import { expect, test } from 'bun:test';
import { createTestWorkspace, testWorkspace } from './test-workspace';
const secret = 'local-workspace-test-secret';
const now = 1790668800000;
const req = (cookie: string) => new Request('https://portal.test/demo/status', { headers: { cookie } });
test('no selector means showcase; signed selectors are isolated and stable', async () => {
  expect(await testWorkspace(req(''), secret, now)).toBeNull();
  const cookie = (await createTestWorkspace(secret, now)).split(';')[0];
  const id = await testWorkspace(req(cookie), secret, now);
  expect(id).toMatch(/^test-[a-f0-9]{32}$/);
  expect(await testWorkspace(req(cookie), secret, now + 1000)).toBe(id);
});
test('expired, forged, and rotated selectors fail closed rather than using showcase', async () => {
  const cookie = (await createTestWorkspace(secret, now)).split(';')[0];
  await expect(testWorkspace(req(cookie), secret, now + 86400001)).rejects.toThrow();
  await expect(testWorkspace(req(cookie + 'a'), secret, now)).rejects.toThrow();
  await expect(testWorkspace(req(cookie), 'different-secret', now)).rejects.toThrow();
});
