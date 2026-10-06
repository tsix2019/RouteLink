import RouteLinkNative from 'routelink-native';

import { DemoConnection } from '@/api/connection/demo/connection';
import type { RouterConnection } from '@/api/connection/types';
import { NativeError } from '@/api/http/errors';
import { useRouters } from '@/state/routers';
import { useSettings } from '@/state/settings';

import { checkRouters } from './check';

/** A router that does not answer: every request times out. */
function unreachable(): RouterConnection {
  const fail = () => Promise.reject(new NativeError('ERR_TIMEOUT', 'request timed out'));
  return { routerId: 'home', kind: 'live', call: fail, batch: fail, ping: async () => false };
}

describe('background check', () => {
  it('reads the watched routers with their saved password and tells when one goes down and comes back', async () => {
    const add = useRouters.getState().add;
    const home = await add({ name: 'Home', baseUrl: 'http://192.168.1.1', username: 'root', savePassword: true }, 'pw');
    await add({ name: 'Office', baseUrl: 'http://10.0.0.1', username: 'root', savePassword: true }, 'pw');
    useSettings.getState().set({ notifyRouters: [home.id], language: 'en' });
    const notify = jest.fn(async (_title: string, _body: string) => undefined);
    let up = true;
    const connect = jest.fn((_profile: { id: string }, _password: string) =>
      up ? new DemoConnection(2026, () => 1_800_000_000_000, 0) : unreachable(),
    );

    // The first round only learns what is there.
    expect(await checkRouters({ notify, connect })).toEqual({ checked: 1, alerts: 0 });
    expect(connect).toHaveBeenCalledWith(expect.objectContaining({ id: home.id }), 'pw');

    up = false;
    expect(await checkRouters({ notify, connect })).toEqual({ checked: 1, alerts: 1 });
    // Second try ten seconds later, waited for natively: a headless start runs no JavaScript timers.
    expect(RouteLinkNative.sleep).toHaveBeenCalledWith(10_000);
    expect(notify).toHaveBeenLastCalledWith('Home is unreachable', expect.any(String));

    up = true;
    expect(await checkRouters({ notify, connect })).toEqual({ checked: 1, alerts: 1 });
    expect(notify).toHaveBeenLastCalledWith('Home is back', expect.any(String));
  });

  it('leaves new devices to the plugin when one of its push channels sends them', async () => {
    const add = useRouters.getState().add;
    const home = await add({ name: 'Lab', baseUrl: 'http://192.168.9.1', username: 'root', savePassword: true }, 'pw');
    useSettings.getState().set({ notifyRouters: [home.id], language: 'en' });
    const notify = jest.fn(async (_title: string, _body: string) => undefined);
    const demo = new DemoConnection(2026, () => 1_800_000_000_000, 0);
    const connect = () => demo;
    await checkRouters({ notify, connect });

    const join = (mac: string) =>
      demo.state.devices.push({
        ...demo.state.devices[0],
        mac,
        hostname: `New-${mac.slice(-2)}`,
        ip: `192.168.8.${200 + demo.state.devices.length}`,
      });
    // The demo plugin has a Bark channel with device_new.
    join('02:11:22:33:44:01');
    expect(await checkRouters({ notify, connect })).toEqual({ checked: 1, alerts: 0 });

    demo.state.uci.routelink.cfg_notify_bark.enabled = '0';
    join('02:11:22:33:44:02');
    expect(await checkRouters({ notify, connect })).toEqual({ checked: 1, alerts: 1 });
    expect(notify).toHaveBeenLastCalledWith(
      expect.stringContaining('Lab'),
      expect.stringContaining('02:11:22:33:44:02'),
    );
  });
});
