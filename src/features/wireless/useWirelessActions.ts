import { networkChanges, radioChanges, type Radio, type WifiNetwork } from '@/api/services/wireless';
import { stageAndApply, type ApplyMode, type ApplyOutcome } from '@/api/uci';
import { useRouterMutation } from '@/hooks/router-queries';
import { useT } from '@/i18n';
import { describeError } from '@/ui/errorText';
import { useToast } from '@/ui/Toast';

type RadioPatch = Parameters<typeof radioChanges>[1];
type NetworkPatch = Parameters<typeof networkChanges>[1];

const RADIOS = [['radios']] as const;

/** Wireless edits: staged as one uci change set and applied safely (rollback) unless told otherwise. */
export function useWirelessActions() {
  const t = useT();
  const toast = useToast();

  const report = (outcome: ApplyOutcome) =>
    outcome.status === 'rolled-back'
      ? toast(t('wireless:result.rolledBack'), 'warning')
      : toast(t('wireless:result.applied'));
  const fail = (error: unknown) => toast(describeError(t, error).title, 'error');

  const radio = useRouterMutation(
    (conn, a: { radio: Radio; patch: RadioPatch }) =>
      stageAndApply(conn, radioChanges(a.radio, a.patch), { mode: 'rollback' }),
    RADIOS,
  );
  const network = useRouterMutation(
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
