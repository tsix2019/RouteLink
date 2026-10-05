import type { RouterConnection } from '../connection/types';
import type { UbusCall } from '../ubus/types';
import { stageAndApply, uci, type UciSection } from '../uci';

/**
 * NW-11: DNS ad blocking with adblock-fast (its own rpcd object) or adblock (uci, an init script and a runtime
 * JSON file). When both are installed the enabled one is used, else adblock-fast.
 */

export type AdblockPackage = 'adblock-fast' | 'adblock';
export type AdblockStatus = 'running' | 'stopped' | 'working' | 'error' | 'paused' | 'unknown';

export interface AdblockSource {
  /** adblock-fast: the file_url section; adblock: the feed name. */
  id: string;
  name: string;
  enabled: boolean;
  action?: 'block' | 'allow';
  /** adblock-fast: download size in bytes. */
  size?: number;
  /** adblock: what the feed is about ("general", "phishing", …). */
  description?: string;
}

export interface AdblockState {
  package: AdblockPackage;
  /** Both packages are installed. */
  both: boolean;
  enabled: boolean;
  status: AdblockStatus;
  /** Domains on the block list. */
  blocked: number;
  version?: string;
  /** adblock: when the lists were last processed (router time). */
  lastRun?: string;
  /** adblock-fast: the first error, else the first warning. */
  message?: { code: string; info: string };
  sources: AdblockSource[];
  /** adblock: the uci list holding the selected feeds (adb_sources up to 4.2, OpenWrt 23.05). */
  feedOption?: 'adb_feed' | 'adb_sources';
}

export type AdblockResult = AdblockState | { package: null };

export function chooseAdblock(o: {
  fast: boolean;
  fastEnabled: boolean;
  adblock: boolean;
  adblockEnabled: boolean;
}): AdblockPackage | null {
  if (o.fast && o.fastEnabled) return 'adblock-fast';
  if (o.adblock && o.adblockEnabled) return 'adblock';
  if (o.fast) return 'adblock-fast';
  return o.adblock ? 'adblock' : null;
}

const ofType = (values: Record<string, UciSection>, type: string) =>
  Object.values(values)
    .filter((s) => s['.type'] === type)
    .sort((a, b) => Number(a['.index'] ?? 0) - Number(b['.index'] ?? 0));
const list = (v: unknown): string[] =>
  (Array.isArray(v) ? v : typeof v === 'string' ? [v] : []).flatMap((x) => String(x).split(/\s+/)).filter(Boolean);

// ---- adblock-fast ----

const FAST_STATES: Record<string, AdblockStatus> = {
  statusSuccess: 'running',
  statusWarning: 'running',
  statusStopped: 'stopped',
  statusStarting: 'working',
  statusRestarting: 'working',
  statusForceReloading: 'working',
  statusDownloading: 'working',
  statusProcessing: 'working',
  statusTriggerBootWait: 'working',
  statusTriggerStartWait: 'working',
  statusPaused: 'paused',
  statusFail: 'error',
  statusError: 'error',
};

interface FastStatus {
  version?: string;
  enabled?: boolean;
  status?: string;
  entries?: number;
  errors?: { code: string; info?: string }[];
  warnings?: { code: string; info?: string }[];
}

export function parseAdblockFast(values: Record<string, UciSection>, status: Record<string, unknown>): AdblockState {
  const st = (status['adblock-fast'] ?? {}) as FastStatus;
  const config = ofType(values, 'adblock-fast')[0];
  const notice = st.errors?.[0] ?? st.warnings?.[0];
  const state: AdblockState = {
    package: 'adblock-fast',
    both: false,
    enabled: typeof st.enabled === 'boolean' ? st.enabled : config?.enabled === '1',
    status: FAST_STATES[st.status ?? ''] ?? 'unknown',
    blocked: Number(st.entries) || 0,
    sources: ofType(values, 'file_url').map((s) => {
      const src: AdblockSource = {
        id: s['.name'],
        name: String(s.name ?? s.url ?? s['.name']),
        enabled: s.enabled !== '0',
        action: s.action === 'allow' ? 'allow' : 'block',
      };
      if (Number(s.size) > 0) src.size = Number(s.size);
      return src;
    }),
  };
  if (st.version) state.version = st.version;
  if (notice) state.message = { code: notice.code, info: notice.info ?? '' };
  return state;
}

