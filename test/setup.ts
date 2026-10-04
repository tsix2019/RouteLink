// Global jest setup: in-memory replacements for native modules.

jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

// The real module calls requireNativeModule() at import time. Tests override individual functions.
jest.mock('routelink-native', () => {
  const notMocked = (name: string) =>
    jest.fn(async () => {
      throw new Error(`routelink-native.${name} is not mocked in this test`);
    });
  return {
    __esModule: true,
    default: {
      httpRequest: notMocked('httpRequest'),
      fetchServerCertificate: notMocked('fetchServerCertificate'),
      getNetworkInfo: notMocked('getNetworkInfo'),
      sendWakeOnLan: notMocked('sendWakeOnLan'),
    },
  };
});

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
