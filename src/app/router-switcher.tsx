import { useQueries } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { pingRouter } from '@/api/connection/live';
import { nativeHttpClient } from '@/api/http/native';
import { useT } from '@/i18n';
import { sortedRouters, useRouters } from '@/state/routers';
import { useSettings } from '@/state/settings';
import { useSnapshots } from '@/state/snapshots';
import { AppText } from '@/ui/AppText';
import { GlassButton } from '@/ui/GlassButton';
import { Icon } from '@/ui/Icon';
import { ListRow, ListSection } from '@/ui/ListSection';
import { Screen } from '@/ui/Screen';
import { StatusDot } from '@/ui/Status';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { spacing } from '@/ui/theme/tokens';
import { isHttps } from '@/utils/url';

/** Sheet listing every router with live reachability; tap to switch. */
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
        pingRouter(nativeHttpClient, r.baseUrl, r.tlsSha256 ? { mode: 'pinned' as const, sha256: r.tlsSha256 } : undefined),
      staleTime: 5_000,
    })),
  });

  const select = (id: string) => {
    setActive(id);
    setSettings({ demoMode: false });
    nav.back();
  };

  return (
    <Screen inTabs={false}>
      <AppText variant="title">{t('routers:switcherTitle')}</AppText>
      <ListSection>
        {routers.map((r, i) => {
          const online = pings[i]?.data;
          const current = !demoMode && r.id === activeId;
          return (
            <ListRow
              key={r.id}
              title={r.name}
              subtitle={[r.baseUrl.replace(/^https?:\/\//, ''), snapshots[r.id]?.model ?? r.model].filter(Boolean).join(' · ')}
              left={<StatusDot status={online === undefined ? 'unknown' : online ? 'online' : 'offline'} />}
              right={
                <View style={styles.right}>
                  {!isHttps(r.baseUrl) ? <Icon name="lockOpen" size={14} color={colors.textTertiary} /> : null}
                  {current ? <Icon name="check" size={18} color={colors.accent} /> : null}
                </View>
              }
              onPress={() => select(r.id)}
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
      </ListSection>
      <View style={styles.actions}>
        <GlassButton label={t('routers:add')} icon="plus" variant="primary" onPress={() => nav.push('/add-router')} />
        <GlassButton label={t('routers:manage')} icon="settings" onPress={() => nav.push('/more/routers')} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  right: { flexDirection: 'row', alignItems: 'center', gap: spacing.s },
  actions: { gap: spacing.s },
});
