import { afterEach, expect, spyOn, test } from 'bun:test';
import { complete } from './agent-model';
const env = { EXPO_PUBLIC_RORK_TOOLKIT_SECRET_KEY: 'test-only-no-network', EXPO_PUBLIC_TOOLKIT_URL: 'https://toolkit.test' };
let restore: (() => void) | undefined;
afterEach(() => restore?.());
function stream(lines: unknown[], done: boolean): void {
  const body = lines.map(v => 'data: ' + JSON.stringify(v) + '\n\n').join('') + (done ? 'data: [DONE]\n\n' : '');
  const spy = spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body));
  restore = () => spy.mockRestore();
}
const fragment = { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-1', function: { name: 'click', arguments: '{"ref":1,"consequential":true}' } }] }, finish_reason: 'tool_calls' }] };
test('complete SSE tools assemble only after final done marker', async () => {
  stream([fragment], true);
  const result = await complete(env, [], new AbortController().signal, () => {});
  expect(result.calls[0]).toEqual({ id: 'call-1', name: 'click', args: { ref: 1, consequential: true } });
});
test('truncated SSE never returns executable tool calls', async () => {
  stream([fragment], false);
  await expect(complete(env, [], new AbortController().signal, () => {})).rejects.toThrow('Incomplete');
});
test('refused and malformed tool streams are rejected', async () => {
  stream([{ choices: [{ delta: { refusal: 'Declined' }, finish_reason: 'stop' }] }], true);
  await expect(complete(env, [], new AbortController().signal, () => {})).rejects.toThrow();
});
