import { useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { WidgetPreview } from 'react-native-android-widget';

import { useActiveRouter } from '@/features/routers/ActiveRouterProvider';
import { useLang, useT } from '@/i18n';
import { ActionSheet } from '@/ui/ActionSheet';
import { AppText } from '@/ui/AppText';
import { Banner } from '@/ui/Feedback';
import { GlassButton } from '@/ui/GlassButton';
import { GlassCard } from '@/ui/GlassCard';
import { Screen } from '@/ui/Screen';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { spacing } from '@/ui/theme/tokens';
import { useToast } from '@/ui/Toast';
import { renderWidget } from '@/widgets/android/widgets';
import { WIDGETS, type WidgetKind, type WidgetName } from '@/widgets/catalog';
import type { WidgetData } from '@/widgets/data';
import { addWidget, openPinPermission } from '@/widgets/pin';
import { sampleWidgetData } from '@/widgets/sample';
import { countWidgets, loadWidgetData, pinWidget } from '@/widgets/update';
import { widgetView } from '@/widgets/view';

/** AP-4 (design §19): every widget with a preview, how many are on the home screen, and a way to add one. */
export default function Widgets() {
  const t = useT();
  const toast = useToast();
  const { router } = useActiveRouter();
  const [busy, setBusy] = useState<WidgetName | null>(null);
  const [help, setHelp] = useState<'blocked' | 'manual' | null>(null);
  // Refetched when the app comes back: widgets may have been added or removed on the home screen meanwhile.
  const state = useQuery({
    queryKey: ['home-screen-widgets'],
    queryFn: async () => ({
      data: await loadWidgetData().catch(() => null),
      counts: Object.fromEntries(
        await Promise.all(WIDGETS.map(async (w) => [w.name, await countWidgets(w.name).catch(() => 0)] as const)),
      ) as Record<WidgetName, number>,
    }),
    staleTime: 0,
  });
  const data = state.data?.data ?? null;

  const add = async (name: WidgetName) => {
    setBusy(name);
    try {
      const result = await addWidget(name);
      if (result === 'added') toast(t('settings:widgets.addedToast'));
      else if (result === 'blocked') setHelp('blocked');
      else if (result === 'unsupported') setHelp('manual');
    } finally {
      setBusy(null);
      void state.refetch();
    }
  };

  if (Platform.OS !== 'android') {
    return (
      <Screen title={t('settings:widgets.title')}>
        <AppText variant="subhead" tone="secondary">
          {t('settings:widgets.iosFooter')}
        </AppText>
      </Screen>
    );
  }

  const noPassword = !!router && !router.isDemo && !router.profile?.savePassword;
  return (
    <>
      <Screen title={t('settings:widgets.title')}>
        <AppText variant="subhead" tone="secondary" style={styles.intro}>
          {t('settings:widgets.intro')}
        </AppText>
        {noPassword ? <Banner tone="info" text={t('settings:widgets.noPassword')} /> : null}
        {WIDGETS.map((w) => (
          <WidgetCard
            key={w.name}
            kind={w}
            data={data}
            count={state.data?.counts[w.name] ?? 0}
            busy={busy === w.name}
            disabled={busy !== null}
            onAdd={() => void add(w.name)}
          />
        ))}
        <AppText variant="footnote" tone="tertiary" style={styles.intro}>
          {t('settings:widgets.footer')}
        </AppText>
        <GlassButton label={t('settings:widgets.manual')} onPress={() => setHelp('manual')} testID="widgets-manual" />
      </Screen>
      <ActionSheet
        visible={help === 'blocked'}
        title={t('settings:widgets.blockedTitle')}
        message={t('settings:widgets.blockedBody')}
        actions={[
          {
            label: t('settings:widgets.openPermission'),
            icon: 'settings',
            onPress: () => {
              setHelp(null);
              void openPinPermission().catch(() => undefined);
            },
          },
        ]}
        cancelLabel={t('settings:widgets.gotIt')}
        onCancel={() => setHelp(null)}
      />
      <ActionSheet
        visible={help === 'manual'}
        title={t('settings:widgets.manualTitle')}
        message={t('settings:widgets.manualBody')}
        actions={[]}
        cancelLabel={t('settings:widgets.gotIt')}
        onCancel={() => setHelp(null)}
      />
    </>
  );
}

function WidgetCard({
  kind,
  data,
  count,
  busy,
  disabled,
  onAdd,
}: {
  kind: WidgetKind;
  data: WidgetData | null;
  count: number;
  busy: boolean;
  disabled: boolean;
  onAdd: () => void;
}) {
  const t = useT();
  const lang = useLang();
  const { scheme, colors } = useTheme();
  const { width, height } = kind.preview;
  const draw = useCallback(() => {
    const v = widgetView(t, lang, data ?? sampleWidgetData(Date.now()));
    const pair = renderWidget(kind.name, v, width, height);
    return scheme === 'dark' ? pair.dark : pair.light;
  }, [t, lang, data, kind.name, width, height, scheme]);
  return (
    <GlassCard
      title={t(`widget.kinds.${kind.key}.name`)}
      subtitle={t(`widget.kinds.${kind.key}.description`)}
      icon="widget"
      testID={`widget-${kind.key}`}>
      <View style={[styles.preview, { backgroundColor: colors.fill }]}>
        <WidgetPreview renderWidget={draw} width={width} height={height} />
      </View>
      <View style={styles.footer}>
        <AppText variant="footnote" tone="secondary" style={styles.count}>
          {count > 0 ? t('settings:widgets.added', { count }) : ''}
        </AppText>
        {pinWidget ? (
          <GlassButton
            label={t('settings:widgets.add')}
            icon="plus"
            variant="primary"
            compact
            loading={busy}
            disabled={disabled}
            onPress={onAdd}
            testID={`widget-add-${kind.key}`}
          />
        ) : null}
      </View>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  intro: { marginHorizontal: spacing.xs },
  // A stand-in for the wallpaper: the widgets' own background shows against it.
  preview: { alignItems: 'center', padding: spacing.m, borderRadius: 18, marginVertical: spacing.s },
  footer: { flexDirection: 'row', alignItems: 'center', gap: spacing.m },
  count: { flex: 1 },
});
