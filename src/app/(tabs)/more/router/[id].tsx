import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';

import { dropLiveConnection } from '@/api/connection/manager';
import { parseAddress } from '@/features/routers/login';
import { formatFingerprint } from '@/features/routers/trust';
import { useT } from '@/i18n';
import { useRouters, type RouterProfile } from '@/state/routers';
import { useSettings } from '@/state/settings';
import { useSnapshots } from '@/state/snapshots';
import { AppText } from '@/ui/AppText';
import { EmptyState } from '@/ui/Feedback';
import { GlassButton } from '@/ui/GlassButton';
import { GlassCard } from '@/ui/GlassCard';
import { ListRow, ListSection } from '@/ui/ListSection';
import { RiskConfirm } from '@/ui/RiskConfirm';
import { Screen } from '@/ui/Screen';
import { TextField } from '@/ui/TextField';
import { useToast } from '@/ui/Toast';

export default function RouterSettings() {
  const t = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const profile = useRouters((s) => s.routers.find((r) => r.id === id));
  if (!profile) {
    return (
      <Screen title={t('more:routerEdit.title')}>
        <EmptyState icon="router" title={t('more:routersScreen.empty')} />
      </Screen>
    );
  }
  return <RouterForm profile={profile} />;
}

/** Name, address, account and pinned certificate of one saved router; delete at the bottom. */
function RouterForm({ profile }: { profile: RouterProfile }) {
  const t = useT();
  const nav = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();
  const update = useRouters((s) => s.update);
  const remove = useRouters((s) => s.remove);
  const remaining = useRouters((s) => s.routers.length) - 1;
  const demoMode = useSettings((s) => s.demoMode);
  const forgetSnapshot = useSnapshots((s) => s.forget);

  const [name, setName] = useState(profile.name);
  const [address, setAddress] = useState(profile.baseUrl);
  const [username, setUsername] = useState(profile.username);
  const [password, setPassword] = useState('');
  const [savePassword, setSavePassword] = useState(profile.savePassword);
  const [addressError, setAddressError] = useState<string | undefined>();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const save = async () => {
    const baseUrl = parseAddress(address);
    if (!baseUrl) {
      setAddressError(t('routers:login.addressInvalid'));
      return;
    }
    // A new address may present a different certificate: the pin only belongs to the old one.
    const moved = baseUrl !== profile.baseUrl;
    await update(
      profile.id,
      {
        name: name.trim() || profile.name,
        baseUrl,
        username: username.trim() || 'root',
        savePassword,
        ...(moved ? { tlsSha256: undefined } : {}),
      },
      password ? password : undefined,
    );
    dropLiveConnection(profile.id);
    await queryClient.invalidateQueries({ queryKey: [profile.id] });
    toast(t('more:routerEdit.saved'));
    nav.back();
  };

  const forgetCertificate = async () => {
    await update(profile.id, { tlsSha256: undefined });
    dropLiveConnection(profile.id);
    await queryClient.invalidateQueries({ queryKey: [profile.id] });
  };

  const del = async () => {
    setConfirmDelete(false);
    await remove(profile.id);
    dropLiveConnection(profile.id);
    forgetSnapshot(profile.id);
    queryClient.removeQueries({ queryKey: [profile.id] });
    if (remaining === 0 && !demoMode) nav.replace('/welcome');
    else nav.back();
  };

  return (
    <>
      <Screen title={profile.name}>
        <GlassCard>
          <TextField label={t('routers:login.name')} value={name} onChangeText={setName} />
          <TextField
            label={t('routers:login.address')}
            value={address}
            onChangeText={(v) => {
              setAddress(v);
              setAddressError(undefined);
            }}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            error={addressError}
          />
        </GlassCard>
        <GlassCard>
          <TextField
            label={t('routers:login.username')}
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TextField
            label={t('routers:login.password')}
            value={password}
            onChangeText={setPassword}
            hint={t('more:routerEdit.passwordHint')}
            secret
          />
        </GlassCard>
        <ListSection footer={t('routers:login.savePasswordHint')}>
          <ListRow
            title={t('routers:login.savePassword')}
            icon="lock"
            switchValue={savePassword}
            onSwitch={setSavePassword}
          />
        </ListSection>
        {profile.tlsSha256 ? (
          <GlassCard title={t('more:routerEdit.certificate')} icon="shield">
            <AppText variant="mono" selectable>
              {formatFingerprint(profile.tlsSha256)}
            </AppText>
            <GlassButton
              label={t('more:routerEdit.forgetCertificate')}
              compact
              onPress={() => void forgetCertificate()}
            />
          </GlassCard>
        ) : null}
        <GlassButton label={t('save')} variant="primary" onPress={() => void save()} testID="router-save" />
        <GlassButton
          label={t('more:routerEdit.delete')}
          icon="trash"
          variant="destructive"
          onPress={() => setConfirmDelete(true)}
          testID="router-delete"
        />
      </Screen>
      <RiskConfirm
        visible={confirmDelete}
        level="medium"
        title={t('more:routerEdit.deleteTitle', { name: profile.name })}
        consequences={[t('more:routerEdit.deleteConsequence')]}
        confirmLabel={t('delete')}
        onConfirm={() => void del()}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  );
}
