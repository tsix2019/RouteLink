import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { getRadioCapabilities, radioChanges, type Radio, type RadioCapabilities } from '@/api/services/wireless';
import { bandLabel, widthLabel } from '@/features/wireless/labels';
import { useWirelessActions } from '@/features/wireless/useWirelessActions';
import { useRadios, useRouterQuery } from '@/hooks/router-queries';
import { useT } from '@/i18n';
import { ErrorState, Skeleton } from '@/ui/Feedback';
import { GlassButton } from '@/ui/GlassButton';
import { GlassCard } from '@/ui/GlassCard';
import { ListRow, ListSection } from '@/ui/ListSection';
import { RiskConfirm } from '@/ui/RiskConfirm';
import { Screen } from '@/ui/Screen';
import { SelectSheet, type SelectOption } from '@/ui/SelectSheet';
import { TextField } from '@/ui/TextField';
import { spacing } from '@/ui/theme/tokens';
import { useToast } from '@/ui/Toast';

const DEFAULT_POWER = 'default';

export default function RadioScreen() {
  const { name } = useLocalSearchParams<{ name: string }>();
  const radios = useRadios();
  const radio = radios.data?.find((r) => r.name === name);
  const caps = useRouterQuery(['radio-caps', name], (conn) => getRadioCapabilities(conn, name), {
    enabled: !!name,
    staleTime: 60_000,
  });

  if (radio) return <RadioForm radio={radio} caps={caps.data} />;
  return (
    <Screen title={name} inTabs>
      {radios.isError ? (
        <ErrorState error={radios.error} onRetry={() => void radios.refetch()} />
      ) : (
        <View style={styles.loading}>
          <Skeleton height={52} radius={14} />
          <Skeleton height={160} radius={22} />
        </View>
      )}
    </Screen>
  );
}

type Picker = 'channel' | 'width' | 'power' | null;

function RadioForm({ radio, caps }: { radio: Radio; caps?: RadioCapabilities }) {
  const t = useT();
  const nav = useRouter();
  const toast = useToast();
  const actions = useWirelessActions();
  const [enabled, setEnabled] = useState(!radio.disabled);
  const [channel, setChannel] = useState(radio.channel);
  const [htmode, setHtmode] = useState(radio.htmode ?? '');
  const [power, setPower] = useState(radio.txpower !== undefined ? String(radio.txpower) : DEFAULT_POWER);
  const [country, setCountry] = useState(radio.country ?? '');
  const [picker, setPicker] = useState<Picker>(null);
  const [confirming, setConfirming] = useState(false);

  const countryValid = country === '' || /^[A-Z]{2}$/.test(country);
  const patch = {
    disabled: !enabled,
    channel,
    htmode: htmode || undefined,
    txpower: power === DEFAULT_POWER ? null : Number(power),
    country: country || undefined,
  };
  const changed = radioChanges(radio, patch).length > 0;

  const channelOptions: SelectOption<string>[] = [
    { value: 'auto', label: t('wireless:auto') },
    ...(caps?.channels.length
      ? caps.channels.map((c) => ({
          value: String(c.channel),
          label: String(c.channel),
          detail: [c.mhz ? `${c.mhz} MHz` : null, c.restricted ? t('wireless:radio.dfs') : null]
            .filter(Boolean)
            .join(' · '),
        }))
      : radio.channel !== 'auto'
        ? [{ value: radio.channel, label: radio.channel }]
        : []),
  ];
  const widthOptions: SelectOption<string>[] = (
    caps?.htmodes.length ? caps.htmodes : radio.htmode ? [radio.htmode] : []
  ).map((m) => ({ value: m, label: widthLabel(m), detail: m }));
  const powerOptions: SelectOption<string>[] = [
    { value: DEFAULT_POWER, label: t('wireless:default') },
    ...(caps?.txpowers ?? (radio.txpower !== undefined ? [radio.txpower] : [])).map((dbm) => ({
      value: String(dbm),
      label: `${dbm} dBm`,
      detail: `${Math.round(10 ** (dbm / 10))} mW`,
    })),
  ];

  return (
    <>
      <Screen title={`${bandLabel(t, radio.band)} · ${radio.name}`} inTabs>
        <ListSection>
          <ListRow title={t('wireless:radio.enabled')} icon="power" switchValue={enabled} onSwitch={setEnabled} />
        </ListSection>
        <ListSection>
          <ListRow
            title={t('wireless:radio.channel')}
            value={channel === 'auto' ? t('wireless:auto') : channel}
            chevron
            onPress={() => setPicker('channel')}
            testID="radio-channel"
          />
          <ListRow
            title={t('wireless:radio.width')}
            value={widthLabel(htmode || undefined)}
            chevron
            disabled={widthOptions.length === 0}
            onPress={() => setPicker('width')}
          />
          <ListRow
            title={t('wireless:radio.txpower')}
            value={power === DEFAULT_POWER ? t('wireless:default') : `${power} dBm`}
            chevron
            onPress={() => setPicker('power')}
          />
        </ListSection>
        <GlassCard>
          <TextField
            label={t('wireless:radio.country')}
            value={country}
            onChangeText={(v) => setCountry(v.toUpperCase().slice(0, 2))}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder="CN"
            hint={t('wireless:radio.countryHint')}
            error={countryValid ? undefined : t('wireless:radio.countryInvalid')}
          />
        </GlassCard>
        <GlassButton
          label={t('wireless:radio.save')}
          variant="primary"
          loading={actions.busy}
          disabled={actions.busy || !countryValid}
          onPress={() => (changed ? setConfirming(true) : toast(t('wireless:radio.noChanges'), 'info'))}
          testID="radio-save"
        />
      </Screen>

      <SelectSheet
        visible={picker === 'channel'}
        title={t('wireless:radio.channel')}
        options={channelOptions}
        value={channel}
        onSelect={(v) => {
          setChannel(v);
          setPicker(null);
        }}
        onCancel={() => setPicker(null)}
      />
      <SelectSheet
        visible={picker === 'width'}
        title={t('wireless:radio.width')}
        options={widthOptions}
        value={htmode}
        onSelect={(v) => {
          setHtmode(v);
          setPicker(null);
        }}
        onCancel={() => setPicker(null)}
      />
      <SelectSheet
        visible={picker === 'power'}
        title={t('wireless:radio.txpower')}
        options={powerOptions}
        value={power}
        onSelect={(v) => {
          setPower(v);
          setPicker(null);
        }}
        onCancel={() => setPicker(null)}
      />
      <RiskConfirm
        visible={confirming}
        level="medium"
        disruptive
        title={t('wireless:radio.confirmTitle')}
        consequences={[t('wireless:radio.consequenceRestart'), t('wireless:radio.consequenceRollback')]}
        confirmLabel={t('common:confirm')}
        onConfirm={() => {
          setConfirming(false);
          actions.applyRadio(radio, patch, () => nav.back());
        }}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  loading: { gap: spacing.m },
});
