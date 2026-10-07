import { useRouter } from 'expo-router';
import { Platform } from 'react-native';

import { allowNotifications, notify, syncBackgroundCheck } from '@/features/background/task';
import { useT } from '@/i18n';
import { useRouters } from '@/state/routers';
import { useSettings } from '@/state/settings';
import { ListRow, ListSection } from '@/ui/ListSection';
import { Screen } from '@/ui/Screen';
import { useToast } from '@/ui/Toast';

/** AP-4 / AP-5 (design §19): which routers the background check watches, and what the widget shows. */
export default function NotificationSettings() {
  const t = useT();
  const toast = useToast();
  const routers = useRouters((s) => s.routers);
  const watched = useSettings((s) => s.notifyRouters);
  const set = useSettings((s) => s.set);
  const nav = useRouter();

  const toggle = async (id: string, on: boolean) => {
    if (on && !(await allowNotifications())) {
      toast(t('settings:notify.permissionDenied'), 'warning');
      return;
    }
    const next = on ? [...new Set([...watched, id])] : watched.filter((w) => w !== id);
    set({ notifyRouters: next });
    await syncBackgroundCheck(next.length > 0).catch(() => undefined);
  };

  const test = async () => {
    if (!(await allowNotifications())) {
      toast(t('settings:notify.permissionDenied'), 'warning');
      return;
    }
    await notify(t('settings:notify.testTitle'), t('settings:notify.testBody'));
  };

  return (
    <Screen title={t('settings:notify.title')}>
      <ListSection title={t('settings:notify.section')} footer={t('settings:notify.footer')}>
        {routers.map((r) => (
          <ListRow
            key={r.id}
            title={r.name}
            subtitle={r.savePassword ? undefined : t('settings:notify.needsPassword')}
            icon="router"
            switchValue={watched.includes(r.id)}
            disabled={!r.savePassword}
            onSwitch={(on) => void toggle(r.id, on)}
            testID={`notify-${r.id}`}
          />
        ))}
        <ListRow title={t('settings:notify.test')} icon="bell" onPress={() => void test()} testID="notify-test" />
      </ListSection>
      <ListSection
        title={t('settings:notify.widgetSection')}
        footer={Platform.OS === 'android' ? undefined : t('settings:widgets.iosFooter')}>
        {Platform.OS === 'android' ? (
          <ListRow
            title={t('settings:widgets.title')}
            icon="widget"
            chevron
            onPress={() => nav.push('/more/widgets')}
            testID="notify-widgets"
          />
        ) : (
          <ListRow
            title={t('widget.kinds.router.name')}
            subtitle={t('widget.kinds.router.description')}
            icon="widget"
          />
        )}
      </ListSection>
    </Screen>
  );
}
