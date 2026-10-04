import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { DiscoveredRouter } from '@/discovery/scan';
import { useAddDraft } from '@/features/routers/addDraft';
import { hostOf } from '@/features/routers/login';
import { looksLikeSideRouter, useDiscovery } from '@/features/routers/useDiscovery';
import { useT } from '@/i18n';
import { useRouters } from '@/state/routers';
import { AppText } from '@/ui/AppText';
import { Banner, EmptyState } from '@/ui/Feedback';
import { GlassButton } from '@/ui/GlassButton';
import { GlassCard } from '@/ui/GlassCard';
import { Icon } from '@/ui/Icon';
import { ListRow, ListSection } from '@/ui/ListSection';
import { PromptSheet } from '@/ui/PromptSheet';
import { HeaderButton, Screen } from '@/ui/Screen';
import { Badge } from '@/ui/Status';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { spacing } from '@/ui/theme/tokens';
import { cidrHosts } from '@/utils/net';

/** Step 1 of adding routers: pick from the LAN scan, scan another subnet, or type an address. */
export default function AddRouter() {
  const t = useT();
  const nav = useRouter();
  const insets = useSafeAreaInsets();
  const discovery = useDiscovery();
  const savedHosts = new Set(useRouters((s) => s.routers).map((r) => hostOf(r.baseUrl)));
  const setTargets = useAddDraft((s) => s.setTargets);
  const [selected, setSelected] = useState<string[]>([]);
  const [askRange, setAskRange] = useState(false);

  const isAdded = (r: DiscoveredRouter) => [r.address, ...r.aliases].some((a) => savedHosts.has(a));
  const chosen = discovery.found.filter((r) => selected.includes(r.address) && !isAdded(r));
  const scanning = discovery.phase === 'scanning' || discovery.phase === 'checking';

  const toggle = (address: string) =>
    setSelected((s) => (s.includes(address) ? s.filter((a) => a !== address) : [...s, address]));

  const next = () => {
    setTargets(chosen.map((r) => ({ baseUrl: `${r.scheme}://${r.address}`, name: r.hostname ?? r.address })));
    nav.push('/add-router/login');
  };

  return (
    <>
      <Screen
        title={t('routers:add')}
        inTabs={false}
        headerLeft={<HeaderButton icon="close" accessibilityLabel={t('close')} onPress={() => nav.back()} />}
        contentStyle={{ paddingBottom: insets.bottom + 96 }}>
        <GlassCard
          title={t('routers:discovery.title')}
          icon="scan"
          accessory={
            scanning ? (
              <HeaderButton icon="stop" accessibilityLabel={t('routers:discovery.stop')} onPress={discovery.cancel} />
            ) : (
              <HeaderButton
                icon="refresh"
                accessibilityLabel={t('routers:discovery.rescan')}
                onPress={() => discovery.start(discovery.range ?? undefined)}
                testID="discovery-rescan"
              />
            )
          }>
          <ScanStatus {...discovery} />
          {discovery.phase === 'no-wifi' ? <Banner tone="warning" text={t('routers:discovery.noWifi')} /> : null}
          {discovery.phase === 'error' ? <Banner tone="error" text={t('routers:discovery.error')} /> : null}
          {looksLikeSideRouter(discovery) && discovery.phase === 'done' ? (
            <Banner tone="info" text={t('routers:discovery.sideRouter')} />
          ) : null}
          {discovery.found.length ? (
            <View style={styles.results}>
              {discovery.found.map((r) => (
                <ResultRow
                  key={r.address}
                  router={r}
                  added={isAdded(r)}
                  checked={selected.includes(r.address)}
                  onPress={() => toggle(r.address)}
                />
              ))}
            </View>
          ) : discovery.phase === 'done' ? (
            <EmptyState
              icon="router"
              title={t('routers:discovery.nothing')}
              message={t('routers:discovery.nothingHint')}
            />
          ) : null}
        </GlassCard>

        <ListSection title={t('routers:discovery.other')}>
          <ListRow
            title={t('routers:discovery.manual')}
            subtitle={t('routers:discovery.manualHint')}
            icon="edit"
            chevron
            onPress={() => {
              setTargets([]);
              nav.push('/add-router/login');
            }}
            testID="add-manual"
          />
          <ListRow
            title={t('routers:discovery.range')}
            subtitle={discovery.range ?? t('routers:discovery.rangeHint')}
            icon="search"
            chevron
            onPress={() => setAskRange(true)}
          />
        </ListSection>
      </Screen>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.m }]} pointerEvents="box-none">
        <GlassButton
          label={
            chosen.length ? t('routers:discovery.nextCount', { count: chosen.length }) : t('routers:discovery.next')
          }
          variant="primary"
          disabled={!chosen.length}
          onPress={next}
          testID="discovery-next"
        />
      </View>

      <PromptSheet
        visible={askRange}
        title={t('routers:discovery.rangeTitle')}
        initialValue={discovery.range ?? ''}
        placeholder="192.168.5.0/24"
        hint={t('routers:discovery.rangeHint')}
        confirmLabel={t('routers:discovery.scan')}
        inputProps={{ autoCapitalize: 'none', autoCorrect: false, keyboardType: 'numbers-and-punctuation' }}
        validate={(value) => {
          try {
            cidrHosts(value.trim());
            return undefined;
          } catch {
            return t('routers:discovery.rangeInvalid');
          }
        }}
        onSubmit={(value) => {
          setAskRange(false);
          setSelected([]);
          discovery.start(value.trim());
        }}
        onCancel={() => setAskRange(false)}
      />
    </>
  );
}

