import type { DemoState } from './state';

/** Packages of the demo router (24.10, opkg) as LuCI's helper lists, installs and removes them. */

type Row = [name: string, version: string, size: number, description: string];

/** Installed from the start; `true` marks packages pulled in as dependencies. */
const INSTALLED: [...Row, boolean][] = [
  [
    'base-files',
    '1674~443ec4032a',
    54_272,
    'This package contains a base filesystem and system scripts for OpenWrt.',
    false,
  ],
  ['busybox', '1.36.1-r3', 266_240, 'The Swiss Army Knife of embedded Linux.', false],
  ['dnsmasq', '2.90-r4', 147_456, 'A lightweight DNS and DHCP server.', false],
  ['dropbear', '2024.86-r1', 112_640, 'A small SSH2 server/client designed for small memory environments.', false],
  [
    'firewall4',
    '2024.12.18~18fc0ead-r1',
    61_440,
    'This package provides an nftables-based implementation of the UCI firewall.',
    false,
  ],
  ['fstools', '2024.12.22~5b9f2e7d-r1', 26_624, 'OpenWrt filesystem tools.', false],
  ['kernel', '6.6.104~b9f7d7a0-r1', 0, 'Virtual kernel package.', false],
  ['libc', '1.2.5-r4', 0, 'C library (musl).', true],
  ['libubox20240329', '2024.03.29~eb9bcb64-r1', 40_960, 'Basic utility library.', true],
  [
    'libuci20130104',
    '2023.08.10~5781664d-r1',
    30_720,
    'C library for the Unified Configuration Interface (UCI).',
    true,
  ],
  ['logd', '2024.04.26~85f10530-r1', 16_384, 'OpenWrt system log implementation.', false],
  [
    'luci',
    '24.10.8',
    0,
    'Standard OpenWrt set including full admin with ppp support and the default Bootstrap theme.',
    false,
  ],
  ['luci-app-firewall', '24.10.8', 53_248, 'Firewall and port forwarding application.', false],
  ['luci-app-package-manager', '24.10.8', 49_152, 'LuCI Support for software packages.', false],
  ['luci-base', '24.10.8', 278_528, 'LuCI core libraries.', true],
  ['luci-mod-network', '24.10.8', 160_768, 'LuCI Network Administration.', true],
  ['luci-mod-status', '24.10.8', 106_496, 'LuCI Status Pages.', true],
  ['luci-mod-system', '24.10.8', 73_728, 'LuCI System Administration.', true],
  ['luci-proto-wireguard', '24.10.8', 36_864, 'Support for WireGuard VPN.', false],
  ['netifd', '2024.12.17~ea01ed41-r1', 237_568, 'OpenWrt Network Interface Configuration Daemon.', false],
  [
    'odhcpd-ipv6only',
    '2024.05.08~a2988231-r1',
    75_776,
    'OpenWrt DHCP/DHCPv6(-PD)/RA Server & Relay (IPv6 only).',
    false,
  ],
  ['ppp', '2.5.1-r1', 260_096, 'A PPP (Point-to-Point Protocol) daemon.', false],
  ['ppp-mod-pppoe', '2.5.1-r1', 30_720, 'Provides support for the PPPoE protocol in pppd.', false],
  ['rpcd', '2024.09.17~b0c6a4f0-r1', 59_392, 'OpenWrt ubus RPC backend server.', false],
  ['uci', '2023.08.10~5781664d-r1', 15_360, 'Utility for the Unified Configuration Interface (UCI).', false],
  ['uhttpd', '2023.06.25~34a8a74d-r3', 51_200, 'A tiny single-threaded HTTP server.', false],
  ['uhttpd-mod-ubus', '2023.06.25~34a8a74d-r3', 18_432, 'The ubus plugin adds a HTTP/JSON RPC proxy for ubus.', false],
  ['wireguard-tools', '1.0.20210914-r4', 92_160, 'WireGuard userspace control program (wg).', true],
  [
    'wpad-basic-mbedtls',
    '2024.09.15~5ace39b0-r2',
    532_480,
    'This package contains a minimal IEEE 802.1x/WPA Authenticator and Supplicant.',
    false,
  ],
];

