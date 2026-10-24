// Optional cloud AI for MENTO (hybrid mode). Everything stays local unless the operator sets CLOUD_AI and a key in .env.
// - Claude (Anthropic) writes text: questions, judging, Japanese, record drafts, reply suggestions; with CLOUD_AI=vision it also sees frames.
// - Speech-to-text can use any OpenAI-compatible /audio/transcriptions endpoint (OpenAI, Groq, …).
// Every cloud failure falls back to the local models, and a failing service is skipped for a while so the app never waits on it twice.
// Keys are read only here, never sent to browsers, and scrubbed from every error message.
import Anthropic from '@anthropic-ai/sdk';

const S = (props) => ({ type: 'object', properties: props, required: Object.keys(props), additionalProperties: false });
const str = { type: 'string' }, num = { type: 'number' }, strs = { type: 'array', items: str };
// One JSON schema per task: structured outputs guarantee parseable JSON in the shape the local prompts already ask for.
export const SCHEMAS = {
  see: S({ action: str, objects: str, change: str, notable: { type: 'boolean' }, importance: num, uncertainty: str }),
  ask: S({ manual_covers: str, questions: strs }),
  judge: S({ scores: { type: 'array', items: num }, best: { type: 'integer' } }),
  translate: S({ ja: str }),
  followup: S({ question: str }),
  draft: S({ summary: str, cues: str, warnings: str, step: str, tool: str }),
  check: S({ status: { type: 'string', enum: ['on_track', 'possible_issue', 'cannot_assess', 'safety_stop'] }, stage: str, evidence: str, confidence: { type: 'string', enum: ['low', 'medium', 'high'] }, knowledge_ids: strs, feedback: str, needs_help: { type: 'boolean' } }),
  reply: S({ reply: str, knowledge_ids: strs }),
  say: S({ text: str }),
};
const NEEDS_PICTURE = new Set(['see', 'check']); // useless without the image: cloud only when vision is allowed
// Models that accept server-side refusal fallbacks (the API re-runs a declined request on a suitable model).
const FALLBACK_OK = /^claude-(opus-5-5|opus-5|fable-5-1|sonnet-5-5)$/;

export function createCloud(E = process.env, o = {}) {
  const mode = ['text', 'vision'].includes(E.CLOUD_AI) ? E.CLOUD_AI : 'off';
  const key = o.key ?? E.ANTHROPIC_API_KEY ?? '', model = E.CLOUD_MODEL || 'claude-opus-5-5', effort = E.CLOUD_EFFORT || 'low';
  const timeout = +(E.CLOUD_TIMEOUT_MS || 30000);
  const stt = { on: E.CLOUD_STT === '1' && !!E.CLOUD_STT_KEY, url: E.CLOUD_STT_URL || 'https://api.openai.com/v1/audio/transcriptions', key: E.CLOUD_STT_KEY || '', model: E.CLOUD_STT_MODEL || 'gpt-4o-transcribe' };
  const llmOn = mode !== 'off' && !!key;
  const client = llmOn ? new Anthropic({ apiKey: key, timeout, maxRetries: 1, ...(E.CLOUD_BASE_URL ? { baseURL: E.CLOUD_BASE_URL } : {}) }) : null;
  const scrub = (m) => [key, stt.key].filter((k) => k && k.length > 8).reduce((s, k) => s.split(k).join('[key]'), String(m || '')).slice(0, 200);
  const st = { llm: { calls: 0, fallbacks: 0, lastError: '', until: 0 }, stt: { calls: 0, fallbacks: 0, lastError: '', until: 0 } };
  // Wrong key/model: stop trying for 30 min. Network, rate limit or outage: retry after a minute.
  const fail = (s, e, permanent) => { s.fallbacks++; s.lastError = scrub(e.message); s.until = Date.now() + (permanent ? 30 : 1) * 60000; };
  const ready = (s) => Date.now() >= s.until;

  // 'vision' = send the image(s); 'text' = send only the text prompt; null = use the local model.
  function route(kind, hasImg) {
    if (!llmOn || !ready(st.llm)) return null;
    if (hasImg && mode === 'vision') return 'vision';
    return NEEDS_PICTURE.has(kind) ? null : 'text';
  }
  async function json(kind, prompt, imgs = []) {
    const content = [...imgs.map((b) => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b.toString('base64') } })), { type: 'text', text: prompt }];
    const body = { model, max_tokens: 8000, output_config: { effort, format: { type: 'json_schema', schema: SCHEMAS[kind] } }, messages: [{ role: 'user', content }] };
    st.llm.calls++;
    try {
      const r = FALLBACK_OK.test(model) ? await client.beta.messages.create({ ...body, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }) : await client.messages.create(body);
      if (r.stop_reason === 'refusal') throw new Error('Cloud model declined this request');
      if (r.stop_reason === 'max_tokens') throw new Error('Cloud answer was cut off');
      const text = r.content.find((b) => b.type === 'text')?.text;
      if (!text) throw new Error('Cloud answer had no text');
      return text;
    } catch (e) {
      fail(st.llm, e, e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError || e instanceof Anthropic.NotFoundError || e instanceof Anthropic.BadRequestError);
      throw Object.assign(new Error('Cloud AI: ' + scrub(e.message)), { cloud: true });
    }
  }
  // OpenAI-compatible transcription; returns the text or throws (the caller then uses local whisper).
  async function transcribe(buf, file, mime, { language, prompt } = {}) {
    if (!stt.on || !ready(st.stt)) return null;
    const f = new FormData();
    f.append('file', new Blob([buf], { type: mime }), file); f.append('model', stt.model); f.append('response_format', 'json');
    if (language && language !== 'auto') f.append('language', language);
    if (prompt) f.append('prompt', prompt);
    st.stt.calls++;
    try {
      const r = await fetch(stt.url, { method: 'POST', headers: { authorization: 'Bearer ' + stt.key }, body: f, signal: AbortSignal.timeout(timeout) });
      if (!r.ok) throw Object.assign(new Error('HTTP ' + r.status), { permanent: [400, 401, 403, 404].includes(r.status) });
      const j = await r.json();
      if (typeof j.text !== 'string') throw new Error('no text in reply');
      return j.text;
    } catch (e) { fail(st.stt, e, e.permanent); throw Object.assign(new Error('Cloud speech-to-text: ' + scrub(e.message)), { cloud: true }); }
  }
  const sttHost = (() => { try { return new URL(stt.url).hostname; } catch { return ''; } })();
  // Safe to show anyone: what is on and what leaves the computer, never keys.
  const status = () => ({
    mode: llmOn ? mode : 'off', provider: llmOn ? 'Anthropic' : null, model: llmOn ? model : null,
    stt: stt.on ? { host: sttHost, model: stt.model } : null,
    calls: st.llm.calls, fallbacks: st.llm.fallbacks, lastError: st.llm.lastError || null, paused: llmOn && !ready(st.llm),
    sttCalls: st.stt.calls, sttFallbacks: st.stt.fallbacks, sttLastError: st.stt.lastError || null,
  });
  return { route, json, transcribe, status, label: llmOn ? 'claude:' + model : null, sttLabel: stt.on ? 'cloud:' + stt.model : null, vision: llmOn && mode === 'vision' };
}
