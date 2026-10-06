import { bytesToBase64 } from '@/utils/base64';

import type { SshTerminal, TerminalHandlers } from '@/api/ssh/client';

/** What the demo router's shell answers (design §16: the terminal works in demo mode, offline). */
const PROMPT = 'root@RouteLink-Demo:~# ';

const BANNER = [
  '',
  '',
  'BusyBox v1.36.1 (2026-09-18 08:20:13 UTC) built-in shell (ash)',
  '',
  '  _______                     ________        __',
  ' |       |.-----.-----.-----.|  |  |  |.----.|  |_',
  ' |   -   ||  _  |  -__|     ||  |  |  ||   _||   _|',
  ' |_______||   __|_____|__|__||________||__|  |____|',
  '          |__| W I R E L E S S   F R E E D O M',
  ' -----------------------------------------------------',
  ' OpenWrt 24.10.8, r29233-443ec4032a',
  ' -----------------------------------------------------',
  '',
].join('\r\n');

const OUTPUT: Record<string, string> = {
  help: 'Demo shell. Try: uname -a, uptime, free, df -h, ip -4 addr, cat /etc/openwrt_release, logread | tail, ls, clear, exit',
  'uname -a': 'Linux RouteLink-Demo 6.6.104 #0 SMP Thu Sep 18 08:20:13 2026 aarch64 GNU/Linux',
  uptime: ' 21:39:07 up 12 days,  3:14,  load average: 0.08, 0.11, 0.09',
  free: [
    '              total        used        free      shared  buff/cache   available',
    'Mem:        1024000      213448      652180        3720      158372      768932',
    'Swap:             0           0           0',
  ].join('\r\n'),
  'df -h': [
    'Filesystem                Size      Used Available Use% Mounted on',
    '/dev/root                 6.5M      6.5M         0 100% /rom',
    'tmpfs                   500.0M      3.6M    496.4M   1% /tmp',
    '/dev/ubi0_2             209.6M      4.1M    200.9M   2% /overlay',
    'overlayfs:/overlay      209.6M      4.1M    200.9M   2% /',
  ].join('\r\n'),
  'ip -4 addr': [
    '1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN qlen 1000',
    '    inet 127.0.0.1/8 scope host lo',
    '6: br-lan: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc noqueue state UP qlen 1000',
    '    inet 192.168.8.1/24 brd 192.168.8.255 scope global br-lan',
    '9: pppoe-wan: <POINTOPOINT,MULTICAST,NOARP,UP,LOWER_UP> mtu 1492 qdisc fq_codel state UNKNOWN qlen 3',
    '    inet 203.0.113.45 peer 203.0.113.1/32 scope global pppoe-wan',
  ].join('\r\n'),
  'cat /etc/openwrt_release': [
    "DISTRIB_ID='OpenWrt'",
    "DISTRIB_RELEASE='24.10.8'",
    "DISTRIB_REVISION='r29233-443ec4032a'",
    "DISTRIB_TARGET='mediatek/filogic'",
    "DISTRIB_ARCH='aarch64_cortex-a53'",
    "DISTRIB_DESCRIPTION='OpenWrt 24.10.8 r29233-443ec4032a'",
  ].join('\r\n'),
  'logread | tail': [
    'Mon Oct  5 21:30:00 2026 cron.err crond[1890]: USER root pid 23710 cmd /usr/sbin/ntpd -q',
    'Mon Oct  5 21:31:12 2026 daemon.info dnsmasq-dhcp[1]: DHCPREQUEST(br-lan) 192.168.8.105 f2:4c:1d:7e:3a:91',
    'Mon Oct  5 21:31:12 2026 daemon.info dnsmasq-dhcp[1]: DHCPACK(br-lan) 192.168.8.105 f2:4c:1d:7e:3a:91 Galaxy-S25',
    'Mon Oct  5 21:35:41 2026 daemon.notice hostapd: phy1-ap0: AP-STA-CONNECTED 3c:22:fb:61:0e:8d auth_alg=sae',
  ].join('\r\n'),
  ls: '\x1b[1;34mbin\x1b[0m  \x1b[1;34metc\x1b[0m  \x1b[1;34mlib\x1b[0m  \x1b[1;34mrom\x1b[0m  \x1b[1;34mroot\x1b[0m  \x1b[1;34mtmp\x1b[0m  \x1b[1;34musr\x1b[0m  \x1b[1;34mwww\x1b[0m',
  pwd: '/root',
  whoami: 'root',
};

const encoder = new TextEncoder();

/** A line-editing shell with canned answers, in place of SSH on the demo router. */
export function openDemoShell(h: TerminalHandlers): SshTerminal {
  let line = '';
  let open = true;
  const out = (text: string) => {
    if (open) setTimeout(() => h.onData(bytesToBase64(encoder.encode(text))), 0);
  };
  const run = (command: string) => {
    const c = command.trim().replace(/\s+/g, ' ');
    if (c === 'exit') {
      out('logout\r\n');
      open = false;
      setTimeout(() => h.onClose(), 0);
      return;
    }
    if (c === 'clear') return out(`\x1b[2J\x1b[H${PROMPT}`);
    const reply = c === '' ? '' : (OUTPUT[c] ?? `-ash: ${c.split(' ')[0]}: not found`);
    out(`${reply ? `${reply}\r\n` : ''}${PROMPT}`);
  };
  // A session already under way: the demo shows what a terminal is for before anything is typed.
  const opening = ['uptime', 'free'].map((c) => `${PROMPT}${c}\r\n${OUTPUT[c]}\r\n`).join('');
  out(`${BANNER}\r\n${opening}${PROMPT}`);
  return {
    id: 'demo',
    async send(text) {
      for (const ch of text.replace(/\x1b\[[0-9;]*[A-Za-z]|\x1bO[A-Za-z]/g, '')) {
        if (ch === '\r' || ch === '\n') {
          out('\r\n');
          const command = line;
          line = '';
          run(command);
        } else if (ch === '\x7f' || ch === '\b') {
          if (line) {
            line = line.slice(0, -1);
            out('\b \b');
          }
        } else if (ch === '\x03') {
          line = '';
          out(`^C\r\n${PROMPT}`);
        } else if (ch === '\t' || ch < ' ') {
          // no completion in the demo
        } else {
          line += ch;
          out(ch);
        }
      }
    },
    async resize() {},
    async close() {
      open = false;
    },
  };
}
