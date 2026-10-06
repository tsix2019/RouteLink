import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useActiveRouter } from '@/features/routers/ActiveRouterProvider';
import { DARK_THEME, LIGHT_THEME } from '@/features/terminal/html';
import { KeyBar } from '@/features/terminal/KeyBar';
import { withCtrl } from '@/features/terminal/keys';
import { TerminalView, type TerminalHandle } from '@/features/terminal/TerminalView';
import { sshTarget, useTerminalSession, type SessionState } from '@/features/terminal/useTerminalSession';
import { useT, type AppT } from '@/i18n';
import { useSettings } from '@/state/settings';
import { AppText } from '@/ui/AppText';
import { GlassButton } from '@/ui/GlassButton';
import { GlassSurface } from '@/ui/glass/GlassSurface';
import { Icon, type IconName } from '@/ui/Icon';
import { PromptSheet } from '@/ui/PromptSheet';
import { StatusDot } from '@/ui/Status';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { MONO_FONT, spacing } from '@/ui/theme/tokens';
import { useToast } from '@/ui/Toast';

const FONT_SIZES = [10, 11, 12, 13, 14, 16, 18, 20];

/** MO-12: an SSH shell on the active router, full screen above the tabs (design §17). */
export default function Terminal() {
  const t = useT();
  const nav = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { scheme, colors } = useTheme();
  const { router, connection } = useActiveRouter();
  const fontSize = useSettings((s) => s.terminalFontSize);
  const setSettings = useSettings((s) => s.set);
  const terminal = useRef<TerminalHandle>(null);
  const size = useRef({ cols: 80, rows: 24 });
  const [ctrl, setCtrl] = useState(false);
  const demo = connection?.kind === 'demo';
  const profile = router?.profile;
  const target = profile ? sshTarget(profile) : null;
  const session = useTerminalSession({
    routerId: profile?.id,
    demo,
    output: terminal,
    size,
    closedLine: t('terminal:closedLine'),
  });
  const state = session.state;
  const theme = scheme === 'dark' ? DARK_THEME : LIGHT_THEME;

  const changeFont = (step: 1 | -1) => {
    const i = FONT_SIZES.indexOf(fontSize);
    const next = FONT_SIZES[Math.min(FONT_SIZES.length - 1, Math.max(0, (i < 0 ? 2 : i) + step))];
    setSettings({ terminalFontSize: next });
    terminal.current?.setFontSize(next);
  };
  const paste = async () => {
    const text = await Clipboard.getStringAsync();
    if (text) terminal.current?.paste(text);
    else toast(t('terminal:clipboardEmpty'));
  };

  return (
    <View style={[styles.page, { backgroundColor: theme.background, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <BarButton icon="close" label={t('terminal:close')} onPress={() => nav.back()} testID="terminal-close" />
        <View style={styles.titleBox}>
          <AppText variant="headline" numberOfLines={1} style={{ color: theme.foreground }}>
            {router ? (router.isDemo ? t('demoRouter') : router.name) : t('terminal:title')}
          </AppText>
          <View style={styles.statusRow}>
            <StatusDot status={state.step === 'connected' ? 'online' : 'offline'} />
            <AppText variant="caption" numberOfLines={1} style={[styles.status, { color: colors.textSecondary }]}>
              {statusText(t, state, demo ? 'demo' : target ? `${target.user}@${target.host}` : '')}
            </AppText>
          </View>
        </View>
        <BarButton text="A−" label={t('terminal:fontSmaller')} onPress={() => changeFont(-1)} />
        <BarButton text="A+" label={t('terminal:fontLarger')} onPress={() => changeFont(1)} />
      </View>

      {/* Android draws edge to edge, so the window no longer shrinks for the keyboard: pad on both. */}
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        <View style={styles.flex}>
          <TerminalView
            ref={terminal}
            dark={scheme === 'dark'}
            fontSize={fontSize}
            onReady={(s) => {
              size.current = s;
              session.connect();
            }}
            onInput={(data) => {
              if (ctrl) setCtrl(false);
              session.send(ctrl ? withCtrl(data) : data);
            }}
            onResize={(s) => {
              size.current = s;
              session.resize(s.cols, s.rows);
            }}
            onCopy={(text) => {
              if (!text) return toast(t('terminal:nothingSelected'));
              void Clipboard.setStringAsync(text).then(() => toast(t('terminal:copied')));
            }}
            testID="terminal-view"
          />
          <StateOverlay
            state={state}
            port={target?.port ?? 22}
            onTrust={session.trustHostKey}
            onCancel={() => (state.step === 'confirm-host' ? nav.back() : session.cancel())}
            onReconnect={session.connect}
          />
        </View>
        <KeyBar
          ctrl={ctrl}
          onCtrl={setCtrl}
          onKey={(key) => terminal.current?.key(key)}
          onText={(text) => session.send(text)}
          onPaste={() => void paste()}
          onCopy={() => terminal.current?.copy()}
          pasteLabel={t('terminal:paste')}
          copyLabel={t('terminal:copy')}
        />
        <View style={{ height: Platform.OS === 'ios' ? 0 : insets.bottom, backgroundColor: colors.card }} />
      </KeyboardAvoidingView>

      <PromptSheet
        visible={state.step === 'password'}
        title={t('terminal:password.title')}
        hint={state.step === 'password' && state.refused ? t('terminal:password.refused') : t('terminal:password.hint')}
        confirmLabel={t('terminal:password.connect')}
        validate={(value) => (value ? undefined : t('terminal:password.required'))}
        onSubmit={session.usePassword}
        onCancel={session.cancel}
        inputProps={{ secret: true, autoCapitalize: 'none' }}
      />
    </View>
  );
}

function statusText(t: AppT, state: SessionState, who: string): string {
  switch (state.step) {
    case 'connected':
      return who === 'demo' ? t('terminal:demo') : who;
    case 'closed':
      return t('terminal:closed');
    default:
      return t('terminal:connecting');
  }
}

function BarButton({
  icon,
  text,
  label,
  onPress,
  testID,
}: {
  label: string;
  onPress: () => void;
  testID?: string;
} & ({ icon: IconName; text?: never } | { text: string; icon?: never })) {
  const { colors } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={6} testID={testID}>
      <GlassSurface variant="pill" style={styles.barButton}>
        {icon ? (
          <Icon name={icon} size={20} color={colors.text} />
        ) : (
          <AppText variant="subhead" style={{ color: colors.text }}>
            {text}
          </AppText>
        )}
      </GlassSurface>
    </Pressable>
  );
}

/** Connecting, host key confirmation and the disconnected state, over the terminal. */
function StateOverlay({
  state,
  port,
  onTrust,
  onCancel,
  onReconnect,
}: {
  state: SessionState;
  port: number;
  onTrust(key: Extract<SessionState, { step: 'confirm-host' }>['key']): void;
  onCancel(): void;
  onReconnect(): void;
}) {
  const t = useT();
  const { colors } = useTheme();
  if (state.step === 'connected' || state.step === 'password') return null;
  if (state.step === 'connecting') {
    return (
      <View style={styles.overlay} pointerEvents="none">
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }
  if (state.step === 'confirm-host') {
    const changed = !!state.previous;
    return (
      <View style={styles.overlay}>
        <GlassSurface variant="card" style={styles.card}>
          <View style={styles.cardTitle}>
            <Icon name={changed ? 'warning' : 'shield'} size={22} color={changed ? colors.danger : colors.accent} />
            <AppText variant="headline" style={styles.flexText}>
              {changed ? t('terminal:hostKey.changedTitle') : t('terminal:hostKey.title')}
            </AppText>
          </View>
          <AppText variant="footnote" tone="secondary">
            {changed ? t('terminal:hostKey.changedMessage') : t('terminal:hostKey.message')}
          </AppText>
          {changed ? <Fingerprint label={t('terminal:hostKey.previous')} value={state.previous ?? ''} strike /> : null}
          <Fingerprint label={state.key.type} value={state.key.fingerprint} />
          <GlassButton
            label={changed ? t('terminal:hostKey.trustChanged') : t('terminal:hostKey.trust')}
            variant={changed ? 'destructive' : 'primary'}
            onPress={() => onTrust(state.key)}
            testID="terminal-trust"
          />
          <GlassButton label={t('terminal:cancel')} onPress={onCancel} />
        </GlassSurface>
      </View>
    );
  }
  const message =
    state.code === 'SSH_AUTH_FAILED'
      ? t('terminal:error.keyRefused')
      : state.code === 'ERR_UNREACHABLE' || state.code === 'ERR_TIMEOUT'
        ? t('terminal:error.unreachable', { port })
        : state.error;
  return (
    <View style={styles.bottomOverlay}>
      <GlassSurface variant="card" style={styles.card}>
        {message ? (
          <AppText variant="footnote" tone="secondary">
            {message}
          </AppText>
        ) : null}
        <GlassButton label={t('terminal:reconnect')} icon="refresh" variant="primary" onPress={onReconnect} />
      </GlassSurface>
    </View>
  );
}

function Fingerprint({ label, value, strike }: { label: string; value: string; strike?: boolean }) {
  return (
    <View style={styles.fingerprint}>
      <AppText variant="caption" tone="secondary">
        {label}
      </AppText>
      <AppText
        variant="footnote"
        selectable
        style={[styles.mono, strike && styles.strike]}
        testID={strike ? undefined : 'terminal-fingerprint'}>
        {value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  flex: { flex: 1 },
  flexText: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s,
    paddingHorizontal: spacing.m,
    paddingVertical: spacing.s,
  },
  titleBox: { flex: 1, minWidth: 0 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  status: { flexShrink: 1 },
  barButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.l,
  },
  bottomOverlay: { position: 'absolute', left: spacing.l, right: spacing.l, bottom: spacing.l },
  card: { padding: spacing.l, gap: spacing.m, alignSelf: 'stretch' },
  cardTitle: { flexDirection: 'row', alignItems: 'center', gap: spacing.s },
  fingerprint: { gap: 2 },
  mono: { fontFamily: MONO_FONT },
  strike: { textDecorationLine: 'line-through' },
});
