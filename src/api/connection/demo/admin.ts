import { UbusError } from '../../ubus/errors';
import type { DemoState } from './state';

/** Processes, scheduled tasks, LEDs and the clock of the demo router (M2 system pages). */

export interface DemoProcess {
  pid: number;
  ppid: number;
  user: string;
  stat: string;
  /** Virtual memory in KB. */
  vsz: number;
  /** Typical CPU share in percent; the demo adds a little jitter per call. */
  cpu: number;
  command: string;
}

export interface DemoAdmin {
  processes: DemoProcess[];
  crontab: string;
  /** Router clock minus real time, seconds (changed by "sync time"). */
  clockSkewSec: number;
}

type Row = [pid: number, ppid: number, user: string, stat: string, vsz: number, cpu: number, command: string];

const PROCESSES: Row[] = [
  [1, 0, 'root', 'S', 1652, 0, '/sbin/procd'],
  [2, 0, 'root', 'SW', 0, 0, '[kthreadd]'],
  [9, 2, 'root', 'SW', 0, 0, '[ksoftirqd/0]'],
  [10, 2, 'root', 'IW', 0, 0, '[rcu_sched]'],
  [14, 2, 'root', 'SW', 0, 0, '[ksoftirqd/1]'],
  [64, 2, 'root', 'SW', 0, 0, '[kswapd0]'],
  [402, 1, 'ubus', 'S', 1236, 0, '/sbin/ubusd'],
  [432, 1, 'root', 'S', 1096, 0, '/sbin/urngd'],
  [1021, 1, 'logd', 'S', 1424, 0, '/sbin/logd -S 64'],
  [1062, 1, 'root', 'S', 2340, 1, '/sbin/rpcd -s /var/run/ubus/ubus.sock -t 30'],
  [1210, 1, 'root', 'S', 1012, 0, '/usr/sbin/dropbear -F -P /var/run/dropbear.1.pid -p 22 -K 300 -T 3'],
  [1388, 1, 'root', 'S', 4864, 1, '/usr/sbin/hostapd -s -g /var/run/hostapd/global'],
  [1389, 1, 'root', 'S', 4720, 0, '/usr/sbin/wpa_supplicant -n -s -g /var/run/wpa_supplicant/global'],
  [1421, 1, 'root', 'S', 2108, 0, '/sbin/netifd'],
  [1478, 1, 'root', 'S', 1664, 0, '/usr/sbin/odhcpd'],
  [1612, 1, 'root', 'S', 1264, 0, '/usr/sbin/crond -f -c /etc/crontabs -l 5'],
  [1690, 1, 'root', 'S', 5832, 3, '/usr/sbin/uhttpd -f -h /www -r RouteLink-Demo -x /cgi-bin -u /ubus -t 60 -T 30'],
  [1764, 1, 'root', 'S', 1032, 0, '/usr/sbin/ntpd -n -N -S /usr/sbin/ntpd-hotplug -p 0.openwrt.pool.ntp.org'],
  [2003, 1, 'dnsmasq', 'S', 2516, 0, '/usr/sbin/dnsmasq -C /var/etc/dnsmasq.conf.cfg01411c -k'],
  [2210, 1421, 'root', 'S', 1428, 0, '/usr/sbin/pppd nodetach ipparam wan ifname pppoe-wan +ipv6 set AUTOIPV6=1'],
  [2291, 1421, 'root', 'S', 980, 0, '/usr/sbin/odhcp6c -s /lib/netifd/dhcpv6.script -Ntry -P0 -t120 pppoe-wan'],
  [2388, 1, 'root', 'S', 3756, 1, '/usr/sbin/routelinkd'],
  [2412, 2, 'root', 'IW', 0, 0, '[kworker/1:2-events]'],
];

const CRONTAB = `# Weekly reboot (LuCI's suggestion: wait for the clock first)
0 4 * * 1 sleep 70 && touch /etc/banner && reboot
30 5 * * * wifi reload
`;

export const createDemoAdmin = (): DemoAdmin => ({
  processes: PROCESSES.map(([pid, ppid, user, stat, vsz, cpu, command]) => ({
    pid,
    ppid,
    user,
    stat,
    vsz,
    cpu,
    command,
  })),
  crontab: CRONTAB,
  clockSkewSec: 0,
});

const MEMORY_KB = 1_024_000;

export function processList(s: DemoState, now: number) {
  return {
    result: s.admin.processes
      .filter((p) => p.command !== '/usr/sbin/routelinkd' || s.agent.installed)
      .map((p) => {
        // A steady busy process jitters by a percent or so between refreshes.
        const cpu = p.cpu ? Math.max(0, p.cpu + (Math.floor(now / 2_000 + p.pid) % 3) - 1) : 0;
        return {
          PID: String(p.pid),
          PPID: String(p.ppid),
          USER: p.user,
          STAT: p.stat,
          VSZ: String(p.vsz),
          '%MEM': `${Math.round((p.vsz / MEMORY_KB) * 100)}%`,
          '%CPU': `${cpu}%`,
          COMMAND: p.command,
        };
      }),
  };
}

