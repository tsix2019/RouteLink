import { allowNotifications, notify, syncBackgroundCheck } from '@/features/background/task';
import { useT } from '@/i18n';
import { useRouters } from '@/state/routers';
import { useSettings } from '@/state/settings';
import { ListRow, ListSection } from '@/ui/ListSection';
import { Screen } from '@/ui/Screen';
import { useToast } from '@/ui/Toast';
import { pinWidget } from '@/widgets/update';

/** AP-4 / AP-5 (design §19): which routers the background check watches, and what the widget shows. */
export default function NotificationSettings() {
  const t = useT();
  const toast = useToast();
  const routers = useRouters((s) => s.routers);
  const watched = useSettings((s) => s.notifyRouters);
  const set = useSettings((s) => s.set);

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

  const pin = async () => {
    const asked = await (pinWidget?.() ?? Promise.resolve(false)).catch(() => false);
    if (!asked) toast(t('settings:notify.pinUnsupported'), 'warning');
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
      <ListSection title={t('settings:notify.widgetSection')} footer={t('settings:notify.widgetFooter')}>
        <ListRow title={t('widget.name')} subtitle={t('widget.description')} icon="widget" />
        {pinWidget ? (
          <ListRow
            title={t('settings:notify.pin')}
            icon="plus"
            onPress={() => void pin()}
            testID="widget-pin"
          />
        ) : null}
      </ListSection>
    </Screen>
  );
}
