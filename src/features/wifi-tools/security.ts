import { getRandomValues } from 'expo-crypto';

import { uci } from '@/api/uci';
import type { UbusCall } from '@/api/ubus/types';
import { needsKey, type WifiNetwork } from '@/api/services/wireless';

import { COMMON_PASSWORDS, KEYBOARD_ROWS } from './passwords';

/** Wi-Fi security check (design §17.4, WF-4). Pure apart from the password generator's random source. */

export type SecurityLevel = 'high' | 'medium' | 'low' | 'danger';

const baseOf = (encryption: string) => encryption.split('+')[0];

/**
 * Management frame protection in effect: the configured value, else what OpenWrt's hostapd.sh sets by
 * default (required for WPA3 and OWE, optional for the WPA2/WPA3 mixed modes, off otherwise).
 */
export function effectiveMfp(encryption: string, ieee80211w?: string): 0 | 1 | 2 {
  if (ieee80211w === '0' || ieee80211w === '1' || ieee80211w === '2') return Number(ieee80211w) as 0 | 1 | 2;
  const base = baseOf(encryption);
  if (base === 'sae' || base === 'owe' || base === 'wpa3' || base === 'wpa3-192') return 2;
  if (base === 'sae-mixed' || base === 'wpa3-mixed') return 1;
  return 0;
}

/** The table of design §17.4; enterprise modes rank like their personal counterparts. */
export function rateEncryption(encryption: string, ieee80211w?: string): SecurityLevel {
  const base = baseOf(encryption);
  const ciphers = encryption.split('+').slice(1);
  const tkipOnly = ciphers.includes('tkip') && !ciphers.includes('ccmp') && !ciphers.includes('aes');
  switch (base) {
    case 'sae':
    case 'wpa3':
    case 'wpa3-192':
      return 'high';
    case 'sae-mixed':
    case 'wpa3-mixed':
      return effectiveMfp(encryption, ieee80211w) > 0 ? 'high' : 'medium';
    case 'psk2':
    case 'wpa2':
      return ciphers.includes('tkip') ? 'low' : 'medium';
    case 'owe':
      return 'medium';
    case 'psk-mixed':
    case 'wpa-mixed':
    case 'psk':
    case 'wpa':
      return 'low';
    default:
      // none, wep-open, wep-shared and anything unknown
      return tkipOnly ? 'low' : 'danger';
  }
}

export type PasswordStrength = 'weak' | 'medium' | 'strong';
export type WeakReason = 'short' | 'digits' | 'common' | 'keyboard' | 'ssid' | 'repeat' | 'one-kind';

const classesOf = (s: string) =>
  [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z\d]/].filter((re) => re.test(s)).length;

/** Typed along one keyboard row (either direction), like "qwertyuiop" or "0987654321". */
function isKeyboardRun(lower: string): boolean {
  if (lower.length < 6) return false;
  return KEYBOARD_ROWS.some((row) => row.includes(lower) || [...row].reverse().join('').includes(lower));
}

/** The whole password is a short unit repeated ("aaaaaaaaaa", "abcabcabcabc", "5201314520131452"). */
const isRepeat = (s: string) => /^(.{1,7})\1+$/.test(s);

/** Letters and digits running up or down by one ("abcdefghijk", "9876543210"). */
function isSequence(s: string): boolean {
  if (s.length < 6) return false;
  const step = s.charCodeAt(1) - s.charCodeAt(0);
  if (step !== 1 && step !== -1) return false;
  for (let i = 2; i < s.length; i++) if (s.charCodeAt(i) - s.charCodeAt(i - 1) !== step) return false;
  return true;
}

/** A common word with digits or symbols around it ("iloveyou2026!", "123password"). */
function hasCommonStem(lower: string): boolean {
  const stem = lower.replace(/^[\d\W_]+/, '').replace(/[\d\W_]+$/, '');
  return stem.length >= 4 && stem !== lower && COMMON_PASSWORDS.has(stem);
}

/**
 * Design §17.4, judged on the phone only. Weak on any of: under 10 characters, digits only, a common
 * password (alone or with digits around it), a keyboard run, sequence or repeat, contains the SSID, or
 * a single kind of character under 16 long. Strong at 14+ with two kinds or 12+ with three; else medium.
 */
export function passwordStrength(key: string, ssid = ''): { strength: PasswordStrength; reasons: WeakReason[] } {
  const lower = key.toLowerCase();
  const reasons: WeakReason[] = [];
  if (key.length < 10) reasons.push('short');
  if (/^\d+$/.test(key)) reasons.push('digits');
  if (COMMON_PASSWORDS.has(lower) || hasCommonStem(lower)) reasons.push('common');
  if (isKeyboardRun(lower) || isSequence(lower)) reasons.push('keyboard');
  if (isRepeat(lower)) reasons.push('repeat');
  const s = ssid.trim().toLowerCase();
  if (s.length >= 3 && lower.includes(s)) reasons.push('ssid');
  const classes = classesOf(key);
  if (classes === 1 && key.length < 16 && !reasons.includes('digits')) reasons.push('one-kind');
  if (reasons.length) return { strength: 'weak', reasons };
  const strong = (key.length >= 14 && classes >= 2) || (key.length >= 12 && classes >= 3);
  return { strength: strong ? 'strong' : 'medium', reasons };
}

/** No 0/O, 1/l/I: the password gets read off a screen and typed on TVs. */
const LOWER = 'abcdefghijkmnpqrstuvwxyz';
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGITS = '23456789';
const ALPHABET = LOWER + UPPER + DIGITS;

