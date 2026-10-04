import { NativeModule, requireNativeModule } from 'expo';

import type { CertificateInfo, HttpRequestOptions, HttpResponse, NetworkInfo } from './RouteLinkNative.types';

declare class RouteLinkNativeModule extends NativeModule<Record<string, never>> {
  httpRequest(options: HttpRequestOptions): Promise<HttpResponse>;
  fetchServerCertificate(url: string, timeoutMs?: number): Promise<CertificateInfo>;
  getNetworkInfo(): Promise<NetworkInfo>;
  /** Android only; iOS rejects with ERR_UNSUPPORTED (broadcast needs Apple's multicast entitlement). */
  sendWakeOnLan(mac: string, broadcast?: string, port?: number): Promise<void>;
}

export default requireNativeModule<RouteLinkNativeModule>('RouteLinkNative');
