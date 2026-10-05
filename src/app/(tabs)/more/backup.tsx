import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { backupContents, backupFileList, backupFileName, downloadBackup, uploadBackup } from '@/api/services/backup';
import { FeatureGate } from '@/features/capabilities/FeatureGate';
import { BackupFirst } from '@/features/maintenance/BackupFirst';
import {
  deleteLocalBackup,
  listLocalBackups,
  pickFile,
  readLocalFile,
  saveLocalBackup,
  shareBackup,
  type LocalBackup,
} from '@/features/maintenance/files';
import { useActiveRouter } from '@/features/routers/ActiveRouterProvider';
import { useRouterQuery, useSystem } from '@/hooks/router-queries';
import { useLang, useT } from '@/i18n';
import { ActionSheet } from '@/ui/ActionSheet';
import { AppText } from '@/ui/AppText';
import { BusyOverlay } from '@/ui/BusyOverlay';
import { describeError } from '@/ui/errorText';
import { GlassButton } from '@/ui/GlassButton';
import { ListRow, ListSection } from '@/ui/ListSection';
import { RiskConfirm } from '@/ui/RiskConfirm';
import { Screen } from '@/ui/Screen';
import { spacing } from '@/ui/theme/tokens';
import { useToast } from '@/ui/Toast';
import { formatBytes } from '@/utils/format';

type Source = { name: string; read(): Promise<Uint8Array> };

/** MO-9: back up to the phone, share, and restore (checked, then the high-risk flow and the progress screen). */
export default function Backup() {
  const t = useT();
  const lang = useLang();
  const toast = useToast();
  const nav = useRouter();
  const { connection, router } = useActiveRouter();
  const hostname = useSystem().data?.hostname ?? 'OpenWrt';
  const files = useRouterQuery(['backup-files'], backupFileList);
  const [locals, setLocals] = useState<LocalBackup[]>(() => listLocalBackups());
  const [busy, setBusy] = useState<string | null>(null);
  const [menu, setMenu] = useState<LocalBackup | null>(null);
  const [deleting, setDeleting] = useState<LocalBackup | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [checked, setChecked] = useState<{ name: string; contents: string[] } | null>(null);
  const fail = (e: unknown) => toast(describeError(t, e).title, 'error');

  const download = async () => {
    if (!connection) return;
    setBusy(t('more:backupScreen.downloading'));
    try {
      const saved = saveLocalBackup(backupFileName(hostname, new Date()), await downloadBackup(connection));
      setLocals(listLocalBackups());
      toast(t('more:backupScreen.saved', { name: saved.name }));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  /** Upload and check before anything is restored: the confirmation lists what the archive holds. */
  const prepare = async (s: Source) => {
    if (!connection) return;
    try {
      const bytes = await s.read();
      setBusy(t('more:backupScreen.uploading', { progress: '0%' }));
      await uploadBackup(connection, bytes, (sent) =>
        setBusy(t('more:backupScreen.uploading', { progress: `${Math.round((sent / bytes.length) * 100)}%` })),
      );
      setBusy(t('more:backupScreen.checking'));
      setChecked({ name: s.name, contents: await backupContents(connection) });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const fromFile = async () => {
    try {
      const picked = await pickFile();
      if (picked) setSource({ name: picked.name, read: async () => picked.bytes });
    } catch (e) {
      fail(e);
    }
  };

  const configs = checked?.contents.filter((f) => f.startsWith('etc/config/')).map((f) => f.slice(11)) ?? [];
  return (
    <>
      <Screen title={t('more:backupScreen.title')}>
        <FeatureGate feature="system.backup" icon="backup">
          <AppText variant="footnote" tone="secondary" style={styles.note}>
            {t('more:backupScreen.intro')}
          </AppText>
          <GlassButton
            label={t('more:backupScreen.download')}
            icon="download"
            variant="primary"
            disabled={!!busy}
            onPress={() => void download()}
            testID="backup-download"
          />
          {files.data ? (
            <AppText variant="footnote" tone="tertiary" style={styles.note}>
              {t('more:backupScreen.files', { count: files.data.length })}
            </AppText>
          ) : null}
          <ListSection title={t('more:backupScreen.local')} footer={t('more:backupScreen.sensitive')}>
            {locals.length ? (
              locals.map((b) => (
                <ListRow
                  key={b.uri}
                  icon="backup"
                  title={b.name}
                  subtitle={[formatBytes(b.size), b.modified ? new Date(b.modified).toLocaleString(lang) : null]
                    .filter(Boolean)
                    .join(' · ')}
                  chevron
                  onPress={() => setMenu(b)}
                  testID={`backup-${b.name}`}
                />
              ))
            ) : (
              <ListRow title={t('more:backupScreen.noLocal')} disabled />
            )}
          </ListSection>
          <GlassButton
            label={t('more:backupScreen.restoreFromFile')}
            icon="import"
            disabled={!!busy}
            onPress={() => void fromFile()}
            testID="backup-restore-file"
          />
        </FeatureGate>
      </Screen>

      <ActionSheet
        visible={!!menu}
        title={menu?.name}
        actions={
          menu
            ? [
                {
                  label: t('more:backupScreen.share'),
                  icon: 'share' as const,
                  onPress: () => {
                    const b = menu;
                    setMenu(null);
                    shareBackup(b, t('more:backupScreen.share')).catch(fail);
                  },
                },
                {
                  label: t('more:backupScreen.restore'),
                  icon: 'reset' as const,
                  onPress: () => {
                    const b = menu;
                    setMenu(null);
                    setSource({ name: b.name, read: () => readLocalFile(b.uri) });
                  },
                },
                {
                  label: t('more:backupScreen.delete'),
                  icon: 'trash' as const,
                  destructive: true,
                  onPress: () => {
                    setDeleting(menu);
                    setMenu(null);
                  },
                },
              ]
            : []
        }
        onCancel={() => setMenu(null)}
      />
      <BackupFirst
        visible={!!source}
        onCancel={() => setSource(null)}
        onContinue={() => {
          const s = source!;
          setSource(null);
          setLocals(listLocalBackups());
          void prepare(s);
        }}
      />
      <RiskConfirm
        visible={!!checked}
        level="high"
        title={t('more:backupScreen.restoreTitle', { name: checked?.name ?? '' })}
        consequences={[
          t('more:backupScreen.restoreRisks.replace'),
          t('more:backupScreen.restoreRisks.reboot'),
          t('more:backupScreen.restoreRisks.address'),
          t('more:backupScreen.restoreRisks.power'),
          t('more:backupScreen.contents', {
            count: checked?.contents.length ?? 0,
            files: configs.slice(0, 6).join(', ') + (configs.length > 6 ? '…' : ''),
          }),
        ]}
        confirmPhrase={router?.name}
        confirmLabel={t('more:backupScreen.confirm')}
        onConfirm={() => {
          setChecked(null);
          nav.push('/maintenance?mode=restore');
        }}
        onCancel={() => setChecked(null)}
      />
      <RiskConfirm
        visible={!!deleting}
        level="medium"
        title={t('more:backupScreen.deleteTitle', { name: deleting?.name ?? '' })}
        consequences={[t('more:backupScreen.deleteConsequence')]}
        confirmLabel={t('more:backupScreen.delete')}
        onConfirm={() => {
          if (deleting) deleteLocalBackup(deleting);
          setDeleting(null);
          setLocals(listLocalBackups());
        }}
        onCancel={() => setDeleting(null)}
      />
      <BusyOverlay visible={!!busy} title={busy ?? ''} />
    </>
  );
}

const styles = StyleSheet.create({
  note: { paddingHorizontal: spacing.l },
});
