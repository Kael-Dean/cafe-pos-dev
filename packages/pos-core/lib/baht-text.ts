// Convert a number to Thai baht text (legal amount in words).
// 325 → "สามร้อยยี่สิบห้าบาทถ้วน", 130.50 → "หนึ่งร้อยสามสิบบาทห้าสิบสตางค์".
// Kept in sync with the standalone copy in bridge/server.mjs (the print bridge
// is deployed separately and can't import app code).
export function bahtText(amount: number): string {
  const num = Math.round((Number(amount) + Number.EPSILON) * 100) / 100;
  if (!isFinite(num)) return '';
  const abs = Math.abs(num);
  const intPart = Math.floor(abs);
  const satang = Math.round((abs - intPart) * 100);

  const D = ['ศูนย์', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
  const P = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];

  const readSix = (s: string): string => {
    let out = '';
    const L = s.length;
    for (let i = 0; i < L; i++) {
      const d = +s[i];
      const pos = L - 1 - i;            // 0=units .. 5=hundred-thousands
      if (d === 0) continue;
      if (pos === 1) out += d === 1 ? 'สิบ' : d === 2 ? 'ยี่สิบ' : D[d] + 'สิบ';
      else if (pos === 0 && d === 1 && L > 1) out += 'เอ็ด';
      else out += D[d] + P[pos];
    }
    return out;
  };
  const readInt = (n: number): string => {
    if (n === 0) return D[0];
    let out = '';
    const groups: number[] = [];
    let x = n;
    while (x > 0) { groups.push(x % 1000000); x = Math.floor(x / 1000000); }
    for (let g = groups.length - 1; g >= 0; g--) {
      if (groups[g] === 0) continue;
      out += readSix(String(groups[g])) + 'ล้าน'.repeat(g);
    }
    return out;
  };

  let txt: string;
  if (intPart === 0 && satang === 0) txt = 'ศูนย์บาทถ้วน';
  else {
    txt = '';
    if (intPart > 0) txt += readInt(intPart) + 'บาท';
    if (satang > 0) txt += readInt(satang) + 'สตางค์';
    else txt += 'ถ้วน';
  }
  return (num < 0 ? 'ลบ' : '') + txt;
}
