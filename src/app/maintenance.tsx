import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { pingRouter } from '@/api/connection/live';
import { nativeHttpClient } from '@/api/http/native';
import { restoreBackup } from '@/api/services/backup';
import { flashFirmware } from '@/api/services/firmware';
import { factoryReset, resetAddresses } from '@/api/services/maintenance';
import { getSystem } from '@/api/services/system';
import { useActiveRouter } from '@/features/routers/ActiveRouterProvider';
import { useLang, useT } from '@/i18n';
import { useRouters } from '@/state/routers';
import { AppText } from '@/ui/AppText';
import { describeError } from '@/ui/errorText';
import { GlassButton } from '@/ui/GlassButton';
import { GlassSurface } from '@/ui/glass/GlassSurface';
import { Icon } from '@/ui/Icon';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { spacing } from '@/ui/theme/tokens';
import { formatDuration } from '@/utils/format';
import { normalizeBaseUrl } from '@/utils/url';

type Mode = 'restore' | 'upgrade' | 'reset';
type Phase = 'starting' | 'down' | 'up' | 'done' | 'timeout' | 'failed';

const POLL_MS = 3_000;
/** Routers keep answering for a few seconds after accepting the command. */
const GRACE_MS = 10_000;
const LIMIT_MIN: Record<Mode, number> = { restore: 5, upgrade: 8, reset: 5 };

/**
 * Design §10: the full-screen wait for restore, firmware upgrade and factory reset — "keep the power on",
 * then the router coming back (after a reset possibly at 192.168.1.1, without a password).
 */
