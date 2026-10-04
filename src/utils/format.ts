export type Lang = 'zh-CN' | 'en';

function scaled(value: number, base: number, units: readonly string[]): string {
  const v = Number.isFinite(value) && value > 0 ? value : 0;
  let i = 0;
  let n = v;
  while (n >= base && i < units.length - 1) {
    n /= base;
    i++;
  }
  const digits = i === 0 || n >= 100 ? 0 : 1;
  return `${n.toFixed(digits)} ${units[i]}`;
}

/** Binary units (1 KB = 1024 B), e.g. 1536 → "1.5 KB". */
export function formatBytes(bytes: number): string {
  return scaled(bytes, 1024, ['B', 'KB', 'MB', 'GB', 'TB']);
}

/** Decimal network units, e.g. 12_300_000 → "12.3 Mbps". */
export function formatBitRate(bitsPerSec: number): string {
  return scaled(bitsPerSec, 1000, ['bps', 'Kbps', 'Mbps', 'Gbps']);
}

const DURATION_UNITS = [
  { sec: 86_400, en: 'd', zh: '天' },
  { sec: 3_600, en: 'h', zh: '小时' },
  { sec: 60, en: 'm', zh: '分钟' },
  { sec: 1, en: 's', zh: '秒' },
] as const;

/** Largest two units, e.g. 273600 → "3d 4h" / "3 天 4 小时". */
export function formatDuration(seconds: number, lang: Lang): string {
  let rest = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const parts: string[] = [];
  for (const u of DURATION_UNITS) {
    const n = Math.floor(rest / u.sec);
    rest -= n * u.sec;
    if (n > 0 || (parts.length === 0 && u.sec === 1)) {
      parts.push(lang === 'en' ? `${n}${u.en}` : `${n} ${u.zh}`);
    } else if (parts.length > 0) {
      break; // only consecutive units: "1h 1m", never "1h 1s"
    }
    if (parts.length === 2) break;
  }
  return parts.join(' ');
}

const PROTOCOLS: Record<string, { en: string; zh?: string }> = {
  static: { en: 'Static', zh: '静态地址' },
  dhcp: { en: 'DHCP' },
  dhcpv6: { en: 'DHCPv6' },
  pppoe: { en: 'PPPoE' },
  pppoa: { en: 'PPPoA' },
  wireguard: { en: 'WireGuard' },
  openvpn: { en: 'OpenVPN' },
  '6in4': { en: '6in4' },
  qmi: { en: 'QMI' },
  ncm: { en: 'NCM' },
  none: { en: 'Unmanaged', zh: '不配置' },
};

/** Interface protocol as people write it: "pppoe" → "PPPoE". */
export function protoLabel(proto: string, lang: Lang): string {
  const p = PROTOCOLS[proto];
  if (!p) return proto;
  return lang === 'zh-CN' && p.zh ? p.zh : p.en;
}

/** Ratio 0..1 → "42%", clamped. */
export function formatPercent(ratio: number): string {
  const r = Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0;
  return `${Math.round(r * 100)}%`;
}
