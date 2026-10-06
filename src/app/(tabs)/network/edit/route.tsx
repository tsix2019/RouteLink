import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet } from 'react-native';

import type { NetInterface } from '@/api/services/network';
import {
  deleteStaticRoute,
  getRoutes,
  saveStaticRoute,
  validateStaticRoute,
  type Family,
  type StaticRoute,
  type StaticRouteInput,
} from '@/api/services/routes';
import type { ApplyOutcome } from '@/api/uci';
import { useInterfaces, useRouterMutation, useRouterQuery } from '@/hooks/router-queries';
import { useT } from '@/i18n';
import { AppText } from '@/ui/AppText';
import { describeError } from '@/ui/errorText';
import { differs, FormPlaceholder, FormScreen, useFormExit, useLoaded } from '@/ui/FormScreen';
import { GlassCard } from '@/ui/GlassCard';
import { ListRow, ListSection } from '@/ui/ListSection';
import { RiskConfirm } from '@/ui/RiskConfirm';
import { Segmented } from '@/ui/Segmented';
import { SelectSheet } from '@/ui/SelectSheet';
import { TextField } from '@/ui/TextField';
import { spacing } from '@/ui/theme/tokens';
import { useToast } from '@/ui/Toast';

/** NW-4: add a static route (`?family=4|6`), or edit `?section=`. */
export default function EditRoute() {
  const t = useT();
  const params = useLocalSearchParams<{ section?: string; family?: string }>();
  const routes = useRouterQuery(['routes'], getRoutes);
  const interfaces = useInterfaces();
  const route = useLoaded(params.section ? routes.data?.statics.find((r) => r.section === params.section) : undefined);
  const title = params.section ? t('network:routes.edit') : t('network:routes.add');
  if (!routes.data || !interfaces.data || (params.section && !route)) {
    return (
      <FormPlaceholder
        title={title}
        error={routes.error ?? interfaces.error}
        onRetry={() => void Promise.all([routes.refetch(), interfaces.refetch()])}
        missing={!!routes.data && !!params.section && !route}
      />
    );
  }
  return (
    <RouteForm
      title={title}
      route={route}
      family={params.family === '6' ? 6 : 4}
      interfaces={interfaces.data.filter((i) => i.name !== 'loopback')}
    />
  );
}

function RouteForm({
  title,
  route,
  family,
  interfaces,
}: {
  title: string;
  route?: StaticRoute;
  family: Family;
  interfaces: NetInterface[];
}) {
  const t = useT();
  const toast = useToast();
  const exit = useFormExit();
  const [initial] = useState<StaticRouteInput>(() => ({
    family: route?.family ?? family,
    interface: route?.interface ?? interfaces.find((i) => i.name === 'lan')?.name ?? '',
    target: route?.target ?? '',
    gateway: route?.gateway ?? '',
    metric: route?.metric ?? '',
    table: route?.table ?? '',
  }));
  const [input, setInput] = useState(initial);
  const [errors, setErrors] = useState<ReturnType<typeof validateStaticRoute>>({});
  const [picking, setPicking] = useState(false);
  const [pending, setPending] = useState<'save' | 'delete' | null>(null);
  const save = useRouterMutation((conn) => saveStaticRoute(conn, input, route), [['routes']]);
  const remove = useRouterMutation((conn, r: StaticRoute) => deleteStaticRoute(conn, r), [['routes']]);

  const set = (patch: Partial<StaticRouteInput>) => {
    setInput((v) => ({ ...v, ...patch }));
    setErrors({});
  };
  const errorText = (key: keyof StaticRouteInput) =>
    errors[key] ? t(`network:routes.error.${errors[key]}`) : undefined;

  const submit = () => {
    const found = validateStaticRoute(
      input,
      interfaces.find((i) => i.name === input.interface),
    );
    setErrors(found);
    if (!Object.keys(found).length) setPending('save');
  };
  const done = {
    onSuccess: (outcome: ApplyOutcome) => {
      if (outcome.status === 'rolled-back') {
        toast(t('network:result.rolledBack'), 'warning');
        return;
      }
      toast(t('network:result.applied'));
      exit.back();
    },
    onError: (e: unknown) => toast(describeError(t, e).title, 'error'),
  };
  const run = () => {
    const kind = pending;
    setPending(null);
    if (kind === 'delete' && route) remove.mutate(route, done);
    else save.mutate(undefined, done);
  };

  return (
    <>
      <FormScreen
        title={title}
        dirty={differs(input, initial)}
        leaving={exit.leaving}
        onSave={submit}
        saving={save.isPending || remove.isPending}
        onDelete={route ? () => setPending('delete') : undefined}
        deleteLabel={t('network:routes.delete')}
        testID="route-form">
        {route ? null : (
          <Segmented
            values={['IPv4', 'IPv6']}
            selectedIndex={input.family === 4 ? 0 : 1}
            onChange={(e) => set({ family: e.nativeEvent.selectedSegmentIndex === 0 ? 4 : 6 })}
          />
        )}
        <ListSection>
          <ListRow
            title={t('network:routes.interface')}
            value={input.interface || undefined}
            chevron
            onPress={() => setPicking(true)}
            testID="route-interface"
          />
        </ListSection>
        {errorText('interface') ? (
          <AppText variant="footnote" tone="danger">
            {errorText('interface')}
          </AppText>
        ) : null}
        <GlassCard contentStyle={styles.card}>
          <TextField
            label={t('network:routes.target')}
            value={input.target}
            onChangeText={(v) => set({ target: v })}
            placeholder={input.family === 4 ? '10.10.0.0/16' : 'fd00:10::/64'}
            hint={t('network:routes.targetHint')}
            autoCapitalize="none"
            autoCorrect={false}
            monospace
            error={errorText('target')}
            testID="route-target"
          />
          <TextField
            label={t('network:routes.gateway')}
            value={input.gateway}
            onChangeText={(v) => set({ gateway: v })}
            placeholder={t('network:routes.optional')}
            hint={t('network:routes.gatewayHint')}
            autoCapitalize="none"
            autoCorrect={false}
            monospace
            error={errorText('gateway')}
            testID="route-gateway"
          />
        </GlassCard>
        <GlassCard contentStyle={styles.card}>
          <TextField
            label={t('network:routes.metricLabel')}
            value={input.metric}
            onChangeText={(v) => set({ metric: v })}
            placeholder={t('network:routes.optional')}
            keyboardType="number-pad"
            error={errorText('metric')}
          />
          <TextField
            label={t('network:routes.tableLabel')}
            value={input.table}
            onChangeText={(v) => set({ table: v })}
            placeholder="main"
            autoCapitalize="none"
            autoCorrect={false}
            error={errorText('table')}
          />
        </GlassCard>
      </FormScreen>

      <SelectSheet
        visible={picking}
        title={t('network:routes.interface')}
        options={interfaces.map((i) => ({ value: i.name, label: i.name, detail: i.device }))}
        value={input.interface}
        onSelect={(v) => {
          set({ interface: v });
          setPicking(false);
        }}
        onCancel={() => setPicking(false)}
      />
      <RiskConfirm
        visible={!!pending}
        level="medium"
        disruptive
        title={
          pending === 'delete' && route
            ? t('network:routes.deleteTitle', { target: route.target })
            : t('network:routes.saveTitle')
        }
        consequences={[t('network:routes.consequence')]}
        confirmLabel={pending === 'delete' ? t('network:routes.delete') : t('save')}
        onConfirm={run}
        onCancel={() => setPending(null)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.m },
});
