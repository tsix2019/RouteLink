import { fetch } from 'expo/fetch';

import type { FetchJson } from './releases';

/** The design's limit for the release lookup: small answers, but GitHub is slow in places. */
const TIMEOUT_MS = 15_000;

/** GETs from the GitHub REST API (or the mock release server), with the system trust store. */
export const githubFetchJson: FetchJson = async (url) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    });
    const text = await res.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    return { status: res.status, json };
  } finally {
    clearTimeout(timer);
  }
};
