import { expect, test } from 'bun:test';
import { BrowserAgent, type AgentTransport } from './agent-loop';
import { observation, validPath, validateAction, needsConfirmation, type Args } from './agent-policy';
import type { Completion } from './agent-model';
import { issueAgentTicket, verifyAgentTicket } from './agent-ticket';

const page = { url: '/portal/schedule', title: 'Review visit', text: 'Rao, Monday 2 PM, Riverside', elements: [{ ref: 1, role: 'button', name: 'Schedule appointment' }] };
const call = (name: string, args: Args): Completion => ({ message: { role: 'assistant', content: null, tool_calls: [{ id: 'call1', type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, calls: [{ id: 'call1', name, args }] });
function setup(options: { allow?: boolean; changed?: boolean; timeout?: boolean; waitApproval?: boolean } = {}) {
  const events: Args[] = [];
  let observes = 0, models = 0, actions = 0;
  let ready!: () => void;
  const approval = new Promise<void>(resolve => { ready = resolve; });
  const transport: AgentTransport = {
    send: msg => events.push(msg), reserveModelCall: async () => {},
    request: async (type, payload, _responseType, signal) => {
      events.push({ type, ...payload });
      if (type === 'request_observation') return { observation: { ...page, text: ++observes > 1 && options.changed ? 'Different appointment' : page.text } };
      if (type === 'confirm_request') {
        ready();
        if (options.waitApproval) await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Stopped')), { once: true }));
        return { allowed: options.allow ?? true };
      }
      if (type === 'action_request') {
        actions++;
        if (options.timeout) throw new Error('Timeout');
        return { ok: true, observation: { ...page, text: 'Appointment scheduled' } };
      }
      return {};
    },
  };
  const agent = new BrowserAgent(transport, {}, async () => ++models === 1 ? call('click', { ref: 1, consequential: false }) : call('finish', { summary: 'Appointment scheduled.' }));
  return { agent, events, approval, actions: () => actions };
}
test('approval is required by observed button semantics even when model marks false', async () => {
  const s = setup(); await s.agent.run('Book it');
  expect(s.events.some(e => e.type === 'confirm_request')).toBe(true);
  expect(s.actions()).toBe(1);
  expect(s.events.some(e => e.type === 'done')).toBe(true);
});
test('denial performs no action and ends the turn', async () => {
  const s = setup({ allow: false }); await s.agent.run('Book it');
  expect(s.actions()).toBe(0);
  expect(s.agent.busy).toBe(false);
});
test('page change after approval invalidates the action', async () => {
  const s = setup({ changed: true }); await s.agent.run('Book it');
  expect(s.actions()).toBe(0);
  expect(s.events.some(e => String(e.summary).includes('portal changed'))).toBe(true);
});
test('Stop while waiting for approval prevents submission', async () => {
  const s = setup({ waitApproval: true }); const running = s.agent.run('Book it');
  await s.approval; s.agent.stop(); await running;
  expect(s.actions()).toBe(0);
  expect(s.agent.busy).toBe(false);
});
test('uncertain submission timeout is never automatically replayed', async () => {
  const s = setup({ timeout: true }); await s.agent.run('Book it');
  expect(s.actions()).toBe(1);
  expect(s.events.some(e => e.type === 'error' && e.fatal)).toBe(true);
});
test('navigation cannot access APIs, encoded escapes or credential URLs', () => {
  for (const path of ['/portal/api/auth/logout', '/portal/../~api/portal/api/me', '/portal/%2e%2e', '/portal/\\evil', '//evil.test', '/portal/home?token=secret']) expect(validPath(path)).toBe(false);
  expect(validPath('/portal/visits/1/checkin?step=insurance')).toBe(true);
});
test('sign-in observations redact all credentials and screenshots are not requested', async () => {
  const cleaned = observation({ url: '/portal/login', title: 'Login', text: 'private value', elements: [{ ref: 1, role: 'textbox', name: 'Username', value: 'private-user' }, { ref: 2, role: 'textbox', name: 'Password', type: 'password', value: 'private-secret' }] });
  expect(JSON.stringify(cleaned)).not.toContain('private-');
  expect(cleaned.elements).toEqual([]);
});
test('credential typing and stale refs are refused', () => {
  expect(validateAction('click', { ref: 20 }, observation(page))).not.toBeNull();
  expect(validateAction('type_text', { ref: 2, text: 'secret' }, { ...page, elements: [{ ref: 2, role: 'textbox', name: 'Username' }] })).not.toBeNull();
  expect(needsConfirmation({ consequential: false }, { ref: 1, role: 'link', name: 'Schedule an appointment' })).toBe(false);
  expect(needsConfirmation({ consequential: false }, { ref: 1, role: 'button', type: 'submit', name: 'This is correct' })).toBe(true);
});
test('session tickets reject expiry, wrong session, forgery and code rotation', async () => {
  const id = 'a'.repeat(32), secret = 'test-only-agent-secret', now = 10000000;
  const ticket = await issueAgentTicket(id, secret, now);
  expect(await verifyAgentTicket(id, ticket, secret, now)).toBe(now + 3600000);
  expect(await verifyAgentTicket(id, ticket, secret, now + 3600001)).toBeNull();
  expect(await verifyAgentTicket('b'.repeat(32), ticket, secret, now)).toBeNull();
  expect(await verifyAgentTicket(id, ticket + 'a', secret, now)).toBeNull();
  expect(await verifyAgentTicket(id, ticket, 'changed-agent-secret', now)).toBeNull();
});
