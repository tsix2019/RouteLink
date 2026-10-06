import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Platform } from 'react-native';

import { getLeds } from '@/api/services/leds';
import { useActiveRouter } from '@/features/routers/ActiveRouterProvider';
import { RouterSwitcherCapsule } from '@/features/routers/RouterSwitcherCapsule';
import { useRebootConfirm } from '@/features/routers/useRebootConfirm';
import { isAvailable } from '@/api/capabilities';
import { useFactoryReset } from '@/features/maintenance/useFactoryReset';
import { hasUpdate } from '@/features/update/check';
import { useCapabilities, useRouterQuery } from '@/hooks/router-queries';
import { useT, type LanguagePreference } from '@/i18n';
import { useRouters } from '@/state/routers';
import { useSettings, type RefreshInterval, type ThemePreference } from '@/state/settings';
import { ListRow, ListSection } from '@/ui/ListSection';
import { Screen } from '@/ui/Screen';
import { SelectSheet } from '@/ui/SelectSheet';
import { Badge } from '@/ui/Status';

type Picker = 'language' | 'theme' | 'refresh' | null;

const LANGUAGES: LanguagePreference[] = ['system', 'zh-CN', 'en'];
const THEMES: ThemePreference[] = ['system', 'light', 'dark'];
const INTERVALS: RefreshInterval[] = [1, 2, 5, 10];

