import qrcodeFactory from 'qrcode-generator';

const BACKSLASH = String.fromCharCode(92);
/** Characters the WIFI: format reserves; each is escaped with a backslash. */
const RESERVED = new Set([BACKSLASH, ';', ',', ':', '"']);

function escape(value: string): string {
  const escaped = [...value].map((c) => (RESERVED.has(c) ? BACKSLASH + c : c)).join('');
  // A value that looks like hexadecimal would be read as raw bytes: quote it.
  return /^[0-9a-f]+$/i.test(value) && value.length % 2 === 0 ? `"${escaped}"` : escaped;
}

const authType = (encryption: string) =>
  encryption === 'none' || encryption === 'owe' || !encryption ? 'nopass' : encryption.startsWith('wep') ? 'WEP' : 'WPA';

/** "WIFI:T:WPA;S:<ssid>;P:<key>;H:true;;" — the format phone cameras join networks from. */
export function wifiQrString(n: { ssid: string; key?: string; encryption: string; hidden?: boolean }): string {
  const type = authType(n.encryption);
  const parts = [`T:${type}`, `S:${escape(n.ssid)}`];
  if (type !== 'nopass') parts.push(`P:${escape(n.key ?? '')}`);
  if (n.hidden) parts.push('H:true');
  return `WIFI:${parts.join(';')};;`;
}

/** Dark modules of the QR code for `text` (UTF-8, error correction M), row by row. */
export function qrMatrix(text: string): boolean[][] {
  // The library defaults to Latin-1; phones read Wi-Fi codes as UTF-8.
  const factory = qrcodeFactory;
  factory.stringToBytes = factory.stringToBytesFuncs['UTF-8'];
  const qr = factory(0, 'M');
  qr.addData(text, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}
