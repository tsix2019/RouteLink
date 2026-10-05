import { base64ToBytes } from '@/utils/base64';

import type { DemoState } from './state';

/**
 * Backup, restore, firmware and factory reset on the demo router (design §16): the full flow, but only an
 * animation — the router "reboots" and comes back with the same settings.
 */

/** A real tar.gz of a few config files, so the restore check has something to list. */
const BACKUP =
  'H4sIAAAAAAACA+2YsU7DMBCGs8JTeIuE1NZ24gRGBCyICdiRmzj01MQOtksFT4+h0EKBgaEu0PuqypGTqX+/u4uVr0bJhqGBUoiXNbC+vlwzwQsqspLx5/1ChIWIJAIz56UlJNlRVMi/MrqB29Evyr8sC4H5R86/nlT9xvIv8vz7/MO9D/kzWvA8IRTz3ziL7EmtXSfd3f6e6T0YTWrTSdAkbaVO9xNkF/xvwKq5bNst+F+u+c8EK9D/mP6rRs5a75YFAHQ/8yS9PDs/O7nGErAL/mvl58ZO4/d/TrN1/7MS+39M/0F7ZRtZqdeWv5wD1D08b47t4MN+b403JA2/nYdqtQ29rGtLUnbEh6w4HB4O2epm+H+FGWNKUi7E8O1Lsbb8Fv/dg/Oq28L8zzhb959z7P8x/V9kv1R1YpzXsgviX5qZVxegp4NT1ZmVzI9Gq8UTxw7k6Goi9e1EAtr8d/2fh/m/Vc7Fn//L/NP8n6P/Mf2fQwMDWAwAr+8CN1bWYN71b+egflcQUPV/47812sux29QJ8I/PfxnNsgzPf6Pnb43xW5j/6BfzX8ax/seAkpwchA8jVo1D/FjUEQRBEARBEOT/8gR+4vNPACgAAA==';

export const demoBackup = (): Uint8Array => base64ToBytes(BACKUP);

const BACKUP_FILES = [
  'etc/config/dhcp',
  'etc/config/firewall',
  'etc/config/network',
  'etc/config/system',
  'etc/config/wireless',
  'etc/crontabs/root',
];

/** What /proc/mounts shows on an OpenWrt One (UBI overlay). */
export const DEMO_MOUNTS = [
  '/dev/root /rom squashfs ro,relatime,errors=continue 0 0',
  'proc /proc proc rw,nosuid,nodev,noexec,noatime 0 0',
  'sysfs /sys sysfs rw,nosuid,nodev,noexec,noatime 0 0',
  'tmpfs /tmp tmpfs rw,nosuid,nodev,noatime 0 0',
  '/dev/ubi0_2 /overlay ubifs rw,noatime,assert=read-only,ubi=0,vol=2 0 0',
  'overlayfs:/overlay / overlay rw,noatime,lowerdir=/,upperdir=/overlay/upper,workdir=/overlay/work 0 0',
  '',
].join('\n');

type Exec = { code: number; stdout?: string; stderr?: string };

/** Accepts the uploads the maintenance pages make. */
export function demoMaintenanceWrite(s: DemoState, path: string, append: boolean, size: number): boolean {
  if (path !== '/tmp/backup.tar.gz' && path !== '/tmp/firmware.bin') return false;
  s.uploads[path] = (append ? (s.uploads[path] ?? 0) : 0) + size;
  return true;
}

export function demoValidateFirmware(s: DemoState) {
  if (!s.uploads['/tmp/firmware.bin']) return null;
  return {
    tests: { fwtool_signature: true, fwtool_device_match: true },
    valid: true,
    forceable: true,
    allow_backup: true,
  };
}

/** sysupgrade, tar and firstboot as the maintenance pages run them. */
export const maintenanceCommands: Record<string, (s: DemoState, args: string[], now: number) => Exec> = {
  '/bin/tar': (s, args) =>
    args.join(' ') === '-tzf /tmp/backup.tar.gz' && s.uploads['/tmp/backup.tar.gz']
      ? { code: 0, stdout: ['etc/', 'etc/config/', ...BACKUP_FILES].join('\n') + '\n' }
      : { code: 1, stderr: 'tar: /tmp/backup.tar.gz: No such file or directory' },
  '/sbin/sysupgrade': (s, args, now) => {
    const command = args.join(' ');
    if (command === '--list-backup') return { code: 0, stdout: BACKUP_FILES.map((f) => `/${f}`).join('\n') + '\n' };
    if (command === '--restore-backup /tmp/backup.tar.gz') {
      return s.uploads['/tmp/backup.tar.gz'] ? { code: 0 } : { code: 1, stderr: 'no backup' };
    }
    if (args[args.length - 1] === '/tmp/firmware.bin' && s.uploads['/tmp/firmware.bin']) {
      // Flashing and the first boot take a while longer than a reboot.
      delete s.uploads['/tmp/firmware.bin'];
      s.rebootingUntil = now + 20_000;
      return { code: 0 };
    }
    return { code: 1, stderr: 'unsupported' };
  },
  '/sbin/firstboot': (s, args, now) => {
    if (args.join(' ') !== '-r -y') return { code: 1, stderr: 'unsupported' };
    s.rebootingUntil = now + 12_000;
    return { code: 0 };
  },
};
