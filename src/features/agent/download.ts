import { CryptoDigestAlgorithm, digest } from 'expo-crypto';
import { fetch } from 'expo/fetch';

import type { InstallDeps } from './install';

const TIMEOUT_MS = 60_000;

/**
 * Phone-side downloads from GitHub (manifest, packages): public HTTPS with the system trust store, so this
 * uses Expo's fetch rather than the router HTTP module (certificate pinning, no redirects).
 */
async function get(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
    return res as unknown as Response;
  } finally {
    clearTimeout(timer);
  }
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const hash = new Uint8Array(await digest(CryptoDigestAlgorithm.SHA256, bytes as Uint8Array<ArrayBuffer>));
  return Array.from(hash, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Manifest, packages and hashing for a real router. */
export const networkInstallDeps: Pick<InstallDeps, 'fetchManifest' | 'download' | 'sha256'> = {
  fetchManifest: async (url) => (await get(url)).json(),
  download: async (url) => new Uint8Array(await (await get(url)).arrayBuffer()),
  sha256: sha256Hex,
};
