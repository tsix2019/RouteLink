import { useQueryClient } from '@tanstack/react-query';
import { useNavigation } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getLiveConnection } from '@/api/connection/manager';
import { classifyError, type ConnectionFailure } from '@/api/connection/types';
import { readGroupHints, roleOf, suggestGateway } from '@/api/group';
import { useAddDraft, type AddTarget } from '@/features/routers/addDraft';
import { useSetRole } from '@/features/routers/GroupSection';
import { hostOf, parseAddress, tryLogin, type LoginOutcome } from '@/features/routers/login';
import { nativeFetchCertificate, resolveCertificate } from '@/features/routers/trust';
import { useTrustPrompt } from '@/features/routers/TrustSheet';
import { useT } from '@/i18n';
import { sortedRouters, useRouters, type RouterProfile } from '@/state/routers';
import { useSettings } from '@/state/settings';
import { ActionSheet } from '@/ui/ActionSheet';
import { AppText } from '@/ui/AppText';
import { describeFailure } from '@/ui/errorText';
import { Banner } from '@/ui/Feedback';
import { GlassButton } from '@/ui/GlassButton';
import { GlassCard } from '@/ui/GlassCard';
import { Icon } from '@/ui/Icon';
import { ListRow, ListSection } from '@/ui/ListSection';
import { Screen } from '@/ui/Screen';
import { TextField } from '@/ui/TextField';
import { useToast } from '@/ui/Toast';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { spacing } from '@/ui/theme/tokens';
import { Segmented } from '@/ui/Segmented';
import { isHttps } from '@/utils/url';

type EntryStatus =
  | { state: 'idle' }
  | { state: 'connecting' }
  | { state: 'ok'; outcome: Extract<LoginOutcome, { ok: true }> }
  | { state: 'failed'; failure: ConnectionFailure };

interface Entry extends AddTarget {
  password: string;
  tlsSha256?: string;
  status: EntryStatus;
}

const toEntry = (target: AddTarget): Entry => ({ ...target, password: '', status: { state: 'idle' } });

interface Suggestion {
  profile: RouterProfile;
  gateway: RouterProfile;
}

/** NG-1: a new router that looks like an AP behind a saved router (bounded: never holds up the add). */
async function findSuggestion(profile: RouterProfile, password: string): Promise<Suggestion | null> {
  try {
    const conn = getLiveConnection(profile, password);
    const hints = await Promise.race([
      readGroupHints(conn),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 6_000)),
    ]);
    if (!hints) return null;
    const gateway = suggestGateway(hints, useRouters.getState().routers, profile.id);
    return gateway ? { profile, gateway } : null;
  } catch {
    return null;
  }
}

/**
 * Step 2 of adding routers: credentials, a login check per router (with the certificate trust
 * prompt for self-signed HTTPS), then save and open the first router.
 */
