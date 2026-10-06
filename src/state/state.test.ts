import * as SecureStore from 'expo-secure-store';
import Storage from 'expo-sqlite/kv-store';

import { DEMO_ROUTER_ID } from '@/api/connection/demo/connection';

import { useAssistant } from './assistant';
import { passwordKey, sortedRouters, useRouters } from './routers';
import { useSettings } from './settings';
import { useSnapshots } from './snapshots';

const secure = SecureStore as unknown as { __store: Map<string, string> };

beforeEach(() => {
  secure.__store.clear();
  useRouters.setState({ routers: [], activeId: null });
});

describe('routers', () => {
  it('normalises the address and stores the password in the secure store', async () => {
    const r = await useRouters
      .getState()
      .add({ name: 'Home', baseUrl: '192.168.1.1/', username: 'root', savePassword: true }, 'pw');
    expect(r.baseUrl).toBe('http://192.168.1.1');
    expect(secure.__store.get(passwordKey(r.id))).toBe('pw');
    await expect(useRouters.getState().getPassword(r.id)).resolves.toBe('pw');
  });

  it('keeps unsaved passwords in memory only', async () => {
    const r = await useRouters
      .getState()
      .add({ name: 'AP', baseUrl: 'http://10.0.0.2', username: 'root', savePassword: false }, 'temp');
    expect(secure.__store.has(passwordKey(r.id))).toBe(false);
    await expect(useRouters.getState().getPassword(r.id)).resolves.toBe('temp');
  });

  it('moves the password when savePassword changes', async () => {
    const r = await useRouters
      .getState()
      .add({ name: 'AP', baseUrl: 'http://10.0.0.2', username: 'root', savePassword: false }, 'temp');
    await useRouters.getState().update(r.id, { savePassword: true });
    expect(secure.__store.get(passwordKey(r.id))).toBe('temp');
  });

  it('forgets or replaces passwords on update', async () => {
    const r = await useRouters
      .getState()
      .add({ name: 'A', baseUrl: 'http://a', username: 'root', savePassword: true }, 'one');
    await useRouters.getState().update(r.id, { name: 'B' }, 'two');
    await expect(useRouters.getState().getPassword(r.id)).resolves.toBe('two');
    await useRouters.getState().update(r.id, {}, null);
    await expect(useRouters.getState().getPassword(r.id)).resolves.toBeNull();
    expect(useRouters.getState().routers[0].name).toBe('B');
  });

  it('removes the password with the router and picks another active router', async () => {
    const a = await useRouters
      .getState()
      .add({ name: 'A', baseUrl: 'http://a', username: 'root', savePassword: true }, 'x');
    const b = await useRouters
      .getState()
      .add({ name: 'B', baseUrl: 'http://b', username: 'root', savePassword: true }, 'y');
    useRouters.getState().setActive(a.id);
    await useRouters.getState().remove(a.id);
    expect(secure.__store.has(passwordKey(a.id))).toBe(false);
    expect(useRouters.getState().activeId).toBe(b.id);
    expect(useRouters.getState().routers.map((r) => r.order)).toEqual([0]);
  });

  it('reorders contiguously and records last use', async () => {
    const ids: string[] = [];
    for (const n of ['A', 'B', 'C'])
      ids.push(
        (await useRouters.getState().add({ name: n, baseUrl: `http://${n}`, username: 'root', savePassword: false }))
          .id,
      );
    useRouters.getState().reorder([ids[2], ids[0]]);
    expect(sortedRouters(useRouters.getState().routers).map((r) => r.name)).toEqual(['C', 'A', 'B']);
    useRouters.getState().setActive(ids[1]);
    expect(useRouters.getState().routers.find((r) => r.id === ids[1])?.lastUsedAt).toBeDefined();
  });
});

describe('settings', () => {
  it('deduplicates the Wake-on-LAN list by normalised MAC', () => {
    useSettings.getState().addWol({ name: 'PC', mac: 'aa-bb-cc-00-11-22' });
    useSettings.getState().addWol({ name: 'Desk PC', mac: 'AA:BB:CC:00:11:22' });
    useSettings.getState().addWol({ name: 'bad', mac: 'nope' });
    expect(useSettings.getState().wolList).toEqual([{ name: 'Desk PC', mac: 'AA:BB:CC:00:11:22' }]);
    useSettings.getState().removeWol('AA:BB:CC:00:11:22');
    expect(useSettings.getState().wolList).toEqual([]);
  });
});

describe('snapshots', () => {
  it('merges patches and forgets routers', () => {
    useSnapshots.getState().save('r1', { model: 'X' });
    useSnapshots.getState().save('r1', { clientsOnline: 3 });
    expect(useSnapshots.getState().byRouter.r1).toMatchObject({ model: 'X', clientsOnline: 3 });
    useSnapshots.getState().forget('r1');
    expect(useSnapshots.getState().byRouter.r1).toBeUndefined();
  });
});

describe('assistant', () => {
  it("keeps real routers' conversations, but not the demo's: demo changes reset with the app", () => {
    const kv = Storage as unknown as { __store: Map<string, string> };
    const say = (text: string) => ({ messages: [{ role: 'user' as const, text }], refs: {} });
    useAssistant.getState().save('r1', say('hello'));
    useAssistant.getState().save(DEMO_ROUTER_ID, say('how is the demo?'));
    const saved = JSON.parse(kv.__store.get('routelink.assistant') ?? '{}') as {
      state: { conversations: Record<string, unknown> };
    };
    expect(Object.keys(saved.state.conversations)).toEqual(['r1']);
    // Still there for this session.
    expect(useAssistant.getState().conversations[DEMO_ROUTER_ID]?.messages).toHaveLength(1);
  });
});
