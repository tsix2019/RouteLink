import type { Client } from '@/api/services/clients';
import type { IconName } from '@/ui/Icon';

const RULES: [RegExp, IconName][] = [
  [/\b(ipad|tablet|kindle|galaxy-?tab|matepad|mi-?pad)\b/, 'tablet'],
  [/\b(iphone|android|pixel|galaxy|redmi|oneplus|oppo|vivo|honor|phone|mi-?\d+)\b/, 'phone'],
  [/\b(macbook|laptop|notebook|thinkpad|xps|surface|matebook|zenbook|lenovo)\b/, 'laptop'],
  [/\b(tv|television|roku|chromecast|fire-?tv|bravia|apple-?tv|shield)\b/, 'tv'],
  [/\b(printer|laserjet|officejet|epson|canon|brother|hp)\b/, 'printer'],
  [/\b(switch|playstation|ps[345]|xbox|nintendo|steam-?deck|sony interactive)\b/, 'game'],
  [/\b(cam|camera|ipc|hikvision|dahua|doorbell)\b/, 'camera'],
  [/\b(echo|sonos|homepod|speaker|nest-?(mini|audio)|soundbar)\b/, 'speaker'],
  [/\b(plug|socket|tuya|shelly|espressif|esp\d*|sonoff|bulb|light)\b/, 'plug'],
  [/\b(nas|synology|qnap|server|unraid|truenas)\b/, 'server'],
  [/\b(pc|desktop|imac|mac-?mini|workstation|tower|intel|dell)\b/, 'desktop'],
];

/** Rough device type from names and vendor; falls back to the connection type. */
export function deviceIcon(client: Pick<Client, 'name' | 'hostname' | 'vendor' | 'connection'>): IconName {
  const text = [client.name, client.hostname, client.vendor]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/[_.]/g, '-');
  for (const [re, icon] of RULES) if (re.test(text)) return icon;
  return client.connection === 'wired' ? 'ethernet' : client.connection === 'wifi' ? 'wifi' : 'unknownDevice';
}