/** A small general list to switch on with the blocker when none is selected (AdAway, else the smallest). */
export function pickDefaultSource(state: AdblockState): AdblockSource | null {
  if (state.sources.some((s) => s.enabled)) return null;
  const blocks = state.sources.filter((s) => s.action !== 'allow');
  return (
    blocks.find((s) => /^AdAway/i.test(s.name)) ??
    [...blocks].sort((a, b) => (a.size ?? Infinity) - (b.size ?? Infinity))[0] ??
    null
  );
}

// ---- adblock ----

export function parseAdblockRuntime(
  text: string,
): { status: AdblockStatus; blocked: number; version?: string; lastRun?: string } | null {
  let r: Record<string, unknown>;
  try {
    r = JSON.parse(text);
  } catch {
    return null;
  }
  const states: Record<string, AdblockStatus> = {
    enabled: 'running',
    disabled: 'stopped',
    paused: 'paused',
    running: 'working',
    error: 'error',
  };
  const out: { status: AdblockStatus; blocked: number; version?: string; lastRun?: string } = {
    status: states[String(r.adblock_status)] ?? 'unknown',
    // 4.5 groups the digits: "325 124".
    blocked: Number(String(r.blocked_domains ?? '').replace(/\D/g, '')) || 0,
  };
  const version = String(r.adblock_version ?? r.frontend_ver ?? '');
  const last = String(r.last_run ?? '');
  if (version && version !== '-') out.version = version;
  if (last && last !== '-') out.lastRun = last;
  return out;
}

/** Where adblock keeps its runtime state: 24.10, 23.05, 25.12 (each release's LuCI ACL allows its own). */
const RUNTIME_FILES = ['/var/run/adb_runtime.json', '/tmp/adb_runtime.json', '/var/run/adblock/adblock.runtime.json'];

async function readRuntime(conn: RouterConnection) {
  for (const path of RUNTIME_FILES) {
    try {
      const text = conn.cgiRead
        ? await conn.cgiRead(path)
        : ((await conn.call<{ data?: string }>('file', 'read', { path })).data ?? '');
      const parsed = parseAdblockRuntime(text);
      if (parsed) return parsed;
    } catch {
      // not there, or not readable for this session
    }
  }
  return null;
}

type Catalogue = Record<string, { descr?: string }>;

/**
 * adblock 4.2 (OpenWrt 23.05) ships its catalogue gzipped; `/etc/init.d/adblock list` prints it, a line per feed:
 * "  + adguard              x         L      general              https://…" (x: selected).
 */
export function parseAdblockList(text: string): Catalogue {
  const out: Catalogue = {};
  for (const line of text.split('\n')) {
    const m = /^\s+\+\s(\w+)\s+(?:x\s+)?\S+\s+(\S+)/.exec(line);
    if (m) out[m[1]] = { descr: m[2] };
  }
  return out;
}

/** The feed catalogue: a JSON file from 4.3 on, else the init script's list. Which one tells the uci option. */
async function readCatalogue(
  conn: RouterConnection,
): Promise<{ feeds: Catalogue; option: 'adb_feed' | 'adb_sources' }> {
  try {
    const r = await conn.call<{ data?: string }>('file', 'read', { path: '/etc/adblock/adblock.feeds' });
    return { feeds: JSON.parse(r.data ?? '{}') as Catalogue, option: 'adb_feed' };
  } catch {
    // 4.2 and older
  }
  try {
    const r = await conn.call<{ stdout?: string }>('file', 'exec', {
      command: '/etc/init.d/adblock',
      params: ['list'],
    });
    return { feeds: parseAdblockList(r.stdout ?? ''), option: 'adb_sources' };
  } catch {
    return { feeds: {}, option: 'adb_feed' };
  }
}

async function adblockState(conn: RouterConnection, values: Record<string, UciSection>): Promise<AdblockState> {
  const global = ofType(values, 'adblock')[0];
  const { feeds: catalogue, option: listed } = await readCatalogue(conn);
  const option =
    global?.adb_sources !== undefined ? 'adb_sources' : global?.adb_feed !== undefined ? 'adb_feed' : listed;
  const selected = list(global?.[option]);
  const sources: AdblockSource[] = Object.entries(catalogue).map(([id, f]) => {
    const src: AdblockSource = { id, name: id, enabled: selected.includes(id) };
    if (f.descr) src.description = f.descr;
    return src;
  });
  for (const id of selected) if (!catalogue[id]) sources.push({ id, name: id, enabled: true });
  const runtime = await readRuntime(conn);
  const state: AdblockState = {
    package: 'adblock',
    both: false,
    enabled: global?.adb_enabled === '1',
    status: runtime?.status ?? 'unknown',
    blocked: runtime?.blocked ?? 0,
    sources,
    feedOption: option,
  };
  if (runtime?.version) state.version = runtime.version;
  if (runtime?.lastRun) state.lastRun = runtime.lastRun;
  return state;
}

