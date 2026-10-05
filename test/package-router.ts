import { fixtureName } from './fixture-names';
import { FixtureConnection, fail, ok } from './fixture-connection';
import type { UbusResult } from '../src/api/ubus/types';

export const PMC = '/usr/libexec/package-manager-call';
export const OPKG_CALL = '/usr/libexec/opkg-call';

const opkgFeeds = (release: string, arch: string) =>
  [
    `src/gz openwrt_core https://downloads.openwrt.org/releases/${release}/targets/x86/64/packages`,
    `src/gz openwrt_base https://downloads.openwrt.org/releases/${release}/packages/${arch}/base`,
    `src/gz openwrt_luci https://downloads.openwrt.org/releases/${release}/packages/${arch}/luci`,
  ].join('\n');

export interface RouterSetup {
  release?: string;
  helper?: typeof PMC | typeof OPKG_CALL | null;
  apk?: boolean;
  arch?: string;
  lists?: boolean;
  access?: boolean;
  availKb?: number;
}

/** A FixtureConnection that looks like an OpenWrt release with LuCI's package manager page. */
export function packageRouter({
  release = '24.10.8',
  helper = PMC,
  apk = false,
  arch = 'x86_64',
  lists = true,
  access = true,
  availKb = 77_557,
}: RouterSetup = {}): FixtureConnection {
  const conn = new FixtureConnection('none');
  const set = (object: string, method: string, params: Record<string, unknown> | undefined, result: UbusResult) =>
    conn.override(fixtureName({ object, method, params }), result);
  set('system', 'board', undefined, ok(release ? { release: { distribution: 'OpenWrt', version: release } } : {}));
  set('system', 'info', undefined, ok({ root: { total: 88_645, avail: availKb } }));
  for (const h of [PMC, OPKG_CALL]) set('file', 'stat', { path: h }, h === helper ? ok({ type: 'file' }) : fail('NOT_FOUND'));
  set('file', 'stat', { path: '/usr/bin/apk' }, apk ? ok({ type: 'file' }) : fail('NOT_FOUND'));
  set('file', 'read', { path: '/etc/opkg/distfeeds.conf' }, apk ? fail('NOT_FOUND') : ok({ data: opkgFeeds(release, arch) }));
  set(
    'file',
    'read',
    { path: '/etc/apk/repositories.d/distfeeds.list' },
    apk ? ok({ data: `https://downloads.openwrt.org/releases/${release}/packages/${arch}/base/packages.adb\n` }) : fail('NOT_FOUND'),
  );
  set('file', 'list', { path: '/var/opkg-lists' }, ok({ entries: !apk && lists ? [{ name: 'openwrt_base', type: 'file' }] : [] }));
  set('file', 'list', { path: '/var/cache/apk' }, apk && lists ? ok({ entries: [{ name: 'packages.adb', type: 'file' }] }) : fail('NOT_FOUND'));
  conn.override('session.access', ok({ access }));
  return conn;
}