function ScanStatus({
  phase,
  done,
  total,
  range,
  found,
}: Pick<ReturnType<typeof useDiscovery>, 'phase' | 'done' | 'total' | 'range' | 'found'>) {
  const t = useT();
  const { colors } = useTheme();
  if (phase === 'checking') {
    return (
      <AppText variant="subhead" tone="secondary">
        {t('routers:discovery.checking')}
      </AppText>
    );
  }
  if (phase !== 'scanning') {
    return phase === 'done' && found.length ? (
      <AppText variant="subhead" tone="secondary">
        {t('routers:discovery.found', { count: found.length })}
      </AppText>
    ) : null;
  }
  const ratio = total ? done / total : 0;
  return (
    <View style={styles.status}>
      <View style={styles.statusRow}>
        <AppText variant="subhead" tone="secondary" style={styles.flex} numberOfLines={1}>
          {range ? t('routers:discovery.scanning', { range }) : t('routers:discovery.scanningLan')}
        </AppText>
        <AppText variant="footnote" tone="tertiary">
          {t('routers:discovery.progress', { done, total })}
        </AppText>
      </View>
      <View style={[styles.track, { backgroundColor: colors.separator }]}>
        <View style={[styles.bar, { width: `${Math.round(ratio * 100)}%`, backgroundColor: colors.accent }]} />
      </View>
    </View>
  );
}

function ResultRow({
  router,
  added,
  checked,
  onPress,
}: {
  router: DiscoveredRouter;
  added: boolean;
  checked: boolean;
  onPress: () => void;
}) {
  const t = useT();
  const { colors } = useTheme();
  const title = router.hostname ?? router.address;
  const subtitle = [router.address, ...router.aliases].filter((a) => a !== title).join(' · ');
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: checked && !added, disabled: added }}
      disabled={added}
      onPress={onPress}
      style={[styles.row, added && styles.disabled]}
      testID={`discovered-${router.address}`}>
      {added ? (
        <Icon name="check" size={22} color={colors.textTertiary} />
      ) : (
        <View
          style={[
            styles.check,
            checked
              ? { backgroundColor: colors.accent, borderColor: colors.accent }
              : { borderColor: colors.textTertiary },
          ]}>
          {checked ? <Icon name="check" size={15} color="#FFFFFF" /> : null}
        </View>
      )}
      <View style={styles.flex}>
        <AppText variant="body" weight="600" numberOfLines={1}>
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="footnote" tone="secondary" numberOfLines={1}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      <View style={styles.badges}>
        {router.isGateway ? <Badge label={t('routers:discovery.gateway')} tone="accent" /> : null}
        <Badge label={router.scheme.toUpperCase()} tone={router.scheme === 'https' ? 'success' : 'neutral'} />
        {added ? <Badge label={t('routers:discovery.added')} /> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  results: { gap: spacing.xs },
  status: { gap: spacing.s },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.s },
  track: { height: 4, borderRadius: 2, overflow: 'hidden' },
  bar: { height: 4, borderRadius: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.m, paddingVertical: spacing.s },
  disabled: { opacity: 0.6 },
  check: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  badges: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  footer: { position: 'absolute', left: spacing.l, right: spacing.l, bottom: 0 },
});
