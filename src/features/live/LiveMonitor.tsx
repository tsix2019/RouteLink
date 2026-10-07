import { useIsFocused } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import RouteLinkNative from 'routelink-native';

import { agentLive } from '@/api/services/agent';
import type { Client } from '@/api/services/clients';
import { allowNotifications } from '@/features/background/task';
import { useActiveRouter } from '@/features/routers/ActiveRouterProvider';
import { useAgentStatus } from '@/hooks/agent-queries';
import { useT } from '@/i18n';
import { useRouters } from '@/state/routers';
import { useSettings } from '@/state/settings';
import { ActionSheet } from '@/ui/ActionSheet';
import { AppText } from '@/ui/AppText';
import { describeError } from '@/ui/errorText';
import { Banner } from '@/ui/Feedback';
import { GlassButton } from '@/ui/GlassButton';
import { GlassSurface } from '@/ui/glass/GlassSurface';
import { spacing } from '@/ui/theme/tokens';
import { useToast } from '@/ui/Toast';

import { brandHint } from './brand';
import { buildConfig, liveTexts, namesOf, pickSource, sampleOf, sampleOfLive } from './config';
import { formatRemaining, LIVE_DURATIONS, remainingMs, type LiveDuration } from './format';
import { liveSession } from './session';
import { liveAvailable, refreshLive, runningFor, useLiveStore } from './store';

const DURATION_KEYS = { 30: 'min30', 60: 'hour1', 240: 'hour4' } as const;
/** Logging in again after the router dropped the session: at most this often. */
const RENEW_EVERY_MS = 60_000;

export interface LiveMonitorButtonProps {
  /** The overview's latest WAN rates (bits/s). */
  latest?: { t: number; rxBps: number; txBps: number };
  devicesOnline?: number;
  clients?: Client[];
  /** Layer-3 WAN device (counters without the plugin). */
  wanDevice?: string;
}

/**
 * "Live monitor" on the overview (design §16, LU-1…LU-4, Android only): pick a duration, see the time
 * left, tap to stop; guidance for notifications, the status-bar chip and battery optimisation. While the
 * overview is on screen it hands its own data to the service, which then skips its requests.
 */
export function LiveMonitorButton(props: LiveMonitorButtonProps) {
  return liveAvailable ? <LiveMonitorControl {...props} /> : null;
}

