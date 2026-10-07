import { useRouter } from 'expo-router';
import { useState } from 'react';

import { getTimeSettings, getTimezones, timezoneChanges, type Timezone } from '@/api/services/system-settings';
import { stageAndApply } from '@/api/uci';
import { filterZones } from '@/features/system/timezones';
import { useRouterMutation, useRouterQuery } from '@/hooks/router-queries';
import { useT } from '@/i18n';
import { describeError } from '@/ui/errorText';
import { EmptyState } from '@/ui/Feedback';
import { FormPlaceholder } from '@/ui/FormScreen';
import { Icon } from '@/ui/Icon';
import { ListRow, ListSection } from '@/ui/ListSection';
import { Screen } from '@/ui/Screen';
import { TextField } from '@/ui/TextField';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { useToast } from '@/ui/Toast';

/** MO-8: the router's time zone, searchable; picking one applies it right away. */
export default function TimezonePicker() {
  const t = useT();
  const toast = useToast();
  const nav = useRouter();
  const { colors } = useTheme();
  const time = useRouterQuery(['system-time'], (conn) => getTimeSettings(conn));
  const zones = useRouterQuery(['timezones'], getTimezones, { staleTime: Infinity });
  const [query, setQuery] = useState('');
  const change = useRouterMutation(
    (conn, z: Timezone) =>
      stageAndApply(conn, timezoneChanges(time.data?.section ?? '@system[0]', z), { mode: 'direct' }),
    [['system-time']],
  );
  const title = t('more:systemScreen.zone');

  if (!time.data || !zones.data) {
    return (
      <FormPlaceholder
        title={title}
        error={time.error ?? zones.error}
        onRetry={() => void Promise.all([time.refetch(), zones.refetch()])}
      />
    );
  }
  const current = time.data.zonename;
  const shown = filterZones(zones.data, query);
  const pick = (z: Timezone) => {
    if (z.zonename === current) return nav.back();
    change.mutate(z, {
      onSuccess: () => {
        toast(t('more:systemScreen.zoneDone'));
        nav.back();
      },
      onError: (e) => toast(describeError(t, e).title, 'error'),
    });
  };

  return (
    <Screen title={title}>
      <TextField
        value={query}
        onChangeText={setQuery}
        placeholder={t('more:systemScreen.zoneSearch')}
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="while-editing"
        testID="zone-search"
      />
      {shown.length ? (
        <ListSection>
          {shown.map((z) => (
            <ListRow
              key={z.zonename}
              title={z.zonename}
              subtitle={z.tz}
              right={z.zonename === current ? <Icon name="check" size={20} color={colors.accent} /> : undefined}
              disabled={change.isPending}
              onPress={() => pick(z)}
              testID={`zone-${z.zonename}`}
            />
          ))}
        </ListSection>
      ) : (
        <EmptyState icon="globe" title={t('more:systemScreen.zoneNone')} />
      )}
    </Screen>
  );
}
