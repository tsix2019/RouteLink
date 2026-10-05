import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { RouterConnection } from '@/api/connection/types';
import {
  deleteInstance,
  getOpenvpn,
  importOvpn,
  inspectOvpn,
  setInstanceEnabled,
  validateImport,
  type OvpnInstance,
} from '@/api/services/openvpn';
import type { ApplyOutcome } from '@/api/uci';
import { FeatureGate } from '@/features/capabilities/FeatureGate';
import { ConnectionBanner } from '@/features/routers/ConnectionBanner';
import { useRouterMutation, useRouterQuery } from '@/hooks/router-queries';
import { useT } from '@/i18n';
import { ActionSheet } from '@/ui/ActionSheet';
import { AppText } from '@/ui/AppText';
import { EditSheet } from '@/ui/EditSheet';
import { describeError } from '@/ui/errorText';
import { ErrorState, Skeleton } from '@/ui/Feedback';
import { GlassButton } from '@/ui/GlassButton';
import { ListRow, ListSection } from '@/ui/ListSection';
import { RiskConfirm } from '@/ui/RiskConfirm';
import { Screen } from '@/ui/Screen';
import { StatusDot } from '@/ui/Status';
import { TextField } from '@/ui/TextField';
import { spacing } from '@/ui/theme/tokens';
import { useToast } from '@/ui/Toast';

type Pending = { title: string; run(conn: RouterConnection): Promise<ApplyOutcome>; done?: string };

/** "My VPN.ovpn" → "My_VPN" (a uci section name). */
const nameFromFile = (file: string) =>
  file
    .replace(/\.(ovpn|conf)$/i, '')
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32) || 'vpn';

/** NW-8: OpenVPN client profiles — import, start and stop, delete. */
export default function OpenVpn() {
  const t = useT();
  const toast = useToast();
  const state = useRouterQuery(['openvpn'], getOpenvpn, { refetchInterval: 10_000 });
  const [importing, setImporting] = useState<{ name: string; text: string } | null>(null);
  const [menu, setMenu] = useState<OvpnInstance | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const run = useRouterMutation((conn, p: Pending) => p.run(conn), [['openvpn']]);
  const fail = (e: unknown) => toast(describeError(t, e).title, 'error');

  const pick = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, type: '*/*' });
      if (result.canceled) return;
      const asset = result.assets[0];
      setImporting({ name: nameFromFile(asset.name), text: await new File(asset.uri).text() });
    } catch {
      toast(t('network:openvpn.error.read-failed'), 'error');
    }
  };

  const status = (i: OvpnInstance) =>
    i.running === null
      ? i.enabled
        ? t('network:openvpn.unknown')
        : t('network:openvpn.stopped')
      : i.running
        ? t('network:openvpn.running')
        : t('network:openvpn.stopped');

  const data = state.data;
  return (
    <>
      <Screen
        title={t('network:openvpn.title')}
        onRefresh={() => state.refetch()}
        top={data ? <ConnectionBanner error={state.error} onRetry={() => void state.refetch()} /> : null}>
        <FeatureGate feature="network.openvpn" icon="vpn">
          <AppText variant="footnote" tone="secondary" style={styles.note}>
            {t('network:openvpn.intro')}
          </AppText>
          {data ? (
            <>
              <ListSection
                footer={data.instances.some((i) => i.running === null) ? t('network:openvpn.statusHint') : undefined}>
                {data.instances.length ? (
                  data.instances.map((i) => (
                    <ListRow
                      key={i.name}
                      title={i.name}
                      subtitle={[status(i), i.hasLogin ? t('network:openvpn.login') : null].filter(Boolean).join(' · ')}
                      left={<StatusDot status={i.running ? 'online' : 'offline'} />}
                      switchValue={i.enabled}
                      onSwitch={(on) =>
                        setPending({
                          title: t(on ? 'network:openvpn.enableTitle' : 'network:openvpn.disableTitle', {
                            name: i.name,
                          }),
                          run: (conn) => setInstanceEnabled(conn, i, on),
                        })
                      }
                      onPress={() => setMenu(i)}
                      testID={`ovpn-${i.name}`}
                    />
                  ))
                ) : (
                  <ListRow title={t('network:openvpn.empty')} disabled />
                )}
              </ListSection>
              <GlassButton
                label={t('network:openvpn.import')}
                icon="import"
                variant="primary"
                disabled={run.isPending}
                onPress={() => void pick()}
                testID="ovpn-import"
              />
            </>
          ) : state.isError ? (
            <ErrorState error={state.error} onRetry={() => void state.refetch()} />
          ) : (
            <View style={styles.loading}>
              {[0, 1].map((i) => (
                <Skeleton key={i} height={56} radius={14} />
              ))}
            </View>
          )}
        </FeatureGate>
      </Screen>

      <ActionSheet
        visible={!!menu}
        title={menu?.name}
        message={menu?.configFile}
        actions={
          menu
            ? [
                {
                  label: t('network:openvpn.delete'),
                  icon: 'trash' as const,
                  destructive: true,
                  onPress: () => {
                    const i = menu;
                    setMenu(null);
                    setPending({
                      title: t('network:openvpn.deleteTitle', { name: i.name }),
                      run: (conn) => deleteInstance(conn, i),
                    });
                  },
                },
              ]
            : []
        }
        onCancel={() => setMenu(null)}
      />
      {importing && data ? (
        <ImportSheet
          initial={importing}
          instances={data.instances}
          onCancel={() => setImporting(null)}
          onSave={(name, login) => {
            const text = importing.text;
            setImporting(null);
            setPending({
              title: t('network:openvpn.importTitle'),
              run: (conn) => importOvpn(conn, name, text, login),
              done: t('network:openvpn.imported', { name }),
            });
          }}
        />
      ) : null}
      <RiskConfirm
        visible={!!pending}
        level="medium"
        disruptive
        title={pending?.title ?? ''}
        consequences={[t('network:openvpn.consequence')]}
        confirmLabel={t('common:confirm')}
        onConfirm={() => {
          const p = pending;
          setPending(null);
          if (!p) return;
          run.mutate(p, {
            onSuccess: (outcome) =>
              outcome.status === 'rolled-back'
                ? toast(t('network:result.rolledBack'), 'warning')
                : toast(p.done ?? t('network:openvpn.applied')),
            onError: fail,
          });
        }}
        onCancel={() => setPending(null)}
      />
    </>
  );
}