function LiveMonitorControl({ latest, devicesOnline, clients, wanDevice }: LiveMonitorButtonProps) {
  const t = useT();
  const toast = useToast();
  const focused = useIsFocused();
  const { router, connection } = useActiveRouter();
  const agent = useAgentStatus();
  const intervalSec = useSettings((s) => s.refreshIntervalSec);
  const state = useLiveStore((s) => s.state);
  const support = useLiveStore((s) => s.support);
  const [picking, setPicking] = useState(false);
  const [starting, setStarting] = useState(false);
  const here = runningFor(state, router?.id);
  const elsewhere = state?.running && !here ? state : null;
  const now = useNow(!!here?.endsAt && focused);

  useLiveSync();

  // ---- hand the overview's data to the service ----
  const names = useMemo(() => namesOf(clients), [clients]);
  const namesKey = JSON.stringify(names);
  const routerName = router?.isDemo ? t('demoRouter') : router?.name;
  useEffect(() => {
    if (!here) return;
    void RouteLinkNative.updateLiveMonitor({ names, routerName, intervalSec }).catch(() => undefined);
    // namesKey stands for names: a new client list with the same names is no news.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [here?.routerId, namesKey, routerName, intervalSec]);

  const source = here?.source;
  useEffect(() => {
    if (!here || !latest || !focused) return;
    if (source === 'luci') {
      const sample = sampleOf(latest, devicesOnline);
      if (sample) void RouteLinkNative.updateLiveMonitor({ sample }).catch(() => undefined);
    } else if (source === 'demo' && connection) {
      // The demo router answers locally: its busiest devices come along for the second line.
      void agentLive(connection)
        .then((live) => RouteLinkNative.updateLiveMonitor({ sample: sampleOfLive(live) }))
        .catch(() => undefined);
    }
    // One update per new overview sample.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latest?.t]);

  // ---- a new login when the router dropped the service's session ----
  const renewedAt = useRef(0);
  const expired = here?.status === 'session-expired';
  useEffect(() => {
    const profile = router?.profile;
    if (!expired || !profile || Date.now() - renewedAt.current < RENEW_EVERY_MS) return;
    renewedAt.current = Date.now();
    void (async () => {
      const password = await useRouters.getState().getPassword(profile.id);
      if (password === null) return;
      const session = await liveSession(profile, password);
      await RouteLinkNative.updateLiveMonitor({ session });
      await refreshLive();
    })().catch(() => undefined);
  }, [expired, router?.profile]);

  const start = async (durationMin: LiveDuration) => {
    setPicking(false);
    if (!router) return;
    setStarting(true);
    try {
      if (!(await allowNotifications())) {
        toast(t('live:tips.notifications'), 'warning');
        void RouteLinkNative.openNotificationSettings();
        return;
      }
      const kind = pickSource(router.isDemo, agent.data, wanDevice);
      if (!kind) {
        toast(t('live:noWan'), 'warning');
        return;
      }
      let session;
      if (kind !== 'demo') {
        const password = router.profile ? await useRouters.getState().getPassword(router.profile.id) : null;
        if (!router.profile || password === null) throw new Error('no password');
        session = await liveSession(router.profile, password);
      }
      let sample = sampleOf(latest, devicesOnline);
      if (kind === 'demo' && connection) sample = sampleOfLive(await agentLive(connection));
      await RouteLinkNative.startLiveMonitor(
        buildConfig({
          routerId: router.id,
          routerName: routerName ?? router.id,
          source: kind,
          session,
          tlsSha256: router.profile?.tlsSha256,
          wanDevice,
          intervalSec,
          durationMin,
          names,
          texts: liveTexts(t),
          sample,
        }),
      );
      await refreshLive();
    } catch (error) {
      const { title } = describeError(t, error);
      toast(`${t('live:startFailed')}: ${title}`, 'error');
    } finally {
      setStarting(false);
    }
  };

  const stop = () => {
    void RouteLinkNative.stopLiveMonitor()
      .then(refreshLive)
      .catch(() => undefined);
  };

  const left = remainingMs(here?.endsAt, now);
  const label = here
    ? left === null
      ? t('live:stopUnlimited')
      : t('live:stop', { remaining: formatRemaining(left) })
    : elsewhere
      ? t('live:elsewhere', { name: elsewhere.routerName ?? '' })
      : t('live:button');
  const hint = brandHint(support?.manufacturer, support?.brand);
  const message = [
    t('live:pick.message'),
    hint ? t(`live:brand.${hint}`) : null,
    elsewhere ? t('live:pick.replace', { name: elsewhere.routerName ?? '' }) : null,
  ]
    .filter(Boolean)
    .join('\n\n');

  return (
    <View style={styles.wrap}>
      <GlassButton
        label={starting ? t('live:starting') : label}
        icon={here ? 'stop' : 'overview'}
        loading={starting}
        disabled={!router}
        onPress={here ? stop : () => setPicking(true)}
        testID="action-live-monitor"
      />
      {here ? <LiveTips expired={expired} /> : null}
      <ActionSheet
        visible={picking}
        title={t('live:pick.title')}
        message={message}
        actions={LIVE_DURATIONS.map((d) => ({
          label: t(d === null ? 'live:pick.unlimited' : `live:pick.${DURATION_KEYS[d]}`),
          icon: 'timer' as const,
          onPress: () => void start(d),
        }))}
        onCancel={() => setPicking(false)}
      />
    </View>
  );
}

/** What stands between the user and a working monitor, each with the settings page that fixes it (LU-4). */
function LiveTips({ expired }: { expired: boolean }) {
  const t = useT();
  const support = useLiveStore((s) => s.support);
  if (!support) return null;
  return (
    <>
      {!support.notificationsEnabled ? (
        <Banner
          tone="warning"
          text={t('live:tips.notifications')}
          action={{ label: t('live:tips.allow'), onPress: () => void RouteLinkNative.openNotificationSettings() }}
        />
      ) : null}
      {support.promotion && !support.canPostPromoted ? (
        <Banner
          text={t('live:tips.promotion')}
          action={{
            label: t('live:tips.open'),
            onPress: () => void RouteLinkNative.openPromotedNotificationSettings(),
          }}
        />
      ) : null}
      {!support.ignoringBatteryOptimizations ? (
        <Banner
          text={t('live:tips.battery')}
          action={{
            label: t('live:tips.open'),
            onPress: () => void RouteLinkNative.openBatteryOptimizationSettings(),
          }}
        />
      ) : null}
      {expired ? <Banner text={t('live:tips.session')} /> : null}
    </>
  );
}

/** "The system interrupted the live monitor" on the next launch (LU-4), until dismissed. */
export function LiveMonitorNotice() {
  const t = useT();
  const interrupted = useLiveStore((s) => s.state?.interrupted);
  const ignoring = useLiveStore((s) => s.support?.ignoringBatteryOptimizations);
  if (!liveAvailable || !interrupted) return null;
  const dismiss = () => {
    void RouteLinkNative.clearLiveMonitorInterruption()
      .then(refreshLive)
      .catch(() => undefined);
  };
  return (
    <GlassSurface variant="card" radius={16} style={styles.notice}>
      <AppText variant="subhead">{t('live:interrupted.text', { name: interrupted.routerName })}</AppText>
      <View style={styles.noticeActions}>
        {ignoring === false ? (
          <GlassButton
            compact
            label={t('live:interrupted.battery')}
            onPress={() => {
              void RouteLinkNative.openBatteryOptimizationSettings();
              dismiss();
            }}
          />
        ) : null}
        <GlassButton compact label={t('live:interrupted.dismiss')} onPress={dismiss} />
      </View>
    </GlassSurface>
  );
}

/**
 * Keeps the store in step with the service: at mount, when the app comes back (from the system settings
 * too), and on its events. A stop the user did not ask for is announced.
 */
function useLiveSync() {
  const t = useT();
  const toast = useToast();
  const announce = useCallback(
    (reason: string) => {
      if (reason === 'error') toast(t('live:stoppedError'), 'error');
      else if (reason === 'system') toast(t('live:stoppedSystem'), 'warning');
    },
    [t, toast],
  );
  useEffect(() => {
    if (!liveAvailable) return;
    const refresh = () => void refreshLive().catch(() => undefined);
    refresh();
    const app = AppState.addEventListener('change', (s) => {
      if (s === 'active') refresh();
    });
    const stopped = RouteLinkNative.addListener('onLiveMonitorStopped', (e) => {
      if (AppState.currentState === 'active') announce(e.reason);
      refresh();
    });
    const status = RouteLinkNative.addListener('onLiveMonitorStatus', refresh);
    return () => {
      app.remove();
      stopped.remove();
      status.remove();
    };
  }, [announce]);
}

/** Wall clock, ticking every second while `active` (the countdown on the button). */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const tick = () => setNow(Date.now());
    // At once too: the clock stood still while inactive.
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 1_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [active]);
  return now;
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.s },
  notice: { padding: spacing.l, gap: spacing.m },
  noticeActions: { flexDirection: 'row', gap: spacing.s, justifyContent: 'flex-end' },
});
