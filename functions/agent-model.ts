import { record, SYSTEM_PROMPT, TOOLS, type Args } from './agent-policy';

export interface ModelEnv { EXPO_PUBLIC_TOOLKIT_URL?: string; EXPO_PUBLIC_RORK_TOOLKIT_SECRET_KEY?: string }
export interface ToolCall { id: string; type: 'function'; function: { name: string; arguments: string } }
export type Part = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
export interface Message { role: 'system' | 'user' | 'assistant' | 'tool'; content: string | Part[] | null; tool_calls?: ToolCall[]; tool_call_id?: string }
export interface Completion { message: Message; calls: { id: string; name: string; args: Args }[] }
/** Strict streamed tool assembly: no browser action can execute until the entire stream has completed. */
export async function complete(env: ModelEnv, messages: Message[], signal: AbortSignal, onText: (text: string) => void): Promise<Completion> {
  if (!env.EXPO_PUBLIC_RORK_TOOLKIT_SECRET_KEY) {
    console.error('agent_model_configuration_missing', { endpoint: !!env.EXPO_PUBLIC_TOOLKIT_URL, credential: !!env.EXPO_PUBLIC_RORK_TOOLKIT_SECRET_KEY });
    throw new Error('AI unavailable');
  }
  const response = await fetch((env.EXPO_PUBLIC_TOOLKIT_URL || 'https://toolkit.rork.com').replace(/\/$/, '') + '/v2/vercel/v1/chat/completions', {
    method: 'POST', signal: AbortSignal.any([signal, AbortSignal.timeout(65000)]),
    headers: { Authorization: `Bearer ${env.EXPO_PUBLIC_RORK_TOOLKIT_SECRET_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'anthropic/claude-sonnet-5.5', messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages], tools: TOOLS, tool_choice: 'auto', max_tokens: 8192, stream: true, stream_options: { include_usage: true } }),
  });
  if (!response.ok || !response.body) {
    console.error('agent_model_http_failed', response.status);
    throw new Error('AI unavailable');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', text = '', reason = '', finished = false, size = 0;
  const calls = new Map<number, ToolCall>();
  try {
    while (!finished) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 1000000) throw new Error('AI response too large');
      buffer += decoder.decode(chunk.value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim(); buffer = buffer.slice(newline + 1);
        if (!line.startsWith('data:')) continue;
        const raw = line.slice(5).trim();
        if (raw === '[DONE]') { finished = true; break; }
        const event = record(JSON.parse(raw));
        if (event.error) throw new Error('AI stream interrupted');
        for (const item of Array.isArray(event.choices) ? event.choices : []) {
          const choice = record(item);
          if (typeof choice.finish_reason === 'string') reason = choice.finish_reason;
          const delta = record(choice.delta ?? {});
          if (delta.refusal) throw new Error('AI declined');
          if (typeof delta.content === 'string') { text += delta.content; onText(delta.content); }
          for (const item of Array.isArray(delta.tool_calls) ? delta.tool_calls : []) {
            const fragment = record(item);
            const index = Number(fragment.index);
            if (!Number.isSafeInteger(index) || index < 0 || index > 5) throw new Error('Invalid tool index');
            const call = calls.get(index) ?? { id: '', type: 'function', function: { name: '', arguments: '' } };
            if (typeof fragment.id === 'string') call.id = fragment.id;
            const fn = record(fragment.function ?? {});
            if (typeof fn.name === 'string') call.function.name += fn.name;
            if (typeof fn.arguments === 'string') call.function.arguments += fn.arguments;
            calls.set(index, call);
          }
        }
      }
    }
  } finally { await reader.cancel().catch(() => {}); }
  signal.throwIfAborted();
  if (!finished || !['stop', 'tool_calls'].includes(reason)) throw new Error('Incomplete AI response');
  const assembled = [...calls.values()];
  const parsed = assembled.map(call => {
    if (!call.id || !call.function.name || call.function.arguments.length > 16000) throw new Error('Invalid tool');
    return { id: call.id, name: call.function.name, args: record(JSON.parse(call.function.arguments || '{}')) };
  });
  return { message: { role: 'assistant', content: text || null, ...(assembled.length ? { tool_calls: assembled } : {}) }, calls: parsed };
}
