"""Ghép web/src thành 1 file HTML: web/index.html (đủ doctype) và bản artifact (không skeleton)."""
import sys, pathlib, base64
src = pathlib.Path(__file__).parent / "src"
page = (src / "page.html").read_text(encoding="utf-8")
page = page.replace("/*CORE*/", (src / "core.js").read_text(encoding="utf-8"))
page = page.replace("/*APP*/", (src / "app.js").read_text(encoding="utf-8"))
tpl = base64.b64encode((src / "template-vinclub.webp").read_bytes()).decode("ascii")
page = page.replace("/*BUILTIN_SRC*/", "data:image/webp;base64," + tpl)
head = ('<!doctype html><html lang="vi"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
        '<style>[hidden]{display:none!important}body{margin:0}img{max-width:100%}</style></head><body>\n')
(pathlib.Path(__file__).parent / "index.html").write_text(head + page + "\n</body></html>\n", encoding="utf-8")
if len(sys.argv) > 1:
    pathlib.Path(sys.argv[1]).write_text(page, encoding="utf-8")
print("ok", len(page))
