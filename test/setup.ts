// Global jest setup: in-memory replacements for native storage modules.

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
