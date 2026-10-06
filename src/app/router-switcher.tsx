import { useQueries } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { DEMO_AP_NAME } from '@/api/connection/demo/connection';
import { pingRouter } from '@/api/connection/live';
import { switcherTree } from '@/api/group';
import { nativeHttpClient } from '@/api/http/native';
import { useT } from '@/i18n';
import { sortedRouters, useRouters, type RouterProfile } from '@/state/routers';
import { useSettings } from '@/state/settings';
import { useSnapshots } from '@/state/snapshots';
import { AppText } from '@/ui/AppText';
import { GlassButton } from '@/ui/GlassButton';
import { Icon } from '@/ui/Icon';
import { ListRow, ListSection } from '@/ui/ListSection';
import { Screen } from '@/ui/Screen';
import { SheetScreen } from '@/ui/SheetScreen';
import { StatusDot } from '@/ui/Status';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { spacing } from '@/ui/theme/tokens';
import { isHttps } from '@/utils/url';

/**
 * Sheet listing every router with live reachability; tap to switch. Access points are listed under their
 * gateway (NG-2) and can still be picked to manage them on their own.
 */
export default function RouterSwitcher() {
  const t = useT();
  const nav = useRouter();
  const { colors } = useTheme();
  const routers = sortedRouters(useRouters((s) => s.routers));
  const activeId = useRouters((s) => s.activeId);
  const setActive = useRouters((s) => s.setActive);
  const demoMode = useSettings((s) => s.demoMode);
  const setSettings = useSettings((s) => s.set);
  const snapshots = useSnapshots((s) => s.byRouter);

  const pings = useQueries({
    queries: routers.map((r) => ({
      queryKey: ['ping', r.id, r.baseUrl, r.tlsSha256],
      queryFn: () =>
        pingRouter(
          nativeHttpClient,
          r.baseUrl,
          r.tlsSha256 ? { mode: 'pinned' as const, sha256: r.tlsSha256 } : undefined,
        ),
      staleTime: 5_000,
    })),
  });

  const select = (id: string) => {
    setActive(id);
    setSettings({ demoMode: false });
    nav.back();
  };

  return (
    <SheetScreen>
      <Screen inTabs={false}>
        <AppText variant="title">{t('routers:switcherTitle')}</AppText>
        <ListSection>
          {switcherTree(routers)
            .flatMap(({ router, aps }) => [router, ...aps])
            .map((r) => {
              const online = pings[routers.indexOf(r)]?.data;
              const current = !demoMode && r.id === activeId;
              const nested = r.role === 'ap' && routers.some((g) => g.id === r.gatewayId && g.role === 'gateway');
              return (
                <ListRow
                  key={r.id}
                  title={r.name}
                  subtitle={[
                    nested ? t('routers:group.apTag') : r.role === 'gateway' ? t('routers:group.gatewayTag') : null,
                    r.baseUrl.replace(/^https?:\/\//, ''),
                    snapshots[r.id]?.model ?? r.model,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  left={
                    <View style={nested ? styles.nested : undefined}>
                      <StatusDot status={online === undefined ? 'unknown' : online ? 'online' : 'offline'} />
                    </View>
                  }
                  right={<RowRight router={r} current={current} />}
                  onPress={() => select(r.id)}
                  testID={`switch-${r.id}`}
                />
              );
            })}
          {demoMode || routers.length === 0 ? (
            <ListRow
              key="demo"
              title={t('demoRouter')}
              subtitle="OpenWrt One · 24.10.8"
              left={<StatusDot status="online" />}
              right={demoMode ? <Icon name="check" size={18} color={colors.accent} /> : undefined}
              onPress={() => {
                setSettings({ demoMode: true });
                nav.back();
              }}
            />
          ) : null}
          {demoMode ? (
            <ListRow
              key="demo-ap"
              title={DEMO_AP_NAME}
              subtitle={`${t('routers:group.apTag')} · Xiaomi AX3000T`}
              left={
                <View style={styles.nested}>
                  <StatusDot status="online" />
                </View>
              }
              disabled
            />
          ) : null}
        </ListSection>
        <View style={styles.actions}>
          <GlassButton label={t('routers:add')} icon="plus" variant="primary" onPress={() => nav.push('/add-router')} />
          {/* Close the sheet on the way: a push would stack a second copy of the tabs above it. */}
          <GlassButton
            label={t('routers:manage')}
            icon="settings"
            onPress={() => nav.dismissTo('/more/routers', { withAnchor: true })}
          />
        </View>
      </Screen>
    </SheetScreen>
  );
}

function RowRight({ router, current }: { router: RouterProfile; current: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={styles.right}>
      {!isHttps(router.baseUrl) ? <Icon name="lockOpen" size={14} color={colors.textTertiary} /> : null}
      {current ? <Icon name="check" size={18} color={colors.accent} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  right: { flexDirection: 'row', alignItems: 'center', gap: spacing.s },
  nested: { marginLeft: spacing.l },
  actions: { gap: spacing.s },
});
