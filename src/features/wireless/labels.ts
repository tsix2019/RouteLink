import type { Band } from '@/api/services/clients';
import { ENCRYPTIONS, htmodeGeneration, htmodeWidth, type Encryption } from '@/api/services/wireless';
import type { AppT } from '@/i18n';

const BAND_KEYS: Record<Band, '2g' | '5g' | '6g'> = { '2.4G': '2g', '5G': '5g', '6G': '6g' };

export const bandLabel = (t: AppT, band: Band | undefined) => t(`wireless:band.${band ? BAND_KEYS[band] : 'unknown'}`);

export const encryptionLabel = (t: AppT, encryption: string) =>
  ENCRYPTIONS.includes(encryption as Encryption)
    ? t(`wireless:network.enc.${encryption as Encryption}`)
    : t('wireless:network.enc.other', { value: encryption });

/** "VHT80" → "80 MHz · Wi-Fi 5". */
export function widthLabel(htmode: string | undefined): string {
  if (!htmode) return '—';
  const width = htmodeWidth(htmode);
  const generation = htmodeGeneration(htmode);
  return [width ? `${width} MHz` : htmode, generation ? `Wi-Fi ${generation}` : null].filter(Boolean).join(' · ');
}

export const channelLabel = (t: AppT, channel: string) =>
  channel === 'auto' ? t('wireless:auto') : t('wireless:channelValue', { channel });
