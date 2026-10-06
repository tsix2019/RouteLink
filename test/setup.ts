// Global jest setup: in-memory replacements for native modules.

// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use import
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use import
jest.mock('react-native-worklets', () => require('react-native-worklets/src/mock'));
// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use import
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));

// The real module calls requireNativeModule() at import time. Tests override individual functions.
jest.mock('routelink-native', () => {
  const notMocked = (name: string) =>
    jest.fn(async () => {
      throw new Error(`routelink-native.${name} is not mocked in this test`);
    });
  // Native events: tests fire them with __emit(name, payload).
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  return {
    __esModule: true,
    default: {
      httpRequest: notMocked('httpRequest'),
      fetchServerCertificate: notMocked('fetchServerCertificate'),
      getNetworkInfo: notMocked('getNetworkInfo'),
      sendWakeOnLan: notMocked('sendWakeOnLan'),
      sleep: jest.fn(async () => undefined),
      sshGenerateKey: notMocked('sshGenerateKey'),
      sshPublicKey: notMocked('sshPublicKey'),
      sshHostKey: notMocked('sshHostKey'),
      sshOpen: notMocked('sshOpen'),
      sshWrite: notMocked('sshWrite'),
      sshResize: notMocked('sshResize'),
      sshClose: notMocked('sshClose'),
      sshExec: notMocked('sshExec'),
      addListener: jest.fn((name: string, listener: (payload: unknown) => void) => {
        const set = listeners.get(name) ?? new Set();
        set.add(listener);
        listeners.set(name, set);
        return { remove: () => set.delete(listener) };
      }),
      __emit: (name: string, payload: unknown) => listeners.get(name)?.forEach((l) => l(payload)),
    },
  };
});

// Home-screen widgets (M4): createWidget hands back an object whose updates tests can check.
jest.mock('expo-widgets', () => ({
  createWidget: jest.fn((name: string) => ({
    name,
    updateSnapshot: jest.fn(),
    updateTimeline: jest.fn(),
    reload: jest.fn(),
  })),
}));

jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    AFTER_FIRST_UNLOCK: 'AFTER_FIRST_UNLOCK',
    getItemAsync: jest.fn(async (key: string) => store.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      store.delete(key);
    }),
    __store: store,
  };
});

jest.mock('expo-sqlite/kv-store', () => {
  const store = new Map<string, string>();
  const Storage = {
    getItem: jest.fn(async (key: string) => store.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: jest.fn(async (key: string) => {
      store.delete(key);
    }),
    getItemSync: jest.fn((key: string) => store.get(key) ?? null),
    setItemSync: jest.fn((key: string, value: string) => {
      store.set(key, value);
    }),
    removeItemSync: jest.fn((key: string) => {
      store.delete(key);
    }),
    clear: jest.fn(async () => store.clear()),
    __store: store,
  };
  return { __esModule: true, default: Storage, Storage };
});