/** `kill -<n> <pid>`: the process goes away (PID 1 and kernel threads refuse, as on a real router). */
export function demoKill(s: DemoState, args: string[]) {
  const pid = Number(args[1]);
  const p = s.admin.processes.find((x) => x.pid === pid);
  if (!p) return { code: 1, stderr: `kill: can't kill pid ${args[1]}: No such process` };
  if (pid === 1 || p.command.startsWith('[')) return { code: 0 };
  s.admin.processes = s.admin.processes.filter((x) => x !== p);
  return { code: 0 };
}

const TRIGGERS = [
  'none',
  'timer',
  'default-on',
  'heartbeat',
  'netdev',
  'phy0rx',
  'phy0tx',
  'phy0assoc',
  'phy0radio',
  'phy0tpt',
  'phy1rx',
  'phy1tx',
  'phy1assoc',
  'phy1radio',
  'phy1tpt',
];

/** Kernel LEDs with the trigger they start with. */
const LEDS: [sysfs: string, max: number, trigger: string][] = [
  ['white:status', 255, 'default-on'],
  ['green:wan', 1, 'none'],
  ['blue:wlan2g', 255, 'phy0tpt'],
  ['blue:wlan5g', 255, 'phy1tpt'],
];

/** Like the kernel: the uci `led` section of a LED decides its trigger and steady state. */
export function ledList(s: DemoState) {
  const sections = Object.values(s.uci.system ?? {}).filter((x) => x['.type'] === 'led');
  return Object.fromEntries(
    LEDS.map(([sysfs, max, initial]) => {
      const section = sections.find((x) => x.sysfs === sysfs);
      const trigger = String(section?.trigger ?? initial);
      const on = trigger === 'none' ? section?.default === '1' : true;
      return [sysfs, { brightness: on ? max : 0, max_brightness: max, triggers: TRIGGERS, active_trigger: trigger }];
    }),
  );
}

const ZONES: Record<string, string> = {
  'Africa/Cairo': 'EET-2EEST,M4.5.5/0,M10.5.4/24',
  'America/Chicago': 'CST6CDT,M3.2.0,M11.1.0',
  'America/Los_Angeles': 'PST8PDT,M3.2.0,M11.1.0',
  'America/New_York': 'EST5EDT,M3.2.0,M11.1.0',
  'America/Sao_Paulo': '<-03>3',
  'Asia/Dubai': '<+04>-4',
  'Asia/Hong_Kong': 'HKT-8',
  'Asia/Kolkata': 'IST-5:30',
  'Asia/Seoul': 'KST-9',
  'Asia/Shanghai': 'CST-8',
  'Asia/Singapore': '<+08>-8',
  'Asia/Taipei': 'CST-8',
  'Asia/Tokyo': 'JST-9',
  'Australia/Melbourne': 'AEST-10AEDT,M10.1.0,M4.1.0/3',
  'Australia/Sydney': 'AEST-10AEDT,M10.1.0,M4.1.0/3',
  'Europe/Berlin': 'CET-1CEST,M3.5.0,M10.5.0/3',
  'Europe/London': 'GMT0BST,M3.5.0/1,M10.5.0',
  'Europe/Moscow': 'MSK-3',
  'Europe/Paris': 'CET-1CEST,M3.5.0,M10.5.0/3',
  'Pacific/Auckland': 'NZST-12NZDT,M9.5.0,M4.1.0/3',
  UTC: 'UTC',
};

const routerSeconds = (s: DemoState, now: number) => Math.floor(now / 1000) + s.admin.clockSkewSec;

export const adminHandlers: Record<string, (s: DemoState, p: Record<string, unknown>, now: number) => unknown> = {
  'luci.getProcessList': (s, _p, now) => processList(s, now),
  'luci.getLEDs': (s) => ledList(s),
  'luci.getTimezones': () => Object.fromEntries(Object.entries(ZONES).map(([zone, tzstring]) => [zone, { tzstring }])),
  'luci.getLocaltime': (s, _p, now) => ({ result: routerSeconds(s, now) }),
  'luci.setLocaltime': (s, p, now) => {
    const t = Number(p.localtime);
    if (!Number.isFinite(t)) throw new UbusError('INVALID_ARGUMENT', 'luci.setLocaltime');
    s.admin.clockSkewSec = Math.round(t - now / 1000);
    return { result: routerSeconds(s, now) };
  },
  'luci.setPassword': (_s, p) => {
    if (typeof p.password !== 'string' || !p.password) throw new UbusError('INVALID_ARGUMENT', 'luci.setPassword');
    return { result: true };
  },
};
