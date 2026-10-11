/* Smart VietQR - core: EMVCo/VietQR parse + build (no DOM). */
(function (root) {
  'use strict';
  var NAPAS_GUID = 'A000000727';
  // BIN -> [tên ngắn, tên đầy đủ]. Bảng rút gọn; bản production lấy từ danh sách NAPAS.
  var BANKS = {
    '970436': ['Vietcombank', 'NH TMCP Ngoại Thương Việt Nam'],
    '970415': ['VietinBank', 'NH TMCP Công Thương Việt Nam'],
    '970418': ['BIDV', 'NH TMCP Đầu tư và Phát triển Việt Nam'],
    '970405': ['Agribank', 'NH Nông nghiệp và Phát triển Nông thôn VN'],
    '970422': ['MB', 'NH TMCP Quân Đội'],
    '970407': ['Techcombank', 'NH TMCP Kỹ Thương Việt Nam'],
    '970416': ['ACB', 'NH TMCP Á Châu'],
    '970432': ['VPBank', 'NH TMCP Việt Nam Thịnh Vượng'],
    '970423': ['TPBank', 'NH TMCP Tiên Phong'],
    '970403': ['Sacombank', 'NH TMCP Sài Gòn Thương Tín'],
    '970437': ['HDBank', 'NH TMCP Phát triển TP.HCM'],
    '970441': ['VIB', 'NH TMCP Quốc tế Việt Nam'],
    '970443': ['SHB', 'NH TMCP Sài Gòn - Hà Nội'],
    '970448': ['OCB', 'NH TMCP Phương Đông'],
    '970426': ['MSB', 'NH TMCP Hàng Hải Việt Nam'],
    '970431': ['Eximbank', 'NH TMCP Xuất Nhập khẩu Việt Nam'],
    '970440': ['SeABank', 'NH TMCP Đông Nam Á'],
    '970449': ['LPBank', 'NH TMCP Lộc Phát Việt Nam'],
    '970454': ['BVBank', 'NH TMCP Bản Việt'],
    '970428': ['Nam A Bank', 'NH TMCP Nam Á'],
    '970409': ['Bac A Bank', 'NH TMCP Bắc Á'],
    '970412': ['PVcomBank', 'NH TMCP Đại Chúng Việt Nam'],
    '970419': ['NCB', 'NH TMCP Quốc Dân'],
    '970425': ['ABBANK', 'NH TMCP An Bình'],
    '970427': ['VietABank', 'NH TMCP Việt Á'],
    '970438': ['BaoViet Bank', 'NH TMCP Bảo Việt'],
    '970452': ['KienlongBank', 'NH TMCP Kiên Long'],
    '970424': ['Shinhan Bank', 'NH TNHH MTV Shinhan Việt Nam'],
    '970457': ['Woori Bank', 'NH TNHH MTV Woori Việt Nam']
  };

  function VietQRError(msg) { this.name = 'VietQRError'; this.message = msg; }
  VietQRError.prototype = Object.create(Error.prototype);

  function utf8(s) { return new TextEncoder().encode(s); }

  function crc16(str) {
    var crc = 0xFFFF, bytes = utf8(str);
    for (var i = 0; i < bytes.length; i++) {
      crc ^= bytes[i] << 8;
      for (var j = 0; j < 8; j++) {
        crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
        crc &= 0xFFFF;
      }
    }
    return ('0000' + crc.toString(16).toUpperCase()).slice(-4);
  }

  // Length trong EMVCo đếm theo ký tự (VietQR thực tế là ASCII).
  function parseTLV(s) {
    var out = {}, i = 0;
    while (i < s.length) {
      if (i + 4 > s.length) throw new VietQRError('Chuỗi QR bị cắt cụt');
      var tag = s.substr(i, 2), len = s.substr(i + 2, 2);
      if (!/^\d\d$/.test(len)) throw new VietQRError('Độ dài không hợp lệ ở tag ' + tag);
      var n = +len, v = s.substr(i + 4, n);
      if (v.length !== n) throw new VietQRError('Thiếu dữ liệu ở tag ' + tag);
      out[tag] = v;
      i += 4 + n;
    }
    return out;
  }

  function tlv(tag, value) {
    if (value.length > 99) throw new VietQRError('Tag ' + tag + ' dài quá 99 ký tự');
    return tag + ('0' + value.length).slice(-2) + value;
  }

  function parseVietQR(payload, opts) {
    opts = opts || {};
    payload = String(payload || '').trim();
    if (!/^0002/.test(payload)) throw new VietQRError('NOT_VIETQR');
    var root = parseTLV(payload), warnings = [];
    var crcOk = !!root['63'] && crc16(payload.slice(0, -4)) === root['63'].toUpperCase();
    if (!crcOk) {
      if (opts.strictCrc) throw new VietQRError('CRC không khớp: mã QR có thể bị sửa hoặc đọc lỗi');
      warnings.push('CRC không khớp');
    }
    var mai = parseTLV(root['38'] || '');
    if (mai['00'] !== NAPAS_GUID) throw new VietQRError('NOT_VIETQR');
    var bene = parseTLV(mai['01'] || '');
    if (!bene['00'] || !bene['01']) throw new VietQRError('Thiếu mã ngân hàng hoặc số tài khoản');
    var add = root['62'] ? parseTLV(root['62']) : {};
    var bank = BANKS[bene['00']] || [null, null];
    if (!bank[0]) warnings.push('Mã ngân hàng ' + bene['00'] + ' chưa có trong bảng');
    if (!root['59']) warnings.push('QR không chứa tên chủ tài khoản');
    return {
      bank_bin: bene['00'], account_number: bene['01'],
      bank_short_name: bank[0], bank_name: bank[1],
      account_name: root['59'] || null, amount: root['54'] || null, content: add['08'] || null,
      service: mai['02'] === 'QRIBFTTC' ? 'card' : 'account',
      is_dynamic: root['01'] === '12', crc_valid: crcOk, raw: payload, warnings: warnings
    };
  }

  function buildVietQR(d) {
    var bene = tlv('00', d.bank_bin) + tlv('01', d.account_number);
    var mai = tlv('00', NAPAS_GUID) + tlv('01', bene) + tlv('02', d.service === 'card' ? 'QRIBFTTC' : 'QRIBFTTA');
    var s = tlv('00', '01') + tlv('01', d.amount ? '12' : '11') + tlv('38', mai) + tlv('53', '704');
    if (d.amount) s += tlv('54', String(d.amount));
    s += tlv('58', 'VN');
    if (d.account_name && d.account_name_verified !== false) s += tlv('59', d.account_name.slice(0, 25));
    if (d.content) s += tlv('62', tlv('08', d.content.slice(0, 50)));
    s += '6304';
    return s + crc16(s);
  }

  root.VietQR = { BANKS: BANKS, crc16: crc16, parseTLV: parseTLV, parse: parseVietQR, build: buildVietQR, Error: VietQRError };
})(typeof window !== 'undefined' ? window : globalThis);
