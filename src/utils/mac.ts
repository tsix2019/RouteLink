/** Canonical form used across the app: upper-case, colon-separated ("AA:BB:CC:00:11:22"). */
export function normalizeMac(mac: string): string | null {
  const hex = mac.replace(/[^0-9a-f]/gi, '');
  if (hex.length !== 12) return null;
  return hex.toUpperCase().match(/../g)!.join(':');
}

/** Locally administered bit set: a randomized/private address (iOS, Android, Windows privacy MAC). */
export const isRandomizedMac = (mac: string): boolean => (parseInt(mac.slice(0, 2), 16) & 0x02) === 0x02;