function ImportSheet({
  initial,
  instances,
  onSave,
  onCancel,
}: {
  initial: { name: string; text: string };
  instances: OvpnInstance[];
  onSave(name: string, login?: { username: string; password: string }): void;
  onCancel(): void;
}) {
  const t = useT();
  const profile = inspectOvpn(initial.text);
  const [name, setName] = useState(initial.name);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const login = profile.needsLogin ? { username, password } : undefined;
  return (
    <EditSheet
      title={t('network:openvpn.importTitle')}
      saveLabel={t('network:openvpn.import')}
      onCancel={onCancel}
      onSave={() => {
        const found = validateImport(name.trim(), initial.text, instances, login);
        setError(found ? t(`network:openvpn.error.${found}`, { files: profile.missingFiles.join(', ') }) : null);
        if (!found) onSave(name.trim(), login);
      }}
      testID="ovpn-import-sheet">
      <TextField
        label={t('network:openvpn.name')}
        value={name}
        onChangeText={(v) => {
          setName(v);
          setError(null);
        }}
        hint={t('network:openvpn.nameHint')}
        autoCapitalize="none"
        autoCorrect={false}
      />
      {profile.remote ? (
        <ListSection>
          <ListRow
            title={t('network:openvpn.server')}
            value={[profile.remote, profile.port, profile.proto?.toUpperCase()].filter(Boolean).join(' · ')}
          />
        </ListSection>
      ) : null}
      {profile.needsLogin ? (
        <>
          <TextField
            label={t('network:openvpn.username')}
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TextField label={t('network:openvpn.password')} value={password} onChangeText={setPassword} secret />
        </>
      ) : null}
      {error ? (
        <AppText variant="footnote" tone="danger">
          {error}
        </AppText>
      ) : null}
    </EditSheet>
  );
}

const styles = StyleSheet.create({
  loading: { gap: spacing.s },
  note: { paddingHorizontal: spacing.l },
});
