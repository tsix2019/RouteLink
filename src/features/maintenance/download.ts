import { fetch } from 'expo/fetch';

import type { RouterConnection } from '@/api/connection/types';
import { sha256Hex } from '@/features/agent/download';

/**
 * Phone-side downloads for online upgrades: public HTTPS from the projects' download sites (system trust,
 * not the router HTTP module). The demo router gets a canned catalogue and a small fake image instead.
 */

const TIMEOUT_MS = 30_000;

export async function fetchJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** The whole file in memory (sysupgrade images are 5–40 MB), reporting the bytes received so far. */
export async function downloadFile(
  url: string,
  onProgress: (received: number, total: number) => void,
): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  const total = Number(res.headers.get('content-length') ?? 0);
  const reader = res.body?.getReader();
  if (!reader) {
    const bytes = new Uint8Array(await res.arrayBuffer());
    onProgress(bytes.length, bytes.length);
    return bytes;
  }
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress(received, total);
  }
  const out = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

export { sha256Hex };

// ---- demo ----

const DEMO_IMAGE_SIZE = 6 * 1024 * 1024;
const demoImage = () => new Uint8Array(DEMO_IMAGE_SIZE).map((_, i) => (i * 7) & 0xff);

/** OpenWrt One on 24.10.8, with 25.12.5 available. */
export async function demoFetchJson(url: string): Promise<unknown> {
  if (url.endsWith('/.versions.json')) {
    return { stable_version: '25.12.5', oldstable_version: '24.10.8', versions_list: ['25.12.5', '24.10.8'] };
  }
  const version = /releases\/([^/]+)\//.exec(url)?.[1] ?? '24.10.8';
  const name = `openwrt-${version}-mediatek-filogic-openwrt_one-squashfs-sysupgrade.itb`;
  return {
    target: 'mediatek/filogic',
    version_number: version,
    version_code: version === '24.10.8' ? 'r29233-443ec4032a' : 'r31000-5a8c3a2e1f',
    profiles: {
      openwrt_one: {
        supported_devices: ['openwrt,one'],
        images: [{ type: 'sysupgrade', filesystem: 'squashfs', name, sha256: await sha256Hex(demoImage()) }],
      },
    },
  };
}

export async function demoDownload(_url: string, onProgress: (received: number, total: number) => void) {
  const bytes = demoImage();
  for (let sent = 0; sent < bytes.length; sent += bytes.length / 8) {
    await new Promise((r) => setTimeout(r, 150));
    onProgress(Math.min(bytes.length, sent + bytes.length / 8), bytes.length);
  }
  return bytes;
}

export const firmwareSource = (conn: RouterConnection | null) =>
  conn?.kind === 'demo' ? { fetchJson: demoFetchJson, download: demoDownload } : { fetchJson, download: downloadFile };
