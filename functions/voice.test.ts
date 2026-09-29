import { expect, test, spyOn } from 'bun:test';
import { boundedAudio, speechText, VoiceService } from './voice';

test('speech delivery preserves numbers and prevents arbitrary audio tags', () => {
  expect(speechText('**A1c: 6.4%**. Take 5 mg [daily].')).toBe('[warm] A1c: 6.4%. Take 5 mg (daily).');
  expect(speechText('[shouting] Hello')).toBe('[warm] (shouting) Hello');
});

test('audio size is bounded even without Content-Length', async () => {
  await expect(boundedAudio(new Request('https://local/voice/transcribe', { method: 'POST', body: new Uint8Array(1_000_001) }))).rejects.toThrow('under 30 seconds');
  await expect(boundedAudio(new Request('https://local/voice/transcribe', { method: 'POST', body: new Uint8Array(10) }))).rejects.toThrow('No usable audio');
});

test('missing voice credentials fail closed', async () => {
  const service = new VoiceService({});
  await expect(service.fetch(new Request('https://local/voice/speech', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Hello' }) }))).rejects.toThrow('not configured');
});

test('v4 availability is mandatory; there is no silent older-model fallback', async () => {
  const fetchMock = spyOn(globalThis, 'fetch').mockResolvedValue(Response.json([{ model_id: 'eleven_v3' }]));
  try {
    await expect(new VoiceService({ ELEVENLABS_API_KEY: 'test-only' }).fetch(new Request('https://local/voice/speech', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Hello' }) }))).rejects.toThrow('No older speech model');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  } finally { fetchMock.mockRestore(); }
});