// ---- both ----

export async function getAdblock(conn: RouterConnection): Promise<AdblockResult> {
  const [fast, adblock, status] = await conn.batch([
    { object: 'uci', method: 'get', params: { config: 'adblock-fast' } },
    { object: 'uci', method: 'get', params: { config: 'adblock' } },
    { object: 'luci.adblock-fast', method: 'getInitStatus', params: { name: 'adblock-fast' } },
  ]);
  const fastValues = fast.ok ? ((fast.data as { values?: Record<string, UciSection> }).values ?? {}) : null;
  const adbValues = adblock.ok ? ((adblock.data as { values?: Record<string, UciSection> }).values ?? {}) : null;
  const pkg = chooseAdblock({
    fast: !!fastValues,
    fastEnabled: !!fastValues && ofType(fastValues, 'adblock-fast')[0]?.enabled === '1',
    adblock: !!adbValues,
    adblockEnabled: !!adbValues && ofType(adbValues, 'adblock')[0]?.adb_enabled === '1',
  });
  if (!pkg) return { package: null };
  const state =
    pkg === 'adblock-fast'
      ? parseAdblockFast(fastValues!, status.ok ? (status.data as Record<string, unknown>) : {})
      : await adblockState(conn, adbValues!);
  return { ...state, both: !!fastValues && !!adbValues };
}

/** uci changes for switching sources on or off; adblock keeps its feeds in one list. */
export function sourceChanges(state: AdblockState, toggles: Record<string, boolean>): UbusCall[] {
  if (state.package === 'adblock-fast') {
    return state.sources
      .filter((s) => s.id in toggles && toggles[s.id] !== s.enabled)
      .map((s) => uci.set('adblock-fast', s.id, { enabled: toggles[s.id] ? '1' : '0' }));
  }
  const feeds = state.sources.filter((s) => toggles[s.id] ?? s.enabled).map((s) => s.id);
  return [uci.set('adblock', 'global', { [state.feedOption ?? 'adb_feed']: feeds })];
}

export type AdblockAction = 'on' | 'off' | 'refresh';

const fastAction = (conn: RouterConnection, action: string) =>
  conn.call('luci.adblock-fast', 'setInitAction', { name: 'adblock-fast', action }, { timeoutMs: 30_000 });
/** Only reload, restart, suspend and resume are allowed on every release (23.05 has no stop). */
const adblockRestart = (conn: RouterConnection) =>
  conn.call('file', 'exec', { command: '/etc/init.d/adblock', params: ['restart'] }, { timeoutMs: 60_000 });

/** On, off, or download the lists again. adblock-fast's own object runs the long steps in the background. */
export async function adblockAction(conn: RouterConnection, pkg: AdblockPackage, action: AdblockAction): Promise<void> {
  if (pkg === 'adblock-fast') {
    const steps = { on: ['enable', 'start'], off: ['stop', 'disable'], refresh: ['restart'] }[action];
    for (const step of steps) await fastAction(conn, step);
    return;
  }
  if (action !== 'refresh') {
    await stageAndApply(conn, [uci.set('adblock', 'global', { adb_enabled: action === 'on' ? '1' : '0' })], {
      mode: 'direct',
    });
  }
  // With adb_enabled off, a restart takes the block list out of the DNS server.
  await adblockRestart(conn);
}

/** Switches blocking on; with no list selected (adblock-fast's default) a small general one comes on too. */
export async function enableAdblock(conn: RouterConnection, state: AdblockState): Promise<void> {
  const fallback = pickDefaultSource(state);
  if (fallback) await stageAndApply(conn, sourceChanges(state, { [fallback.id]: true }), { mode: 'direct' });
  await adblockAction(conn, state.package, 'on');
}

/** Saves the sources, then processes the lists again if blocking is on. */
export async function saveSources(conn: RouterConnection, state: AdblockState, toggles: Record<string, boolean>) {
  const changes = sourceChanges(state, toggles);
  if (changes.length) await stageAndApply(conn, changes, { mode: 'direct' });
  if (state.enabled) await adblockAction(conn, state.package, 'refresh');
}