export default function AddRouterLogin() {
  const t = useT();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const trust = useTrustPrompt();
  const routers = useRouters((s) => s.routers);
  const addRouter = useRouters((s) => s.add);
  const setActive = useRouters((s) => s.setActive);
  const setSettings = useSettings((s) => s.set);
  const getPassword = useRouters((s) => s.getPassword);
  const setRole = useSetRole();
  const toast = useToast();
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [newIds, setNewIds] = useState<string[]>([]);
  const [pickingPassword, setPickingPassword] = useState(false);

  const draft = useAddDraft((s) => s.targets);
  const manual = draft.length === 0;
  const [entries, setEntries] = useState<Entry[]>(() => draft.map(toEntry));
  const [address, setAddress] = useState('');
  const [manualName, setManualName] = useState('');
  const [addressError, setAddressError] = useState<string | undefined>();
  const [username, setUsername] = useState('root');
  const [password, setPassword] = useState('');
  const [same, setSame] = useState(true);
  const [savePassword, setSavePassword] = useState(true);
  const [busy, setBusy] = useState(false);

  const multi = entries.length > 1;
  const shared = !multi || same;
  const anyHttp = manual
    ? !!parseAddress(address) && !isHttps(parseAddress(address)!)
    : entries.some((e) => !isHttps(e.baseUrl));

  const patch = (baseUrl: string, change: Partial<Entry>) =>
    setEntries((list) => list.map((e) => (e.baseUrl === baseUrl ? { ...e, ...change } : e)));

  /** Builds the list to connect: the typed address in manual mode, the picked routers otherwise. */
  const prepare = (): Entry[] | null => {
    if (!manual) return entries;
    const baseUrl = parseAddress(address);
    if (!baseUrl) {
      setAddressError(t('routers:login.addressInvalid'));
      return null;
    }
    if (routers.some((r) => r.baseUrl === baseUrl)) {
      setAddressError(t('routers:login.duplicate'));
      return null;
    }
    const previous = entries[0]?.baseUrl === baseUrl ? entries[0] : undefined;
    const entry: Entry = previous ? { ...previous, name: manualName } : { ...toEntry({ baseUrl, name: manualName }) };
    setEntries([entry]);
    return [entry];
  };

  const connect = async () => {
    const list = prepare();
    if (!list) return;
    setBusy(true);
    const results = new Map<string, Entry>();
    for (const entry of list) {
      if (entry.status.state === 'ok') {
        results.set(entry.baseUrl, entry);
        continue;
      }
      patch(entry.baseUrl, { status: { state: 'connecting' } });
      const pw = shared ? password : entry.password;
      let tlsSha256 = entry.tlsSha256;
      let outcome = await tryLogin({ baseUrl: entry.baseUrl, username, password: pw, tlsSha256 });
      if (!outcome.ok && (outcome.failure.kind === 'tls-untrusted' || outcome.failure.kind === 'tls-mismatch')) {
        try {
          const sha = await resolveCertificate(
            { baseUrl: entry.baseUrl, failure: outcome.failure.kind, pinnedSha256: tlsSha256 },
            { fetchCertificate: nativeFetchCertificate, ask: trust.ask },
          );
          if (sha) {
            tlsSha256 = sha;
            outcome = await tryLogin({ baseUrl: entry.baseUrl, username, password: pw, tlsSha256 });
          }
        } catch (error) {
          outcome = { ok: false, failure: classifyError(error) };
        }
      }
      const status: EntryStatus = outcome.ok ? { state: 'ok', outcome } : { state: 'failed', failure: outcome.failure };
      const next = { ...entry, tlsSha256, status };
      results.set(entry.baseUrl, next);
      patch(entry.baseUrl, { tlsSha256, status });
    }

    const done = list.map((e) => results.get(e.baseUrl)!);
    if (done.every((e) => e.status.state === 'ok')) {
      const ids: string[] = [];
      const found: Suggestion[] = [];
      for (const e of done) {
        if (e.status.state !== 'ok') continue;
        const { outcome } = e.status;
        const profile = await addRouter(
          {
            name: e.name.trim() || outcome.hostname || hostOf(e.baseUrl),
            baseUrl: e.baseUrl,
            username: username.trim() || 'root',
            savePassword,
            tlsSha256: e.tlsSha256,
            authMode: outcome.authMode,
            model: outcome.model,
          },
          shared ? password : e.password,
        );
        ids.push(profile.id);
        const suggestion = await findSuggestion(profile, shared ? password : e.password);
        if (suggestion) found.push(suggestion);
      }
      if (found.length) {
        setNewIds(ids);
        setSuggestions(found);
        return;
      }
      finish(ids);
      return;
    }
    setBusy(false);
  };

  const finish = (ids: string[]) => {
    // An access point opens on its gateway: that is where the merged view is.
    const first = useRouters.getState().routers.find((r) => r.id === ids[0]);
    const open = first && roleOf(first) === 'ap' && first.gatewayId ? first.gatewayId : ids[0];
    setActive(open);
    setSettings({ demoMode: false });
    queryClient.removeQueries({ queryKey: [open] });
    // Leave the modal and whatever was underneath (welcome, switcher): start fresh on the new router.
    navigation.getParent()?.reset({
      index: 0,
      routes: [{ name: '(tabs)', state: { index: 0, routes: [{ name: 'overview' }] } }],
    });
  };

  const decide = async (join: boolean) => {
    const [current, ...rest] = suggestions;
    if (join) await setRole(current.profile, { gatewayId: current.gateway.id });
    setSuggestions(rest);
    if (!rest.length) finish(newIds);
  };

  /** "Use the main router's password": most APs of a home share it. */
  const fillPassword = async (id: string) => {
    setPickingPassword(false);
    const saved = await getPassword(id);
    if (saved) setPassword(saved);
    else toast(t('routers:group.usePasswordNone'), 'info');
  };
  const passwordSources = sortedRouters(routers).sort(
    (a, b) => Number(roleOf(b) === 'gateway') - Number(roleOf(a) === 'gateway'),
  );

  return (
    <>
      <Screen
        title={t('routers:login.title')}
        inTabs={false}
        contentStyle={{ paddingBottom: insets.bottom + spacing.xxl }}>
        {manual ? (
          <GlassCard>
            <TextField
              label={t('routers:login.address')}
              value={address}
              onChangeText={(v) => {
                setAddress(v);
                setAddressError(undefined);
              }}
              placeholder={t('routers:login.addressPlaceholder')}
              error={addressError}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              autoFocus
              testID="login-address"
            />
            <TextField
              label={t('routers:login.name')}
              value={manualName}
              onChangeText={setManualName}
              placeholder="OpenWrt"
              testID="login-name"
            />
            {entries[0] ? <EntryStatusLine status={entries[0].status} /> : null}
          </GlassCard>
        ) : (
          entries.map((e) => (
            <GlassCard
              key={e.baseUrl}
              title={e.baseUrl.replace(/^https?:\/\//, '')}
              icon="router"
              accessory={
                multi ? (
                  <GlassButton
                    label={t('routers:login.remove')}
                    compact
                    disabled={busy}
                    onPress={() => setEntries((list) => list.filter((x) => x.baseUrl !== e.baseUrl))}
                  />
                ) : undefined
              }>
              <TextField
                label={t('routers:login.name')}
                value={e.name}
                onChangeText={(name) => patch(e.baseUrl, { name })}
              />
              {!shared ? (
                <TextField
                  label={t('routers:login.password')}
                  value={e.password}
                  onChangeText={(pw) => patch(e.baseUrl, { password: pw, status: { state: 'idle' } })}
                  secret
                />
              ) : null}
              <EntryStatusLine status={e.status} />
            </GlassCard>
          ))
        )}

        {multi ? (
          <View style={styles.same}>
            <AppText variant="subhead" tone="secondary">
              {t('routers:login.samePassword')}
            </AppText>
            <Segmented
              values={[t('routers:login.same'), t('routers:login.different')]}
              selectedIndex={same ? 0 : 1}
              onChange={(ev) => setSame(ev.nativeEvent.selectedSegmentIndex === 0)}
            />
          </View>
        ) : null}

        <GlassCard>
          <TextField
            label={t('routers:login.username')}
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
            testID="login-username"
          />
          {shared ? (
            <TextField
              label={t('routers:login.password')}
              value={password}
              onChangeText={(pw) => {
                setPassword(pw);
                setEntries((list) =>
                  list.map((e) => (e.status.state === 'failed' ? { ...e, status: { state: 'idle' } } : e)),
                );
              }}
              hint={t('routers:login.passwordHint')}
              secret
              returnKeyType="go"
              onSubmitEditing={() => void connect()}
              testID="login-password"
            />
          ) : null}
          {shared && passwordSources.length ? (
            <GlassButton
              label={t('routers:group.usePassword')}
              icon="key"
              compact
              onPress={() => setPickingPassword(true)}
              testID="login-use-password"
            />
          ) : null}
        </GlassCard>

        <ListSection footer={t('routers:login.savePasswordHint')}>
          <ListRow
            title={t('routers:login.savePassword')}
            icon="lock"
            switchValue={savePassword}
            onSwitch={setSavePassword}
          />
        </ListSection>

        {anyHttp ? <Banner tone="warning" text={t('routers:login.httpWarning')} /> : null}

        <GlassButton
          label={multi ? t('routers:login.connectAll') : t('routers:login.connect')}
          variant="primary"
          loading={busy}
          disabled={busy || (manual ? !address.trim() : entries.length === 0)}
          onPress={() => void connect()}
          testID="login-connect"
        />
      </Screen>
      {trust.sheet}
      <ActionSheet
        visible={pickingPassword}
        title={t('routers:group.usePassword')}
        actions={passwordSources.map((r) => ({
          label: r.name,
          icon: 'router',
          onPress: () => void fillPassword(r.id),
        }))}
        onCancel={() => setPickingPassword(false)}
      />
      <ActionSheet
        visible={suggestions.length > 0}
        title={t('routers:group.suggestTitle')}
        message={
          suggestions[0]
            ? t('routers:group.suggestMessage', {
                name: suggestions[0].profile.name,
                gateway: suggestions[0].gateway.name,
              })
            : undefined
        }
        actions={[{ label: t('routers:group.suggestJoin'), icon: 'accessPoint', onPress: () => void decide(true) }]}
        onCancel={() => void decide(false)}
      />
    </>
  );
}

function EntryStatusLine({ status }: { status: EntryStatus }) {
  const t = useT();
  const { colors } = useTheme();
  if (status.state === 'idle') return null;
  if (status.state === 'connecting') {
    return (
      <View style={styles.status}>
        <ActivityIndicator size="small" color={colors.textSecondary} />
        <AppText variant="footnote" tone="secondary">
          {t('routers:login.connecting')}
        </AppText>
      </View>
    );
  }
  if (status.state === 'ok') {
    return (
      <View style={styles.status}>
        <Icon name="check" size={16} color={colors.success} />
        <AppText variant="footnote" tone="success">
          {t('routers:login.connected', { model: status.outcome.model ?? 'OpenWrt' })}
        </AppText>
      </View>
    );
  }
  const { title, detail } = describeFailure(t, status.failure);
  return (
    <View style={styles.status}>
      <Icon name="error" size={16} color={colors.danger} />
      <AppText variant="footnote" tone="danger" style={styles.flex}>
        {detail ? `${title}\n${detail}` : title}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  same: { gap: spacing.s },
  status: { flexDirection: 'row', alignItems: 'center', gap: spacing.s },
});
