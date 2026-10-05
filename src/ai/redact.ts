/**
 * Design §18 privacy: what tool results may tell the AI provider. Four kinds of data can be switched off one by
 * one; masking (on by default) hides the device-specific half of MAC addresses and public IP addresses.
 * Passwords and keys never go out, whatever the settings.
 */
export interface Privacy {
  /** Device names and host names. */
  names: boolean;
  /** IP addresses. */
  ips: boolean;
  /** MAC addresses. */
  macs: boolean;
  /** System log lines. */
  logs: boolean;
  /** Mask MAC addresses and public IP addresses. */
  mask: boolean;
}

export const DEFAULT_PRIVACY: Privacy = { names: true, ips: true, macs: true, logs: true, mask: true };

const MAC = /\b([0-9a-f]{2})[:-]([0-9a-f]{2})[:-]([0-9a-f]{2})[:-][0-9a-f]{2}[:-][0-9a-f]{2}[:-][0-9a-f]{2}\b/gi;
const IPV4 = /\b(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\b/g;

/** Keeps the manufacturer part (OUI). */
export const maskMac = (mac: string) => mac.replace(MAC, (_m, a, b, c) => `${a}:${b}:${c}:**:**:**`.toUpperCase());

export function isPrivateIp(ip: string): boolean {
  const v4 = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(ip);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a === 0
    );
  }
  const v6 = ip.toLowerCase();
  return v6 === '::1' || v6.startsWith('fe80:') || /^f[cd][0-9a-f]{2}:/.test(v6);
}

/** Public addresses keep their network half: "203.0.*.*", "2001:db8:1234::*". */
export function maskIp(ip: string): string {
  if (isPrivateIp(ip)) return ip;
  const v4 = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(ip);
  if (v4) return `${v4[1]}.${v4[2]}.*.*`;
  if (ip.includes(':')) return `${ip.split(':').slice(0, 3).join(':')}::*`;
  return ip;
}

/** An address as the provider may see it, or undefined when addresses are off. */
export function ipOut(ip: string | null | undefined, p: Privacy): string | undefined {
  if (!ip || !p.ips) return undefined;
  return p.mask ? maskIp(ip) : ip;
}

export function macOut(mac: string | null | undefined, p: Privacy): string | undefined {
  if (!mac || !p.macs) return undefined;
  return p.mask ? maskMac(mac) : mac.toUpperCase();
}

export const nameOut = (name: string | null | undefined, p: Privacy): string | undefined =>
  name && p.names ? name : undefined;

/** Free text (log lines): MACs and addresses follow the same rules as fields. */
export function scrubText(text: string, p: Privacy): string {
  let out = text.replace(MAC, (m) => macOut(m, p) ?? '[mac]');
  out = out.replace(IPV4, (m) => {
    if (m.split('.').some((n) => Number(n) > 255)) return m;
    return ipOut(m, p) ?? '[ip]';
  });
  return out;
}

const SECRET = /^(key|password|passwd|psk|private_?key|preshared_?key|secret|token|auth|sae_password|wpa_passphrase)$/i;

/** Drops secret fields at any depth, and fields left undefined by the privacy rules. */
export function stripSecrets<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => stripSecrets(v)) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (SECRET.test(k) || v === undefined) continue;
      out[k] = stripSecrets(v);
    }
    return out as T;
  }
  return value;
}
