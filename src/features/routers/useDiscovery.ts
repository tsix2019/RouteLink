import { useCallback, useEffect, useRef, useState } from 'react';
import RouteLinkNative, { type NetworkInfo } from 'routelink-native';

import { nativeHttpClient } from '@/api/http/native';
import { createProber } from '@/discovery/probe';
import { scan, sortRouters, type DiscoveredRouter, type Prober } from '@/discovery/scan';
import { cidrHosts, scanTargets } from '@/utils/net';

export type DiscoveryPhase = 'checking' | 'no-wifi' | 'scanning' | 'done' | 'error';

export interface DiscoveryState {
  phase: DiscoveryPhase;
  found: DiscoveredRouter[];
  done: number;
  total: number;
  gateway: string | null;
  /** CIDR typed by the user, scanned instead of the phone's subnet. */
  range: string | null;
}

export interface DiscoveryDeps {
  getNetworkInfo(): Promise<NetworkInfo>;
  prober: Prober;
}

let nativeDeps: DiscoveryDeps | null = null;
const defaultDeps = () =>
  (nativeDeps ??= {
    getNetworkInfo: () => RouteLinkNative.getNetworkInfo(),
    prober: createProber(nativeHttpClient),
  });

const INITIAL: DiscoveryState = { phase: 'checking', found: [], done: 0, total: 0, gateway: null, range: null };

/** Adds or refreshes a result; an IP result absorbs the host-name entry it was merged with. */
function upsert(list: DiscoveredRouter[], router: DiscoveredRouter): DiscoveredRouter[] {
  const rest = list.filter((r) => r.address !== router.address && !router.aliases.includes(r.address));
  return sortRouters([...rest, { ...router, aliases: [...router.aliases] }]);
}

/**
 * LAN discovery for the add-router screen: scans the phone's Wi-Fi subnet (or a CIDR the user
 * typed) for OpenWrt and streams results as they are found. Starts on mount.
 */
type Plan =
  | { kind: 'scan'; targets: string[]; gateway: string | null; range: string | null }
  | { kind: 'no-wifi' }
  | { kind: 'error'; range: string | null };

/** What to scan: the typed CIDR, or the phone's Wi-Fi subnet. */
async function plan(range: string | null, deps: DiscoveryDeps): Promise<Plan> {
  try {
    if (range) return { kind: 'scan', targets: cidrHosts(range), gateway: null, range };
    const info = await deps.getNetworkInfo();
    if (!info.isWifi || !info.ip || !info.netmask) return { kind: 'no-wifi' };
    const targets = scanTargets({ ip: info.ip, netmask: info.netmask, gateway: info.gateway });
    return { kind: 'scan', targets, gateway: info.gateway, range: null };
  } catch {
    return { kind: 'error', range };
  }
}

export function useDiscovery(deps?: DiscoveryDeps) {
  const [state, setState] = useState<DiscoveryState>(INITIAL);
  const controller = useRef<AbortController | null>(null);
  const depsRef = useRef(deps);

  /** Cancels the running scan and returns the controller for a new one. */
  const begin = useCallback(() => {
    controller.current?.abort();
    controller.current = new AbortController();
    return controller.current;
  }, []);

  const execute = useCallback(async (p: Plan, ctrl: AbortController) => {
    if (ctrl.signal.aborted) return;
    if (p.kind !== 'scan') {
      setState({ ...INITIAL, phase: p.kind, range: p.kind === 'error' ? p.range : null });
      return;
    }
    setState({ phase: 'scanning', found: [], done: 0, total: p.targets.length, gateway: p.gateway, range: p.range });
    await scan({
      targets: p.targets,
      gateway: p.gateway,
      prober: (depsRef.current ?? defaultDeps()).prober,
      signal: ctrl.signal,
      onFound: (router) => setState((s) => ({ ...s, found: upsert(s.found, router) })),
      onProgress: (done, total) => setState((s) => ({ ...s, done, total })),
    });
    if (!ctrl.signal.aborted) setState((s) => ({ ...s, phase: 'done' }));
  }, []);

  useEffect(() => {
    const ctrl = begin();
    void plan(null, depsRef.current ?? defaultDeps()).then((p) => execute(p, ctrl));
    return () => ctrl.abort();
  }, [begin, execute]);

  const start = useCallback(
    (range?: string) => {
      const ctrl = begin();
      setState({ ...INITIAL, phase: range ? 'scanning' : 'checking' });
      void plan(range ?? null, depsRef.current ?? defaultDeps()).then((p) => execute(p, ctrl));
    },
    [begin, execute],
  );

  const cancel = useCallback(() => {
    controller.current?.abort();
    setState((s) => (s.phase === 'scanning' || s.phase === 'checking' ? { ...s, phase: 'done' } : s));
  }, []);

  return { ...state, start, cancel };
}

/** Side-router hint: OpenWrt found, but the phone's gateway is not one of them. */
export const looksLikeSideRouter = (s: Pick<DiscoveryState, 'found' | 'gateway' | 'range'>) =>
  !s.range && !!s.gateway && s.found.length > 0 && !s.found.some((r) => r.isGateway);
