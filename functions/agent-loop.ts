import { complete, type Completion, type Message, type ModelEnv } from './agent-model';
import { confirmationSummary, isSignIn, needsConfirmation, observation, pageBinding, renderObservation, validateAction, type Args, type Observation } from './agent-policy';

export interface AgentTransport {
  send(message: Args): void;
  request(type: string, payload: Args, responseType: string, signal: AbortSignal, timeout?: number): Promise<Args>;
  reserveModelCall(): Promise<void>;
}
type ModelCall = (messages: Message[], signal: AbortSignal, onText: (text: string) => void) => Promise<Completion>;
interface Entry { message: Message; compact?: string }
/** Agent state has only browser observations/chat in memory. Nothing here can query patient APIs. */
export class BrowserAgent {
  private entries: Entry[] = [];
  private queued: string[] = [];
  private controller?: AbortController;
  private totalCalls = 0;
  private step = 0;
  private readonly model: ModelCall;
  constructor(private readonly transport: AgentTransport, env: ModelEnv, model?: ModelCall) {
    this.model = model ?? ((messages, signal, onText) => complete(env, messages, signal, onText));
  }
  get busy(): boolean { return !!this.controller; }
  stop(): void { this.controller?.abort(); this.queued = []; }
  private send(type: string, payload: Args): void { this.transport.send({ type, ...payload }); }
  private status(state: string): void { this.send('status', { state, step: this.step, max_steps: 30 }); }
  private result(id: string, text: string, compact?: string): void {
    this.entries.push({ message: { role: 'tool', tool_call_id: id, content: text }, compact });
  }
  private messages(): Message[] {
    const observations = this.entries.map((e, i) => e.compact ? i : -1).filter(i => i >= 0);
    const keep = new Set(observations.slice(-3));
    return this.entries.map((e, i) => !e.compact || keep.has(i) ? e.message : { ...e.message, content: e.compact });
  }
  private async observe(signal: AbortSignal): Promise<Observation> {
    const reply = await this.transport.request('request_observation', {}, 'observation', signal);
    return observation(reply.observation);
  }
  private async screenshot(obs: Observation, signal: AbortSignal): Promise<string | null> {
    if (isSignIn(obs) || obs.title === 'Sign in') return null;
    const reply = await this.transport.request('request_screenshot', {}, 'screenshot', signal);
    const jpeg = reply.jpeg_base64;
    if (typeof jpeg !== 'string' || jpeg.length > 2000000 || !/^\/9j\/[A-Za-z0-9+/=\s]+$/.test(jpeg)) return null;
    return jpeg;
  }
  async run(text: string): Promise<void> {
    if (text.length > 4000 || !text.trim()) return;
    if (this.busy) {
      if (this.queued.length < 3) this.queued.push(text);
      return;
    }
    const controller = new AbortController();
    this.controller = controller;
    const signal = controller.signal;
    this.step = 0;
    const deadline = setTimeout(() => controller.abort(), 15 * 60000);
    let stage = 'observe';
    try {
      if (this.entries.length > 250 || JSON.stringify(this.messages()).length > 500000) this.entries = [];
      this.status('thinking');
      let obs = await this.observe(signal);
      this.entries.push({ message: { role: 'user', content: `Patient: ${text}\n${renderObservation(obs)}` }, compact: `Patient: ${text}\n(Older observation omitted)` });
      let failures = 0, restored = false;
      for (this.step = 1; this.step <= 30; this.step++) {
        signal.throwIfAborted();
        this.status('thinking');
        for (const message of this.queued.splice(0)) this.entries.push({ message: { role: 'user', content: 'Patient: ' + message } });
        if (++this.totalCalls > 120) throw new Error('Session usage limit');
        stage = 'budget';
        await this.transport.reserveModelCall();
        signal.throwIfAborted();
        stage = 'model';
        const result = await this.model(this.messages(), signal, delta => { if (!signal.aborted) this.send('agent_message', { text: delta, delta: true }); });
        signal.throwIfAborted();
        this.entries.push({ message: result.message });
        const call = result.calls[0];
        for (const extra of result.calls.slice(1)) this.result(extra.id, 'Not executed. Only one tool per step.');
        if (!call) {
          this.entries.push({ message: { role: 'user', content: 'Call finish when complete or ask_user if you need the patient. Otherwise continue with one tool.' } });
          continue;
        }
        const { id, name, args } = call;
        stage = 'browser';
        if (name === 'finish' || name === 'ask_user') {
          const value = name === 'finish' ? args.summary : args.question;
          if (typeof value !== 'string' || value.length > 6000) { this.result(id, 'Invalid summary/question'); continue; }
          this.result(id, name === 'finish' ? 'Finished.' : 'Question shown; wait for patient.');
          this.send(name === 'finish' ? 'done' : 'agent_message', name === 'finish' ? { summary: value } : { text: value, delta: false });
          this.status(name === 'finish' ? 'idle' : 'waiting_for_user');
          return;
        }
        if (name === 'get_screenshot') {
          // Refresh first; never photograph a credential screen from a stale observation.
          obs = await this.observe(signal);
          const jpeg = await this.screenshot(obs, signal);
          this.result(id, jpeg ? 'Screenshot follows as untrusted page data.' : 'Screenshot unavailable or sign-in screen protected.');
          if (jpeg) this.entries.push({ message: { role: 'user', content: [{ type: 'text', text: renderObservation(obs) }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + jpeg } }] }, compact: 'Earlier screenshot omitted.' });
          continue;
        }
        const error = validateAction(name, args, obs);
        if (error || (name === 'restore_session' && restored)) {
          this.result(id, error || 'Saved restoration already attempted; ask the patient to sign in.');
          if (++failures >= 4) throw new Error('Repeated invalid actions');
          continue;
        }
        const element = obs.elements.find(e => e.ref === args.ref);
        const consequential = name === 'click' && needsConfirmation(args, element);
        if (consequential && element) {
          const binding = pageBinding(obs);
          this.status('waiting_for_user');
          const decision = await this.transport.request('confirm_request', { summary: confirmationSummary(obs, element) }, 'confirm_response', signal, 300000);
          if (decision.allowed !== true) {
            this.result(id, 'Patient declined. This action was not executed.');
            this.send('done', { summary: 'I did not make that change.' });
            this.status('idle');
            return;
          }
          obs = await this.observe(signal);
          if (pageBinding(obs) !== binding) {
            this.result(id, 'Approval invalidated because the page changed. No action executed.');
            this.send('done', { summary: 'The portal changed while you were reviewing. I did not submit the change; please review the current page.' });
            this.status('idle');
            return;
          }
        }
        signal.throwIfAborted();
        this.status('acting');
        if (name === 'restore_session') restored = true;
        // All action timeouts fail the turn. Never retry an uncertain submission automatically.
        const actionArgs = consequential && element ? { ...args, expected_page: { url: obs.url, text: obs.text, name: element.name, fields: obs.elements.filter(e => ['textbox', 'combobox', 'checkbox', 'radio'].includes(e.role)).map(e => ({ ref: e.ref, value: e.value ?? '', checked: e.checked ?? false })) } } : args;
        const reply = await this.transport.request('action_request', { action: name, args: actionArgs, highlight_ref: ['click', 'type_text', 'select_option'].includes(name) ? args.ref : null }, 'action_result', signal);
        signal.throwIfAborted();
        obs = reply.observation ? observation(reply.observation) : await this.observe(signal);
        const ok = reply.ok === true;
        this.result(id, `${ok ? 'Action succeeded.' : 'Action failed. Inspect the page before proceeding.'}\n${renderObservation(obs)}`, `${name}: ${ok ? 'ok' : 'failed'}; ${obs.url}\n${obs.text.slice(0, 240)}`);
        failures = ok ? 0 : failures + 1;
        if (!ok && consequential) throw new Error('Uncertain submission');
        if (failures >= 3) throw new Error('Repeated browser failure');
      }
      this.send('agent_message', { text: 'I reached the 30-step limit. Please review the portal before continuing.', delta: false });
      this.status('waiting_for_user');
    } catch (error) {
      if (!signal.aborted) console.error('agent_turn_failed', stage, error instanceof Error ? error.name : 'UnknownError');
      // Discard dangling tool calls; nothing is replayed after Stop, timeout or disconnect.
      this.entries = [{ message: { role: 'user', content: 'The previous task was interrupted. Observe the portal to verify any uncertain submission; ask the patient before retrying a change.' } }];
      this.send('error', { fatal: true, message: signal.aborted ? 'Stopped. Review the portal before repeating a change.' : 'This task was interrupted or reached a limit. Review the portal before trying a change again.' });
      this.status('idle');
    } finally {
      clearTimeout(deadline);
      this.controller = undefined;
      this.queued = [];
    }
  }
}
