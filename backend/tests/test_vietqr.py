import json
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from vietqr_service import (  # noqa: E402
    DEMO_LAYOUT, FONTS, VietQRData, VietQRError, app, build_vietqr, crc16_ccitt, parse_vietqr, render_qr,
)

NEW = VietQRData(bank_bin="970437", account_number="002704070614096",
                 account_name="TRAN THI HUONG", content="ECUV", amount="150000")
OLD = VietQRData(bank_bin="970436", account_number="0123456789", account_name="NGUYEN VAN A", content="OLD")


def test_crc_standard_vector():
    assert crc16_ccitt("123456789") == "29B1"


def test_build_parse_roundtrip():
    d = parse_vietqr(build_vietqr(NEW))
    assert (d.bank_bin, d.account_number, d.account_name, d.content, d.amount) == (
        "970437", "002704070614096", "TRAN THI HUONG", "ECUV", "150000")
    assert d.bank_short_name == "HDBank" and d.crc_valid and d.is_dynamic


def test_tampered_payload_rejected():
    p = build_vietqr(NEW)
    tampered = p.replace("002704070614096", "002704070614097")
    with pytest.raises(VietQRError):
        parse_vietqr(tampered)


def test_not_vietqr_rejected():
    with pytest.raises(VietQRError):
        parse_vietqr("https://example.com")


def test_missing_name_warning():
    d = parse_vietqr(build_vietqr(VietQRData(bank_bin="970418", account_number="123456")))
    assert d.account_name is None
    assert any("tag 59" in w for w in d.warnings)


@pytest.fixture
def files(tmp_path):
    tpl = Image.new("RGB", (800, 500), (245, 248, 255))
    dr = ImageDraw.Draw(tpl)
    dr.rectangle([0, 0, 800, 110], fill=(11, 61, 145))
    tpl.paste(render_qr(build_vietqr(OLD), 300, "#000", "#FFF", 2), (60, 150))
    f = ImageFont.truetype(FONTS["regular"], 28)
    for y, t in [(175, "Vietcombank"), (235, "NGUYEN VAN A"), (295, "STK: 0123456789"), (352, "Nội dung: OLD")]:
        dr.text((400, y), t, fill=(17, 17, 17), font=f)
    tpl_path, qr_path = tmp_path / "tpl.png", tmp_path / "qr.png"
    tpl.save(tpl_path)
    render_qr(build_vietqr(NEW), 400, "#000", "#FFF", 4).save(qr_path)
    return tpl_path, qr_path


def test_api_parse(files):
    _, qr = files
    r = TestClient(app).post("/api/v1/qr/parse", files={"image": qr.open("rb")})
    assert r.status_code == 200
    assert r.json()["data"]["account_number"] == "002704070614096"


def test_api_apply_qr(files, tmp_path):
    tpl, qr = files
    r = TestClient(app).post(
        "/api/v1/template/apply-qr",
        files={"template": tpl.open("rb"), "qr_image": qr.open("rb")},
        data={"layout": json.dumps(DEMO_LAYOUT)},
    )
    assert r.status_code == 200 and r.headers["content-type"] == "image/png"
    out = tmp_path / "out.png"
    out.write_bytes(r.content)
    # decode lại ảnh đầu ra phải ra tài khoản mới
    r2 = TestClient(app).post("/api/v1/qr/parse", files={"image": out.open("rb")})
    assert r2.json()["data"]["account_number"] == "002704070614096"
