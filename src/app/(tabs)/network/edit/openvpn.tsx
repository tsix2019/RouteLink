import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { getOpenvpn, importOvpn, inspectOvpn, validateImport, type OvpnInstance } from '@/api/services/openvpn';
import type { ApplyOutcome } from '@/api/uci';
import { useRouterMutation, useRouterQuery } from '@/hooks/router-queries';
import { useT } from '@/i18n';
import { AppText } from '@/ui/AppText';
import { describeError } from '@/ui/errorText';
import { FormPlaceholder, FormScreen, useFormExit } from '@/ui/FormScreen';
import { GlassCard } from '@/ui/GlassCard';
import { ListRow, ListSection } from '@/ui/ListSection';
import { RiskConfirm } from '@/ui/RiskConfirm';
import { TextField } from '@/ui/TextField';
import { spacing } from '@/ui/theme/tokens';
import { useToast } from '@/ui/Toast';

/** "My VPN.ovpn" → "My_VPN" (a uci section name). */
const nameFromFile = (file: string) =>
  file
    .replace(/\.(ovpn|conf)$/i, '')
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32) || 'vpn';

type Login = { username: string; password: string };

/** NW-8: import an OpenVPN client profile — pick the .ovpn, then name it (and its login, if it asks). */
export default function ImportOpenVpn() {
  const t = useT();
  const state = useRouterQuery(['openvpn'], getOpenvpn);
  const title = t('network:openvpn.importTitle');
  if (!state.data) {
    return <FormPlaceholder title={title} error={state.error} onRetry={() => void state.refetch()} />;
  }
  return <ImportForm title={title} instances={state.data.instances} />;
}

function ImportForm({ title, instances }: { title: string; instances: OvpnInstance[] }) {
  const t = useT();
  const toast = useToast();
  const exit = useFormExit();
  const [file, setFile] = useState<{ fileName: string; text: string } | null>(null);
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const profile = file ? inspectOvpn(file.text) : null;
  const login: Login | undefined = profile?.needsLogin ? { username, password } : undefined;
  const save = useRouterMutation(
    (conn, p: { name: string; text: string; login?: Login }) => importOvpn(conn, p.name, p.text, p.login),
    [['openvpn']],
  );

  const pick = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, type: '*/*' });
      if (result.canceled) return;
      const asset = result.assets[0];
      const text = await new File(asset.uri).text();
      setFile({ fileName: asset.name, text });
      setName(nameFromFile(asset.name));
      setError(null);
    } catch {
      toast(t('network:openvpn.error.read-failed'), 'error');
    }
  };

  const submit = () => {
    if (!file || !profile) return;
    const found = validateImport(name.trim(), file.text, instances, login);
    setError(found ? t(`network:openvpn.error.${found}`, { files: profile.missingFiles.join(', ') }) : null);
    if (!found) setConfirming(true);
  };
  const run = () => {
    setConfirming(false);
    if (!file) return;
    const trimmed = name.trim();
    save.mutate(
      { name: trimmed, text: file.text, login },
      {
        onSuccess: (outcome: ApplyOutcome) => {
          if (outcome.status === 'rolled-back') {
            toast(t('network:result.rolledBack'), 'warning');
            return;
          }
          toast(t('network:openvpn.imported', { name: trimmed }));
          exit.back();
        },
        onError: (e: unknown) => toast(describeError(t, e).title, 'error'),
      },
    );
  };

  return (
    <>
      <FormScreen
        title={title}
        dirty={!!file}
        leaving={exit.leaving}
        onSave={submit}
        saving={save.isPending}
        saveLabel={t('network:openvpn.import')}
        saveDisabled={!file}
        testID="ovpn-form">
        <ListSection>
          <ListRow
            title={t('network:openvpn.pickFile')}
            icon="import"
            value={file?.fileName}
            chevron
            disabled={save.isPending}
            onPress={() => void pick()}
            testID="ovpn-pick"
          />
        </ListSection>
        {file && profile ? (
          <>
            <GlassCard contentStyle={styles.card}>
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
                testID="ovpn-name"
              />
            </GlassCard>
            {profile.remote ? (
              <ListSection>
                <ListRow
                  title={t('network:openvpn.server')}
                  value={[profile.remote, profile.port, profile.proto?.toUpperCase()].filter(Boolean).join(' · ')}
                />
              </ListSection>
            ) : null}
            {profile.needsLogin ? (
              <GlassCard contentStyle={styles.card}>
                <TextField
                  label={t('network:openvpn.username')}
                  value={username}
                  onChangeText={(v) => {
                    setUsername(v);
                    setError(null);
                  }}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <TextField
                  label={t('network:openvpn.password')}
                  value={password}
                  onChangeText={(v) => {
                    setPassword(v);
                    setError(null);
                  }}
                  secret
                />
              </GlassCard>
            ) : null}
          </>
        ) : null}
        {error ? (
          <AppText variant="footnote" tone="danger">
            {error}
          </AppText>
        ) : null}
      </FormScreen>

      <RiskConfirm
        visible={confirming}
        level="medium"
        disruptive
        title={t('network:openvpn.importTitle')}
        consequences={[t('network:openvpn.consequence')]}
        confirmLabel={t('common:confirm')}
        onConfirm={run}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.m },
});
