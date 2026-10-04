import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import type { Client } from '@/api/services/clients';
import { useT } from '@/i18n';
import { Icon } from '@/ui/Icon';
import { ListRow } from '@/ui/ListSection';
import { Badge, SignalBars, StatusDot } from '@/ui/Status';
import { useTheme } from '@/ui/theme/ThemeProvider';

import { deviceIcon } from './deviceIcon';

export const deviceHref = (mac: string) => `/device/${encodeURIComponent(mac)}` as const;

export function DeviceRow({ client }: { client: Client }) {
  const t = useT();
  const router = useRouter();
  const { colors } = useTheme();
  const vendor = client.vendor ?? (client.randomizedMac ? t('devices:privateAddress') : undefined);
  return (
    <ListRow
      title={client.name}
      subtitle={[client.ipv4 ?? '—', vendor].filter(Boolean).join(' · ')}
      left={
        <View style={[styles.icon, { backgroundColor: client.online ? colors.accent : colors.separator }]}>
          <Icon name={deviceIcon(client)} size={18} color={client.online ? colors.accentText : colors.textSecondary} />
        </View>
      }
      right={
        <View style={styles.right}>
          {client.isBlocked ? <Badge label={t('devices:badge.blocked')} tone="danger" /> : null}
          {client.isStatic ? <Badge label={t('devices:badge.static')} tone="accent" /> : null}
          {client.wifi && client.online ? <SignalBars dbm={client.wifi.signal} /> : null}
          <StatusDot status={client.online ? 'online' : 'offline'} />
        </View>
      }
      chevron
      onPress={() => router.push(deviceHref(client.mac))}
      testID={`device-${client.mac}`}
    />
  );
}

const styles = StyleSheet.create({
  icon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  right: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});
