import * as WebBrowser from 'expo-web-browser';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { MarkdownText } from '@/features/assistant/MarkdownText';
import { apkDeps, cleanApks, installApk } from '@/features/update/apk';
import { checkForUpdate, currentVersion, hasUpdate } from '@/features/update/check';
import { prepareApk } from '@/features/update/install';
import { notesFor, UpdateError, type AppRelease } from '@/features/update/releases';
import { useLang, useT, type AppT } from '@/i18n';
import { useSettings } from '@/state/settings';
import { AppText } from '@/ui/AppText';
import { describeError } from '@/ui/errorText';
import { Skeleton } from '@/ui/Feedback';
import { GlassButton } from '@/ui/GlassButton';
import { GlassCard } from '@/ui/GlassCard';
import { ListRow, ListSection } from '@/ui/ListSection';
import { Screen } from '@/ui/Screen';
import { TextField } from '@/ui/TextField';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { spacing } from '@/ui/theme/tokens';
import { formatDate, formatDayTime } from '@/utils/dates';
import { formatBytes } from '@/utils/format';

const ANDROID = Platform.OS === 'android';

type Apk = NonNullable<AppRelease['apk']>;
type Phase = { kind: 'idle' } | { kind: 'downloading'; done: number; total: number } | { kind: 'verifying' };

const errorText = (t: AppT, e: unknown) =>
  e instanceof UpdateError
    ? t(`more:updateScreen.error.${e.code}`, { detail: e.detail ?? '' })
    : describeError(t, e).title;

const isAbort = (e: unknown) => e instanceof Error && e.name === 'AbortError';

