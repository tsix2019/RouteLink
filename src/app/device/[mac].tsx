import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ActionError } from '@/api/services/action-error';
import { staticIpChanges } from '@/api/services/client-actions';
import type { Client } from '@/api/services/clients';
import { deviceIcon } from '@/features/devices/deviceIcon';
import { useDeviceActions } from '@/features/devices/useDeviceActions';
import { useClients } from '@/hooks/router-queries';
import { useLang, useT } from '@/i18n';
import { useSettings } from '@/state/settings';
import { AppText } from '@/ui/AppText';
import { describeError } from '@/ui/errorText';
import { EmptyState } from '@/ui/Feedback';
import { GlassCard } from '@/ui/GlassCard';
import { Icon } from '@/ui/Icon';
import { InfoGrid } from '@/ui/InfoGrid';
import { ListRow, ListSection } from '@/ui/ListSection';
import { PromptSheet } from '@/ui/PromptSheet';
import { RiskConfirm } from '@/ui/RiskConfirm';
import { Screen } from '@/ui/Screen';
import { SheetScreen } from '@/ui/SheetScreen';
import { Badge, SignalBars, StatusDot } from '@/ui/Status';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { spacing } from '@/ui/theme/tokens';
import { useToast } from '@/ui/Toast';
import { formatDuration } from '@/utils/format';

type Dialog = null | 'rename' | 'static' | 'release' | 'kick' | 'block' | 'unblock';

/** Device sheet: everything known about one client plus its actions. */
export default function DeviceDetail() {
  const { mac: raw } = useLocalSearchParams<{ mac: string }>();
  const mac = decodeURIComponent(raw ?? '');
  const t = useT();
  const clients = useClients();
  const client = clients.data?.find((c) => c.mac === mac);
  return (
    <SheetScreen>
      {client ? (
        <DeviceContent client={client} clients={clients.data ?? []} />
      ) : (
        <Screen inTabs={false}>
          <EmptyState icon="unknownDevice" title={clients.isLoading ? t('loading') : t('devices:detail.notFound')} />
        </Screen>
      )}
    </SheetScreen>
  );
}

