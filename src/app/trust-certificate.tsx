import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { useActiveRouter } from '@/features/routers/ActiveRouterProvider';
import { nativeFetchCertificate, type TrustRequest } from '@/features/routers/trust';
import { CertificateDetails } from '@/features/routers/TrustSheet';
import { useT } from '@/i18n';
import { useRouters } from '@/state/routers';
import { ErrorState, Skeleton } from '@/ui/Feedback';
import { GlassButton } from '@/ui/GlassButton';
import { Screen } from '@/ui/Screen';
import { SheetScreen } from '@/ui/SheetScreen';
import { spacing } from '@/ui/theme/tokens';
import { useToast } from '@/ui/Toast';

/**
 * Opened from the connection banner when the active router's certificate is untrusted or no longer
 * matches the pinned one. Trusting pins the certificate the router presents now.
 */
export default function TrustCertificate() {
  const t = useT();
  const nav = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { router } = useActiveRouter();
  const update = useRouters((s) => s.update);
  const profile = router?.profile;

  const certificate = useQuery({
    queryKey: ['certificate', profile?.baseUrl],
    queryFn: () => nativeFetchCertificate(profile!.baseUrl),
    enabled: !!profile,
    staleTime: 0,
    gcTime: 0,
  });

  const request: TrustRequest | null =
    profile && certificate.data
      ? profile.tlsSha256 && profile.tlsSha256 !== certificate.data.sha256.toLowerCase()
        ? {
            kind: 'changed',
            baseUrl: profile.baseUrl,
            certificate: certificate.data,
            previousSha256: profile.tlsSha256,
          }
        : { kind: 'new', baseUrl: profile.baseUrl, certificate: certificate.data }
      : null;

  const accept = async () => {
    if (!profile || !certificate.data) return;
    await update(profile.id, { tlsSha256: certificate.data.sha256.toLowerCase() });
    await queryClient.invalidateQueries({ queryKey: [profile.id] });
    toast(t('routers:trust.trusted'));
    nav.back();
  };

  return (
    <SheetScreen detent={0.8}>
      <Screen inTabs={false}>
        {request ? (
          <>
            <CertificateDetails request={request} />
            <View style={styles.actions}>
              <GlassButton
                label={t(request.kind === 'changed' ? 'routers:trust.trustNew' : 'routers:trust.trust')}
                variant={request.kind === 'changed' ? 'warning' : 'primary'}
                onPress={() => void accept()}
                testID="trust-accept"
              />
              <GlassButton label={t('cancel')} onPress={() => nav.back()} />
            </View>
          </>
        ) : certificate.isError ? (
          <ErrorState error={certificate.error} onRetry={() => void certificate.refetch()} />
        ) : (
          <View style={styles.actions}>
            <Skeleton height={28} width="70%" />
            <Skeleton height={64} />
            <Skeleton height={120} />
          </View>
        )}
      </Screen>
    </SheetScreen>
  );
}

const styles = StyleSheet.create({
  actions: { gap: spacing.s },
});
