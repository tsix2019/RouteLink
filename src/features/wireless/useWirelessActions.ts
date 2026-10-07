import { networkChanges, radioChanges, type Radio, type WifiNetwork } from '@/api/services/wireless';
import { stageAndApply, type ApplyMode, type ApplyOutcome } from '@/api/uci';
import { useMemberMutation } from '@/hooks/router-queries';
import { useActiveRouter } from '@/features/routers/ActiveRouterProvider';
import { useT } from '@/i18n';
import { describeError } from '@/ui/errorText';
import { useToast } from '@/ui/Toast';

type RadioPatch = Parameters<typeof radioChanges>[1];
type NetworkPatch = Parameters<typeof networkChanges>[1];

const RADIOS = [['radios']] as const;

/**
 * Wireless edits: staged as one uci change set and applied safely (rollback) unless told otherwise.
 * `routerId` picks a router of the active group (an AP); default is the active router.
 */
export function useWirelessActions(routerId?: string) {
  const { router } = useActiveRouter();
  const target = routerId || router?.id;
  const t = useT();
  const toast = useToast();

  const report = (outcome: ApplyOutcome) =>
    outcome.status === 'rolled-back'
      ? toast(t('wireless:result.rolledBack'), 'warning')
      : toast(t('wireless:result.applied'));
  const fail = (error: unknown) => toast(describeError(t, error).title, 'error');

  const radio = useMemberMutation(
    target,
    (conn, a: { radio: Radio; patch: RadioPatch }) =>
      stageAndApply(conn, radioChanges(a.radio, a.patch), { mode: 'rollback' }),
    RADIOS,
  );
  const network = useMemberMutation(
    target,
    (conn, a: { network: WifiNetwork; patch: NetworkPatch; mode: ApplyMode }) =>
      stageAndApply(conn, networkChanges(a.network, a.patch), { mode: a.mode }),
    RADIOS,
  );

  return {
    busy: radio.isPending || network.isPending,
    applyRadio: (r: Radio, patch: RadioPatch, onDone?: () => void) =>
      radio.mutate(
        { radio: r, patch },
        {
          onSuccess: (outcome) => {
            report(outcome);
            onDone?.();
          },
          onError: fail,
        },
      ),
    applyNetwork: (n: WifiNetwork, patch: NetworkPatch, mode: ApplyMode, onDone?: (outcome: ApplyOutcome) => void) =>
      network.mutate(
        { network: n, patch, mode },
        {
          onSuccess: (outcome) => {
            report(outcome);
            onDone?.(outcome);
          },
          onError: fail,
        },
      ),
  };
}