function DeviceContent({ client, clients }: { client: Client; clients: Client[] }) {
  const t = useT();
  const lang = useLang();
  const toast = useToast();
  const { colors } = useTheme();
  const actions = useDeviceActions();
  const addWol = useSettings((s) => s.addWol);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [ban, setBan] = useState(false);
  const close = () => setDialog(null);
  const vendor = client.vendor ?? (client.randomizedMac ? t('devices:privateAddress') : undefined);
  const wifi = client.wifi;
  const copy = (value: string) => {
    void Clipboard.setStringAsync(value);
    toast(t('copied'));
  };

  return (
    <Screen inTabs={false}>
      <View style={styles.header}>
        <View
          style={[
            styles.avatar,
            {
              backgroundColor: client.online ? colors.accent : colors.separator,
            },
          ]}>
          <Icon name={deviceIcon(client)} size={30} color={client.online ? colors.accentText : colors.textSecondary} />
        </View>
        <View style={styles.headerText}>
          <AppText variant="title" numberOfLines={2}>
            {client.name}
          </AppText>
          <View style={styles.statusRow}>
            <StatusDot status={client.online ? 'online' : 'offline'} />
            <AppText variant="subhead" tone="secondary">
              {`${client.online ? t('online') : t('offline')} · ${wifi ? `${wifi.ssid} ${wifi.band}` : t('devices:detail.wired')}`}
            </AppText>
            {wifi && client.online ? <SignalBars dbm={wifi.signal} size={14} /> : null}
            {client.isStatic ? <Badge label={t('devices:badge.static')} tone="accent" /> : null}
            {client.isBlocked ? <Badge label={t('devices:badge.blocked')} tone="danger" /> : null}
          </View>
        </View>
      </View>

      <GlassCard>
        <InfoGrid
          items={[
            {
              label: t('devices:detail.ip'),
              value: client.ipv4,
              selectable: true,
            },
            {
              label: t('devices:detail.mac'),
              value: client.mac,
              selectable: true,
            },
            { label: t('devices:detail.vendor'), value: vendor },
            { label: t('devices:detail.hostname'), value: client.hostname },
            { label: t('devices:detail.staticIp'), value: client.staticIp },
            {
              label: t('devices:detail.signal'),
              value: wifi && client.online ? `${wifi.signal} dBm` : undefined,
            },
            {
              label: t('devices:detail.rates'),
              value: wifi?.rxRate
                ? `${(wifi.rxRate / 1000).toFixed(0)} / ${((wifi.txRate ?? 0) / 1000).toFixed(0)} Mbps`
                : undefined,
            },
            {
              label: t('devices:detail.connectedFor'),
              value: wifi?.connectedSec ? formatDuration(wifi.connectedSec, lang) : undefined,
            },
            {
              label: t('devices:detail.lease'),
              value: client.leaseExpiresSec ? formatDuration(client.leaseExpiresSec, lang) : undefined,
            },
            {
              label: t('devices:detail.ipv6'),
              value: client.ipv6[0],
              wide: true,
              selectable: true,
            },
          ]}
        />
      </GlassCard>

      <ListSection title={t('devices:actions.title')}>
        <ListRow
          icon="edit"
          title={t('devices:actions.rename')}
          chevron
          onPress={() => setDialog('rename')}
          disabled={actions.busy}
        />
        <ListRow
          icon="pin"
          title={client.isStatic ? t('devices:actions.staticIpEdit') : t('devices:actions.staticIp')}
          value={client.staticIp}
          chevron
          onPress={() => setDialog('static')}
          disabled={actions.busy}
        />
        {client.isStatic ? (
          <ListRow
            icon="pin"
            title={t('devices:actions.removeStaticIp')}
            onPress={() => setDialog('release')}
            disabled={actions.busy}
          />
        ) : null}
        {wifi && client.online ? (
          <ListRow
            icon="kick"
            title={t('devices:actions.kick')}
            onPress={() => setDialog('kick')}
            disabled={actions.busy}
          />
        ) : null}
        {client.isBlocked ? (
          <ListRow
            icon="block"
            title={t('devices:actions.unblock')}
            onPress={() => setDialog('unblock')}
            disabled={actions.busy}
          />
        ) : (
          <ListRow
            icon="block"
            title={t('devices:actions.block')}
            destructive
            onPress={() => setDialog('block')}
            disabled={actions.busy}
          />
        )}
        {!client.online || client.connection !== 'wifi' ? (
          <ListRow
            icon="bolt"
            title={t('devices:actions.wake')}
            onPress={() => actions.wake(client.mac)}
            disabled={actions.busy}
          />
        ) : null}
        <ListRow
          icon="plus"
          title={t('devices:actions.addToWol')}
          onPress={() => {
            addWol({ name: client.name, mac: client.mac });
            toast(t('devices:result.applied'));
          }}
        />
        {client.ipv4 ? (
          <ListRow icon="copy" title={t('devices:actions.copyIp')} onPress={() => copy(client.ipv4!)} />
        ) : null}
        <ListRow icon="copy" title={t('devices:actions.copyMac')} onPress={() => copy(client.mac)} />
      </ListSection>

      <PromptSheet
        visible={dialog === 'rename'}
        title={t('devices:actions.rename')}
        initialValue={client.alias ?? client.hostname ?? ''}
        placeholder={t('devices:actions.renamePrompt')}
        hint={t('devices:actions.renameHint')}
        confirmLabel={t('save')}
        validate={(v) =>
          v.trim()
            ? v.trim().length > 64
              ? t('errors:action.name-too-long')
              : undefined
            : t('errors:action.name-empty')
        }
        onCancel={close}
        onSubmit={(name) => {
          close();
          actions.rename(client, name);
        }}
      />
      <PromptSheet
        visible={dialog === 'static'}
        title={client.isStatic ? t('devices:actions.staticIpEdit') : t('devices:actions.staticIp')}
        initialValue={client.staticIp ?? client.ipv4 ?? ''}
        placeholder="192.168.1.100"
        hint={`${t('devices:confirm.staticConsequence')} ${t('devices:confirm.applyConsequence')}`}
        confirmLabel={t('save')}
        inputProps={{
          keyboardType: 'numbers-and-punctuation',
          monospace: true,
        }}
        validate={(ip) => {
          try {
            staticIpChanges(client, ip, clients);
            return undefined;
          } catch (e) {
            return e instanceof ActionError ? describeError(t, e).title : String(e);
          }
        }}
        onCancel={close}
        onSubmit={(ip) => {
          close();
          actions.reserve(client, ip.trim(), clients);
        }}
      />
      <RiskConfirm
        visible={dialog === 'release'}
        level="medium"
        title={t('devices:actions.removeStaticIp')}
        consequences={[t('devices:confirm.staticConsequence'), t('devices:confirm.applyConsequence')]}
        confirmLabel={t('common:confirm')}
        onCancel={close}
        onConfirm={() => {
          close();
          actions.release(client);
        }}
      />
      <RiskConfirm
        visible={dialog === 'kick'}
        level="medium"
        disruptive
        title={t('devices:confirm.kickTitle', { name: client.name })}
        consequences={[t('devices:confirm.kickConsequence'), ...(ban ? [t('devices:confirm.kickBanConsequence')] : [])]}
        confirmLabel={t('devices:actions.kick')}
        option={{
          label: t('devices:actions.kickBan'),
          value: ban,
          onChange: setBan,
        }}
        onCancel={close}
        onConfirm={() => {
          close();
          actions.kick(client, ban);
        }}
      />
      <RiskConfirm
        visible={dialog === 'block'}
        level="medium"
        disruptive
        title={t('devices:confirm.blockTitle', { name: client.name })}
        consequences={[t('devices:confirm.blockConsequence'), t('devices:confirm.applyConsequence')]}
        confirmLabel={t('devices:actions.block')}
        onCancel={close}
        onConfirm={() => {
          close();
          actions.block(client);
        }}
      />
      <RiskConfirm
        visible={dialog === 'unblock'}
        level="medium"
        title={t('devices:confirm.unblockTitle', { name: client.name })}
        consequences={[t('devices:confirm.unblockConsequence'), t('devices:confirm.applyConsequence')]}
        confirmLabel={t('devices:actions.unblock')}
        onCancel={close}
        onConfirm={() => {
          close();
          actions.unblock(client);
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.l,
    marginTop: spacing.s,
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: { flex: 1, gap: 4 },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
});