/** More tab: router tools on top, app settings below — one grouped list, like iOS Settings. */
export default function More() {
  const t = useT();
  const nav = useRouter();
  const { router } = useActiveRouter();
  const routerCount = useRouters((s) => s.routers.length);
  const settings = useSettings();
  const reboot = useRebootConfirm();
  const reset = useFactoryReset();
  const caps = useCapabilities();
  const [picker, setPicker] = useState<Picker>(null);
  const hasRouter = !!router;
  // Most x86 routers have no LEDs: the row only shows when there is something to set.
  const hasLeds = !!useRouterQuery(['leds'], getLeds).data?.length;

  return (
    <>
      <Screen title={t('tabs.more')} headerLeft={<RouterSwitcherCapsule />}>
        <ListSection title={t('more:router')}>
          <ListRow
            title={t('more:services')}
            icon="services"
            chevron
            disabled={!hasRouter}
            onPress={() => nav.push('/more/services')}
            testID="more-services"
          />
          <ListRow
            title={t('more:processes')}
            icon="process"
            chevron
            disabled={!hasRouter}
            onPress={() => nav.push('/more/processes')}
            testID="more-processes"
          />
          <ListRow
            title={t('more:packages')}
            icon="package"
            chevron
            disabled={!hasRouter}
            onPress={() => nav.push('/more/packages')}
            testID="more-packages"
          />
          <ListRow
            title={t('more:cron')}
            icon="schedule"
            chevron
            disabled={!hasRouter}
            onPress={() => nav.push('/more/cron')}
            testID="more-cron"
          />
          {hasLeds ? (
            <ListRow
              title={t('more:leds')}
              icon="light"
              chevron
              onPress={() => nav.push('/more/leds')}
              testID="more-leds"
            />
          ) : null}
          <ListRow
            title={t('more:logs')}
            icon="logs"
            chevron
            disabled={!hasRouter}
            onPress={() => nav.push('/more/logs')}
            testID="more-logs"
          />
          <ListRow
            title={t('assistant:title')}
            icon="assistant"
            chevron
            disabled={!hasRouter}
            onPress={() => nav.push('/assistant')}
            testID="more-assistant"
          />
          <ListRow
            title={t('terminal:entry')}
            icon="terminal"
            chevron
            disabled={!hasRouter}
            onPress={() => nav.push('/terminal')}
            testID="more-terminal"
          />
          <ListRow
            title={t('agent:title')}
            icon="plugin"
            chevron
            disabled={!hasRouter}
            onPress={() => nav.push('/more/agent')}
            testID="more-agent"
          />
          <ListRow
            title={t('more:wol')}
            icon="bolt"
            chevron
            disabled={!hasRouter}
            onPress={() => nav.push('/more/wol')}
            testID="more-wol"
          />
          <ListRow
            title={t('more:system')}
            icon="settings"
            chevron
            disabled={!hasRouter}
            onPress={() => nav.push('/more/system')}
            testID="more-system"
          />
          <ListRow
            title={t('more:reboot')}
            icon="power"
            destructive
            disabled={!hasRouter}
            onPress={reboot.open}
            testID="more-reboot"
          />
        </ListSection>

        <ListSection title={t('more:maintenance')}>
          <ListRow
            title={t('more:backup')}
            icon="backup"
            chevron
            disabled={!hasRouter}
            onPress={() => nav.push('/more/backup')}
            testID="more-backup"
          />
          <ListRow
            title={t('more:firmware')}
            icon="firmware"
            chevron
            disabled={!hasRouter}
            onPress={() => nav.push('/more/firmware')}
            testID="more-firmware"
          />
          <ListRow
            title={t('more:reset')}
            icon="reset"
            destructive
            disabled={!hasRouter || !isAvailable(caps.data, 'system.reset')}
            onPress={reset.open}
            testID="more-reset"
          />
        </ListSection>

        <ListSection title={t('more:app')}>
          <ListRow
            title={t('more:manageRouters')}
            icon="router"
            value={routerCount ? String(routerCount) : undefined}
            chevron
            onPress={() => nav.push('/more/routers')}
            testID="more-routers"
          />
          <ListRow
            title={t('settings:notify.title')}
            icon="bell"
            chevron
            onPress={() => nav.push('/more/notifications')}
            testID="more-notifications"
          />
          <ListRow
            title={t('assistant:settings')}
            icon="assistant"
            chevron
            onPress={() => nav.push('/more/assistant')}
            testID="more-assistant-settings"
          />
          <ListRow
            title={t('settings:language.title')}
            icon="language"
            value={t(`settings:language.${settings.language}`)}
            chevron
            onPress={() => setPicker('language')}
            testID="more-language"
          />
          <ListRow
            title={t('settings:theme.title')}
            icon="appearance"
            value={t(`settings:theme.${settings.theme}`)}
            chevron
            onPress={() => setPicker('theme')}
          />
          <ListRow
            title={t('settings:refresh.title')}
            icon="timer"
            value={t('settings:refresh.value', { count: settings.refreshIntervalSec })}
            chevron
            onPress={() => setPicker('refresh')}
          />
          {Platform.OS === 'android' ? (
            <ListRow
              title={t('settings:reduceTransparency.title')}
              icon="transparency"
              switchValue={settings.reduceTransparency}
              onSwitch={(v) => settings.set({ reduceTransparency: v })}
            />
          ) : null}
          <ListRow
            title={t('settings:demo.title')}
            icon="demo"
            switchValue={settings.demoMode}
            onSwitch={(v) => {
              settings.set({ demoMode: v });
              if (!v && routerCount === 0) nav.replace('/welcome');
            }}
            testID="more-demo"
          />
          <ListRow
            title={t('more:about')}
            icon="about"
            right={
              hasUpdate(settings.updateLatest) ? (
                <Badge label={t('more:updateScreen.badge')} tone="accent" />
              ) : undefined
            }
            chevron
            onPress={() => nav.push('/more/about')}
            testID="more-about"
          />
        </ListSection>
      </Screen>

      <SelectSheet
        visible={picker === 'language'}
        title={t('settings:language.title')}
        options={LANGUAGES.map((v) => ({ value: v, label: t(`settings:language.${v}`) }))}
        value={settings.language}
        onSelect={(v) => {
          settings.set({ language: v });
          setPicker(null);
        }}
        onCancel={() => setPicker(null)}
      />
      <SelectSheet
        visible={picker === 'theme'}
        title={t('settings:theme.title')}
        options={THEMES.map((v) => ({ value: v, label: t(`settings:theme.${v}`) }))}
        value={settings.theme}
        onSelect={(v) => {
          settings.set({ theme: v });
          setPicker(null);
        }}
        onCancel={() => setPicker(null)}
      />
      <SelectSheet
        visible={picker === 'refresh'}
        title={t('settings:refresh.title')}
        options={INTERVALS.map((v) => ({ value: String(v), label: t('settings:refresh.value', { count: v }) }))}
        value={String(settings.refreshIntervalSec)}
        onSelect={(v) => {
          settings.set({ refreshIntervalSec: Number(v) as RefreshInterval });
          setPicker(null);
        }}
        onCancel={() => setPicker(null)}
      />
      {reboot.element}
      {reset.element}
    </>
  );
}
