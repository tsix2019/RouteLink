import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { reboot } from '@/api/services/system';
import { useActiveRouter } from '@/features/routers/ActiveRouterProvider';
import { useLang, useT } from '@/i18n';
import { AppText } from '@/ui/AppText';
import { GlassButton } from '@/ui/GlassButton';
import { GlassSurface } from '@/ui/glass/GlassSurface';
import { Icon } from '@/ui/Icon';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { spacing } from '@/ui/theme/tokens';
import { formatDuration } from '@/utils/format';

type Phase = 'down' | 'up' | 'done' | 'timeout' | 'failed';

const POLL_MS = 3_000;
const GRACE_MS = 10_000; // routers keep answering for a few seconds after accepting the reboot
const LIMIT_MS = 5 * 60_000;

/** Full-screen progress while the router reboots; polls reachability until it is back (design §10, §13). */
export default function Reboot() {
  const t = useT();
  const lang = useLang();
  const nav = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { connection } = useActiveRouter();
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<Phase>('down');
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (!connection || started.current) return;
    started.current = true;
    const begin = Date.now();
    let cancelled = false;
    let sawDown = false;
    const tick = setInterval(() => setElapsed(Math.floor((Date.now() - begin) / 1000)), 1000);

    const poll = async () => {
      while (!cancelled && Date.now() - begin < LIMIT_MS) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        if (cancelled) return;
        const up = await connection.ping();
        if (!up) {
          sawDown = true;
          setPhase('up');
        } else if (sawDown || Date.now() - begin > GRACE_MS * 3) {
          setPhase('done');
          void queryClient.invalidateQueries();
          setTimeout(() => !cancelled && nav.back(), 1_500);
          return;
        }
      }
      if (!cancelled) setPhase('timeout');
    };

    reboot(connection)
      .then(poll)
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
        setPhase('failed');
      });

    return () => {
      cancelled = true;
      clearInterval(tick);
    };
  }, [connection, nav, queryClient]);

  const finished = phase === 'done' || phase === 'timeout' || phase === 'failed';
  const message = {
    down: t('overview:reboot.waitingDown'),
    up: t('overview:reboot.waitingUp'),
    done: t('overview:reboot.done'),
    timeout: t('overview:reboot.timeout'),
    failed: t('errors:generic', { message: error ?? '' }),
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
          {t('overview:reboot.progressTitle')}
        </AppText>
        <AppText variant="body" tone="secondary" align="center">
          {message}
        </AppText>
        {phase === 'timeout' ? (
          <AppText variant="footnote" tone="secondary" align="center">
            {t('overview:reboot.timeoutHint')}
          </AppText>
        ) : null}
        <AppText variant="footnote" tone="tertiary" align="center">
          {t('overview:reboot.elapsed', { time: formatDuration(elapsed, lang) })}
        </AppText>
        {finished && phase !== 'done' ? (
          <GlassButton label={t('overview:reboot.close')} onPress={() => nav.back()} />
        ) : null}
      </GlassSurface>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'center', paddingHorizontal: spacing.xl },
  card: { padding: spacing.xxl, gap: spacing.m, alignItems: 'center' },
});
