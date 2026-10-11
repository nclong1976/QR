"""
Smart VietQR Template Generator & Scanner - backend demo (FastAPI + OpenCV + Pillow).

Chạy:  pip install fastapi uvicorn python-multipart opencv-python-headless pillow qrcode
       uvicorn vietqr_service:app --reload

Luồng: decode ảnh QR -> parse EMVCo/VietQR -> build lại payload (CRC hợp lệ) -> render QR
       -> xóa vùng cũ trên template -> vẽ QR + text mới theo layout JSON -> trả PNG.
"""
from __future__ import annotations

import base64
import io
import json
from dataclasses import dataclass, asdict, field
from typing import Literal, Optional

import cv2
import numpy as np
import qrcode
from PIL import Image, ImageDraw, ImageFont

# --------------------------------------------------------------------------------------
# 1. EMVCo / VietQR parser & builder
# --------------------------------------------------------------------------------------
NAPAS_GUID = "A000000727"
BANKS = {  # BIN -> (short name, full name). Bản đầy đủ: lấy từ danh sách BIN của NAPAS.
    "970436": ("Vietcombank", "NH TMCP Ngoại Thương Việt Nam"),
    "970415": ("VietinBank", "NH TMCP Công Thương Việt Nam"),
    "970418": ("BIDV", "NH TMCP Đầu tư và Phát triển Việt Nam"),
    "970405": ("Agribank", "NH Nông nghiệp và Phát triển Nông thôn"),
    "970422": ("MB", "NH TMCP Quân Đội"),
    "970407": ("Techcombank", "NH TMCP Kỹ Thương Việt Nam"),
    "970416": ("ACB", "NH TMCP Á Châu"),
    "970432": ("VPBank", "NH TMCP Việt Nam Thịnh Vượng"),
    "970423": ("TPBank", "NH TMCP Tiên Phong"),
    "970403": ("Sacombank", "NH TMCP Sài Gòn Thương Tín"),
    "970437": ("HDBank", "NH TMCP Phát triển TP.HCM"),
    "970441": ("VIB", "NH TMCP Quốc tế Việt Nam"),
    "970443": ("SHB", "NH TMCP Sài Gòn - Hà Nội"),
}


class VietQRError(ValueError):
    pass


def crc16_ccitt(data: str) -> str:
    """CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF) - chuẩn EMVCo tag 63."""
    crc = 0xFFFF
    for b in data.encode("utf-8"):
        crc ^= b << 8
        for _ in range(8):
            crc = ((crc << 1) ^ 0x1021) if crc & 0x8000 else crc << 1
            crc &= 0xFFFF
    return f"{crc:04X}"


def parse_tlv(s: str) -> dict[str, str]:
    """Tách chuỗi Tag(2) Length(2) Value(n) thành dict."""
    out, i = {}, 0
    while i < len(s):
        if i + 4 > len(s):
            raise VietQRError(f"TLV bị cắt cụt tại vị trí {i}")
        tag, length = s[i:i + 2], s[i + 2:i + 4]
        if not length.isdigit():
            raise VietQRError(f"Length không hợp lệ tại tag {tag}")
        n = int(length)
        value = s[i + 4:i + 4 + n]
        if len(value) != n:
            raise VietQRError(f"Value tag {tag} thiếu dữ liệu")
        out[tag] = value
        i += 4 + n
    return out


def tlv(tag: str, value: str) -> str:
    if len(value) > 99:
        raise VietQRError(f"Tag {tag} dài quá 99 ký tự")
    return f"{tag}{len(value):02d}{value}"


@dataclass
class VietQRData:
    bank_bin: str
    account_number: str
    bank_short_name: Optional[str] = None
    bank_name: Optional[str] = None
    account_name: Optional[str] = None      # tag 59 - NHIỀU QR ngân hàng KHÔNG có trường này
    amount: Optional[str] = None            # tag 54
    content: Optional[str] = None           # tag 62.08
    service: Literal["account", "card"] = "account"
    is_dynamic: bool = False                # tag 01 = 12
    crc_valid: bool = True
    raw: str = ""
    warnings: list[str] = field(default_factory=list)


