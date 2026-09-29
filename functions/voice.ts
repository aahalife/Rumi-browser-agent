import { bodyJSON, HTTPError, json } from './http';

/** Server-only provider configuration; never returned to clients or sent to the model. */
export interface VoiceEnv { ELEVENLABS_API_KEY?: string; ELEVENLABS_VOICE_ID?: string }

/** Add a delivery cue without rewriting facts or accepting arbitrary provider audio tags. */
export function speechText(text: string): string {
  return '[warm] ' + text.replace(/\[/g, '(').replace(/\]/g, ')').replace(/[*`#]/g, '').trim();
}

export async function boundedAudio(request: Request): Promise<Uint8Array> {
  const limit = 1_000_000;
  if (Number(request.headers.get('Content-Length') ?? 0) > limit) throw new HTTPError(413, 'Please keep each voice request under 30 seconds.');
  const reader = request.body?.getReader();
  if (!reader) throw new HTTPError(400, 'No audio received.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) { await reader.cancel(); throw new HTTPError(413, 'Please keep each voice request under 30 seconds.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  if (size < 100) throw new HTTPError(400, 'No usable audio received.');
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

/** REST voice adapter. No transcript/audio persistence and no patient API access. */
export class VoiceService {
  private voiceID: string | undefined;
  constructor(private readonly env: VoiceEnv) {}

  private async provider(path: string, init?: RequestInit): Promise<Response> {
    if (!this.env.ELEVENLABS_API_KEY) throw new HTTPError(503, 'Voice is not configured. You can still type to Rumi.');
    const headers = new Headers(init?.headers);
    headers.set('xi-api-key', this.env.ELEVENLABS_API_KEY);
    const response = await fetch(`https://api.elevenlabs.io${path}`, { ...init, headers, signal: AbortSignal.timeout(45000) });
    if (!response.ok) {
      await response.body?.cancel();
      throw new HTTPError(503, response.status === 429 ? 'Voice usage is temporarily limited. Please try later or type your request.' : 'ElevenLabs voice is unavailable. Check the key permissions, credits, and v4 access. You can still type.');
    }
    return response;
  }

  private async configure(): Promise<string> {
    if (this.voiceID) return this.voiceID;
    const models = await (await this.provider('/v1/models')).json() as { model_id: string }[];
    if (!models.some(model => model.model_id === 'eleven_v4')) throw new HTTPError(503, 'ElevenLabs v4 is not available for this account. No older speech model was substituted.');
    if (this.env.ELEVENLABS_VOICE_ID) { this.voiceID = this.env.ELEVENLABS_VOICE_ID; return this.voiceID; }
    const catalog = await (await this.provider('/v2/voices?page_size=100')).json() as { voices?: { voice_id: string; category?: string; description?: string; labels?: Record<string, string> }[] };
    const voices = catalog.voices ?? [];
    const voice = voices.find(item => item.category === 'premade' && /warm|calm|reassuring|soft/i.test(JSON.stringify(item.labels ?? {}) + (item.description ?? ''))) ?? voices.find(item => item.category === 'premade');
    if (!voice) throw new HTTPError(503, 'No default voice is available. Configure an ElevenLabs voice before continuing.');
    this.voiceID = voice.voice_id;
    return voice.voice_id;
  }

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === '/voice/speech') {
      const body = await bodyJSON(request);
      if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 6000) throw new HTTPError(400, 'The reply is too long to read aloud. Please read it in the chat.');
      const voice = await this.configure();
      const response = await this.provider(`/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: speechText(body.text), model_id: 'eleven_v4', voice_settings: { stability: 0.6, similarity_boost: 0.75 } }),
      });
      return new Response(response.body, { headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
    }
    if (path === '/voice/transcribe') {
      if (request.headers.get('Content-Type') !== 'audio/mp4') throw new HTTPError(415, 'Unsupported audio format.');
      const bytes = await boundedAudio(request);
      const form = new FormData();
      form.append('file', new Blob([bytes], { type: 'audio/mp4' }), 'speech.m4a');
      form.append('model_id', 'scribe_v2');
      form.append('tag_audio_events', 'false');
      form.append('diarize', 'false');
      const result = await (await this.provider('/v1/speech-to-text', { method: 'POST', body: form })).json() as { text?: string };
      const text = result.text?.trim() ?? '';
      if (text.length > 4000) throw new HTTPError(400, 'Please use a shorter voice request.');
      return json({ text });
    }
    throw new HTTPError(404, 'Not found');
  }
}
