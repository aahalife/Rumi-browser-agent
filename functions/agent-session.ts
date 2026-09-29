import { DurableObject } from 'cloudflare:workers';
import { BrowserAgent } from './agent-loop';
import { record, type Args } from './agent-policy';
import type { ModelEnv } from './agent-model';
import { verifyAgentTicket } from './agent-ticket';
import { json } from './http';

export interface AgentEnv extends ModelEnv { DO: Fetcher; DEMO_ACCESS_CODE?: string; LINDEN_PORTAL_ORIGIN?: string }
interface Pending { type: string; resolve: (value: Args) => void; reject: (error: Error) => void }
/** One transient browser session per actor. No transcripts, screenshots or credentials are persisted. */
export class LindenAgent extends DurableObject<AgentEnv> {
  private agent?: BrowserAgent;
  private socket?: WebSocket;
  private pending = new Map<string, Pending>();
  private expires = 0;
  private turnCount = 0;
  private generation = '';
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const expires = await verifyAgentTicket(url.searchParams.get('session_id') ?? '', request.headers.get('X-Agent-Token') ?? '', this.env.DEMO_ACCESS_CODE);
    if (!expires) return json({ detail: 'Session expired. Reconnect to continue.' }, 401);
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return json({ detail: 'WebSocket required' }, 426);
    this.halt();
    for (const peer of this.ctx.getWebSockets()) peer.close(4004, 'Replaced connection');
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    this.socket = server;
    this.expires = expires;
    this.generation = this.env.DEMO_ACCESS_CODE ?? '';
    // New transport owns a new loop. Reconnection never resumes a pending browser action.
    this.agent = new BrowserAgent({
      send: message => this.send(server, message),
      request: (type, payload, responseType, signal, timeout) => this.request(server, type, payload, responseType, signal, timeout),
      reserveModelCall: async () => {
        if (Date.now() >= this.expires || this.generation !== this.env.DEMO_ACCESS_CODE) throw new Error('Expired session');
        const r = await this.env.DO.fetch(new Request('https://internal/internal/model-budget', { method: 'POST', headers: { 'X-Rork-DO-Class': 'LindenAgentGate', 'X-Rork-DO-Id': 'agent-gate-v1' } }));
        if (!r.ok) throw new Error('Demo usage limit');
      },
    }, this.env);
    this.send(server, { type: 'status', state: 'idle', step: 0, max_steps: 30 });
    return new Response(null, { status: 101, webSocket: client });
  }
  private send(ws: WebSocket, message: Args): void {
    try { ws.send(JSON.stringify(message)); } catch { this.halt(); }
  }
  private request(ws: WebSocket, type: string, payload: Args, responseType: string, signal: AbortSignal, timeout = 20000): Promise<Args> {
    signal.throwIfAborted();
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const cleanup = (): void => { clearTimeout(timer); signal.removeEventListener('abort', abort); this.pending.delete(id); };
      const fail = (error: Error): void => { cleanup(); reject(error); };
      const abort = (): void => fail(new Error('Stopped'));
      const timer = setTimeout(() => fail(new Error('Phone response timeout')), timeout);
      signal.addEventListener('abort', abort, { once: true });
      this.pending.set(id, { type: responseType, resolve: value => { cleanup(); resolve(value); }, reject: fail });
      this.send(ws, { type, id, ...payload });
    });
  }
  override webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): void {
    if (ws !== this.socket || !this.agent) {
      ws.close(4004, 'Session interrupted; reconnect');
      return;
    }
    if (Date.now() >= this.expires || this.generation !== this.env.DEMO_ACCESS_CODE) { this.halt(); ws.close(4004, 'Session expired'); return; }
    if (typeof raw !== 'string' || raw.length > 2200000) { this.halt(); ws.close(1009, 'Message too large'); return; }
    try {
      const message = record(JSON.parse(raw));
      if (message.type === 'stop') { this.halt(); return; }
      if (message.type === 'user_message') {
        if (typeof message.text !== 'string' || message.text.length > 4000 || ++this.turnCount > 40) throw new Error('Message limit');
        // Do not await the loop: responses and Stop must be delivered while it is waiting.
        this.ctx.waitUntil(this.agent.run(message.text));
        return;
      }
      if (typeof message.id !== 'string') return;
      const pending = this.pending.get(message.id);
      if (pending && message.type === pending.type) pending.resolve(message);
    } catch {
      this.send(ws, { type: 'error', fatal: true, message: 'Invalid request or session limit. Reconnect to continue.' });
      this.halt();
    }
  }
  private halt(): void {
    this.agent?.stop();
    for (const pending of [...this.pending.values()]) pending.reject(new Error('Connection interrupted'));
    this.pending.clear();
  }
  override webSocketClose(ws: WebSocket): void { if (ws === this.socket) { this.halt(); this.socket = undefined; this.agent = undefined; } }
  override webSocketError(ws: WebSocket): void { this.webSocketClose(ws); }
}