/** 16 random characters in four groups ("Kx7m-Qp3t-Wn8r-Hd2v"); always all three kinds. */
export function generatePassword(random: (bytes: Uint8Array) => Uint8Array = getRandomValues): string {
  for (;;) {
    const bytes = random(new Uint8Array(32));
    const chars: string[] = [];
    // Rejection sampling keeps every character equally likely.
    const limit = 256 - (256 % ALPHABET.length);
    for (const b of bytes) if (b < limit && chars.length < 16) chars.push(ALPHABET[b % ALPHABET.length]);
    if (chars.length < 16) continue;
    const pw = chars.join('');
    if ([LOWER, UPPER, DIGITS].every((set) => [...pw].some((c) => set.includes(c))))
      return pw.match(/.{4}/g)!.join('-');
  }
}

export type SecurityFinding =
  | { kind: 'password'; strength: PasswordStrength; reasons: WeakReason[] }
  | { kind: 'wps' }
  | { kind: 'mfp-off' }
  | { kind: 'guest-not-isolated' }
  | { kind: 'hidden' };

export type SecurityFix = 'upgrade-wpa3' | 'upgrade-wpa2' | 'disable-wps' | 'enable-mfp' | 'new-password' | 'isolate';

export interface SecurityReport {
  section: string;
  ssid: string;
  level: SecurityLevel;
  findings: SecurityFinding[];
  fixes: SecurityFix[];
}

/** What the router's hostapd supports (`luci getFeatures`); unknown when the field is missing. */
export interface WifiFeatures {
  sae?: boolean;
}

export function parseWifiFeatures(raw: unknown): WifiFeatures {
  const hostapd = (raw as { hostapd?: Record<string, unknown> } | null)?.hostapd;
  return { sae: typeof hostapd?.sae === 'boolean' ? hostapd.sae : undefined };
}

export const isGuestNetwork = (n: Pick<WifiNetwork, 'section' | 'network'>) =>
  n.network.includes('guest') || n.section.startsWith('guest_');

export function checkNetwork(n: WifiNetwork, features: WifiFeatures): SecurityReport {
  const level = rateEncryption(n.encryption, n.ieee80211w);
  const base = baseOf(n.encryption);
  const findings: SecurityFinding[] = [];
  const fixes: SecurityFix[] = [];
  const personal = needsKey(n.encryption) && !base.startsWith('wpa') && !base.startsWith('wep');

  if (personal && n.key) {
    const pw = passwordStrength(n.key, n.ssid);
    findings.push({ kind: 'password', ...pw });
    if (pw.strength !== 'strong') fixes.push('new-password');
  }
  if (n.wps) {
    findings.push({ kind: 'wps' });
    fixes.push('disable-wps');
  }
  const encrypted = base !== 'none' && !base.startsWith('wep');
  if (encrypted && effectiveMfp(n.encryption, n.ieee80211w) === 0) {
    findings.push({ kind: 'mfp-off' });
    // TKIP cannot carry MFP; the encryption upgrade below takes care of it.
    if (!n.encryption.includes('tkip') && base !== 'psk' && base !== 'psk-mixed') fixes.push('enable-mfp');
  }
  if (isGuestNetwork(n) && !n.isolate) {
    findings.push({ kind: 'guest-not-isolated' });
    fixes.push('isolate');
  }
  if (n.hidden) findings.push({ kind: 'hidden' });

  // Personal networks only: enterprise (802.1X) setups are left to whoever built them.
  const upgradable = (base === 'none' || base.startsWith('wep') || personal) && level !== 'high';
  if (upgradable && base !== 'owe') {
    if (features.sae === true) fixes.unshift('upgrade-wpa3');
    else if (level === 'low' || level === 'danger') fixes.unshift('upgrade-wpa2');
  }
  return { section: n.section, ssid: n.ssid, level, findings, fixes };
}

const LEVEL_ORDER: SecurityLevel[] = ['danger', 'low', 'medium', 'high'];
/** Worst first. */
export const byRisk = (a: { level: SecurityLevel }, b: { level: SecurityLevel }) =>
  LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level);

/** The level a set of networks shares in a summary: the worst one. */
export const worstLevel = (levels: SecurityLevel[]): SecurityLevel | undefined =>
  [...levels].sort((a, b) => LEVEL_ORDER.indexOf(a) - LEVEL_ORDER.indexOf(b))[0];

/** Fixes that need a new password (open/WEP networks being encrypted, or the password fix itself). */
export const fixNeedsKey = (n: WifiNetwork, fix: SecurityFix) =>
  fix === 'new-password' ||
  ((fix === 'upgrade-wpa3' || fix === 'upgrade-wpa2') && (!needsKey(n.encryption) || baseOf(n.encryption).startsWith('wep')));

/**
 * uci changes for the chosen fixes on one network, staged together and applied through the WL-2 flow.
 * `key` is required when a fix needs a new password (fixNeedsKey).
 */
export function fixChanges(n: WifiNetwork, fixes: SecurityFix[], key?: string): UbusCall[] {
  const values: Record<string, string> = {};
  for (const fix of fixes) {
    switch (fix) {
      case 'upgrade-wpa3':
        // Mixed mode keeps older devices connected; pure WPA3 would lock them out.
        values.encryption = 'sae-mixed';
        values.ieee80211w = '1';
        break;
      case 'upgrade-wpa2':
        values.encryption = 'psk2+ccmp';
        break;
      case 'disable-wps':
        if (n.wps) {
          values.wps_pushbutton = '0';
          values.wps_label = '0';
        }
        break;
      case 'enable-mfp':
        values.ieee80211w = '1';
        break;
      case 'isolate':
        values.isolate = '1';
        break;
      case 'new-password':
        break;
    }
  }
  if (fixes.some((f) => fixNeedsKey(n, f))) {
    if (!key) throw new Error('fixChanges: a new password is required');
    values.key = key;
  }
  return Object.keys(values).length ? [uci.set('wireless', n.section, values)] : [];
}