def parse_vietqr(payload: str, strict_crc: bool = True) -> VietQRData:
    payload = payload.strip()
    root = parse_tlv(payload)
    warnings: list[str] = []

    # CRC: tính trên toàn bộ chuỗi tới hết "6304"
    crc_ok = True
    if "63" in root:
        crc_ok = crc16_ccitt(payload[:-4]) == root["63"].upper()
        if not crc_ok:
            if strict_crc:
                raise VietQRError("CRC không khớp - QR có thể bị sửa hoặc đọc lỗi")
            warnings.append("CRC không khớp")
    else:
        warnings.append("Thiếu tag 63 (CRC)")

    mai = parse_tlv(root.get("38", ""))
    if mai.get("00") != NAPAS_GUID:
        raise VietQRError("Không phải VietQR (tag 38.00 khác A000000727)")
    bene = parse_tlv(mai.get("01", ""))
    bank_bin, acc = bene.get("00"), bene.get("01")
    if not bank_bin or not acc:
        raise VietQRError("Thiếu BIN hoặc số tài khoản")

    add = parse_tlv(root["62"]) if "62" in root else {}
    short, full = BANKS.get(bank_bin, (None, None))
    if short is None:
        warnings.append(f"BIN {bank_bin} chưa có trong bảng ngân hàng")
    name = root.get("59")
    if not name:
        warnings.append("QR không chứa tên chủ TK (tag 59) - cần tra cứu hoặc nhập & xác nhận")

    return VietQRData(
        bank_bin=bank_bin, account_number=acc, bank_short_name=short, bank_name=full,
        account_name=name, amount=root.get("54"), content=add.get("08"),
        service="card" if mai.get("02") == "QRIBFTTC" else "account",
        is_dynamic=root.get("01") == "12", crc_valid=crc_ok, raw=payload, warnings=warnings,
    )


def build_vietqr(d: VietQRData) -> str:
    """Sinh lại payload VietQR chuẩn (dùng để render QR sạch, không cắt ảnh QR gốc)."""
    bene = tlv("00", d.bank_bin) + tlv("01", d.account_number)
    mai = tlv("00", NAPAS_GUID) + tlv("01", bene) + tlv("02", "QRIBFTTC" if d.service == "card" else "QRIBFTTA")
    s = tlv("00", "01") + tlv("01", "12" if d.amount else "11") + tlv("38", mai) + tlv("53", "704")
    if d.amount:
        s += tlv("54", d.amount)
    s += tlv("58", "VN")
    if d.account_name:
        s += tlv("59", d.account_name[:25])
    if d.content:
        s += tlv("62", tlv("08", d.content[:50]))
    s += "6304"
    return s + crc16_ccitt(s)


# --------------------------------------------------------------------------------------
# 2. Decode QR từ ảnh (camera frame / ảnh thư viện)
# --------------------------------------------------------------------------------------
def decode_qr(img_bgr: np.ndarray) -> tuple[str, np.ndarray]:
    """Trả về (chuỗi, 4 góc). Thử thêm ảnh xám + phóng to cho ảnh nhỏ/mờ."""
    det = cv2.QRCodeDetector()
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    for cand, scale in ((img_bgr, 1), (gray, 1), (cv2.resize(gray, None, fx=2, fy=2), 2)):
        text, pts, _ = det.detectAndDecode(cand)
        if text:
            return text, (pts.reshape(-1, 2) / scale)
    raise VietQRError("Không tìm thấy hoặc không đọc được mã QR trong ảnh")


