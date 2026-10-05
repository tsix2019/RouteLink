import { useCallback, useState, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useLang, useT } from '@/i18n';
import { AppText } from '@/ui/AppText';
import { GlassButton } from '@/ui/GlassButton';
import { GlassSurface } from '@/ui/glass/GlassSurface';
import { Icon } from '@/ui/Icon';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { spacing } from '@/ui/theme/tokens';
import type { Lang } from '@/utils/format';
import { formatDate } from '@/utils/dates';

import { formatFingerprint, type TrustRequest } from './trust';
import { NoBlurTarget } from '@/ui/glass/BlurTarget';

const date = (iso: string, lang: Lang) => {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? formatDate(Math.floor(ms / 1000), lang) : '—';
};

/** Certificate facts the user compares against the router before trusting it. */
export function CertificateDetails({ request }: { request: TrustRequest }) {
  const t = useT();
  const lang = useLang();
  const { colors } = useTheme();
  const changed = request.kind === 'changed';
  const c = request.certificate;
  return (
    <View style={styles.details}>
      <View style={styles.titleRow}>
        <Icon name={changed ? 'warning' : 'shield'} size={26} color={changed ? colors.danger : colors.accent} />
        <AppText variant="title" style={styles.flex}>
          {t(changed ? 'routers:trust.changedTitle' : 'routers:trust.newTitle')}
        </AppText>
      </View>
      <AppText variant="subhead" tone="secondary">
        {t(changed ? 'routers:trust.changedBody' : 'routers:trust.newBody')}
      </AppText>
      <AppText variant="footnote" tone="secondary" selectable>
        {request.baseUrl}
      </AppText>
      <Fact label={t('routers:trust.subject')}>{c.subject || '—'}</Fact>
      <Fact label={t('routers:trust.issuer')}>{c.issuer || '—'}</Fact>
      <Fact label={t('routers:trust.validity')}>{`${date(c.notBefore, lang)} – ${date(c.notAfter, lang)}`}</Fact>
      {changed ? (
        <>
          <Fact label={t('routers:trust.previous')} mono>
            {formatFingerprint(request.previousSha256)}
          </Fact>
          <Fact label={t('routers:trust.current')} mono>
            {formatFingerprint(c.sha256)}
          </Fact>
        </>
      ) : (
        <Fact label={t('routers:trust.fingerprint')} mono>
          {formatFingerprint(c.sha256)}
        </Fact>
      )}
    </View>
  );
}

function Fact({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <View style={styles.fact}>
      <AppText variant="caption" tone="secondary">
        {label}
      </AppText>
      <AppText variant={mono ? 'mono' : 'subhead'} selectable>
        {children}
      </AppText>
    </View>
  );
}

/** Bottom sheet asking whether to trust a router's certificate. */
export function TrustSheet({ request, onDecide }: { request: TrustRequest; onDecide(trust: boolean): void }) {
  const t = useT();
  const insets = useSafeAreaInsets();
  return (
    <Modal transparent animationType="slide" onRequestClose={() => onDecide(false)} statusBarTranslucent>
      <NoBlurTarget>
        <Pressable style={styles.scrim} onPress={() => onDecide(false)} accessibilityLabel={t('cancel')} />
        <View style={[styles.wrap, { paddingBottom: insets.bottom + spacing.m, maxHeight: '88%' }]}>
          <GlassSurface variant="floating" style={[styles.sheet, styles.shrink]}>
            <ScrollView style={styles.shrink} contentContainerStyle={styles.scroll}>
              <CertificateDetails request={request} />
            </ScrollView>
            <GlassButton
              label={t(request.kind === 'changed' ? 'routers:trust.trustNew' : 'routers:trust.trust')}
              variant={request.kind === 'changed' ? 'warning' : 'primary'}
              onPress={() => onDecide(true)}
              testID="trust-accept"
            />
            <GlassButton label={t('cancel')} onPress={() => onDecide(false)} testID="trust-cancel" />
          </GlassSurface>
        </View>
      </NoBlurTarget>
    </Modal>
  );
}

/** `ask(request)` shows a TrustSheet and resolves with the user's answer; render `sheet` once. */
export function useTrustPrompt() {
  const [pending, setPending] = useState<{ request: TrustRequest; resolve(trust: boolean): void } | null>(null);
  const ask = useCallback(
    (request: TrustRequest) => new Promise<boolean>((resolve) => setPending({ request, resolve })),
    [],
  );
  const sheet = pending ? (
    <TrustSheet
      request={pending.request}
      onDecide={(trust) => {
        pending.resolve(trust);
        setPending(null);
      }}
    />
  ) : null;
  return { ask, sheet };
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.35)' },
  wrap: { position: 'absolute', left: spacing.m, right: spacing.m, bottom: 0 },
  sheet: { padding: spacing.xl, gap: spacing.m },
  scroll: { paddingBottom: spacing.s },
  shrink: { flexShrink: 1 },
  details: { gap: spacing.m },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.s },
  fact: { gap: 2 },
});
