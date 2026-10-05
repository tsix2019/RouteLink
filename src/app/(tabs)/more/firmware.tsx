import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  checkOnline,
  getFirmwareInfo,
  onlineSupport,
  uploadFirmware,
  validateFirmware,
  type FirmwareCheck,
  type OfficialImage,
  type OnlineCheck,
} from '@/api/services/firmware';
import { FeatureGate } from '@/features/capabilities/FeatureGate';
import { BackupFirst } from '@/features/maintenance/BackupFirst';
import { firmwareSource, sha256Hex } from '@/features/maintenance/download';
import { pickFile } from '@/features/maintenance/files';
import { useActiveRouter } from '@/features/routers/ActiveRouterProvider';
import { useRouterQuery } from '@/hooks/router-queries';
import { useT } from '@/i18n';
import { AppText } from '@/ui/AppText';
import { BusyOverlay } from '@/ui/BusyOverlay';
import { describeError } from '@/ui/errorText';
import { ErrorState, Skeleton } from '@/ui/Feedback';
import { GlassButton } from '@/ui/GlassButton';
import { GlassCard } from '@/ui/GlassCard';
import { ListRow, ListSection } from '@/ui/ListSection';
import { RiskConfirm } from '@/ui/RiskConfirm';
import { Screen } from '@/ui/Screen';
import { spacing } from '@/ui/theme/tokens';
import { useToast } from '@/ui/Toast';
import { formatBytes } from '@/utils/format';

/** Where the image comes from; read() yields its bytes (downloaded and verified, or picked). */
type Source = { name: string; read(onProgress: (text: string) => void): Promise<Uint8Array> };
type Checked = { name: string; size: number; check: FirmwareCheck };

const percent = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : formatBytes(a));

/** MO-11: firmware from the official download site (official builds only) or a local file. */
export default function Firmware() {
  const t = useT();
  const toast = useToast();
  const nav = useRouter();
  const { connection, router } = useActiveRouter();
  const info = useRouterQuery(['firmware-info'], getFirmwareInfo);
  const [online, setOnline] = useState<OnlineCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [checked, setChecked] = useState<Checked | null>(null);
  const [keep, setKeep] = useState(true);
  const [force, setForce] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const fail = (e: unknown) => toast(describeError(t, e).title, 'error');
  const files = firmwareSource(connection);

  const data = info.data;
  const support = data ? onlineSupport(data) : null;

  const check = async () => {
    if (!data) return;
    setChecking(true);
    try {
      setOnline(await checkOnline(data, files.fetchJson));
    } catch (e) {
      fail(e);
    } finally {
      setChecking(false);
    }
  };

  const official = (image: OfficialImage): Source => ({
    name: image.name,
    read: async (progress) => {
      const bytes = await files.download(image.url, (got, total) =>
        progress(t('more:firmwareScreen.downloading', { progress: percent(got, total) })),
      );
      progress(t('more:firmwareScreen.verifying'));
      if ((await sha256Hex(bytes)) !== image.sha256) throw new Error(t('more:firmwareScreen.hashMismatch'));
      return bytes;
    },
  });

  const fromFile = async () => {
    try {
      const picked = await pickFile();
      if (picked) setSource({ name: picked.name, read: async () => picked.bytes });
    } catch (e) {
      fail(e);
    }
  };

  /** Download or read, upload, validate: all before the user is asked to confirm. */
  const prepare = async (s: Source) => {
    if (!connection || !data) return;
    try {
      const bytes = await s.read(setBusy);
      setBusy(t('more:firmwareScreen.uploading', { progress: '0%' }));
      await uploadFirmware(connection, bytes, data.tmpFreeKb, (sent) =>
        setBusy(t('more:firmwareScreen.uploading', { progress: percent(sent, bytes.length) })),
      );
      setBusy(t('more:firmwareScreen.validating'));
      const result = await validateFirmware(connection);
      setKeep(result.allowBackup);
      setForce(false);
      setChecked({ name: s.name, size: bytes.length, check: result });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const canFlash = !!checked && (checked.check.valid || (checked.check.forceable && force));
  return (
    <>
      <Screen title={t('more:firmwareScreen.title')} onRefresh={() => info.refetch()}>
        <FeatureGate feature="system.firmware" icon="firmware">
          {data ? (
            <>
              <ListSection title={t('more:firmwareScreen.current')}>
                <ListRow title={t('more:firmwareScreen.model')} value={data.model} />
                <ListRow
                  title={t('more:firmwareScreen.version')}
                  value={`${data.distribution} ${data.version}`}
                  subtitle={data.revision}
                />
                <ListRow title={t('more:firmwareScreen.target')} value={data.target} />
                <ListRow title={t('more:firmwareScreen.board')} value={data.board} />
              </ListSection>

              {checked ? (
                <FlashCard
                  checked={checked}
                  keep={keep}
                  force={force}
                  onKeep={setKeep}
                  onForce={setForce}
                  canFlash={canFlash}
                  onFlash={() => setConfirming(true)}
                  onCancel={() => setChecked(null)}
                />
              ) : (
                <>
                  <ListSection
                    title={t('more:firmwareScreen.online')}
                    footer={support?.ok ? t('more:firmwareScreen.checkHint', { site: support.site }) : undefined}>
                    {!support?.ok ? (
                      <ListRow title={t(`more:firmwareScreen.unsupported.${support!.reason}`)} disabled />
                    ) : !online ? (
                      <ListRow
                        title={checking ? t('more:firmwareScreen.checking') : t('more:firmwareScreen.check')}
                        icon="refresh"
                        disabled={checking}
                        onPress={() => void check()}
                        testID="firmware-check"
                      />
                    ) : online.status === 'unsupported' ? (
                      <ListRow title={t(`more:firmwareScreen.unsupported.${online.reason}`)} disabled />
                    ) : online.status === 'custom-build' ? (
                      <ListRow title={t('more:firmwareScreen.customBuild')} disabled />
                    ) : online.status === 'no-image' ? (
                      <ListRow title={t('more:firmwareScreen.noImage')} disabled />
                    ) : (
                      <>
                        {online.upgrades.length ? null : (
                          <ListRow title={t('more:firmwareScreen.upToDate')} icon="check" disabled />
                        )}
                        {online.upgrades.map((u) => (
                          <ListRow
                            key={u.version}
                            title={t('more:firmwareScreen.upgradeTo', { version: u.version })}
                            subtitle={u.name}
                            icon="firmware"
                            chevron
                            onPress={() => setSource(official(u))}
                            testID={`firmware-upgrade-${u.version}`}
                          />
                        ))}
                        <ListRow
                          title={t('more:firmwareScreen.reinstall', { version: online.current.version })}
                          subtitle={online.current.name}
                          chevron
                          onPress={() => setSource(official(online.current))}
                          testID="firmware-reinstall"
                        />
                      </>
                    )}
                  </ListSection>
                  <ListSection title={t('more:firmwareScreen.local')}>
                    <ListRow
                      title={t('more:firmwareScreen.pickFile')}
                      icon="import"
                      chevron
                      onPress={() => void fromFile()}
                      testID="firmware-file"
                    />
                  </ListSection>
                </>
              )}
            </>
          ) : info.isError ? (
            <ErrorState error={info.error} onRetry={() => void info.refetch()} />
          ) : (
            <View style={styles.loading}>
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} height={52} radius={14} />
              ))}
            </View>
          )}
        </FeatureGate>
      </Screen>

      <BackupFirst
        visible={!!source}
        onCancel={() => setSource(null)}
        onContinue={() => {
          const s = source!;
          setSource(null);
          void prepare(s);
        }}
      />
      <RiskConfirm
        visible={confirming}
        level="high"
        title={t('more:firmwareScreen.confirmTitle')}
        subtitle={checked?.name}
        consequences={[
          t('more:firmwareScreen.risks.brick'),
          t('more:firmwareScreen.risks.time'),
          ...(keep ? [] : [t('more:firmwareScreen.risks.settings')]),
          t('more:firmwareScreen.packages'),
          t('more:firmwareScreen.risks.power'),
        ]}
        confirmPhrase={router?.name}
        confirmLabel={t('more:firmwareScreen.confirm')}
        onConfirm={() => {
          setConfirming(false);
          setChecked(null);
          nav.push(`/maintenance?mode=upgrade&keep=${keep ? 1 : 0}&force=${force ? 1 : 0}`);
        }}
        onCancel={() => setConfirming(false)}
      />
      <BusyOverlay visible={!!busy} title={busy ?? ''} />
    </>
  );
}

