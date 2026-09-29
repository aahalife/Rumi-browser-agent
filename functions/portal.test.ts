import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { RecordStore, type SQL } from './store';
import { PortalService } from './portal';
import { safeNext } from './http';
import type { AuthEnv } from './auth';
import type { AppointmentRecord, SlotRecord } from './models';

const origin = 'https://portal.test';
const secret = 'test-only-private-code-not-for-deployment';
let db: Database;
let store: RecordStore;
let service: PortalService;
let now: number;
let env: AuthEnv;
let cookies: Map<string, string>;
function rebuild(): void {
  const sql: SQL = { exec: (query, ...bindings) => db.query(query).all(...bindings) as Record<string, unknown>[] };
  store = new RecordStore(sql, work => db.transaction(work)());
  service = new PortalService(store, env, () => now);
}
async function request(path: string, method = 'GET', body?: unknown, options: { key?: boolean; jar?: Map<string, string>; headers?: Record<string, string> } = {}): Promise<Response> {
  const jar = options.jar ?? cookies;
  const headers = new Headers({ 'Content-Type': 'application/json', ...options.headers });
  if (options.key !== false) headers.set('X-Demo-Key', secret);
  headers.set('cookie', [...jar].map(([k, v]) => `${k}=${v}`).join('; '));
  const response = await service.fetch(new Request(origin + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
  for (const header of response.headers.getSetCookie()) {
    const pair = header.split(';')[0];
    const split = pair.indexOf('=');
    jar.set(pair.slice(0, split), pair.slice(split + 1));
  }
  return response;
}
async function login(username = 'demo', jar = cookies): Promise<void> {
  expect((await request('/demo/access', 'POST', {}, { jar })).status).toBe(200);
  expect((await request('/portal/api/auth/login', 'POST', { username, password: 'demo123' }, { jar })).status).toBe(200);
}
beforeEach(() => {
  db = new Database(':memory:');
  env = { DEMO_ACCESS_CODE: secret };
  now = Date.parse('2026-09-29T08:00:00Z');
  cookies = new Map<string, string>();
  rebuild();
});
afterEach(() => db.close());

describe('private access and saved sign-in', () => {
  test('fails closed without a configured private code', async () => {
    env = {}; rebuild();
    expect((await request('/portal/api/me')).status).toBe(503);
    expect(store.all('patient')).toHaveLength(0);
  });
  test('public demo credentials cannot bypass private access', async () => {
    expect((await request('/portal/api/auth/login', 'POST', { username: 'demo', password: 'demo123' }, { key: false })).status).toBe(403);
    expect(store.all('patient')).toHaveLength(0);
  });
  test('private code alone does not authenticate a patient', async () => {
    expect((await request('/portal/api/me')).status).toBe(401);
  });
  test('rejects foreign origins even with a valid private code', async () => {
    expect((await request('/demo/access', 'POST', {}, { headers: { Origin: 'https://attacker.test' } })).status).toBe(403);
  });
  test('native bootstrap sets private cookie and redirects only to the portal', async () => {
    const response = await request('/demo/native-access', 'POST', {});
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/portal/home');
    expect(response.headers.get('set-cookie')).toContain('__Host-linden_demo=');
    expect((await request('/demo/status', 'GET', undefined, { key: false })).status).toBe(200);
  });
  test('sets secure host-only HttpOnly cookies and no-store responses', async () => {
    const response = await request('/demo/access', 'POST', {});
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('set-cookie')).toContain('Secure; HttpOnly; SameSite=Strict');
    expect(response.headers.get('set-cookie')).toContain('__Host-linden_demo=');
    expect(response.headers.get('set-cookie')).not.toContain('Domain=');
    expect((await request('/demo/status', 'GET', undefined, { key: false })).status).toBe(200);
  });
  test('rotates refresh token exactly once and invalidates the old access token', async () => {
    await login();
    const old = new Map(cookies);
    now += 301000;
    expect((await request('/portal/api/me')).status).toBe(401);
    expect((await request('/portal/api/auth/refresh', 'POST')).status).toBe(200);
    expect((await request('/portal/api/me')).status).toBe(200);
    expect((await request('/portal/api/auth/refresh', 'POST', undefined, { jar: old })).status).toBe(401);
  });
  test('concurrent refresh requests cannot both consume one credential', async () => {
    await login();
    const left = new Map(cookies), right = new Map(cookies);
    const responses = await Promise.all([request('/portal/api/auth/refresh', 'POST', {}, { jar: left }), request('/portal/api/auth/refresh', 'POST', {}, { jar: right })]);
    expect(responses.map(r => r.status).sort()).toEqual([200, 401]);
  });
  test('logout invalidates server-held credentials', async () => {
    await login();
    const old = new Map(cookies);
    expect((await request('/portal/api/auth/logout', 'POST')).status).toBe(200);
    expect((await request('/portal/api/me', 'GET', undefined, { jar: old })).status).toBe(401);
  });
  test('saved device code survives service reconstruction and is single-use', async () => {
    await login();
    const device = await (await request('/portal/api/auth/device-token', 'POST', {})).json() as { token: string };
    const { code } = await (await request('/portal/api/auth/device-login', 'POST', device, { key: false, jar: new Map() })).json() as { code: string };
    rebuild();
    const fresh = new Map<string, string>();
    const complete = await request(`/portal/api/auth/device-login/complete?code=${code}&next=https://evil.test`, 'GET', undefined, { key: false, jar: fresh });
    expect(complete.status).toBe(303);
    expect(complete.headers.get('location')).toBe('/portal/home');
    expect((await request('/portal/api/me', 'GET', undefined, { key: false, jar: fresh })).status).toBe(200);
    expect((await request(`/portal/api/auth/device-login/complete?code=${code}`, 'GET', undefined, { key: false, jar: fresh })).status).toBe(401);
  });
  test('revoking a device also revokes outstanding completion codes', async () => {
    await login();
    const device = await (await request('/portal/api/auth/device-token', 'POST', {})).json();
    const { code } = await (await request('/portal/api/auth/device-login', 'POST', device)).json() as { code: string };
    expect((await request('/portal/api/auth/device-login/revoke', 'POST', device)).status).toBe(200);
    expect((await request(`/portal/api/auth/device-login/complete?code=${code}`)).status).toBe(401);
    expect((await request('/portal/api/auth/device-login', 'POST', device)).status).toBe(401);
  });
  test('completion codes expire after two minutes', async () => {
    await login();
    const device = await (await request('/portal/api/auth/device-token', 'POST', {})).json();
    const { code } = await (await request('/portal/api/auth/device-login', 'POST', device)).json() as { code: string };
    now += 120001;
    expect((await request(`/portal/api/auth/device-login/complete?code=${code}`)).status).toBe(401);
  });
  test('private code rotation invalidates all old sessions and devices', async () => {
    await login();
    const device = await (await request('/portal/api/auth/device-token', 'POST', {})).json();
    env = { DEMO_ACCESS_CODE: secret + '-rotated' }; rebuild();
    expect((await request('/portal/api/me', 'GET', undefined, { key: false })).status).toBe(403);
    expect((await request('/portal/api/auth/device-login', 'POST', device, { key: false })).status).toBe(401);
  });
  test('throttles repeated access attempts', async () => {
    for (let i = 0; i < 30; i++) expect((await request('/demo/access', 'POST', {}, { key: false })).status).toBe(403);
    expect((await request('/demo/access', 'POST', {}, { key: false })).status).toBe(429);
    now += 600001;
    expect((await request('/demo/access', 'POST', {})).status).toBe(200);
  });
  test('stores no raw cookie or device credentials', async () => {
    await login();
    const device = await (await request('/portal/api/auth/device-token', 'POST', {})).json() as { token: string };
    const stored = JSON.stringify(db.query('SELECT * FROM credentials').all());
    expect(stored).not.toContain(device.token);
    for (const value of cookies.values()) expect(stored).not.toContain(value);
    expect(stored).not.toContain(secret);
  });
});

describe('portal behavior and durable mutations', () => {
  test('appointment and slot wire times preserve clinic wall time and omit patient conflicts', async () => {
    await login();
    const appt = await (await request('/portal/api/appointments/1')).json() as { start: string };
    expect(appt.start).toContain('T10:30:00');
    expect(appt.start.endsWith('Z')).toBe(false);
    const stored = store.get<AppointmentRecord>('appointment', 1)!;
    const candidate = store.all<SlotRecord>('slot').find(s => s.start === stored.start && s.provider.id !== stored.provider.id)!;
    store.put('slot', { ...candidate, status: 'open' });
    const slots = await (await request(`/portal/api/scheduling/slots?location_id=${candidate.location_id}&days=14`)).json() as SlotRecord[];
    expect(slots.some(s => s.id === candidate.id)).toBe(false);
    expect(slots.every(s => !s.start.endsWith('Z'))).toBe(true);
    expect(slots.some(s => Number(s.start.slice(11, 13)) >= 12)).toBe(true);
  });
  test('blank optional check-in fields preserve existing information', async () => {
    await login();
    const before = await (await request('/portal/api/me')).json();
    expect((await request('/portal/api/appointments/1/checkin/personal_info', 'PUT', { phone: '', email: null, address: '' })).status).toBe(200);
    expect((await request('/portal/api/appointments/1/checkin/insurance', 'PUT', { insurance_payer: '', insurance_member_id: '' })).status).toBe(200);
    const after = await (await request('/portal/api/me')).json();
    expect(after).toEqual(before);
  });
  test('patient-owned resources cannot be read or changed by another patient', async () => {
    await login('demo2');
    for (const path of ['/appointments/1', '/appointments/1/checkin', '/messages/1', '/results/1', '/medications/1']) expect((await request('/portal/api' + path)).status).toBe(404);
    expect((await request('/portal/api/appointments/1/cancel', 'POST', { reason: 'Other' })).status).toBe(404);
    expect((await request('/portal/api/medications/1/refill', 'POST', { pharmacy_id: 1 })).status).toBe(404);
  });
  test('only one competing booking wins and state survives reconstruction', async () => {
    await login();
    const slot = store.all<SlotRecord>('slot').find(s => s.status === 'open')!;
    const payload = { slot_id: slot.id, reason: 'follow_up', comments: 'Retained after restart' };
    const responses = await Promise.all([request('/portal/api/appointments', 'POST', payload), request('/portal/api/appointments', 'POST', payload)]);
    expect(responses.map(r => r.status).sort()).toEqual([201, 409]);
    rebuild();
    const appts = store.all<AppointmentRecord>('appointment').filter(a => a.slot_id === slot.id);
    expect(appts).toHaveLength(1);
    expect(appts[0].comments).toBe(payload.comments);
    expect(store.get<SlotRecord>('slot', slot.id)?.status).toBe('booked');
  });
  test('cancellation frees the slot and cannot be applied twice', async () => {
    await login();
    const original = store.get<AppointmentRecord>('appointment', 1)!;
    expect((await request('/portal/api/appointments/1/cancel', 'POST', { reason: 'Transportation', comments: 'No ride' })).status).toBe(200);
    expect(store.get<SlotRecord>('slot', original.slot_id!)?.status).toBe('open');
    expect((await request('/portal/api/appointments/1/cancel', 'POST', { reason: 'Other' })).status).toBe(409);
  });
  test('invalid booking rolls back without occupying a slot', async () => {
    await login();
    const slot = store.all<SlotRecord>('slot').find(s => s.status === 'open')!;
    expect((await request('/portal/api/appointments', 'POST', { slot_id: slot.id, reason: 'invalid' })).status).toBe(422);
    expect(store.get<SlotRecord>('slot', slot.id)?.status).toBe('open');
    expect((await request('/portal/api/scheduling/slots?location_id=1&days=90')).status).toBe(422);
  });
  test('messages persist and replies update the same conversation', async () => {
    await login();
    const response = await request('/portal/api/messages', 'POST', { recipient_id: 1, subject: 'Follow-up question', body: 'Please contact me.' });
    expect(response.status).toBe(201);
    const { id } = await response.json() as { id: number };
    expect((await request(`/portal/api/messages/${id}/reply`, 'POST', { body: 'Thank you.' })).status).toBe(201);
    rebuild();
    const conv = await (await request(`/portal/api/messages/${id}`)).json() as { message_count: number; messages: { body: string }[] };
    expect(conv.message_count).toBe(2);
    expect(conv.messages[1].body).toBe('Thank you.');
    expect((await request('/portal/api/messages', 'POST', { recipient_id: 1, subject: ' ', body: ' ' })).status).toBe(422);
  });
  test('refill requests are atomic and do not decrement refills prematurely', async () => {
    await login();
    const responses = await Promise.all([request('/portal/api/medications/1/refill', 'POST', { pharmacy_id: 2 }), request('/portal/api/medications/1/refill', 'POST', { pharmacy_id: 1 })]);
    expect(responses.map(r => r.status).sort()).toEqual([201, 409]);
    rebuild();
    const med = await (await request('/portal/api/medications/1')).json() as { refills_left: number; pending_refill: { status: string } };
    expect(med.refills_left).toBe(2);
    expect(med.pending_refill.status).toBe('requested');
  });
  test('results have original values and reviewing clears the unread count', async () => {
    await login();
    const result = await (await request('/portal/api/results/1')).json() as { results: { value: string }[]; reviewed: boolean };
    expect(result.results[0].value).toBe('5.9');
    expect(result.reviewed).toBe(true);
    expect((await (await request('/portal/api/me')).json() as { new_results: number }).new_results).toBe(0);
  });
  test('all check-in steps and exact consent are required before completion', async () => {
    await login();
    const base = '/portal/api/appointments/1/checkin';
    expect((await request(base + '/complete', 'POST')).status).toBe(422);
    for (const step of ['personal_info', 'insurance', 'allergies', 'medications']) expect((await request(base + '/' + step, 'PUT', { confirmed: true })).status).toBe(200);
    expect((await request(base + '/questionnaire', 'PUT', { answers: { reason: 'Follow-up' } })).status).toBe(422);
    expect((await request(base + '/questionnaire', 'PUT', { answers: { reason: 'Follow-up', new_symptoms: 'No', tobacco: 'No', falls: 'No' } })).status).toBe(200);
    expect((await request(base + '/consent', 'PUT', { agreed: true, signature: 'Someone else' })).status).toBe(422);
    expect((await request(base + '/consent', 'PUT', { agreed: true, signature: 'Priya Sharma' })).status).toBe(200);
    expect((await request(base + '/complete', 'POST')).status).toBe(200);
    rebuild();
    expect((await (await request(base)).json() as { status: string }).status).toBe('complete');
    expect((await request(base + '/complete', 'POST')).status).toBe(409);
  });
  test('a canceled appointment cannot finish an in-progress check-in', async () => {
    await login();
    await request('/portal/api/appointments/1/checkin/personal_info', 'PUT', {});
    await request('/portal/api/appointments/1/cancel', 'POST', { reason: 'Other' });
    expect((await request('/portal/api/appointments/1/checkin/insurance', 'PUT', {})).status).toBe(409);
  });
  test('invalid JSON and oversized payloads are rejected without side effects', async () => {
    const headers = { 'Content-Type': 'application/json', 'X-Demo-Key': secret };
    expect((await service.fetch(new Request(origin + '/demo/access', { method: 'POST', headers, body: '{' }))).status).toBe(400);
    expect((await service.fetch(new Request(origin + '/demo/access', { method: 'POST', headers, body: JSON.stringify({ text: 'a'.repeat(33000) }) }))).status).toBe(413);
  });
  test('redirects cannot escape the portal or point at credential endpoints', () => {
    for (const unsafe of ['//evil.test', '/portal/\\evil.test', '/portal/%2f%2fevil.test', '/portal/api/auth/logout', '/portalevil/home']) expect(safeNext(unsafe)).toBe('/portal/home');
    expect(safeNext('/portal/results/1')).toBe('/portal/results/1');
  });
});
