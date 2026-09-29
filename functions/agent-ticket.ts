/** One-hour session bearer credentials stay in headers, never URL query strings or traces. */
async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
export async function issueAgentTicket(id: string, secret: string, now = Date.now()): Promise<string> {
  const expires = now + 3600000;
  const payload = `linden-agent:${id}:${expires}`;
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), new TextEncoder().encode(payload));
  return `${expires}.${[...new Uint8Array(signature)].map(b => b.toString(16).padStart(2, '0')).join('')}`;
}
export async function verifyAgentTicket(id: string, ticket: string, secret: string | undefined, now = Date.now()): Promise<number | null> {
  if (!secret || secret.length < 16 || !/^[a-f0-9]{32}$/.test(id)) return null;
  const match = /^(\d+)\.([a-f0-9]{64})$/.exec(ticket);
  if (!match || Number(match[1]) <= now || Number(match[1]) > now + 3600000) return null;
  const signature = new Uint8Array(match[2].match(/../g)!.map(v => parseInt(v, 16)));
  const valid = await crypto.subtle.verify('HMAC', await hmacKey(secret), signature, new TextEncoder().encode(`linden-agent:${id}:${match[1]}`));
  return valid ? Number(match[1]) : null;
}