function FlashCard({
  checked,
  keep,
  force,
  onKeep,
  onForce,
  canFlash,
  onFlash,
  onCancel,
}: {
  checked: Checked;
  keep: boolean;
  force: boolean;
  onKeep(v: boolean): void;
  onForce(v: boolean): void;
  canFlash: boolean;
  onFlash(): void;
  onCancel(): void;
}) {
  const t = useT();
  const { check } = checked;
  return (
    <>
      <GlassCard contentStyle={styles.card}>
        <AppText variant="headline">{checked.name}</AppText>
        <AppText variant="footnote" tone="secondary">
          {formatBytes(checked.size)}
        </AppText>
        <AppText variant="subhead" tone={check.valid ? 'success' : 'danger'}>
          {check.valid
            ? t('more:firmwareScreen.imageOk')
            : t('more:firmwareScreen.imageBad', { tests: check.failed.join(', ') || '—' })}
        </AppText>
      </GlassCard>
      <ListSection
        footer={check.allowBackup ? t('more:firmwareScreen.keepHint') : t('more:firmwareScreen.keepUnavailable')}>
        <ListRow
          title={t('more:firmwareScreen.keep')}
          switchValue={keep}
          onSwitch={onKeep}
          disabled={!check.allowBackup}
          testID="firmware-keep"
        />
        {!check.valid && check.forceable ? (
          <ListRow
            title={t('more:firmwareScreen.force')}
            subtitle={t('more:firmwareScreen.forceHint')}
            switchValue={force}
            onSwitch={onForce}
            destructive
          />
        ) : null}
      </ListSection>
      <AppText variant="footnote" tone="secondary" style={styles.note}>
        {t('more:firmwareScreen.packages')}
      </AppText>
      <GlassButton
        label={t('more:firmwareScreen.flash')}
        variant="destructive"
        disabled={!canFlash}
        onPress={onFlash}
        testID="firmware-flash"
      />
      <GlassButton label={t('cancel')} onPress={onCancel} />
    </>
  );
}

const styles = StyleSheet.create({
  loading: { gap: spacing.s },
  card: { gap: spacing.xs },
  note: { paddingHorizontal: spacing.l },
});