/** AP-6: this version, the newest release (Android downloads and installs it), and the update settings. */
export default function SoftwareUpdate() {
  const t = useT();
  const lang = useLang();
  const latest = useSettings((s) => s.updateLatest);
  const checkedAt = useSettings((s) => s.updateCheckedAt);
  const autoCheck = useSettings((s) => s.updateAutoCheck);
  const mirror = useSettings((s) => s.agentMirror);
  const setSettings = useSettings((s) => s.set);
  const [mirrorDraft, setMirrorDraft] = useState(mirror);
  // Only on request ("Check for Updates"), or on opening when a new version is already known: its notes
  // are not kept in the settings.
  const [wanted, setWanted] = useState(() => hasUpdate(useSettings.getState().updateLatest));
  const lookup = useQuery({
    queryKey: ['app-release'],
    queryFn: async () => (await checkForUpdate()).release,
    enabled: wanted,
    staleTime: 5 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const check = () => (wanted ? void lookup.refetch() : setWanted(true));
  const checking = lookup.isFetching;
  // The lookup's release has the notes; the daily check may have found a newer one since.
  const release = lookup.data && lookup.data.version === latest?.version ? lookup.data : null;
  const error = lookup.isError && !checking ? errorText(t, lookup.error) : null;
  const current = currentVersion();
  const newer = hasUpdate(latest, current) ? (release ?? latest) : null;

  // Old downloads go; only the newest version's APK may stay for "Install".
  const keep = newer?.apk?.name;
  useEffect(() => {
    if (ANDROID) cleanApks(keep);
  }, [keep]);

  return (
    <Screen title={t('more:update')}>
      <GlassCard contentStyle={styles.card}>
        <View style={styles.row}>
          <AppText variant="headline" style={styles.flex}>
            {t('more:updateScreen.current')}
          </AppText>
          <AppText variant="body" tone="secondary" testID="update-current">
            {current}
          </AppText>
        </View>
        <AppText variant="footnote" tone="secondary">
          {checkedAt
            ? t('more:updateScreen.checkedAt', { time: formatDayTime(checkedAt / 1000, lang) })
            : t('more:updateScreen.neverChecked')}
        </AppText>
        {error ? (
          <AppText variant="subhead" tone="danger" testID="update-error">
            {error}
          </AppText>
        ) : checkedAt && !newer && !checking ? (
          <AppText variant="subhead" tone="success" testID="update-latest">
            {t('more:updateScreen.upToDate')}
          </AppText>
        ) : null}
        <GlassButton
          label={t('more:updateScreen.check')}
          icon="refresh"
          loading={checking}
          disabled={checking}
          onPress={check}
          testID="update-check"
        />
      </GlassCard>

      {newer ? (
        <GlassCard
          title={t('more:updateScreen.newVersion', { version: newer.version })}
          subtitle={[
            t('more:updateScreen.released', { date: formatDate(Date.parse(newer.publishedAt) / 1000, lang) }),
            newer.apk && ANDROID ? t('more:updateScreen.size', { size: formatBytes(newer.apk.size) }) : null,
          ]
            .filter(Boolean)
            .join(' · ')}
          icon="download"
          contentStyle={styles.card}
          testID="update-new">
          {release ? (
            <MarkdownText text={notesFor(release.notes, lang)} />
          ) : checking ? (
            <Skeleton height={96} radius={12} />
          ) : null}
          {ANDROID && newer.apk ? (
            // Keyed by the APK: a newer release found meanwhile starts over (its file is not downloaded yet).
            <ApkActions key={newer.apk.name} apk={newer.apk} htmlUrl={newer.htmlUrl} mirror={mirrorDraft.trim()} />
          ) : (
            <>
              <GlassButton
                label={t('more:updateScreen.releasePage')}
                icon="link"
                variant="primary"
                onPress={() => void WebBrowser.openBrowserAsync(newer.htmlUrl)}
                testID="update-release-page"
              />
              {ANDROID ? null : (
                <AppText variant="footnote" tone="secondary">
                  {t('more:updateScreen.iosHint')}
                </AppText>
              )}
            </>
          )}
        </GlassCard>
      ) : null}

      <ListSection footer={t('more:updateScreen.autoCheckHint')}>
        <ListRow
          title={t('more:updateScreen.autoCheck')}
          icon="schedule"
          switchValue={autoCheck}
          onSwitch={(updateAutoCheck) => setSettings({ updateAutoCheck })}
          testID="update-auto"
        />
      </ListSection>
      {ANDROID ? (
        <ListSection footer={t('more:updateScreen.mirrorHint')}>
          <View style={styles.mirror}>
            <TextField
              label={t('more:updateScreen.mirror')}
              value={mirrorDraft}
              onChangeText={setMirrorDraft}
              onEndEditing={() => setSettings({ agentMirror: mirrorDraft.trim() })}
              placeholder="https://ghproxy.example/"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              testID="update-mirror"
            />
          </View>
        </ListSection>
      ) : null}
    </Screen>
  );
}

/** Android: "Download and Install", the progress and "Cancel", then "Install" once the APK is here. */
function ApkActions({ apk, htmlUrl, mirror }: { apk: Apk; htmlUrl: string; mirror: string }) {
  const t = useT();
  const { colors } = useTheme();
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  // Downloaded earlier (right size): the button says "Install"; installing verifies it in full first.
  const [downloaded, setDownloaded] = useState(() => {
    const file = apkDeps.file(apk.name);
    return file.exists && file.size === apk.size;
  });
  const [error, setError] = useState<string | null>(null);
  const [installerFailed, setInstallerFailed] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  const run = async () => {
    const c = new AbortController();
    controller.current = c;
    setError(null);
    setInstallerFailed(false);
    setPhase(downloaded ? { kind: 'verifying' } : { kind: 'downloading', done: 0, total: apk.size });
    try {
      const file = await prepareApk(
        apk,
        {
          mirror,
          signal: c.signal,
          onProgress: ({ bytesWritten, totalBytes }) => {
            const total = totalBytes > 0 ? totalBytes : apk.size;
            setPhase(
              bytesWritten >= total ? { kind: 'verifying' } : { kind: 'downloading', done: bytesWritten, total },
            );
          },
        },
        apkDeps,
      );
      setDownloaded(true);
      setPhase({ kind: 'idle' });
      await installApk(file);
    } catch (e) {
      setPhase({ kind: 'idle' });
      if (isAbort(e)) {
        setDownloaded(false);
        return;
      }
      if (e instanceof UpdateError && e.code === 'installer') setInstallerFailed(true);
      else setDownloaded(false);
      setError(errorText(t, e));
    } finally {
      if (controller.current === c) controller.current = null;
    }
  };

  return (
    <>
      {phase.kind === 'downloading' ? (
        <>
          <View style={[styles.track, { backgroundColor: colors.fill }]}>
            <View
              style={[
                styles.bar,
                { backgroundColor: colors.accent, width: `${Math.min(100, (phase.done / phase.total) * 100)}%` },
              ]}
            />
          </View>
          <AppText variant="footnote" tone="secondary" testID="update-progress">
            {t('more:updateScreen.downloading', { done: formatBytes(phase.done), total: formatBytes(phase.total) })}
          </AppText>
          <GlassButton label={t('cancel')} onPress={() => controller.current?.abort()} testID="update-cancel" />
        </>
      ) : phase.kind === 'verifying' ? (
        <GlassButton label={t('more:updateScreen.verifying')} variant="primary" loading disabled />
      ) : (
        <GlassButton
          label={downloaded ? t('more:updateScreen.install') : t('more:updateScreen.download')}
          icon="download"
          variant="primary"
          onPress={() => void run()}
          testID="update-install"
        />
      )}
      {downloaded && phase.kind === 'idle' ? (
        <AppText variant="footnote" tone="secondary">
          {t('more:updateScreen.installHint')}
        </AppText>
      ) : null}
      {error ? (
        <AppText variant="footnote" tone="danger" testID="update-install-error">
          {error}
        </AppText>
      ) : null}
      {installerFailed ? (
        <GlassButton
          label={t('more:updateScreen.releasePage')}
          icon="link"
          onPress={() => void WebBrowser.openBrowserAsync(htmlUrl)}
          testID="update-release-page"
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.m },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.s },
  flex: { flex: 1 },
  mirror: { padding: spacing.m },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  bar: { height: 6, borderRadius: 3 },
});
