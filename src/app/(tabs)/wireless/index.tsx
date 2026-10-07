import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import type { Client } from '@/api/services/clients';
import type { Radio } from '@/api/services/wireless';
import { ConnectionBanner } from '@/features/routers/ConnectionBanner';
import { RouterSwitcherCapsule } from '@/features/routers/RouterSwitcherCapsule';
import { bandLabel, channelLabel, encryptionLabel, widthLabel } from '@/features/wireless/labels';
import { getWifiSchedules } from '@/api/services/wifi-schedule';
import { useActiveRouter } from '@/features/routers/ActiveRouterProvider';
import { useClients, useGroupRadios, useRouterQuery, type GroupRadios } from '@/hooks/router-queries';
import { useT } from '@/i18n';
import { EmptyState, ErrorState, Skeleton } from '@/ui/Feedback';
import { ListRow, ListSection } from '@/ui/ListSection';
import { HeaderButton, Screen } from '@/ui/Screen';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { spacing } from '@/ui/theme/tokens';

/**
 * Wi-Fi tab: one grouped section per radio — its settings row, then its networks. In a network group
 * (NG-4) the gateway's radios come first, then each access point's under its name.
 */
export default function Wireless() {
  const t = useT();
  const nav = useRouter();
  const { router: active } = useActiveRouter();
  const groups = useGroupRadios();
  const radios = groups[0];
  const members = groups.slice(1);
  const clients = useClients();
  const schedules = useRouterQuery(['wifi-schedule'], getWifiSchedules);
  const hasRadios = !!radios.radios?.length || members.length > 0;
  const grouped = members.length > 0;

  return (
    <Screen
      title={t('tabs.wireless')}
      headerLeft={<RouterSwitcherCapsule />}
      headerRight={
        hasRadios ? (
          <HeaderButton
            icon="scan"
            accessibilityLabel={t('wireless:scan')}
            onPress={() => nav.push('/wireless/scan')}
          />
        ) : undefined
      }
      onRefresh={() => groups.forEach((g) => g.refetch())}
      top={
        radios.radios ? (
          <ConnectionBanner error={radios.error} onRetry={radios.refetch} updatedAt={radios.updatedAt} />
        ) : null
      }>
      {radios.radios ? (
        hasRadios ? (
          <>
            {radios.radios.map((radio) => (
              <RadioSection
                key={radio.name}
                radio={radio}
                clients={clients.data ?? []}
                owner={grouped ? { id: active?.id ?? '', name: radios.name } : undefined}
              />
            ))}
            {members.map((m) => (
              <MemberSections key={m.routerId} member={m} clients={clients.data ?? []} />
            ))}
            <ListSection title={t('wireless:tools.section')}>
              <ListRow
                title={t('wireless:tools.signal')}
                icon="antenna"
                chevron
                onPress={() => nav.push('/wireless/tools/signal')}
                testID="wireless-signal"
              />
              <ListRow
                title={t('wireless:tools.channels')}
                icon="chart"
                chevron
                onPress={() => nav.push('/wireless/tools/channels')}
                testID="wireless-channels"
              />
              <ListRow
                title={t('wireless:tools.security')}
                icon="shield"
                chevron
                onPress={() => nav.push('/wireless/tools/security')}
                testID="wireless-security"
              />
            </ListSection>
            <ListSection title={t('wireless:guest.section')}>
              <ListRow
                title={t('wireless:guest.row')}
                icon="guest"
                chevron
                onPress={() => nav.push('/wireless/guest')}
                testID="wireless-guest"
              />
            </ListSection>
            <ListSection title={t('wireless:schedule.section')}>
              <ListRow
                title={t('wireless:schedule.row')}
                icon="moon"
                value={
                  schedules.data
                    ? schedules.data.schedules.length
                      ? t('wireless:schedule.count', { count: schedules.data.schedules.length })
                      : t('wireless:schedule.none')
                    : undefined
                }
                chevron
                onPress={() => nav.push('/wireless/schedule')}
                testID="wireless-schedule"
              />
            </ListSection>
          </>
        ) : (
          <EmptyState icon="wifiOff" title={t('wireless:noRadios')} message={t('wireless:noRadiosHint')} />
        )
      ) : radios.error ? (
        <ErrorState error={radios.error} onRetry={radios.refetch} />
      ) : (
        <View style={styles.loading}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={52} radius={14} />
          ))}
        </View>
      )}
    </Screen>
  );
}

