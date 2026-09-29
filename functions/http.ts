/** Only deliberate public errors are returned; unexpected exceptions never expose payloads. */
export class HTTPError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
export function json(data: unknown, status = 200, headers: Headers = new Headers()): Response {
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  return Response.json(data, { status, headers });
}
export function stringField(body: Record<string, unknown>, key: string, max = 4000, fallback?: string): string {
  const value = body[key] ?? fallback;
  if (typeof value !== 'string' || value.length > max || (fallback === undefined && !value.trim())) throw new HTTPError(422, `Invalid ${key.replaceAll('_', ' ')}`);
  return value.trim();
}
export function integer(value: unknown, label = 'identifier'): number {
  if ((typeof value !== 'number' && typeof value !== 'string') || !/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < 1) throw new HTTPError(422, `Invalid ${label}`);
  return Number(value);
}
export async function bodyJSON(request: Request): Promise<Record<string, unknown>> {
  if (request.method === 'GET' || request.method === 'HEAD') return {};
  if (!request.body) return {};
  const reader = request.body.getReader();
  let size = 0;
  let text = '';
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 32768) { await reader.cancel(); throw new HTTPError(413, 'Request too large'); }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  if (!text) return {};
  if (!request.headers.get('content-type')?.includes('application/json')) throw new HTTPError(415, 'Send JSON data');
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch { throw new HTTPError(400, 'Invalid JSON'); }
}
export function safeNext(value: string | null): string {
  if (!value || !value.startsWith('/portal/') || /[\\\r\n%]/.test(value)) return '/portal/home';
  const url = new URL(value, 'https://local.invalid');
  return url.origin === 'https://local.invalid' && !url.pathname.startsWith('/portal/api/') ? url.pathname + url.search : '/portal/home';
}
