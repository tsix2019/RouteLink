import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

/** Configuration backups kept on the phone (app documents, so the system does not clear them). */

export interface LocalBackup {
  name: string;
  uri: string;
  size: number;
  /** ms since the epoch */
  modified: number;
}

const dir = () => new Directory(Paths.document, 'backups');

export function listLocalBackups(): LocalBackup[] {
  const d = dir();
  if (!d.exists) return [];
  return d
    .list()
    .filter((f): f is File => f instanceof File && f.name.endsWith('.tar.gz'))
    .map((f) => ({ name: f.name, uri: f.uri, size: f.size ?? 0, modified: f.modificationTime ?? 0 }))
    .sort((a, b) => b.modified - a.modified);
}

/** Saves under `name`, adding "-2", "-3" … when a backup of that name exists already. */
export function saveLocalBackup(name: string, bytes: Uint8Array): LocalBackup {
  const d = dir();
  d.create({ idempotent: true, intermediates: true });
  const base = name.replace(/\.tar\.gz$/, '');
  let file = new File(d, name);
  for (let i = 2; file.exists; i++) file = new File(d, `${base}-${i}.tar.gz`);
  file.create();
  file.write(bytes);
  return { name: file.name, uri: file.uri, size: bytes.length, modified: file.modificationTime ?? 0 };
}

export function deleteLocalBackup(backup: LocalBackup): void {
  const file = new File(backup.uri);
  if (file.exists) file.delete();
}

export const readLocalFile = (uri: string): Promise<Uint8Array> => new File(uri).bytes();

export async function shareBackup(backup: LocalBackup, dialogTitle: string): Promise<void> {
  await Sharing.shareAsync(backup.uri, { mimeType: 'application/gzip', UTI: 'org.gnu.gnu-zip-archive', dialogTitle });
}

/** Any file through the system picker, copied to the cache so it can be read; null when cancelled. */
export async function pickFile(): Promise<{ name: string; bytes: Uint8Array } | null> {
  const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, type: '*/*' });
  if (result.canceled) return null;
  const asset = result.assets[0];
  return { name: asset.name, bytes: await new File(asset.uri).bytes() };
}