export default function Maintenance() {
  const t = useT();
  const lang = useLang();
  const nav = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ mode: Mode; keep?: string; force?: string }>();
  const mode: Mode = params.mode === 'upgrade' || params.mode === 'reset' ? params.mode : 'restore';
  const { connection, router } = useActiveRouter();
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<Phase>('starting');
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState<string | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const started = useRef(false);
  const sawDown = useRef(false);
  const begin = useRef(0);

  const baseUrl = router?.profile?.baseUrl;
  const watch = mode === 'reset' && connection?.kind === 'live' && baseUrl ? resetAddresses(baseUrl) : null;

  useEffect(() => {
    if (!connection) return;
    let cancelled = false;
    const first = !started.current;
    started.current = true;
    if (first) begin.current = Date.now();
    const deadline = Date.now() + LIMIT_MIN[mode] * 60_000;
    const tick = setInterval(() => setElapsed(Math.floor((Date.now() - begin.current) / 1000)), 1000);

    const reachable = async (): Promise<string | null> => {
      if (!watch) return (await connection.ping()) ? (baseUrl ?? 'demo') : null;
      for (const url of watch) if (await pingRouter(nativeHttpClient, url)) return url;
      return null;
    };
    const poll = async () => {
      setPhase(sawDown.current ? 'up' : 'down');
      while (!cancelled && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        if (cancelled) return;
        const at = await reachable();
        if (!at) {
          sawDown.current = true;
          setPhase('up');
        } else if (sawDown.current || Date.now() - begin.current > GRACE_MS * 3) {
          setFound(at);
          setPhase('done');
          void queryClient.invalidateQueries();
          if (mode === 'upgrade') {
            getSystem(connection)
              .then((s) => !cancelled && setVersion(`${s.distribution} ${s.version}`.trim()))
              .catch(() => undefined);
          }
          return;
        }
      }
      if (!cancelled) setPhase('timeout');
    };
    const run = () =>
      mode === 'restore'
        ? restoreBackup(connection)
        : mode === 'upgrade'
          ? flashFirmware(connection, params.keep !== '0', params.force === '1')
          : factoryReset(connection);

    (first ? run() : Promise.resolve()).then(poll).catch((e: unknown) => {
      if (cancelled) return;
      setError(describeError(t, e).title);
      setPhase('failed');
    });

    return () => {
      cancelled = true;
      clearInterval(tick);
    };
    // `round` restarts the wait after a timeout; the command itself runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection, round]);

  const finished = phase === 'done' || phase === 'timeout' || phase === 'failed';
  // iOS blocks the swipe back (gestureEnabled: false); Android's back button must wait for the end too.
  useEffect(() => {
    if (finished) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, [finished]);

  const sameAddress =
    !!found && !!baseUrl && normalizeBaseUrl(found) === normalizeBaseUrl(baseUrl.replace(/^https:/, 'http:'));
  const profileId = router?.profile?.id;
  /** After a reset the router has no password: log in with an empty one, at the address it answers on. */
  const adopt = async (address?: string) => {
    if (!profileId) return;
    await useRouters.getState().update(profileId, address ? { baseUrl: address } : {}, '');
    nav.dismissTo('/more/system', { withAnchor: true });
  };

  const message = {
    starting: t('more:progress.starting'),
    down: t('more:progress.waitingDown'),
    up: watch ? t('more:progress.waitingReset', { addresses: watch.join(' / ') }) : t('more:progress.waitingUp'),
    done:
      mode === 'restore'
        ? t('more:progress.doneRestore')
        : mode === 'upgrade'
          ? t('more:progress.doneUpgrade')
          : t('more:progress.doneReset'),
    timeout: t('more:progress.timeout', { minutes: LIMIT_MIN[mode] }),
    failed: t('more:progress.failed', { message: error ?? '' }),
  }[phase];

  return (
    <View style={[styles.root, { paddingTop: insets.top + spacing.xxl, paddingBottom: insets.bottom + spacing.xl }]}>
      <GlassSurface variant="floating" style={styles.card}>
        {phase === 'done' ? (
          <Icon name="check" size={48} color={colors.success} />
        ) : finished ? (
          <Icon name="warning" size={48} color={colors.warning} />
        ) : (
          <ActivityIndicator size="large" color={colors.accent} />
        )}
        <AppText variant="title" align="center">
          {t(`more:progress.${mode}`)}
        </AppText>
        {!finished ? (
          <View style={[styles.power, { backgroundColor: colors.danger }]}>
            <Icon name="bolt" size={16} color="#FFFFFF" />
            <AppText variant="subhead" weight="600" style={styles.powerText}>
              {t('more:progress.keepPower')}
            </AppText>
          </View>
        ) : null}
        <AppText variant="body" tone="secondary" align="center">
          {message}
        </AppText>
        {phase === 'done' && version ? (
          <AppText variant="body" align="center">
            {t('more:progress.doneVersion', { version })}
          </AppText>
        ) : null}
        {phase === 'done' && mode === 'reset' && connection?.kind === 'live' ? (
          <AppText variant="footnote" tone="secondary" align="center">
            {sameAddress
              ? t('more:progress.resetSameAddress')
              : t('more:progress.resetNewAddress', { address: found ?? '' })}
          </AppText>
        ) : null}
        {phase === 'timeout' ? (
          <AppText variant="footnote" tone="secondary" align="center">
            {t('more:progress.timeoutHint')}
          </AppText>
        ) : null}
        <AppText variant="footnote" tone="tertiary" align="center">
          {t('more:progress.elapsed', { time: formatDuration(elapsed, lang) })}
        </AppText>
        {phase === 'done' && mode === 'reset' && connection?.kind === 'live' ? (
          sameAddress ? (
            <GlassButton label={t('more:progress.setPassword')} variant="primary" onPress={() => void adopt()} />
          ) : found ? (
            <GlassButton
              label={t('more:progress.useNewAddress', { address: found })}
              variant="primary"
              onPress={() => void adopt(found)}
            />
          ) : null
        ) : null}
        {phase === 'timeout' ? (
          <GlassButton label={t('more:progress.keepWaiting')} onPress={() => setRound((r) => r + 1)} />
        ) : null}
        {finished ? <GlassButton label={t('more:progress.close')} onPress={() => nav.back()} /> : null}
      </GlassSurface>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'center', paddingHorizontal: spacing.xl },
  card: { padding: spacing.xxl, gap: spacing.m, alignItems: 'center' },
  power: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s,
    paddingHorizontal: spacing.m,
    paddingVertical: spacing.s,
    borderRadius: 999,
  },
  powerText: { color: '#FFFFFF' },
});
