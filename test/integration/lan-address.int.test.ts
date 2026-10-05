// A6 (M2 plan T11): when the LAN address changes, can the session that applied the change still
// confirm it, now on the new address? The answer decides how the app changes the LAN address.
// Needs a second way in to the new address (ROUTER_ALT_URL → ROUTER_ALT_IP); the QEMU router in CI
// has one. The test always moves the router back.
import { nodeHttpClient } from '../../src/api/http/node';
import { uci, type UciValues } from '../../src/api/uci';
import { connect, ROUTER_URL, sleep, waitFor } from './router';

const ALT_URL = process.env.ROUTER_ALT_URL;
const ALT_IP = process.env.ROUTER_ALT_IP;

/** `uci confirm` with a given session id, straight over JSON-RPC: "ok", the ubus status, or the failure. */
async function confirmAt(url: string, sid: string): Promise<string> {
  try {
    const res = await nodeHttpClient.request({
      url: `${url}/ubus`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'call', params: [sid, 'uci', 'confirm', {}] }),
      timeoutMs: 4_000,
      tls: { mode: 'system' },
    });
    const body = JSON.parse(res.body) as { result?: [number]; error?: { code: number } };
    if (body.result) return body.result[0] === 0 ? 'ok' : `status ${body.result[0]}`;
    return `error ${body.error?.code}`;
  } catch (error) {
    return `unreachable (${(error as Error).message})`;
  }
}

/** Polls confirm on `url` until it succeeds or `ms` pass; returns the last answer. */
async function confirmWithin(url: string, sid: string, ms: number): Promise<string[]> {
  const answers: string[] = [];
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const answer = await confirmAt(url, sid);
    if (answers[answers.length - 1] !== answer) answers.push(answer);
    if (answer === 'ok') break;
    await sleep(2_000);
  }
  return answers;
}

/** Writes the address the way the config already holds it: 25.12 uses a CIDR list, older releases ipaddr + netmask. */
const addressValues = (current: unknown, ip: string): UciValues =>
  Array.isArray(current) ? { ipaddr: [`${ip}/24`] } : { ipaddr: ip };

async function moveLan(fromUrl: string, toUrl: string, ip: string): Promise<string[]> {
  const { conn, sessions } = connect({ url: fromUrl });
  const lan = (await uci.get(conn, 'network')).lan;
  await conn.call('uci', 'set', { config: 'network', section: 'lan', values: addressValues(lan.ipaddr, ip) });
  await conn.call('uci', 'apply', { rollback: true, timeout: 60 });
  return confirmWithin(toUrl, sessions[sessions.length - 1].sid, 45_000);
}

(ALT_URL && ALT_IP ? describe : describe.skip)('A6: confirming a LAN address change', () => {
  it('the applying session confirms the change on the new address', async () => {
    const { conn } = connect();
    const lan = (await uci.get(conn, 'network')).lan;
    const oldIp = String(Array.isArray(lan.ipaddr) ? lan.ipaddr[0] : lan.ipaddr).split('/')[0];

    const there = await moveLan(ROUTER_URL, ALT_URL!, ALT_IP!);
    console.log(`A6 ${oldIp} → ${ALT_IP}: ${there.join(' → ')}`);
    if (there[there.length - 1] === 'ok') {
      const back = await moveLan(ALT_URL!, ROUTER_URL, oldIp);
      console.log(`A6 ${ALT_IP} → ${oldIp}: ${back.join(' → ')}`);
      expect(back[back.length - 1]).toBe('ok');
    } else {
      // Unconfirmed: the router restores the old address by itself once the 60 s timer runs out.
      await waitFor(async () => (await connect().conn.call('system', 'board')) !== undefined, 120_000);
    }
    expect(there[there.length - 1]).toBe('ok');
    expect(await connect().conn.ping()).toBe(true);
  }, 300_000);
});