/** Further packages in the feeds. */
const AVAILABLE: Row[] = [
  ['adblock', '4.2.2-r6', 35_840, 'Powerful adblock solution to block ads and trackers by DNS.'],
  ['luci-app-adblock', '24.10.8', 20_480, 'LuCI support for Adblock.'],
  ['luci-app-ddns', '24.10.8', 40_960, 'LuCI support for Dynamic DNS.'],
  ['ddns-scripts', '2.8.2-r64', 61_440, 'Dynamic DNS client scripts.'],
  ['luci-app-sqm', '24.10.8', 16_384, 'LuCI support for SQM (smart queue management).'],
  ['sqm-scripts', '1.6.0-r2', 61_440, 'A queue setup script for cake and fq_codel.'],
  ['luci-app-upnp', '24.10.8', 24_576, 'LuCI support for UPnP.'],
  ['miniupnpd-nftables', '2.3.7-r2', 133_120, 'Lightweight UPnP IGD, NAT-PMP & PCP daemon.'],
  ['luci-app-wol', '24.10.8', 12_288, 'LuCI support for Wake-on-LAN.'],
  ['etherwake', '1.09-r6', 8_192, 'WoL client for magic packets via ethernet frames.'],
  ['luci-app-nlbwmon', '24.10.8', 28_672, 'LuCI support for the netlink bandwidth monitor.'],
  ['nlbwmon', '2023.02.02~c7616bcf-r2', 40_960, 'Netlink-based bandwidth monitor.'],
  ['tcpdump-mini', '4.99.5-r1', 186_368, 'Network monitoring and data acquisition tool (minimal version).'],
  ['iperf3', '3.17.1-r3', 25_600, 'Internet Protocol bandwidth measuring tool.'],
  ['htop', '3.3.0-r1', 133_120, 'Interactive process viewer.'],
  ['nano', '8.2-r1', 159_744, 'An enhanced clone of the Pico text editor.'],
  ['curl', '8.11.1-r1', 71_680, 'A client-side URL transfer utility.'],
  ['luci-app-statistics', '24.10.8', 69_632, 'LuCI statistics pages (collectd).'],
  ['luci-theme-openwrt-2020', '24.10.8', 34_816, 'OpenWrt 2020 theme.'],
  ['kmod-usb-storage', '6.6.104-r1', 49_152, 'Kernel support for USB mass storage devices.'],
];

const ROUTELINK: Row[] = [
  ['routelinkd', '1.0.0-r1', 92_416, 'Per-device traffic statistics for the RouteLink app.'],
  ['luci-app-routelink', '1.0.0-r1', 40_960, 'LuCI support for RouteLink.'],
  [
    'luci-i18n-routelink-zh-cn',
    '1.0.0-r1',
    8_192,
    'Translation for luci-app-routelink - 简体中文 (Simplified Chinese).',
  ],
];

export interface DemoPackages {
  /** Name → installed as a dependency. */
  installed: Map<string, boolean>;
}

export const createDemoPackages = (): DemoPackages => ({
  installed: new Map(INSTALLED.map(([name, , , , auto]) => [name, auto])),
});

const catalog = new Map<string, Row>([
  ...INSTALLED.map((r) => [r[0], r.slice(0, 4) as Row] as const),
  ...AVAILABLE.map((r) => [r[0], r] as const),
  ...ROUTELINK.map((r) => [r[0], r] as const),
]);

const block = ([name, version, size, description]: Row, extra: string[] = []) =>
  [
    `Package: ${name}`,
    `Version: ${version}`,
    'Depends: libc',
    ...extra,
    `Installed-Size: ${size}`,
    `Description:  ${description}`,
  ].join('\n');

function installedNames(state: DemoState): string[] {
  const names = [...state.packages.installed.keys()];
  if (state.agent.installed) names.push(...ROUTELINK.map((r) => r[0]));
  return names.sort();
}

/** LuCI's helper (`package-manager-call`) on the demo router. */
export function demoPackageHelper(state: DemoState, argv: string[]): string {
  const [, action, ...args] = argv;
  const out = (code: number, stdout = '', stderr = '') => JSON.stringify({ code, stdout, stderr });
  switch (action) {
    case 'list-installed':
      return `${installedNames(state)
        .map((name) => {
          const auto = state.packages.installed.get(name) === true;
          return block(catalog.get(name)!, [
            'Status: install user installed',
            ...(auto ? ['Auto-Installed: yes'] : []),
          ]);
        })
        .join('\n\n')}\n`;
    case 'list-available':
      return `${[...catalog.values()].map((r) => block(r)).join('\n\n')}\n`;
    case 'update':
      return out(0, 'Updated list of available packages in /var/opkg-lists/openwrt_base');
    case 'install': {
      // The plugin's one-tap install uploads a file; the package page installs by name.
      if (args.some((a) => a.startsWith('/tmp/upload.'))) {
        state.agent.installed = true;
        state.agent.resetAt = 0;
        return out(0, 'Installing routelinkd (1.0.0-r1) to root...\nConfiguring routelinkd.');
      }
      const unknown = args.filter((a) => !catalog.has(a));
      if (unknown.length) return out(255, '', `Unknown package '${unknown[0]}'.`);
      for (const name of args) {
        if (ROUTELINK.some((r) => r[0] === name)) state.agent.installed = true;
        else if (!state.packages.installed.has(name)) state.packages.installed.set(name, false);
      }
      return out(0, args.map((a) => `Installing ${a} (${catalog.get(a)![1]}) to root...`).join('\n'));
    }
    case 'remove':
      for (const name of args) {
        if (name === 'routelinkd') state.agent.installed = false;
        state.packages.installed.delete(name);
      }
      return out(0, args.map((a) => `Removing package ${a} from root...`).join('\n'));
    default:
      return out(1, '', `unsupported: ${action}`);
  }
}
