import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  getTimeSettings,
  getTimezones,
  setAdminPassword,
  syncRouterClock,
  timezoneChanges,
  validatePassword,
  type Timezone,
} from '@/api/services/system-settings';
import { stageAndApply } from '@/api/uci';
import { FeatureGate } from '@/features/capabilities/FeatureGate';
import { useActiveRouter } from '@/features/routers/ActiveRouterProvider';
import { ConnectionBanner } from '@/features/routers/ConnectionBanner';
import { useRouterMutation, useRouterQuery } from '@/hooks/router-queries';
import { useLang, useT } from '@/i18n';
import { useRouters } from '@/state/routers';
import { AppText } from '@/ui/AppText';
import { describeError } from '@/ui/errorText';
import { ErrorState, Skeleton } from '@/ui/Feedback';
import { GlassButton } from '@/ui/GlassButton';
import { NoBlurTarget } from '@/ui/glass/BlurTarget';
import { GlassSurface } from '@/ui/glass/GlassSurface';
import { ListRow, ListSection } from '@/ui/ListSection';
import { RiskConfirm } from '@/ui/RiskConfirm';
import { Screen } from '@/ui/Screen';
import { SelectSheet } from '@/ui/SelectSheet';
import { TextField } from '@/ui/TextField';
import { spacing } from '@/ui/theme/tokens';
import { useToast } from '@/ui/Toast';
import { formatDayTime } from '@/utils/dates';
import { formatDuration } from '@/utils/format';

/** MO-8: router clock and time zone, and the admin password. */
export default function SystemSettings() {
  const t = useT();
  const lang = useLang();
  const toast = useToast();
  const { router } = useActiveRouter();
  const time = useRouterQuery(['system-time'], (conn) => getTimeSettings(conn), { refetchInterval: 10_000 });
  const zones = useRouterQuery(['timezones'], getTimezones, { staleTime: Infinity });
  const [picking, setPicking] = useState(false);
  const [passwordSheet, setPasswordSheet] = useState(false);
  const [newPassword, setNewPassword] = useState<string | null>(null);
  const username = router?.profile?.username ?? 'root';

  const fail = (error: unknown) => toast(describeError(t, error).title, 'error');
  const sync = useRouterMutation((conn) => syncRouterClock(conn), [['system-time']]);
  const changeZone = useRouterMutation(
    (conn, z: Timezone) =>
      stageAndApply(conn, timezoneChanges(time.data?.section ?? '@system[0]', z), { mode: 'direct' }),
    [['system-time']],
  );
  const changePassword = useRouterMutation(async (conn, password: string) => {
    await setAdminPassword(conn, username, password);
    // Keep the app signed in: the next login uses the new password.
    if (router?.profile) await useRouters.getState().update(router.profile.id, {}, password);
  }, []);

  const offset = time.data?.offsetSec ?? 0;
  const offsetText =
    Math.abs(offset) < 3
      ? t('more:systemScreen.offsetOk')
      : t(offset > 0 ? 'more:systemScreen.ahead' : 'more:systemScreen.behind', {
          time: formatDuration(Math.abs(offset), lang),
        });

  return (
    <>
      <Screen
        title={t('more:system')}
        onRefresh={() => time.refetch()}
        top={time.data ? <ConnectionBanner error={time.error} onRetry={() => void time.refetch()} /> : null}>
        <FeatureGate feature="system.time" icon="settings">
          {time.data ? (
            <ListSection title={t('more:systemScreen.time')}>
              <ListRow
                title={t('more:systemScreen.routerTime')}
                subtitle={offsetText}
                value={formatDayTime(time.data.localTime, lang, { utc: true })}
                icon="timer"
              />
              <ListRow
                title={t('more:systemScreen.zone')}
                value={time.data.zonename}
                icon="globe"
                chevron
                disabled={!zones.data}
                onPress={() => setPicking(true)}
                testID="system-zone"
              />
              <ListRow title={t('more:systemScreen.ntp')} value={time.data.ntp ? t('on') : t('off')} />
              <ListRow
                title={t('more:systemScreen.sync')}
                icon="refresh"
                disabled={sync.isPending}
                onPress={() =>
                  sync.mutate(undefined, { onSuccess: () => toast(t('more:systemScreen.synced')), onError: fail })
                }
                testID="system-sync"
              />
            </ListSection>
          ) : time.isError ? (
            <ErrorState error={time.error} onRetry={() => void time.refetch()} />
          ) : (
            <View style={styles.loading}>
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} height={52} radius={14} />
              ))}
            </View>
          )}
        </FeatureGate>
        <FeatureGate feature="system.password" icon="key">
          <ListSection
            title={t('more:systemScreen.password')}
            footer={t('more:systemScreen.passwordHint', { user: username })}>
            <ListRow
              title={t('more:systemScreen.changePassword')}
              icon="key"
              chevron
              disabled={changePassword.isPending || router?.isDemo === undefined}
              onPress={() => setPasswordSheet(true)}
              testID="system-password"
            />
          </ListSection>
        </FeatureGate>
      </Screen>

      <SelectSheet
        visible={picking}
        title={t('more:systemScreen.zone')}
        options={(zones.data ?? []).map((z) => ({ value: z.zonename, label: z.zonename, detail: z.tz }))}
        value={time.data?.zonename ?? ''}
        onSelect={(name) => {
          setPicking(false);
          const z = zones.data?.find((x) => x.zonename === name);
          if (z && z.zonename !== time.data?.zonename) {
            changeZone.mutate(z, { onSuccess: () => toast(t('more:systemScreen.zoneDone')), onError: fail });
          }
        }}
        onCancel={() => setPicking(false)}
      />
      {passwordSheet ? (
        <PasswordSheet
          onSubmit={(p) => {
            setPasswordSheet(false);
            setNewPassword(p);
          }}
          onCancel={() => setPasswordSheet(false)}
        />
      ) : null}
      <RiskConfirm
        visible={newPassword !== null}
        level="medium"
        title={t('more:systemScreen.passwordTitle', { user: username })}
        consequences={[t('more:systemScreen.passwordConsequence')]}
        confirmLabel={t('more:systemScreen.changePassword')}
        onConfirm={() => {
          const p = newPassword;
          setNewPassword(null);
          if (p)
            changePassword.mutate(p, { onSuccess: () => toast(t('more:systemScreen.passwordDone')), onError: fail });
        }}
        onCancel={() => setNewPassword(null)}
      />
    </>
  );
}

