import { DurableObject } from 'cloudflare:workers';
import { RecordStore } from './store';
import { PortalService } from './portal';
import { HTTPError, json } from './http';
import { testWorkspace } from './test-workspace';
import type { AuthEnv } from './auth';
import { verifyAgentTicket } from './agent-ticket';
export { LindenAgent } from './agent-session';
export { LindenAgentGate } from './agent-gate';

interface Env extends AuthEnv { DO: Fetcher }
/** A single strongly consistent showcase; test actors will use separate identities. */
export class LindenPortal extends DurableObject<Env> {
  override async fetch(request: Request): Promise<Response> {
    const store = new RecordStore(this.ctx.storage.sql, work => this.ctx.storage.transactionSync(work));
    return new PortalService(store, this.env).fetch(request);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/healthz' && request.method === 'GET') return json({ ok: true, service: 'rumi-portal', version: 2 });
    if (url.pathname.startsWith('/portal/api/') || ['/demo/access', '/demo/native-access', '/demo/status', '/demo/test'].includes(url.pathname)) {
      const wrapped = new Request(request.url, request);
      // Never let callers choose the actor or access an internal administration route.
      wrapped.headers.set('X-Rork-DO-Class', 'LindenPortal');
      try {
        wrapped.headers.set('X-Rork-DO-Id', url.pathname === '/demo/test' ? 'showcase-v1' : await testWorkspace(request, env.DEMO_ACCESS_CODE) ?? 'showcase-v1');
      } catch (error) {
        return json({ detail: error instanceof HTTPError ? error.message : 'Invalid test access.' }, 403);
      }
      return env.DO.fetch(wrapped);
    }
    if (['/agent/sessions', '/voice/speech', '/voice/transcribe'].includes(url.pathname) && request.method === 'POST') {
      const wrapped = new Request(request.url, request);
      wrapped.headers.set('X-Rork-DO-Class', 'LindenAgentGate');
      wrapped.headers.set('X-Rork-DO-Id', 'agent-gate-v1');
      return env.DO.fetch(wrapped);
    }
    if (url.pathname === '/agent/ws') {
      const id = url.searchParams.get('session_id') ?? '';
      const origin = request.headers.get('Origin');
      if (origin && origin !== url.origin && origin !== env.LINDEN_PORTAL_ORIGIN) return json({ detail: 'This request is not allowed.' }, 403);
      if (!await verifyAgentTicket(id, request.headers.get('X-Agent-Token') ?? '', env.DEMO_ACCESS_CODE)) return json({ detail: 'Session expired. Reconnect to continue.' }, 401);
      const wrapped = new Request(request.url, request);
      wrapped.headers.set('X-Rork-DO-Class', 'LindenAgent');
      wrapped.headers.set('X-Rork-DO-Id', id);
      return env.DO.fetch(wrapped);
    }
    return json({ detail: 'Not found' }, 404);
  },
} satisfies ExportedHandler<Env>;
