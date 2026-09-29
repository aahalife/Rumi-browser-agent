import { RecordStore } from './store';
import { HTTPError, json, safeNext, stringField } from './http';
import type { PatientRecord } from './models';
import { createTestWorkspace } from './test-workspace';

export interface AuthEnv { DEMO_ACCESS_CODE?: string; LINDEN_PORTAL_ORIGIN?: string }
interface Credential { hash: string; kind: string; patient: number; expires: number; generation: string; parent: string | null }
const day = 86400000;
const cookieNames = { demo: '__Host-linden_demo', access: '__Host-linden_access', refresh: '__Host-linden_refresh' } as const;
export async function digest(value: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function token(): string {
  return [...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, '0')).join('');
}
function cookie(request: Request, name: string): string {
  return request.headers.get('cookie')?.split(';').map(v => v.trim()).find(v => v.startsWith(name + '='))?.slice(name.length + 1) ?? '';
}
function setCookie(headers: Headers, kind: keyof typeof cookieNames, value: string, ttl: number): void {
  headers.append('Set-Cookie', `${cookieNames[kind]}=${value}; Path=/; Max-Age=${Math.floor(ttl / 1000)}; Secure; HttpOnly; SameSite=Strict`);
}
function equal(a: string, b: string): boolean {
  let difference = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) difference |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return difference === 0;
}
/** Server-held opaque tokens. Only hashes are persisted; rotating the private code invalidates all sessions. */
export class PortalAuth {
  constructor(private readonly store: RecordStore, private readonly env: AuthEnv, private readonly now: () => number) {}
  async context(request: Request): Promise<{ generation: string; privateAccess: boolean; patient: number | null }> {
    const secret = this.env.DEMO_ACCESS_CODE;
    if (!secret || secret.length < 16) throw new HTTPError(503, 'Private demo access is not configured yet.');
    const origin = request.headers.get('origin');
    if (origin && origin !== new URL(request.url).origin && origin !== this.env.LINDEN_PORTAL_ORIGIN) throw new HTTPError(403, 'This request is not allowed.');
    if (request.headers.get('sec-fetch-site') === 'cross-site') throw new HTTPError(403, 'This request is not allowed.');
    const generation = await digest(secret);
    const supplied = request.headers.get('X-Demo-Key');
    if (supplied) this.throttle(request, 'private-key', 60);
    const privateAccess = supplied ? equal(await digest(supplied), generation) : false;
    const [demo, access] = await Promise.all([
      this.lookup(cookie(request, cookieNames.demo), 'demo', generation),
      this.lookup(cookie(request, cookieNames.access), 'access', generation),
    ]);
    return { generation, privateAccess: privateAccess || !!demo, patient: access?.patient ?? null };
  }
  private lookupHash(hash: string, kind: string, generation: string): Credential | undefined {
    const row = [...this.store.sql.exec('SELECT * FROM credentials WHERE hash=? AND kind=? AND generation=? AND expires>?', hash, kind, generation, this.now())][0];
    return row as unknown as Credential | undefined;
  }
  private async lookup(raw: string, kind: string, generation: string): Promise<Credential | undefined> {
    if (!raw || raw.length > 256) return undefined;
    return this.lookupHash(await digest(raw), kind, generation);
  }
  private async make(kind: string, patient: number, generation: string, ttl: number, parent: string | null = null): Promise<{ raw: string; hash: string; expires: number }> {
    const raw = token();
    const hash = await digest(raw);
    const expires = this.now() + ttl;
    this.store.sql.exec('DELETE FROM credentials WHERE expires<=?', this.now());
    this.store.sql.exec('INSERT INTO credentials(hash,kind,patient,expires,generation,parent) VALUES(?,?,?,?,?,?)', hash, kind, patient, expires, generation, parent);
    return { raw, hash, expires };
  }
  private async issue(patient: number, generation: string, headers: Headers): Promise<void> {
    const family = token();
    const access = await this.make('access', patient, generation, 300000, family);
    const refresh = await this.make('refresh', patient, generation, 7 * day, family);
    setCookie(headers, 'access', access.raw, 300000);
    setCookie(headers, 'refresh', refresh.raw, 7 * day);
  }
  private throttle(request: Request, route: string, max = 30): void {
    // The trusted ingress address never appears in logs or response bodies.
    const address = request.headers.get('CF-Connecting-IP') ?? 'unknown';
    if (!this.store.limit(`auth:${route}:${address}`, max, 600000, this.now()) || !this.store.limit(`auth:global:${route}`, 500, 600000, this.now())) throw new HTTPError(429, 'Too many attempts. Please try again later.');
  }
  async handle(request: Request, body: Record<string, unknown>, context: Awaited<ReturnType<PortalAuth['context']>>): Promise<Response | undefined> {
    const url = new URL(request.url);
    const path = url.pathname;
    const { generation, privateAccess, patient } = context;
    const headers = new Headers();
    if (path === '/demo/test' && request.method === 'POST') {
      this.throttle(request, 'test', 20);
      if (!privateAccess) throw new HTTPError(403, 'Private access is required for isolated tests.');
      headers.append('Set-Cookie', await createTestWorkspace(this.env.DEMO_ACCESS_CODE!, this.now()));
      for (const kind of ['demo', 'access', 'refresh'] as const) setCookie(headers, kind, '', 0);
      return json({ ok: true, isolated: true }, 200, headers);
    }
    if (['/demo/access', '/demo/native-access'].includes(path) && request.method === 'POST') {
      this.throttle(request, 'access');
      if (!privateAccess) throw new HTTPError(403, 'The private demo access code was not accepted.');
      const session = await this.make('demo', 0, generation, 7 * day);
      setCookie(headers, 'demo', session.raw, 7 * day);
      if (path === '/demo/native-access') {
        headers.set('Location', '/portal/home');
        return json(null, 303, headers);
      }
      return json({ ok: true }, 200, headers);
    }
    if (path === '/demo/status' && request.method === 'GET') {
      if (!privateAccess) throw new HTTPError(403, 'Enter the private demo access code.');
      return json({ ok: true });
    }
    if (!path.startsWith('/portal/api/auth/')) return undefined;
    const action = path.slice('/portal/api/auth/'.length);
    const isCompletion = action === 'device-login/complete';
    if (request.method !== (isCompletion ? 'GET' : 'POST')) throw new HTTPError(405, 'Method not allowed');
    this.throttle(request, action, action === 'refresh' ? 120 : 30);
    if (!privateAccess && !['device-login', 'device-login/complete', 'device-login/revoke'].includes(action)) throw new HTTPError(403, 'Enter the private demo access code.');
    if (action === 'login') {
      const username = stringField(body, 'username', 64);
      const password = stringField(body, 'password', 128);
      const record = this.store.all<PatientRecord>('patient').find(p => p.username === username);
      // These are deliberately fictional, publicly documented portal credentials behind the private demo gate.
      if (!record || !equal(await digest(password), await digest('demo123'))) throw new HTTPError(401, 'Invalid username or password');
      await this.issue(record.id, generation, headers);
      return json({ ok: true }, 200, headers);
    }
    if (action === 'refresh' || action === 'logout') {
      const hash = await digest(cookie(request, cookieNames.refresh));
      const accessHash = await digest(cookie(request, cookieNames.access));
      const previous = this.store.transaction(() => {
        const row = this.lookupHash(hash, 'refresh', generation);
        if (row?.parent) this.store.sql.exec('DELETE FROM credentials WHERE parent=?', row.parent);
        this.store.sql.exec('DELETE FROM credentials WHERE hash=? OR hash=?', hash, accessHash);
        return row;
      });
      setCookie(headers, 'access', '', 0);
      setCookie(headers, 'refresh', '', 0);
      if (action === 'logout') return json({ ok: true }, 200, headers);
      if (!previous) return json({ detail: 'Refresh token invalid' }, 401, headers);
      await this.issue(previous.patient, generation, headers);
      return json({ ok: true }, 200, headers);
    }
    if (action === 'device-token') {
      if (!patient) throw new HTTPError(401, 'Not signed in');
      const label = stringField(body, 'label', 64, 'Linden device');
      const device = await this.make('device', patient, generation, 90 * day);
      return json({ id: device.hash.slice(0, 16), token: device.raw, expires_at: new Date(device.expires).toISOString(), label });
    }
    if (action === 'device-login' || action === 'device-login/revoke') {
      const raw = stringField(body, 'token', 256);
      const device = await this.lookup(raw, 'device', generation);
      if (action.endsWith('/revoke')) {
        if (device) this.store.transaction(() => {
          this.store.sql.exec('DELETE FROM credentials WHERE hash=? OR parent=?', device.hash, device.hash);
        });
        return json({ ok: true });
      }
      if (!device) throw new HTTPError(401, "This phone's saved sign-in is no longer valid.");
      const code = await this.make('code', device.patient, generation, 120000, device.hash);
      return json({ code: code.raw, expires_in: 120 });
    }
    if (isCompletion) {
      const hash = await digest(url.searchParams.get('code') ?? '');
      const code = this.store.transaction(() => {
        const row = this.lookupHash(hash, 'code', generation);
        this.store.sql.exec('DELETE FROM credentials WHERE hash=?', hash);
        if (!row?.parent || !this.lookupHash(row.parent, 'device', generation)) return undefined;
        return row;
      });
      if (!code) throw new HTTPError(401, 'Sign-in code expired. Please sign in.');
      await this.issue(code.patient, generation, headers);
      const demo = await this.make('demo', 0, generation, 7 * day);
      setCookie(headers, 'demo', demo.raw, 7 * day);
      headers.set('Location', safeNext(url.searchParams.get('next')));
      return json(null, 303, headers);
    }
    throw new HTTPError(404, 'Not found');
  }
}