function PasswordSheet({ onSubmit, onCancel }: { onSubmit(password: string): void; onCancel(): void }) {
  const t = useT();
  const insets = useSafeAreaInsets();
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | undefined>();
  const submit = () => {
    const problem = validatePassword(password, repeat);
    if (problem) setError(t(`more:systemScreen.passwordError.${problem}`));
    else onSubmit(password);
  };
  return (
    <Modal transparent animationType="slide" onRequestClose={onCancel} statusBarTranslucent>
      <NoBlurTarget>
        <Pressable style={styles.scrim} onPress={onCancel} accessibilityLabel={t('cancel')} />
        <KeyboardAvoidingView behavior="padding" style={styles.wrap}>
          <GlassSurface variant="floating" style={[styles.sheet, { marginBottom: insets.bottom + spacing.m }]}>
            <AppText variant="title">{t('more:systemScreen.changePassword')}</AppText>
            <TextField
              label={t('more:systemScreen.newPassword')}
              value={password}
              onChangeText={(v) => {
                setPassword(v);
                setError(undefined);
              }}
              secret
              autoFocus
              testID="system-new-password"
            />
            <TextField
              label={t('more:systemScreen.repeat')}
              value={repeat}
              onChangeText={(v) => {
                setRepeat(v);
                setError(undefined);
              }}
              secret
              error={error}
              returnKeyType="done"
              onSubmitEditing={submit}
              testID="system-repeat-password"
            />
            <GlassButton label={t('more:systemScreen.changePassword')} variant="primary" onPress={submit} />
            <GlassButton label={t('cancel')} onPress={onCancel} />
          </GlassSurface>
        </KeyboardAvoidingView>
      </NoBlurTarget>
    </Modal>
  );
}

const styles = StyleSheet.create({
  loading: { gap: spacing.s },
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.35)' },
  wrap: { position: 'absolute', left: spacing.m, right: spacing.m, bottom: 0 },
  sheet: { padding: spacing.xl, gap: spacing.m },
});
