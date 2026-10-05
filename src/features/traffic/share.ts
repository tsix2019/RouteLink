import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

/** Writes the CSV to the cache directory and opens the system share sheet. */
export async function shareCsv(fileName: string, content: string, dialogTitle: string): Promise<void> {
  const file = new File(Paths.cache, fileName);
  if (file.exists) file.delete();
  file.create();
  file.write(content);
  await Sharing.shareAsync(file.uri, { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text', dialogTitle });
}

/** The phone's IANA time zone, for CSV timestamps. */
export const phoneTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

/** "routelink-traffic-2026-10-05.csv" (the range's start, in the phone's time zone). */
export function csvFileName(kind: 'devices' | 'curve', start: number): string {
  const d = new Date(start * 1000);
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return `routelink-${kind === 'devices' ? 'traffic' : 'traffic-curve'}-${day}.csv`;
}
