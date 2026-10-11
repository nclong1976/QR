"""Ghép web/src thành 1 file HTML: web/index.html (đủ doctype) và bản artifact (không skeleton)."""
import sys, pathlib, base64
src = pathlib.Path(__file__).parent / "src"
page = (src / "page.html").read_text(encoding="utf-8")
vendor = pathlib.Path(__file__).parent / "vendor"
# thư viện được nhúng thẳng vào trang để không phụ thuộc CDN (mạng/trình duyệt trong app có thể chặn)
page = page.replace("/*VENDOR_JSQR*/", "/* jsQR 1.4.0 - Apache-2.0 - https://github.com/cozmo/jsQR */\n" + (vendor / "jsQR.js").read_text(encoding="utf-8"))
page = page.replace("/*VENDOR_QRCODE*/", "/* qrcode-generator 1.4.4 - MIT - https://github.com/kazuhikoarase/qrcode-generator */\n" + (vendor / "qrcode.js").read_text(encoding="utf-8"))
page = page.replace("/*CORE*/", (src / "core.js").read_text(encoding="utf-8"))
page = page.replace("/*APP*/", (src / "app.js").read_text(encoding="utf-8"))
tpl = base64.b64encode((src / "template-vinclub.webp").read_bytes()).decode("ascii")
page = page.replace("/*BUILTIN_SRC*/", "data:image/webp;base64," + tpl)
head = ('<!doctype html><html lang="vi"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
        # cài lên màn hình chính: biểu tượng mã QR, mở toàn màn hình như ứng dụng
        '<link rel="manifest" href="manifest.webmanifest">'
        '<link rel="icon" type="image/png" sizes="32x32" href="icons/favicon-32.png">'
        '<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">'
        '<meta name="theme-color" content="#0E6E6A">'
        '<meta name="mobile-web-app-capable" content="yes">'
        '<meta name="apple-mobile-web-app-capable" content="yes">'
        '<meta name="apple-mobile-web-app-title" content="VietQR">'
        '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">'
        '<style>[hidden]{display:none!important}body{margin:0}img{max-width:100%}</style></head><body>\n')
(pathlib.Path(__file__).parent / "index.html").write_text(head + page + "\n</body></html>\n", encoding="utf-8")
if len(sys.argv) > 1:
    pathlib.Path(sys.argv[1]).write_text(page, encoding="utf-8")
print("ok", len(page))
