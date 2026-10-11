(function () {
  'use strict';
  var V = window.VietQR;
  var $ = function (id) { return document.getElementById(id); };
  var out = $('out'), octx = out.getContext('2d', { willReadFrequently: true });
  var ov = $('overlay'), vctx = ov.getContext('2d');

  var EXAMPLE = '00020101021238590010A0000007270129000697043701150027040706140960208QRIBFTTA530370454061500005802VN5914TRAN THI HUONG62080804ECUV6304336C';
  // Ảnh khung mặc định (thẻ VinClub Member), build.py nhúng từ src/template-vinclub.webp
  var BUILTIN_SRC = '/*BUILTIN_SRC*/';
  var BUILTIN_VER = 2;
  var KEYS = ['qr', 'bank_short_name', 'account_name', 'account_number', 'content', 'amount'];
  var LABEL = { qr: 'Mã QR', bank_short_name: 'Ngân hàng', account_name: 'Chủ TK', account_number: 'STK', content: 'Nội dung', amount: 'Số tiền' };

  var S = {
    qr: null, isExample: true, userName: '',
    templates: [], tpl: null, img: null, orig: null,
    sel: 'qr', tab: 1, verified: null, verifyMsg: '', drag: null
  };

  /* ---------- helpers ---------- */
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function fmtMoney(a) { return Number(a).toLocaleString('vi-VN') + ' đ'; }
  function css(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }
  function setStatus(el, cls, text) { el.className = 'status ' + cls; el.textContent = text; el.hidden = !text; }
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }
  function loadImage(src) {
    return new Promise(function (res, rej) { var im = new Image(); im.onload = function () { res(im); }; im.onerror = rej; im.src = src; });
  }
  function fileToDataURL(f) {
    return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = rej; r.readAsDataURL(f); });
  }

  /* ---------- QR decode ---------- */
  function decodeFrom(img) {
    var tries = [1400, 900, 2000, 600], c = document.createElement('canvas'), x = c.getContext('2d', { willReadFrequently: true });
    var W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
    for (var i = 0; i < tries.length; i++) {
      var k = Math.min(1, tries[i] / Math.max(W, H));
      c.width = Math.max(1, Math.round(W * k)); c.height = Math.max(1, Math.round(H * k));
      x.drawImage(img, 0, 0, c.width, c.height);
      var d = x.getImageData(0, 0, c.width, c.height);
      var r = window.jsQR && jsQR(d.data, c.width, c.height, { inversionAttempts: 'attemptBoth' });
      if (r && r.data) return { data: r.data, loc: r.location, k: k };
    }
    return null;
  }

  function acceptPayload(text) {
    var d;
    try { d = V.parse(text, { strictCrc: true }); }
    catch (e) {
      var msg = e.message === 'NOT_VIETQR'
        ? 'Đây không phải mã chuyển khoản VietQR (có thể là MoMo, ZaloPay hoặc một đường link). Nội dung đọc được: ' + String(text).slice(0, 60)
        : 'Mã QR không hợp lệ: ' + e.message;
      setStatus($('qrStatus'), 'err', msg);
      return false;
    }
    S.qr = d; S.isExample = false; S.userName = '';
    $('nameIn').value = '';
    setStatus($('qrStatus'), 'ok', 'Đã đọc mã QR của ' + (d.bank_short_name || 'ngân hàng BIN ' + d.bank_bin) + '.');
    renderInfo(); render(true);
    return true;
  }

  async function onQRFile(ev) {
    var f = ev.target.files && ev.target.files[0]; ev.target.value = '';
    if (!f) return;
    setStatus($('qrStatus'), 'info', 'Đang đọc mã QR…');
    try {
      var img = await loadImage(URL.createObjectURL(f));
      var r = decodeFrom(img);
      if (!r) { setStatus($('qrStatus'), 'err', 'Không tìm thấy mã QR trong ảnh. Hãy chụp gần hơn, đủ sáng và để mã nằm trọn trong khung hình.'); return; }
      acceptPayload(r.data);
    } catch (e) { setStatus($('qrStatus'), 'err', 'Không mở được ảnh này. Hãy thử ảnh JPG hoặc PNG khác.'); }
  }

  function renderInfo() {
    var d = S.qr, dl = $('info');
    dl.innerHTML = '';
    function row(label, value, opts) {
      opts = opts || {};
      var div = document.createElement('div'), dt = document.createElement('dt'), dd = document.createElement('dd');
      dt.textContent = label; dd.textContent = value; if (opts.num) dd.className = 'num';
      if (opts.muted) dd.style.color = 'var(--warn)';
      div.appendChild(dt); div.appendChild(dd);
      var tail = document.createElement('span');
      if (opts.copy) {
        var b = document.createElement('button'); b.className = 'copy'; b.type = 'button'; b.textContent = 'Sao chép';
        b.onclick = function () {
          var done = function () { b.textContent = 'Đã chép'; setTimeout(function () { b.textContent = 'Sao chép'; }, 1500); };
          try { navigator.clipboard.writeText(opts.copy).then(done, function () { selectText(dd); }); } catch (e) { selectText(dd); }
        };
        tail.appendChild(b);
      }
      div.appendChild(tail); dl.appendChild(div);
    }
    row('Ngân hàng', (d.bank_short_name || 'Chưa rõ') + ' · BIN ' + d.bank_bin);
    row('Chủ TK', d.account_name || 'Không có trong mã QR', { muted: !d.account_name });
    row('Số TK', d.account_number, { num: true, copy: d.account_number });
    row('Nội dung', d.content || '—');
    row('Số tiền', d.amount ? fmtMoney(d.amount) : 'Người chuyển tự nhập', { num: !!d.amount });
    row('Loại mã', (d.is_dynamic ? 'QR động' : 'QR tĩnh') + (d.service === 'card' ? ' · số thẻ' : ' · số tài khoản'));
    $('nameField').hidden = !!d.account_name;
  }
  function selectText(el) { var r = document.createRange(); r.selectNodeContents(el); var s = getSelection(); s.removeAllRanges(); s.addRange(r); }

  function values() {
    var d = S.qr;
    return {
      bank_short_name: d.bank_short_name || ('BIN ' + d.bank_bin),
      account_name: d.account_name || S.userName.trim(),
      account_number: d.account_number,
      content: d.content || '',
      amount: d.amount ? fmtMoney(d.amount) : ''
    };
  }

  /* ---------- built-in template ---------- */
  function builtinLayout() {
    return {
      ver: BUILTIN_VER,
      qr: { box: [548, 56, 372, 372], clear: 'none', quiet: 2, fg: '#000000', bg: '#FFFFFF', show: true },
      fields: {
        bank_short_name: { box: [64, 1240, 849, 50], clear: 'none', size: 40, bold: true, color: '#9FE7E4', align: 'left', upper: false, prefix: '', show: true },
        account_name: { box: [64, 1296, 849, 62], clear: 'none', size: 52, bold: true, color: '#FFFFFF', align: 'left', upper: true, prefix: '', show: true },
        account_number: { box: [64, 1364, 849, 50], clear: 'none', size: 40, bold: false, color: '#FFFFFF', align: 'left', upper: false, prefix: 'STK: ', show: true },
        content: { box: [64, 1420, 849, 44], clear: 'none', size: 32, bold: false, color: '#D6F2F2', align: 'left', upper: false, prefix: 'Nội dung: ', show: true },
        amount: { box: [64, 1470, 849, 48], clear: 'none', size: 36, bold: true, color: '#FFD27A', align: 'left', upper: false, prefix: 'Số tiền: ', show: true }
      }
    };
  }

  /* ---------- rendering ---------- */
  function drawQR(x, payload, box, o) {
    var q = qrcode(0, 'M'); q.addData(payload, 'Byte'); q.make();
    var n = q.getModuleCount(), qz = o.quiet, side = Math.min(box[2], box[3]);
    var m = side / (n + 2 * qz); if (m >= 3) m = Math.floor(m);
    var full = m * (n + 2 * qz), ox = box[0] + (box[2] - full) / 2, oy = box[1] + (box[3] - full) / 2;
    x.fillStyle = o.bg; x.fillRect(Math.round(ox), Math.round(oy), Math.round(full), Math.round(full));
    x.fillStyle = o.fg;
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (q.isDark(r, c)) {
      var px = ox + (c + qz) * m, py = oy + (r + qz) * m;
      x.fillRect(Math.floor(px), Math.floor(py), Math.ceil(px + m) - Math.floor(px), Math.ceil(py + m) - Math.floor(py));
    }
  }

  function sampleBg(box) {
    var d = S.orig, W = d.width, H = d.height, px = d.data, pad = 4;
    var x0 = Math.max(0, Math.round(box[0]) - pad), y0 = Math.max(0, Math.round(box[1]) - pad);
    var x1 = Math.min(W - 1, Math.round(box[0] + box[2]) + pad), y1 = Math.min(H - 1, Math.round(box[1] + box[3]) + pad);
    var rs = [], gs = [], bs = [];
    function take(x, y) { var i = (y * W + x) * 4; rs.push(px[i]); gs.push(px[i + 1]); bs.push(px[i + 2]); }
    var step = Math.max(1, Math.round((x1 - x0 + y1 - y0) / 400));
    for (var x = x0; x <= x1; x += step) { take(x, y0); take(x, y1); }
    for (var y = y0; y <= y1; y += step) { take(x0, y); take(x1, y); }
    function med(a) { a.sort(function (p, q) { return p - q; }); return a[a.length >> 1] || 255; }
    return 'rgb(' + med(rs) + ',' + med(gs) + ',' + med(bs) + ')';
  }

  function fontStr(f, size) { return (f.bold ? '700 ' : '400 ') + size + 'px "Be Vietnam Pro", system-ui, sans-serif'; }

  function drawText(x, f, text) {
    var b = f.box, size = f.size, m;
    while (size > 8) {
      x.font = fontStr(f, size); m = x.measureText(text);
      var h = (m.actualBoundingBoxAscent || size * .8) + (m.actualBoundingBoxDescent || size * .2);
      if (m.width <= b[2] && h <= b[3]) break;
      size -= 1;
    }
    x.font = fontStr(f, size); m = x.measureText(text);
    var asc = m.actualBoundingBoxAscent || size * .8, desc = m.actualBoundingBoxDescent || size * .2;
    var tx = f.align === 'center' ? b[0] + (b[2] - m.width) / 2 : f.align === 'right' ? b[0] + b[2] - m.width : b[0];
    var ty = b[1] + (b[3] - (asc + desc)) / 2 + asc;
    x.textBaseline = 'alphabetic'; x.textAlign = 'left'; x.fillStyle = f.color;
    x.fillText(text, tx, ty);
  }

  var verifyTimer = null;
  function render(verifyNow) {
    if (!S.img || !S.qr) return;
    var L = S.tpl.layout;
    if (out.width !== S.img.naturalWidth || out.height !== S.img.naturalHeight) {
      out.width = ov.width = S.img.naturalWidth; out.height = ov.height = S.img.naturalHeight;
    }
    octx.drawImage(S.img, 0, 0);
    var els = [L.qr].concat(Object.keys(L.fields).map(function (k) { return L.fields[k]; }));
    els.forEach(function (e) { if (e.show && e.clear === 'fill') { octx.fillStyle = sampleBg(e.box); octx.fillRect(e.box[0], e.box[1], e.box[2], e.box[3]); } });
    if (L.qr.show) drawQR(octx, S.qr.raw, L.qr.box, L.qr);
    var v = values();
    Object.keys(L.fields).forEach(function (k) {
      var f = L.fields[k]; if (!f.show || !v[k]) return;
      var t = String(v[k]); if (f.upper) t = t.toLocaleUpperCase('vi-VN');
      drawText(octx, f, (f.prefix || '') + t);
    });
    drawOverlay();
    S.verified = null; updateBadges();
    clearTimeout(verifyTimer);
    verifyTimer = setTimeout(verify, verifyNow ? 0 : 350);
  }

  function verify() {
    var ok = false, msg = '';
    if (!S.tpl.layout.qr.show) { msg = 'Mã QR đang bị ẩn trên thẻ.'; }
    else {
      var r = decodeFrom(out);
      if (!r) msg = 'Không đọc lại được mã QR trên ảnh. Hãy tăng kích thước ô mã QR hoặc tăng viền trắng.';
      else {
        try {
          var d = V.parse(r.data, { strictCrc: true });
          ok = d.bank_bin === S.qr.bank_bin && d.account_number === S.qr.account_number;
          msg = ok ? 'Mã QR trên ảnh khớp ' + (S.qr.bank_short_name || S.qr.bank_bin) + ' · ' + S.qr.account_number + '.' : 'Mã QR trên ảnh không khớp tài khoản đã quét.';
        } catch (e) { msg = 'Mã QR trên ảnh không hợp lệ.'; }
      }
    }
    S.verified = ok; S.verifyMsg = msg;
    updateBadges(); updateExport();
  }

  function updateBadges() {
    var b = $('badges'); b.innerHTML = '';
    function pill(cls, text) { var s = document.createElement('span'); s.className = 'pill ' + cls; s.innerHTML = '<span class="dot"></span>'; s.appendChild(document.createTextNode(text)); b.appendChild(s); }
    if (S.isExample) pill('example', 'Mã QR ví dụ');
    if (S.verified === true) pill('good', 'Đã kiểm tra: QR khớp tài khoản');
    else if (S.verified === false) pill('bad', 'QR chưa khớp');
    else pill('', 'Đang kiểm tra…');
    if (S.qr && !S.qr.account_name && S.userName.trim()) pill('warn', 'Tên chủ TK chưa xác thực');
    if (S.tpl) pill('', 'Khung: ' + S.tpl.name);
  }

  function updateExport() {
    var vb = $('verifyBox');
    if (S.verified === true) { vb.className = 'verify good'; vb.innerHTML = '<div><b>Sẵn sàng xuất ảnh</b><small></small></div>'; }
    else if (S.verified === false) { vb.className = 'verify bad'; vb.innerHTML = '<div><b>Chưa thể xuất ảnh</b><small></small></div>'; }
    else { vb.className = 'verify wait'; vb.innerHTML = '<div><b>Đang kiểm tra ảnh…</b><small></small></div>'; }
    vb.querySelector('small').textContent = S.verifyMsg;
    $('dlBtn').disabled = S.verified !== true;
    $('dlBtn').style.opacity = S.verified === true ? 1 : .5;
    if (S.verified === true) {
      $('resultImg').src = out.toDataURL('image/png');
      $('resultImg').hidden = false; $('dlNote').hidden = false;
      $('sizeInfo').textContent = 'Kích thước: ' + out.width + ' × ' + out.height + ' px';
    } else { $('resultImg').hidden = true; $('dlNote').hidden = true; $('sizeInfo').textContent = ''; }
  }

  /* ---------- overlay & dragging ---------- */
  function elBox(k) { var L = S.tpl.layout; return k === 'qr' ? L.qr : L.fields[k]; }
  function scale() { return out.width / out.getBoundingClientRect().width; }
  function drawOverlay() {
    vctx.clearRect(0, 0, ov.width, ov.height);
    if (S.tab !== 2 || !S.tpl) return;
    var k = scale(), lw = Math.max(1.5, 2 * k), sel = css('--sel') || '#E0592A';
    KEYS.forEach(function (key) {
      var e = elBox(key); if (!e.show) return;
      var b = e.box, on = key === S.sel;
      vctx.setLineDash(on ? [] : [6 * k, 5 * k]);
      vctx.lineWidth = on ? lw * 1.5 : lw;
      vctx.strokeStyle = on ? sel : 'rgba(20,32,51,.55)';
      vctx.strokeRect(b[0], b[1], b[2], b[3]);
      if (!on) { vctx.strokeStyle = 'rgba(255,255,255,.7)'; vctx.lineDashOffset = 5 * k; vctx.strokeRect(b[0], b[1], b[2], b[3]); vctx.lineDashOffset = 0; }
      var fs = Math.round(12 * k);
      vctx.font = '600 ' + fs + 'px "Be Vietnam Pro", sans-serif';
      var tw = vctx.measureText(LABEL[key]).width + 10 * k;
      vctx.fillStyle = on ? sel : 'rgba(20,32,51,.75)';
      vctx.fillRect(b[0], Math.max(0, b[1] - fs - 8 * k), tw, fs + 8 * k);
      vctx.fillStyle = '#fff'; vctx.fillText(LABEL[key], b[0] + 5 * k, Math.max(fs + 2 * k, b[1] - 6 * k));
      if (on) { var h = 22 * k; vctx.setLineDash([]); vctx.fillStyle = sel; vctx.fillRect(b[0] + b[2] - h / 2, b[1] + b[3] - h / 2, h, h); vctx.fillStyle = '#fff'; vctx.fillRect(b[0] + b[2] - h / 4, b[1] + b[3] - h / 4, h / 2, h / 2); }
    });
  }

  function pt(ev) { var r = ov.getBoundingClientRect(), k = out.width / r.width; return [(ev.clientX - r.left) * k, (ev.clientY - r.top) * k]; }
  function inside(p, b, pad) { pad = pad || 0; return p[0] >= b[0] - pad && p[0] <= b[0] + b[2] + pad && p[1] >= b[1] - pad && p[1] <= b[1] + b[3] + pad; }
  ov.addEventListener('pointerdown', function (ev) {
    if (S.tab !== 2) return;
    var p = pt(ev), k = scale(), selB = elBox(S.sel).box, h = 22 * k;
    if (elBox(S.sel).show && Math.abs(p[0] - (selB[0] + selB[2])) <= h && Math.abs(p[1] - (selB[1] + selB[3])) <= h) {
      S.drag = { mode: 'resize', p: p, b: selB.slice() };
    } else {
      var hit = null;
      KEYS.slice().reverse().forEach(function (key) { var e = elBox(key); if (!hit && e.show && inside(p, e.box, 4 * k)) hit = key; });
      if (!hit) return;
      if (hit !== S.sel) { S.sel = hit; buildChips(); buildProps(); }
      S.drag = { mode: 'move', p: p, b: elBox(hit).box.slice() };
    }
    ov.setPointerCapture(ev.pointerId); ev.preventDefault();
    drawOverlay();
  });
  var raf = 0;
  ov.addEventListener('pointermove', function (ev) {
    if (!S.drag) return;
    var p = pt(ev), dx = p[0] - S.drag.p[0], dy = p[1] - S.drag.p[1], b = S.drag.b, e = elBox(S.sel), W = out.width, H = out.height;
    if (S.drag.mode === 'move') {
      e.box[0] = Math.round(Math.min(Math.max(b[0] + dx, 0), W - b[2]));
      e.box[1] = Math.round(Math.min(Math.max(b[1] + dy, 0), H - b[3]));
    } else {
      var nw = Math.max(24, Math.min(b[2] + dx, W - b[0])), nh = Math.max(16, Math.min(b[3] + dy, H - b[1]));
      if (S.sel === 'qr') { nw = nh = Math.min(nw, nh, W - b[0], H - b[1]); }
      e.box[2] = Math.round(nw); e.box[3] = Math.round(nh);
    }
    if (!raf) raf = requestAnimationFrame(function () { raf = 0; render(false); syncBoxInputs(); });
  });
  function endDrag() { if (S.drag) { S.drag = null; markDirty(); } }
  ov.addEventListener('pointerup', endDrag); ov.addEventListener('pointercancel', endDrag);

  /* ---------- element chips & properties ---------- */
  function buildChips() {
    var c = $('elChips'); c.innerHTML = '';
    KEYS.forEach(function (k) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'chip' + (elBox(k).show ? '' : ' off');
      b.textContent = LABEL[k]; b.setAttribute('aria-pressed', String(k === S.sel));
      b.onclick = function () { S.sel = k; buildChips(); buildProps(); drawOverlay(); };
      c.appendChild(b);
    });
  }

  function field(label, input) { var l = document.createElement('label'); l.className = 'field'; l.textContent = label; l.appendChild(input); return l; }
  function num(id, val, on) { var i = document.createElement('input'); i.type = 'number'; i.id = id; i.value = val; i.inputMode = 'numeric'; i.oninput = function () { if (i.value !== '') on(+i.value); }; return i; }

  function buildProps() {
    var p = $('props'), e = elBox(S.sel), isQR = S.sel === 'qr';
    p.innerHTML = '';
    var show = document.createElement('label'); show.className = 'check';
    var cb = document.createElement('input'); cb.type = 'checkbox'; cb.id = 'pShow'; cb.checked = e.show;
    cb.onchange = function () { e.show = cb.checked; buildChips(); change(); };
    show.appendChild(cb); show.appendChild(document.createTextNode('Hiện ' + LABEL[S.sel].toLowerCase() + ' trên thẻ'));
    p.appendChild(show);

    var g = document.createElement('div'); g.className = 'grid4';
    ['X', 'Y', 'Rộng', 'Cao'].forEach(function (lab, i) {
      g.appendChild(field(lab, num('pBox' + i, e.box[i], function (v) {
        e.box[i] = Math.max(i > 1 ? 8 : 0, Math.round(v));
        if (isQR && i > 1) { e.box[2] = e.box[3] = e.box[i]; syncBoxInputs(); }
        change();
      })));
    });
    p.appendChild(g);

    var g2 = document.createElement('div'); g2.className = 'grid2';
    if (isQR) {
      var fg = document.createElement('input'); fg.type = 'color'; fg.id = 'pFg'; fg.value = e.fg; fg.oninput = function () { e.fg = fg.value; change(); };
      var bg = document.createElement('input'); bg.type = 'color'; bg.id = 'pBg'; bg.value = e.bg; bg.oninput = function () { e.bg = bg.value; change(); };
      g2.appendChild(field('Màu mã', fg)); g2.appendChild(field('Màu nền mã', bg));
      g2.appendChild(field('Viền trắng (ô)', num('pQuiet', e.quiet, function (v) { e.quiet = Math.max(0, Math.min(6, Math.round(v))); change(); })));
    } else {
      g2.appendChild(field('Cỡ chữ tối đa (px)', num('pSize', e.size, function (v) { e.size = Math.max(8, Math.round(v)); change(); })));
      var col = document.createElement('input'); col.type = 'color'; col.id = 'pColor'; col.value = e.color; col.oninput = function () { e.color = col.value; change(); };
      g2.appendChild(field('Màu chữ', col));
      var pre = document.createElement('input'); pre.type = 'text'; pre.id = 'pPrefix'; pre.value = e.prefix || ''; pre.placeholder = 'VD: STK: ';
      pre.oninput = function () { e.prefix = pre.value; change(); };
      g2.appendChild(field('Chữ đứng trước', pre));
    }
    var clr = document.createElement('select'); clr.id = 'pClear';
    [['fill', 'Tô màu nền xung quanh'], ['none', 'Không xóa (vùng đã trống)']].forEach(function (o) { var op = document.createElement('option'); op.value = o[0]; op.textContent = o[1]; clr.appendChild(op); });
    clr.value = e.clear; clr.onchange = function () { e.clear = clr.value; change(); };
    g2.appendChild(field('Xóa nội dung cũ', clr));
    p.appendChild(g2);

    if (!isQR) {
      var seg = document.createElement('div'); seg.className = 'seg'; seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', 'Căn lề');
      [['left', 'Trái'], ['center', 'Giữa'], ['right', 'Phải']].forEach(function (o) {
        var b = document.createElement('button'); b.type = 'button'; b.textContent = o[1]; b.setAttribute('aria-pressed', String(e.align === o[0]));
        b.onclick = function () { e.align = o[0]; buildProps(); change(); };
        seg.appendChild(b);
      });
      p.appendChild(field('Căn lề', seg));
      var row = document.createElement('div'); row.className = 'row';
      [['bold', 'Chữ đậm'], ['upper', 'In hoa']].forEach(function (o) {
        var l = document.createElement('label'); l.className = 'check';
        var c2 = document.createElement('input'); c2.type = 'checkbox'; c2.id = 'p_' + o[0]; c2.checked = !!e[o[0]];
        c2.onchange = function () { e[o[0]] = c2.checked; change(); };
        l.appendChild(c2); l.appendChild(document.createTextNode(o[1])); l.style.marginRight = '12px'; row.appendChild(l);
      });
      p.appendChild(row);
    }
  }
  function syncBoxInputs() { var e = elBox(S.sel); for (var i = 0; i < 4; i++) { var el = $('pBox' + i); if (el && document.activeElement !== el) el.value = e.box[i]; } }
  function change() { render(false); markDirty(); }
  function markDirty() { S.dirty = true; $('saveTpl').textContent = 'Lưu khung'; }

  /* ---------- template storage (IndexedDB, per device) ---------- */
  var dbp = null;
  function idb() {
    if (dbp) return dbp;
    dbp = new Promise(function (res) {
      try {
        var rq = indexedDB.open('smart-vietqr', 1);
        rq.onupgradeneeded = function () { rq.result.createObjectStore('templates', { keyPath: 'id' }); };
        rq.onsuccess = function () { res(rq.result); }; rq.onerror = function () { res(null); };
      } catch (e) { res(null); }
    });
    return dbp;
  }
  async function dbAll() { var db = await idb(); if (!db) return []; return new Promise(function (res) { try { var r = db.transaction('templates').objectStore('templates').getAll(); r.onsuccess = function () { res(r.result || []); }; r.onerror = function () { res([]); }; } catch (e) { res([]); } }); }
  async function dbPut(t) { var db = await idb(); if (!db) return false; return new Promise(function (res) { try { var tx = db.transaction('templates', 'readwrite'); tx.objectStore('templates').put(t); tx.oncomplete = function () { res(true); }; tx.onerror = function () { res(false); }; } catch (e) { res(false); } }); }
  async function dbDel(id) { var db = await idb(); if (!db) return; return new Promise(function (res) { try { var tx = db.transaction('templates', 'readwrite'); tx.objectStore('templates').delete(id); tx.oncomplete = res; tx.onerror = res; } catch (e) { res(); } }); }

  function buildTplList() {
    var c = $('tpls'); c.innerHTML = '';
    var add = document.createElement('label'); add.className = 'tpl add'; add.setAttribute('for', 'tplIn'); add.tabIndex = 0;
    add.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg><span>Tải khung mới</span>';
    add.onkeydown = function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); $('tplIn').click(); } };
    c.appendChild(add);
    S.templates.forEach(function (t) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'tpl'; b.setAttribute('aria-pressed', String(S.tpl && S.tpl.id === t.id));
      var im = document.createElement('img'); im.src = t.thumb || t.src; im.alt = '';
      var s = document.createElement('span'); s.textContent = t.name;
      b.appendChild(im); b.appendChild(s);
      b.onclick = function () { selectTpl(t.id); };
      c.appendChild(b);
    });
  }

  async function selectTpl(id) {
    var t = S.templates.filter(function (x) { return x.id === id; })[0]; if (!t) return;
    S.tpl = t; store('svq-last', id);
    S.img = await loadImage(t.src);
    var c = document.createElement('canvas'); c.width = S.img.naturalWidth; c.height = S.img.naturalHeight;
    var x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(S.img, 0, 0);
    S.orig = x.getImageData(0, 0, c.width, c.height);
    $('delTpl').hidden = !!t.builtin; $('confirmDel').hidden = true; $('renameField').hidden = true;
    buildTplList(); buildChips(); buildProps(); render(true);
  }

  function thumbOf(img) {
    var c = document.createElement('canvas'), k = 240 / img.naturalWidth; c.width = 240; c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); return c.toDataURL('image/jpeg', .8);
  }

  function guessLayout(img) {
    var W = img.naturalWidth, H = img.naturalHeight, r = decodeFrom(img), qb, found = false;
    if (r) {
      var L = r.loc, xs = [L.topLeftCorner.x, L.topRightCorner.x, L.bottomLeftCorner.x, L.bottomRightCorner.x].map(function (v) { return v / r.k; });
      var ys = [L.topLeftCorner.y, L.topRightCorner.y, L.bottomLeftCorner.y, L.bottomRightCorner.y].map(function (v) { return v / r.k; });
      var x0 = Math.min.apply(0, xs), x1 = Math.max.apply(0, xs), y0 = Math.min.apply(0, ys), y1 = Math.max.apply(0, ys);
      var side = Math.max(x1 - x0, y1 - y0), pad = side * 0.07;
      qb = [Math.max(0, Math.round(x0 - pad)), Math.max(0, Math.round(y0 - pad)), Math.round(side + 2 * pad), Math.round(side + 2 * pad)];
      qb[2] = qb[3] = Math.min(qb[2], W - qb[0], H - qb[1]);
      found = true;
    } else {
      var s0 = Math.round(Math.min(W, H) * 0.5); qb = [Math.round(W * 0.06), Math.round((H - s0) / 2), s0, s0];
    }
    var right = W - (qb[0] + qb[2]) > W * 0.32, fields = {}, keys = KEYS.slice(1), sizes = [0.09, 0.105, 0.09, 0.075, 0.075];
    var unit = qb[3] / 7, rowH = qb[3] / keys.length;
    keys.forEach(function (k, i) {
      var h = Math.round(Math.max(24, unit * 0.95)), box;
      // Bên phải QR: chia đều cột chữ theo chiều cao QR để phủ kín chữ cũ.
      if (right) { var fx = qb[0] + qb[2] + Math.round(W * 0.03); box = [fx, Math.round(qb[1] + i * rowH), Math.round(W - fx - W * 0.04), Math.round(rowH * 0.94)]; }
      else { var fy = qb[1] + qb[3] + Math.round(H * 0.02) + i * Math.round(h * 1.1); box = [Math.round(W * 0.08), Math.min(fy, H - h), Math.round(W * 0.84), h]; }
      fields[k] = { box: box, clear: 'fill', size: Math.round(Math.max(14, qb[3] * sizes[i])), bold: k === 'account_name' || k === 'bank_short_name' || k === 'amount', color: '#142033', align: right ? 'left' : 'center', upper: k === 'account_name', prefix: { account_number: 'STK: ', content: 'Nội dung: ', amount: 'Số tiền: ' }[k] || '', show: true };
    });
    return { layout: { qr: { box: qb, clear: 'fill', quiet: 2, fg: '#000000', bg: '#FFFFFF', show: true }, fields: fields }, found: found, old: r && r.data };
  }

  function autoTextColor(layout) {
    Object.keys(layout.fields).forEach(function (k) {
      var m = /rgb\((\d+),(\d+),(\d+)\)/.exec(sampleBg(layout.fields[k].box));
      if (m) { var lum = (0.299 * m[1] + 0.587 * m[2] + 0.114 * m[3]); layout.fields[k].color = lum < 120 ? '#FFFFFF' : '#142033'; }
    });
  }

  async function onTplFile(ev) {
    var f = ev.target.files && ev.target.files[0]; ev.target.value = '';
    if (!f) return;
    setStatus($('tplStatus'), 'info', 'Đang phân tích khung…');
    try {
      var src = await fileToDataURL(f), img = await loadImage(src);
      var maxSide = 2400;
      if (Math.max(img.naturalWidth, img.naturalHeight) > maxSide) {
        var k = maxSide / Math.max(img.naturalWidth, img.naturalHeight), c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); src = c.toDataURL('image/png'); img = await loadImage(src);
      }
      var g = guessLayout(img);
      var t = { id: 'tpl-' + Date.now(), name: (f.name || 'Khung mới').replace(/\.[^.]+$/, '').slice(0, 40), src: src, thumb: thumbOf(img), layout: g.layout, updated: Date.now() };
      S.templates.push(t);
      await selectTpl(t.id);
      autoTextColor(t.layout); buildProps(); render(true);
      setStatus($('tplStatus'), g.found ? 'ok' : 'info', g.found
        ? 'Đã tìm thấy mã QR cũ và đặt sẵn ô mã QR. Kéo các ô chữ vào đúng chỗ chữ cũ, rồi bấm Lưu khung.'
        : 'Không tìm thấy mã QR cũ trên khung. Kéo ô Mã QR và các ô chữ vào đúng vị trí, rồi bấm Lưu khung.');
      S.sel = g.found ? 'account_name' : 'qr'; buildChips(); buildProps(); drawOverlay();
      markDirty();
    } catch (e) { setStatus($('tplStatus'), 'err', 'Không mở được ảnh khung. Hãy dùng ảnh PNG hoặc JPG.'); }
  }

  async function saveTpl() {
    var t = S.tpl, rec = clone(t);
    if (t.builtin) { rec.src = null; rec.thumb = null; }
    t.updated = rec.updated = Date.now();
    var ok = await dbPut(rec);
    S.dirty = false;
    $('saveTpl').textContent = ok ? 'Đã lưu' : 'Chỉ lưu tạm';
    setStatus($('tplStatus'), ok ? 'ok' : 'err', ok ? 'Đã lưu khung "' + t.name + '" trên thiết bị này.' : 'Trình duyệt không cho lưu lâu dài. Khung chỉ giữ đến khi bạn đóng trang.');
  }

  /* ---------- tabs ---------- */
  function setTab(n) {
    S.tab = n;
    [1, 2, 3].forEach(function (i) { $('t' + i).setAttribute('aria-selected', String(i === n)); $('p' + i).hidden = i !== n; });
    ov.style.pointerEvents = n === 2 ? 'auto' : 'none';
    ov.style.cursor = n === 2 ? 'move' : 'default';
    drawOverlay();
    store('svq-tab', String(n));
  }

  /* ---------- export ---------- */
  var dlCap = null;
  async function download() {
    if (S.verified !== true) return;
    var blob = await new Promise(function (res) { out.toBlob(res, 'image/png'); });
    var name = 'vietqr-' + (S.qr.bank_short_name || S.qr.bank_bin).replace(/\s+/g, '') + '-' + S.qr.account_number + '.png';
    if (!dlCap) { setStatus($('dlStatus'), 'info', 'Thiết bị này chưa hỗ trợ nút tải. Nhấn giữ vào ảnh bên dưới và chọn Lưu ảnh.'); return; }
    try {
      await dlCap.save({ filename: name, data: blob });
      setStatus($('dlStatus'), 'ok', 'Đã lưu ' + name + '.');
    } catch (e) {
      var code = e && e.code;
      setStatus($('dlStatus'), code === 'declined' ? 'info' : 'err',
        code === 'declined' ? 'Bạn đã hủy lưu ảnh.' : code === 'rate_limited' ? 'Đang có một hộp thoại lưu đang mở. Thử lại sau giây lát.' : 'Không lưu được ở đây. Nhấn giữ vào ảnh bên dưới và chọn Lưu ảnh.');
    }
  }

  /* ---------- boot ---------- */
  async function boot() {
    try { await Promise.all([document.fonts.load('700 40px "Be Vietnam Pro"'), document.fonts.load('400 40px "Be Vietnam Pro"'), document.fonts.load('500 24px "Be Vietnam Pro"')]); } catch (e) {}
    if (!window.jsQR || !window.qrcode) {
      setStatus($('qrStatus'), 'err', 'Không tải được thư viện đọc/tạo mã QR. Kiểm tra kết nối mạng rồi mở lại trang.');
      return;
    }
    qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
    S.qr = V.parse(EXAMPLE, { strictCrc: true });
    renderInfo();

    var builtinSrc = BUILTIN_SRC;
    var builtin = { id: 'builtin', name: 'VinClub Member', builtin: true, src: builtinSrc, layout: builtinLayout() };
    var saved = await dbAll();
    // chỉ dùng layout đã lưu nếu nó thuộc đúng phiên bản ảnh khung hiện tại
    saved.forEach(function (t) { if (t.id === 'builtin') { if (t.layout && t.layout.ver === BUILTIN_VER) { builtin.layout = t.layout; if (t.name) builtin.name = t.name; } } });
    S.templates = [builtin].concat(saved.filter(function (t) { return t.id !== 'builtin' && t.src; }).sort(function (a, b) { return (b.updated || 0) - (a.updated || 0); }));
    builtin.thumb = await loadImage(builtinSrc).then(thumbOf);
    var last = store('svq-last');
    await selectTpl(S.templates.some(function (t) { return t.id === last; }) ? last : 'builtin');
    var tab = +(store('svq-tab') || 1); setTab(tab >= 1 && tab <= 3 ? tab : 1);

    try { if (window.claude && window.claude.use) window.claude.use('downloads').then(function (d) { dlCap = d; }); } catch (e) {}
  }

  $('t1').onclick = function () { setTab(1); };
  $('t2').onclick = function () { setTab(2); };
  $('t3').onclick = function () { setTab(3); };
  $('camIn').onchange = onQRFile; $('galIn').onchange = onQRFile;
  $('payloadBtn').onclick = function () { var v = $('payloadIn').value.trim(); if (v) acceptPayload(v); };
  $('nameIn').oninput = function () { S.userName = $('nameIn').value; render(false); };
  $('tplIn').onchange = onTplFile;
  $('saveTpl').onclick = saveTpl;
  $('renameTpl').onclick = function () { var f = $('renameField'); f.hidden = !f.hidden; $('renameIn').value = S.tpl.name; if (!f.hidden) $('renameIn').focus(); };
  $('renameIn').oninput = function () { S.tpl.name = $('renameIn').value.slice(0, 40) || 'Khung'; buildTplList(); updateBadges(); markDirty(); };
  $('delTpl').onclick = function () { $('confirmDel').hidden = false; };
  $('delNo').onclick = function () { $('confirmDel').hidden = true; };
  $('delYes').onclick = async function () {
    var id = S.tpl.id; await dbDel(id);
    S.templates = S.templates.filter(function (t) { return t.id !== id; });
    setStatus($('tplStatus'), 'info', 'Đã xóa khung.');
    selectTpl('builtin');
  };
  $('dlBtn').onclick = download;
  window.addEventListener('resize', drawOverlay);
  boot();
})();
