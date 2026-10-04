import RouteLinkNative, { type CertificateInfo } from 'routelink-native';

import { toNativeError } from '@/api/http/errors';

/** What the trust sheet shows: a first-time certificate, or one that replaced a pinned certificate. */
export type TrustRequest =
  | { kind: 'new'; baseUrl: string; certificate: CertificateInfo }
  | { kind: 'changed'; baseUrl: string; certificate: CertificateInfo; previousSha256: string };

export interface TrustDeps {
  fetchCertificate(url: string): Promise<CertificateInfo>;
  /** Shows the request to the user; resolves true when they trust the certificate. */
  ask(request: TrustRequest): Promise<boolean>;
}

export const nativeFetchCertificate = async (url: string): Promise<CertificateInfo> => {
  try {
    return await RouteLinkNative.fetchServerCertificate(url);
  } catch (error) {
    throw toNativeError(error);
  }
};

/**
 * Trust on first use (design §7). For an untrusted or changed certificate, fetch the router's
 * certificate and ask the user. Returns the fingerprint to pin, or null when the user declines.
 */
export async function resolveCertificate(
  o: { baseUrl: string; failure: 'tls-untrusted' | 'tls-mismatch'; pinnedSha256?: string },
  deps: TrustDeps,
): Promise<string | null> {
  const certificate = await deps.fetchCertificate(o.baseUrl);
  const request: TrustRequest =
    o.failure === 'tls-mismatch' && o.pinnedSha256
      ? { kind: 'changed', baseUrl: o.baseUrl, certificate, previousSha256: o.pinnedSha256 }
      : { kind: 'new', baseUrl: o.baseUrl, certificate };
  return (await deps.ask(request)) ? certificate.sha256.toLowerCase() : null;
}

/** "ab12…" → "AB:12:…" */
export function formatFingerprint(sha256: string): string {
  return (
    sha256
      .replace(/[^0-9a-f]/gi, '')
      .toUpperCase()
      .match(/.{1,2}/g)
      ?.join(':') ?? ''
  );
}