# --------------------------------------------------------------------------------------
# 3. Template layout + renderer
# --------------------------------------------------------------------------------------
# Layout JSON (lưu cùng template). Toạ độ px trên ảnh gốc của template.
# clear: "fill" = đổ màu nền lấy mẫu quanh viền box (nền phẳng)
#        "inpaint" = cv2.inpaint (nền gradient/texture nhẹ)
#        "none" = vùng đã trống sẵn trên template
DEMO_LAYOUT = {
    "qr": {"box": [60, 150, 300, 300], "clear": "fill", "quiet_zone": 2,
           "fg": "#000000", "bg": "#FFFFFF"},
    "fields": [
        {"key": "bank_short_name", "box": [400, 170, 360, 40], "clear": "fill",
         "font": "bold", "size": 30, "color": "#0B3D91", "align": "left"},
        {"key": "account_name", "box": [400, 230, 360, 44], "clear": "fill",
         "font": "bold", "size": 32, "color": "#111111", "align": "left", "upper": True},
        {"key": "account_number", "box": [400, 290, 360, 40], "clear": "fill",
         "font": "regular", "size": 30, "color": "#111111", "align": "left",
         "prefix": "STK: "},
        {"key": "content", "box": [400, 350, 360, 36], "clear": "fill",
         "font": "regular", "size": 24, "color": "#444444", "align": "left",
         "prefix": "Nội dung: "},
    ],
}

FONTS = {  # Production: dùng font hỗ trợ tiếng Việt đầy đủ, VD Be Vietnam Pro / Roboto / Inter
    "regular": "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "bold": "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
}


def hex_to_rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))  # type: ignore


def sample_bg(img: np.ndarray, x: int, y: int, w: int, h: int, pad: int = 4) -> tuple[int, ...]:
    """Lấy màu nền = median các pixel trên viền ngoài box (bỏ qua chính nội dung bên trong)."""
    H, W = img.shape[:2]
    x0, y0, x1, y1 = max(x - pad, 0), max(y - pad, 0), min(x + w + pad, W), min(y + h + pad, H)
    ring = np.concatenate([
        img[y0:y, x0:x1].reshape(-1, 3), img[y + h:y1, x0:x1].reshape(-1, 3),
        img[y0:y1, x0:x].reshape(-1, 3), img[y0:y1, x + w:x1].reshape(-1, 3),
    ])
    return tuple(int(v) for v in np.median(ring, axis=0)) if len(ring) else (255, 255, 255)


def clear_region(img: np.ndarray, box: list[int], mode: str) -> None:
    x, y, w, h = box
    if mode == "fill":
        img[y:y + h, x:x + w] = sample_bg(img, x, y, w, h)
    elif mode == "inpaint":
        mask = np.zeros(img.shape[:2], np.uint8)
        mask[y:y + h, x:x + w] = 255
        img[:] = cv2.inpaint(img, mask, 5, cv2.INPAINT_TELEA)


def render_qr(payload: str, size: int, fg: str, bg: str, quiet_zone: int) -> Image.Image:
    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, border=quiet_zone, box_size=10)
    qr.add_data(payload)
    qr.make(fit=True)
    im = qr.make_image(fill_color=fg, back_color=bg).convert("RGB")
    return im.resize((size, size), Image.NEAREST)  # NEAREST giữ cạnh module sắc nét


def fit_font(draw: ImageDraw.ImageDraw, text: str, font_key: str, size: int, max_w: int, max_h: int):
    """Giảm cỡ chữ đến khi vừa box (chống tràn với tên dài)."""
    while size > 8:
        font = ImageFont.truetype(FONTS[font_key], size)
        l, t, r, b = draw.textbbox((0, 0), text, font=font)
        if r - l <= max_w and b - t <= max_h:
            return font, (l, t, r, b)
        size -= 1
    font = ImageFont.truetype(FONTS[font_key], 8)
    return font, draw.textbbox((0, 0), text, font=font)