/** An access point of the group: its radios, or why they can't be shown. */
function MemberSections({ member, clients }: { member: GroupRadios; clients: Client[] }) {
  const t = useT();
  const nav = useRouter();
  if (member.radios) {
    return (
      <>
        {member.radios.map((radio) => (
          <RadioSection
            key={radio.name}
            radio={radio}
            clients={clients}
            owner={{ id: member.routerId, name: member.name, ap: true }}
          />
        ))}
        {member.radios.length === 0 ? (
          <ListSection title={member.name}>
            <ListRow title={t('wireless:noRadios')} disabled />
          </ListSection>
        ) : null}
      </>
    );
  }
  return (
    <ListSection title={member.name}>
      {member.needsPassword ? (
        <ListRow
          title={t('wireless:group.needsPassword')}
          subtitle={t('wireless:group.needsPasswordHint')}
          icon="key"
          chevron
          onPress={() => nav.push(`/more/router/${encodeURIComponent(member.routerId)}`)}
          testID={`member-password-${member.routerId}`}
        />
      ) : member.error ? (
        <ListRow
          title={t('wireless:group.offline')}
          subtitle={t('wireless:group.offlineHint')}
          icon="warning"
          onPress={member.refetch}
        />
      ) : (
        <ListRow title={t('wireless:group.loading')} disabled />
      )}
    </ListSection>
  );
}

function RadioSection({
  radio,
  clients,
  owner,
}: {
  radio: Radio;
  clients: Client[];
  /** Set in a network group: the router the radio belongs to (`ap` for an access point). */
  owner?: { id: string; name: string; ap?: boolean };
}) {
  const t = useT();
  const nav = useRouter();
  const { colors } = useTheme();
  const status = radio.disabled ? t('wireless:off') : radio.up ? undefined : t('wireless:down');
  const routerParam = owner?.ap ? `?router=${encodeURIComponent(owner.id)}` : '';
  const prefix = owner?.ap ? `${owner.id}-` : '';
  const title = `${bandLabel(t, radio.band)} · ${radio.name}`;
  return (
    <ListSection title={owner ? `${owner.name} · ${title}` : title}>
      <ListRow
        title={t('wireless:radioSettings')}
        subtitle={[channelLabel(t, radio.channel), widthLabel(radio.htmode)].join(' · ')}
        value={status}
        icon="antenna"
        chevron
        onPress={() => nav.push(`/wireless/radio/${encodeURIComponent(radio.name)}${routerParam}`)}
        testID={`radio-${prefix}${radio.name}`}
      />
      {radio.networks.map((n) => {
        const count = clients.filter(
          (c) => c.online && c.wifi && c.wifi.ifname === n.ifname && (!owner || !c.ap || c.ap.routerId === owner.id),
        ).length;
        const details = [
          encryptionLabel(t, n.encryption),
          n.hidden ? t('wireless:hidden') : null,
          n.up ? t('wireless:clients', { count }) : n.disabled ? t('wireless:off') : t('wireless:down'),
        ].filter(Boolean);
        return (
          <ListRow
            key={n.section}
            title={n.ssid || n.section}
            subtitle={details.join(' · ')}
            icon={n.up ? 'wifi' : 'wifiOff'}
            iconColor={n.up ? colors.success : colors.textTertiary}
            chevron
            onPress={() => nav.push(`/wireless/network/${encodeURIComponent(n.section)}${routerParam}`)}
            testID={`wifi-${prefix}${n.section}`}
          />
        );
      })}
      {radio.networks.length === 0 ? <ListRow title={t('wireless:noNetworks')} disabled /> : null}
    </ListSection>
  );
}

const styles = StyleSheet.create({
  loading: { gap: spacing.s },
});
