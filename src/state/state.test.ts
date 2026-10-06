import * as SecureStore from 'expo-secure-store';
import Storage from 'expo-sqlite/kv-store';

import { DEMO_ROUTER_ID } from '@/api/connection/demo/connection';

import { KEEP_CONVERSATIONS, useAssistant } from './assistant';
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
  const kv = Storage as unknown as { __store: Map<string, string> };
  const say = (text: string) => [{ role: 'user' as const, text }];
  const mine = (routerId: string) =>
    Object.values(useAssistant.getState().conversations).filter((c) => c.routerId === routerId);

  beforeEach(() => useAssistant.getState().clear());

  it("keeps real routers' conversations, but not the demo's: demo changes reset with the app", () => {
    useAssistant.getState().save({ id: 'a', routerId: 'r1', messages: say('hello'), refs: {} });
    useAssistant.getState().save({ id: 'b', routerId: DEMO_ROUTER_ID, messages: say('how is the demo?'), refs: {} });
    const saved = JSON.parse(kv.__store.get('routelink.assistant') ?? '{}') as {
      state: { conversations: Record<string, unknown> };
    };
    expect(Object.keys(saved.state.conversations)).toEqual(['a']);
    // Still there for this session.
    expect(useAssistant.getState().conversations.b?.messages).toHaveLength(1);
  });

  it('names a conversation after its first question and keeps the name it is given', () => {
    const long = `${'路由器'.repeat(30)}
怎么样`;
    useAssistant.getState().save({ id: 'a', routerId: 'r1', messages: say(long), refs: {} });
    const title = useAssistant.getState().conversations.a.title;
    expect(title).toHaveLength(60);
    expect(title.endsWith('…')).toBe(true);
    useAssistant.getState().rename('a', '  晚上 网速  ');
    useAssistant.getState().save({ id: 'a', routerId: 'r1', messages: [...say(long), ...say('还有呢')], refs: {} });
    expect(useAssistant.getState().conversations.a).toMatchObject({ title: '晚上 网速', messages: { length: 2 } });
  });

  it('keeps a router to its latest conversations', () => {
    for (let i = 0; i < KEEP_CONVERSATIONS + 3; i++) {
      jest.spyOn(Date, 'now').mockReturnValue(1_000 + i);
      useAssistant.getState().save({ id: `c${i}`, routerId: 'r1', messages: say(`q${i}`), refs: {} });
    }
    useAssistant.getState().save({ id: 'other', routerId: 'r2', messages: say('hi'), refs: {} });
    jest.restoreAllMocks();
    expect(mine('r1')).toHaveLength(KEEP_CONVERSATIONS);
    expect(useAssistant.getState().conversations.c0).toBeUndefined();
    expect(useAssistant.getState().conversations[`c${KEEP_CONVERSATIONS + 2}`]).toBeDefined();
    expect(mine('r2')).toHaveLength(1);
  });

  it('closes a conversation that is deleted, and clears one router at a time', () => {
    const s = () => useAssistant.getState();
    s().save({ id: 'a', routerId: 'r1', messages: say('one'), refs: {} });
    s().save({ id: 'b', routerId: 'r1', messages: say('two'), refs: {} });
    s().save({ id: 'c', routerId: 'r2', messages: say('three'), refs: {} });
    s().open('r1', 'a');
    s().remove('a');
    expect(s().current.r1).toBeUndefined();
    s().open('r2', 'c');
    s().clear('r1');
    expect(Object.keys(s().conversations)).toEqual(['c']);
    expect(s().current).toEqual({ r2: 'c' });
  });

  it("turns version 1's one conversation per router into the router's first conversation", async () => {
    const messages = [
      { role: 'user', text: '谁在线？' },
      { role: 'assistant', text: '3 台', calls: [] },
    ];
    kv.__store.set(
      'routelink.assistant',
      JSON.stringify({
        version: 1,
        state: {
          consented: true,
          conversations: { r1: { messages, refs: { d1: 'aa' }, updatedAt: 5 }, r2: { messages: [] } },
        },
      }),
    );
    await useAssistant.persist.rehydrate();
    const [c, ...rest] = Object.values(useAssistant.getState().conversations);
    expect(rest).toEqual([]);
    expect(c).toMatchObject({ routerId: 'r1', title: '谁在线？', messages, refs: { d1: 'aa' }, updatedAt: 5 });
    expect(useAssistant.getState().consented).toBe(true);
  });
});
