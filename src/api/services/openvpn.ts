import type { RouterConnection } from '../connection/types';
import { UbusError } from '../ubus/errors';
import { stageAndApply, uci, type ApplyOptions, type ApplyOutcome, type UciSection, type UciValues } from '../uci';

/**
 * NW-8: OpenVPN client profiles. A profile is uploaded to /etc/openvpn/<name>.ovpn and becomes a uci instance
 * pointing at it; a login goes into the instance's `username`/`password`, which every supported init script
 * passes as `--auth-user-pass` after `--config` (so it wins over the profile's own line).
 */

const DIR = '/etc/openvpn';
/** Disabled examples from the package's default config. */
const EXAMPLES = new Set(['custom_config', 'sample_server', 'sample_client']);

export interface OvpnInstance {
  name: string;
  enabled: boolean;
  configFile?: string;
  hasLogin: boolean;
  /** null when the router does not let the session see procd's services (23.05). */
  running: boolean | null;
}

export interface OvpnProfile {
  client: boolean;
  remote?: string;
  port?: string;
  proto?: string;
  /** `auth-user-pass`: the server wants a user name and password. */
  needsLogin: boolean;
  /** Certificates or keys referenced as separate files, which the import cannot bring along. */
  missingFiles: string[];
}

const FILE_DIRECTIVES = new Set([
  'ca',
  'cert',
  'key',
  'tls-auth',
  'tls-crypt',
  'tls-crypt-v2',
  'pkcs12',
  'secret',
  'dh',
]);

export function inspectOvpn(text: string): OvpnProfile {
  const profile: OvpnProfile = { client: false, needsLogin: false, missingFiles: [] };
  let inline: string | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (inline) {
      if (line === `</${inline}>`) inline = null;
      continue;
    }
    const block = /^<([\w-]+)>$/.exec(line);
    if (block) {
      inline = block[1];
      continue;
    }
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const [directive, ...args] = line.split(/\s+/);
    if (directive === 'client' || directive === 'tls-client') profile.client = true;
    else if (directive === 'remote' && !profile.remote) {
      profile.remote = args[0];
      if (args[1]) profile.port = args[1];
      if (args[2]) profile.proto = args[2];
    } else if (directive === 'proto' && !profile.proto) profile.proto = args[0];
    else if (directive === 'port' && !profile.port) profile.port = args[0];
    else if (directive === 'auth-user-pass') profile.needsLogin = true;
    else if (FILE_DIRECTIVES.has(directive) && args[0] && args[0] !== '[inline]') profile.missingFiles.push(args[0]);
  }
  return profile;
}

export interface OvpnLogin {
  username: string;
  password: string;
}

export type ImportError = 'name-invalid' | 'name-taken' | 'empty' | 'not-client' | 'missing-files' | 'needs-login';

export function validateImport(
  name: string,
  text: string,
  instances: OvpnInstance[],
  login?: OvpnLogin,
  takenNames: string[] = [...EXAMPLES],
): ImportError | null {
  if (!/^[A-Za-z0-9_]{1,32}$/.test(name)) return 'name-invalid';
  if (instances.some((i) => i.name === name) || takenNames.includes(name)) return 'name-taken';
  if (!text.trim()) return 'empty';
  const profile = inspectOvpn(text);
  if (!profile.client) return 'not-client';
  if (profile.missingFiles.length) return 'missing-files';
  if (profile.needsLogin && !login?.username) return 'needs-login';
  return null;
}

type Services = Record<string, { instances?: Record<string, { running?: boolean }> }> | null;

export function parseOpenvpn(values: Record<string, UciSection>, services: Services): OvpnInstance[] {
  const live = services?.openvpn?.instances ?? {};
  return Object.values(values)
    .filter((s) => s['.type'] === 'openvpn')
    .sort((a, b) => Number(a['.index'] ?? 0) - Number(b['.index'] ?? 0))
    .filter((s) => !(EXAMPLES.has(s['.name']) && s.enabled !== '1'))
    .map((s) => {
      const i: OvpnInstance = {
        name: s['.name'],
        enabled: s.enabled === '1',
        hasLogin: typeof s.username === 'string' && s.username !== '',
        running: services ? live[s['.name']]?.running === true : null,
      };
      if (typeof s.config === 'string') i.configFile = s.config;
      return i;
    });
}

export async function getOpenvpn(conn: RouterConnection): Promise<{ installed: boolean; instances: OvpnInstance[] }> {
  const [config, services] = await conn.batch([
    { object: 'uci', method: 'get', params: { config: 'openvpn' } },
    { object: 'service', method: 'list', params: { name: 'openvpn' } },
  ]);
  if (!config.ok) {
    if (config.error instanceof UbusError && config.error.code === 'NOT_FOUND')
      return { installed: false, instances: [] };
    throw config.error;
  }
  const values = (config.data as { values?: Record<string, UciSection> }).values ?? {};
  return { installed: true, instances: parseOpenvpn(values, services.ok ? (services.data as Services) : null) };
}

type Tuning = Omit<ApplyOptions, 'mode'>;

/**
 * A tunnel can take over the default route; rollback keeps a profile that cuts the phone off from
 * sticking. The profile file is written first and stays if the instance is rolled back (harmless).
 */
export async function importOvpn(
  conn: RouterConnection,
  name: string,
  text: string,
  login?: OvpnLogin,
  t?: Tuning,
): Promise<ApplyOutcome> {
  const path = `${DIR}/${name}.ovpn`;
  await conn.call('file', 'write', { path, data: text });
  const values: UciValues = { enabled: '1', config: path };
  if (login?.username) {
    values.username = login.username;
    values.password = login.password;
  }
  return stageAndApply(conn, [uci.add('openvpn', 'openvpn', values, name)], { mode: 'rollback', ...t });
}

export const setInstanceEnabled = (conn: RouterConnection, instance: OvpnInstance, enabled: boolean, t?: Tuning) =>
  stageAndApply(conn, [uci.set('openvpn', instance.name, { enabled: enabled ? '1' : '0' })], {
    mode: 'rollback',
    ...t,
  });

/** Removes the instance; the uploaded profile goes too when it is one of ours. */
export async function deleteInstance(
  conn: RouterConnection,
  instance: OvpnInstance,
  t?: Tuning,
): Promise<ApplyOutcome> {
  const outcome = await stageAndApply(conn, [uci.del('openvpn', instance.name)], { mode: 'rollback', ...t });
  if (outcome.status !== 'rolled-back' && instance.configFile === `${DIR}/${instance.name}.ovpn`) {
    await conn.call('file', 'remove', { path: instance.configFile }).catch(() => undefined);
  }
  return outcome;
}
