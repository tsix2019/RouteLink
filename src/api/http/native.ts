import RouteLinkNative from 'routelink-native';

import { toNativeError } from './errors';
import type { HttpClient } from './types';

/** All router traffic goes through the native module: certificate pinning, no cookie jar, no redirects. */
export const nativeHttpClient: HttpClient = {
  async request(req) {
    try {
      return await RouteLinkNative.httpRequest(req);
    } catch (error) {
      throw toNativeError(error);
    }
  },
};