def apply_template(template_bgr: np.ndarray, data: VietQRData, layout: dict) -> Image.Image:
    img = template_bgr.copy()

    # Step 4: xóa nội dung cũ
    clear_region(img, layout["qr"]["box"], layout["qr"].get("clear", "fill"))
    for f in layout["fields"]:
        clear_region(img, f["box"], f.get("clear", "fill"))

    canvas = Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
    draw = ImageDraw.Draw(canvas)

    # Step 5a: QR mới sinh từ payload chuẩn
    q = layout["qr"]
    x, y, w, h = q["box"]
    side = min(w, h)
    qr_img = render_qr(build_vietqr(data), side, q.get("fg", "#000"), q.get("bg", "#FFF"), q.get("quiet_zone", 2))
    canvas.paste(qr_img, (x + (w - side) // 2, y + (h - side) // 2))

    # Step 5b: text - luôn lấy từ dữ liệu QR đã parse
    values = asdict(data)
    for f in layout["fields"]:
        val = values.get(f["key"])
        if not val:
            continue
        text = f.get("prefix", "") + (str(val).upper() if f.get("upper") else str(val))
        bx, by, bw, bh = f["box"]
        font, (l, t, r, b) = fit_font(draw, text, f.get("font", "regular"), f.get("size", 24), bw, bh)
        tw, th = r - l, b - t
        tx = {"left": bx, "center": bx + (bw - tw) // 2, "right": bx + bw - tw}[f.get("align", "left")] - l
        ty = by + (bh - th) // 2 - t
        draw.text((tx, ty), text, font=font, fill=hex_to_rgb(f.get("color", "#000000")))

    return canvas


def verify_output(img: Image.Image, data: VietQRData) -> bool:
    """Step 6 guard: decode lại ảnh kết quả, phải khớp BIN + STK trước khi trả về."""
    text, _ = decode_qr(cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR))
    out = parse_vietqr(text)
    return out.bank_bin == data.bank_bin and out.account_number == data.account_number


# --------------------------------------------------------------------------------------
# 4. FastAPI
# --------------------------------------------------------------------------------------
try:
    from fastapi import FastAPI, File, Form, HTTPException, UploadFile
    from fastapi.responses import Response
except ImportError:  # cho phép import module mà không cần FastAPI
    FastAPI = None

if FastAPI:
    app = FastAPI(title="Smart VietQR API", version="1.0")

    def _read_image(raw: bytes) -> np.ndarray:
        img = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
        if img is None:
            raise HTTPException(415, {"code": "INVALID_IMAGE", "message": "Không đọc được ảnh"})
        return img

    @app.post("/api/v1/qr/parse")
    async def qr_parse(image: Optional[UploadFile] = File(None), payload: Optional[str] = Form(None)):
        try:
            if image is not None:
                payload, corners = decode_qr(_read_image(await image.read()))
            elif payload:
                corners = None
            else:
                raise HTTPException(422, {"code": "MISSING_INPUT", "message": "Cần image hoặc payload"})
            d = parse_vietqr(payload, strict_crc=False)
        except VietQRError as e:
            raise HTTPException(422, {"code": "QR_INVALID", "message": str(e)})
        return {"success": True, "data": asdict(d),
                "qr_corners": corners.round(1).tolist() if corners is not None else None}

    @app.post("/api/v1/template/apply-qr")
    async def template_apply(
        template: UploadFile = File(...),
        layout: str = Form(...),                       # layout JSON (hoặc template_id ở bản thật)
        qr_image: Optional[UploadFile] = File(None),
        qr_payload: Optional[str] = Form(None),
        account_name: Optional[str] = Form(None),      # chỉ dùng khi QR không có tag 59
        output: Literal["png", "base64"] = Form("png"),
    ):
        try:
            if qr_image is not None:
                qr_payload, _ = decode_qr(_read_image(await qr_image.read()))
            if not qr_payload:
                raise HTTPException(422, {"code": "MISSING_INPUT", "message": "Cần qr_image hoặc qr_payload"})
            d = parse_vietqr(qr_payload)               # strict CRC khi xuất ảnh
            if not d.account_name and account_name:
                d.account_name = account_name.strip()
                d.warnings.append("Tên chủ TK do người dùng nhập, chưa xác thực")
            result = apply_template(_read_image(await template.read()), d, json.loads(layout))
            if not verify_output(result, d):
                raise HTTPException(500, {"code": "VERIFY_FAILED", "message": "QR đầu ra không khớp dữ liệu"})
        except VietQRError as e:
            raise HTTPException(422, {"code": "QR_INVALID", "message": str(e)})

        buf = io.BytesIO()
        result.save(buf, "PNG")
        if output == "png":
            return Response(buf.getvalue(), media_type="image/png",
                            headers={"X-VietQR-Warnings": json.dumps(d.warnings, ensure_ascii=True)})
        return {"success": True, "data": asdict(d),
                "image_base64": base64.b64encode(buf.getvalue()).decode()}
