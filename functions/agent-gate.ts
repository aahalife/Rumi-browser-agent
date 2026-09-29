import { DurableObject } from 'cloudflare:workers';
import { PortalAuth, type AuthEnv } from './auth';
import { HTTPError, bodyJSON, json } from './http';
import { RecordStore } from './store';
import { issueAgentTicket } from './agent-ticket';

/** Auth/usage authority in its own actor; it has no patient records or model/tool execution. */
export class LindenAgentGate extends DurableObject<AuthEnv> {
  override async fetch(request: Request): Promise<Response> {
    const store = new RecordStore(this.ctx.storage.sql, work => this.ctx.storage.transactionSync(work));
    const path = new URL(request.url).pathname;
    try {
      if (path === '/internal/model-budget' && request.method === 'POST') {
        if (!store.limit('model:day', 1200, 86400000, Date.now()) || !store.limit('model:minute', 100, 60000, Date.now())) throw new HTTPError(429, 'Demo usage limit reached. Please try later.');
        return json({ ok: true });
      }
      if (path !== '/agent/sessions' || request.method !== 'POST') return json({ detail: 'Not found' }, 404);
      await bodyJSON(request);
      const address = request.headers.get('CF-Connecting-IP') ?? 'unknown';
      if (!store.limit(`session:${address}`, 30, 600000, Date.now()) || !store.limit('sessions:global', 200, 3600000, Date.now())) throw new HTTPError(429, 'Please wait before reconnecting.');
      const context = await new PortalAuth(store, this.env, Date.now).context(request);
      if (!context.privateAccess) throw new HTTPError(403, 'Private access code was not accepted.');
      const id = crypto.randomUUID().replaceAll('-', '');
      return json({ session_id: id, session_token: await issueAgentTicket(id, this.env.DEMO_ACCESS_CODE!), expires_in: 3600 });
    } catch (error) {
      return json({ detail: error instanceof HTTPError ? error.message : 'Unable to start the assistant.' }, error instanceof HTTPError ? error.status : 500);
    }
  }
}
