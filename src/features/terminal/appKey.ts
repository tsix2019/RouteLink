import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { generateKeyPair } from '@/api/ssh/client';

const SEED = 'ssh.app-key.seed';
const PUBLIC = 'ssh.app-key.public';
const OPTIONS = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK };

/** No device name in the comment: it ends up in the router's authorized_keys. */
const COMMENT = `routelink-${Platform.OS}`;

export interface AppKey {
  /** 32-byte ed25519 seed, base64: never leaves the secure store except into the native SSH client. */
  seed: string;
  /** authorized_keys line. */
  publicKey: string;
}

let making: Promise<AppKey> | null = null;

/** The app's one ed25519 key (design §17), made on first use. */
export function appKey(): Promise<AppKey> {
  making ??= (async () => {
    const [seed, publicKey] = await Promise.all([SecureStore.getItemAsync(SEED), SecureStore.getItemAsync(PUBLIC)]);
    if (seed && publicKey) return { seed, publicKey };
    const pair = await generateKeyPair(COMMENT);
    await SecureStore.setItemAsync(SEED, pair.seed, OPTIONS);
    await SecureStore.setItemAsync(PUBLIC, pair.publicKey, OPTIONS);
    return pair;
  })().finally(() => {
    making = null;
  });
  return making;
}
