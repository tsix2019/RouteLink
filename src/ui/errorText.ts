import { classifyError, type ConnectionFailure } from '@/api/connection/types';
import { ActionError } from '@/api/services/action-error';
import type { AppT } from '@/i18n';

/** User-facing title + optional detail for any error the app can throw. */
export function describeError(t: AppT, error: unknown): { title: string; detail?: string } {
  if (error instanceof ActionError) {
    const key = `errors:action.${error.code}` as 'errors:action.name-empty';
    const known = t(key, { message: error.message, defaultValue: '' });
    return { title: known || t('errors:generic', { message: error.message }) };
  }
  return describeFailure(t, classifyError(error));
}

/** Same as describeError, for a failure that was already classified. */
export function describeFailure(t: AppT, failure: ConnectionFailure): { title: string; detail?: string } {
  switch (failure.kind) {
    case 'offline':
      return { title: t('errors:connection.offline'), detail: t('errors:connectionHint.offline') };
    case 'auth':
      return { title: t('errors:connection.auth') };
    case 'not-openwrt':
      return { title: t('errors:connection.not-openwrt') };
    case 'tls-untrusted':
      return { title: t('errors:connection.tls-untrusted') };
    case 'tls-mismatch':
      return { title: t('errors:connection.tls-mismatch') };
    case 'permission':
      return { title: t('errors:connection.permission'), detail: failure.call };
    case 'protocol':
      return { title: t('errors:connection.protocol', { status: failure.status }) };
    default:
      return { title: t('errors:generic', { message: failure.message }) };
  }
}
