import { useState } from 'react';

import { hasPublicKey, installPublicKey, removePublicKey } from '@/api/services/ssh-keys';
import { useActiveRouter } from '@/features/routers/ActiveRouterProvider';
import { useCapabilities, useRouterMutation, useRouterQuery } from '@/hooks/router-queries';
import { useT } from '@/i18n';
import { useRouters, type RouterProfile } from '@/state/routers';
import { AppText } from '@/ui/AppText';
import { describeError } from '@/ui/errorText';
import { GlassButton } from '@/ui/GlassButton';
import { GlassCard } from '@/ui/GlassCard';
import { ListRow, ListSection } from '@/ui/ListSection';
import { RiskConfirm } from '@/ui/RiskConfirm';
import { Segmented } from '@/ui/Segmented';
import { TextField } from '@/ui/TextField';
import { useToast } from '@/ui/Toast';

import { appKey } from './appKey';

export interface SshFields {
  port: string;
  user: string;
  auth: 'password' | 'key';
}

export const sshFieldsOf = (p: RouterProfile): SshFields => ({
  port: String(p.sshPort ?? 22),
  user: p.sshUser ?? 'root',
  auth: p.sshAuth ?? 'password',
});

/** null when the port is fine, else the problem. */
export const sshPortError = (port: string) => {
  const n = Number(port);
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? null : 'portInvalid';
};

const AUTHS: SshFields['auth'][] = ['password', 'key'];

/**
 * MO-12 settings of one router: port, user and login method (saved with the form), the pinned host key, and the
 * app's public key on the router (installed through the router login, only for the router in use).
 */
export function SshSection({
  profile,
  fields,
  onChange,
  portError,
}: {
  profile: RouterProfile;
  fields: SshFields;
  onChange(patch: Partial<SshFields>): void;
  portError?: string;
}) {
  const t = useT();
  const toast = useToast();
  const update = useRouters((s) => s.update);
  const { router } = useActiveRouter();
  const active = router?.id === profile.id;
  const capable = useCapabilities().data?.['system.sshkeys']?.status === 'ok';
  const [confirm, setConfirm] = useState<'install' | 'remove' | null>(null);

  const installed = useRouterQuery(['ssh-key'], async (conn) => hasPublicKey(conn, (await appKey()).publicKey), {
    enabled: active && capable,
  });
  const change = useRouterMutation(
    async (conn, action: 'install' | 'remove') => {
      const line = (await appKey()).publicKey;
      return action === 'install' ? installPublicKey(conn, line) : removePublicKey(conn, line);
    },
    [['ssh-key']],
  );
  const run = (action: 'install' | 'remove') => {
    setConfirm(null);
    change.mutate(action, {
      onSuccess: async () => {
        // The key is only useful when it is used: switch the login over (and back).
        const auth = action === 'install' ? 'key' : 'password';
        onChange({ auth });
        await update(profile.id, { sshAuth: auth });
        toast(t(action === 'install' ? 'terminal:settings.installed' : 'terminal:settings.removed'));
      },
      onError: (e) => toast(describeError(t, e).title, 'error'),
    });
  };

  return (
    <>
      <GlassCard title={t('terminal:settings.section')} icon="terminal">
        <TextField
          label={t('terminal:settings.port')}
          value={fields.port}
          onChangeText={(port) => onChange({ port: port.replace(/\D/g, '') })}
          keyboardType="number-pad"
          error={portError}
        />
        <TextField
          label={t('terminal:settings.user')}
          value={fields.user}
          onChangeText={(user) => onChange({ user })}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <AppText variant="footnote" tone="secondary">
          {t('terminal:settings.auth')}
        </AppText>
        <Segmented
          values={[t('terminal:settings.authPassword'), t('terminal:settings.authKey')]}
          selectedIndex={AUTHS.indexOf(fields.auth)}
          onChange={(e) => onChange({ auth: AUTHS[e.nativeEvent.selectedSegmentIndex] })}
        />
        <AppText variant="footnote" tone="secondary">
          {t('terminal:settings.footer')}
        </AppText>
      </GlassCard>

      <ListSection
        footer={
          !active ? t('terminal:settings.notActive') : installed.isLoading ? t('terminal:settings.checking') : undefined
        }>
        <ListRow
          title={t('terminal:settings.hostKey')}
          subtitle={profile.sshHostKey ?? t('terminal:settings.notPinned')}
          icon="shield"
        />
        {profile.sshHostKey ? (
          <ListRow
            title={t('terminal:settings.forgetHostKey')}
            onPress={() => {
              void update(profile.id, { sshHostKey: undefined }).then(() =>
                toast(t('terminal:settings.forgotHostKey')),
              );
            }}
            testID="ssh-forget-host-key"
          />
        ) : null}
        {active && capable ? (
          installed.data ? (
            <ListRow
              title={t('terminal:settings.remove')}
              subtitle={t('terminal:settings.installed')}
              icon="key"
              destructive
              disabled={change.isPending}
              onPress={() => setConfirm('remove')}
              testID="ssh-remove-key"
            />
          ) : (
            <ListRow
              title={t('terminal:settings.install')}
              icon="key"
              disabled={change.isPending || installed.isLoading}
              onPress={() => setConfirm('install')}
              testID="ssh-install-key"
            />
          )
        ) : null}
      </ListSection>
      {change.isPending ? <GlassButton label={t('terminal:settings.appKey')} loading disabled /> : null}

      <RiskConfirm
        visible={confirm !== null}
        level="medium"
        title={confirm === 'remove' ? t('terminal:settings.removeTitle') : t('terminal:settings.installTitle')}
        consequences={
          confirm === 'remove'
            ? [t('terminal:settings.removeConsequence')]
            : [t('terminal:settings.installConsequenceFile'), t('terminal:settings.installConsequenceLogin')]
        }
        confirmLabel={confirm === 'remove' ? t('terminal:settings.remove') : t('terminal:settings.install')}
        onConfirm={() => confirm && run(confirm)}
        onCancel={() => setConfirm(null)}
      />
    </>
  );
}
