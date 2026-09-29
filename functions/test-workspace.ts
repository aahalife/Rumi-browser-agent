import { HTTPError } from './http';

const cookieName = '__Host-linden_test';
async function key(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
/** Signed, expiring test routing. An invalid/expired selector must never fall back to showcase data. */
export async function testWorkspace(request: Request, secret: string | undefined, now = Date.now()): Promise<string | null> {
  const raw = request.headers.get('cookie')?.split(';').map(v => v.trim()).find(v => v.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
  if (!raw) return null;
  const match = /^(\d+)\.([a-f0-9]{32})\.([a-f0-9]{64})$/.exec(raw);
  if (!secret || !match || Number(match[1]) <= now || Number(match[1]) > now + 86400000) throw new HTTPError(403, 'Test access expired. Start a new isolated test session.');
  const signature = new Uint8Array(match[3].match(/../g)!.map(v => parseInt(v, 16)));
  if (!await crypto.subtle.verify('HMAC', await key(secret), signature, new TextEncoder().encode(`${match[1]}.${match[2]}`))) throw new HTTPError(403, 'Invalid test access.');
  return `test-${match[2]}`;
}
/** Called only after private authentication and global rate limiting; never resets existing records. */
export async function createTestWorkspace(secret: string, now = Date.now()): Promise<string> {
  const id = crypto.randomUUID().replaceAll('-', '');
  const payload = `${now + 86400000}.${id}`;
  const signature = await crypto.subtle.sign('HMAC', await key(secret), new TextEncoder().encode(payload));
  const hex = [...new Uint8Array(signature)].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${cookieName}=${payload}.${hex}; Path=/; Max-Age=86400; Secure; HttpOnly; SameSite=Strict`;
}
