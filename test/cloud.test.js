// Hybrid AI (lib/cloud.js): routing, local fallback, key safety. A fake Anthropic API, fake Ollama and fake
// speech-to-text service run on localhost, so no real key or network is needed.
import test, { before, after } from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import http from 'node:http';
import { createCloud } from '../lib/cloud.js';

const KEY = 'sk-ant-test-SECRET-0123456789', STT_KEY = 'sk-stt-test-SECRET-9876543210';
const seen = { claude: [], ollama: 0, stt: [], compat: [] }; let fail = false, echoKey = false, compatNoSchema = false;
const answerFor = (props) => {
  if (props.ja) return { ja: 'なぜ横から挟むのですか？' };
  if (props.questions) return { manual_covers: 'nothing', questions: ['Why do you clamp from that side?', 'How do you know it is ready?', 'What do you do differently on old boards?'] };
  if (props.scores) return { scores: [5, 3, 2], best: 0 };
  if (props.reply) return { reply: 'Lift the iron as soon as the solder flows and shines.', knowledge_ids: [seen.known, 'made-up-id'] };
  if (props.summary) return { summary: 'Cloud summary.', cues: 'shiny', warnings: '', step: 'Heat the joint', tool: '' };
  return { question: 'Why then?' };
};
let mock, mockUrl;
before(async () => {
  mock = http.createServer((req, res) => {
    let b = []; req.on('data', (c) => b.push(c)); req.on('end', () => {
      b = Buffer.concat(b);
      if (req.url.startsWith('/v1/messages')) {
        const body = JSON.parse(b); seen.claude.push({ url: req.url, headers: req.headers, body });
        if (fail) { res.writeHead(500, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: echoKey ? 'bad key ' + KEY : 'overloaded' } })); }
        const out = answerFor(body.output_config.format.schema.properties);
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ id: 'msg_1', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text: JSON.stringify(out) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }));
      }
      if (req.url === '/compat/chat/completions') { // OpenAI-compatible (Gemini) API
        const body = JSON.parse(b); seen.compat.push({ headers: req.headers, body });
        if (body.model === 'gemini-busy') { res.writeHead(503, { 'content-type': 'application/json' }); return res.end('{"error":{"message":"high demand"}}'); }
        if (seen.compat.length === 1) { res.writeHead(429, { 'retry-after': '0.01', 'content-type': 'application/json' }); return res.end('{}'); }
        if (body.response_format.type === 'json_schema' && compatNoSchema) { res.writeHead(400, { 'content-type': 'application/json' }); return res.end(JSON.stringify([{ error: { message: 'Invalid JSON payload: unknown field in response_format schema' } }])); }
        const props = body.response_format.json_schema?.schema.properties || JSON.parse(body.messages[0].content[0].text.split('JSON schema:\n')[1]).properties;
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '```json\n' + JSON.stringify(answerFor(props)) + '\n```' } }] }));
      }
      if (req.url === '/api/chat') { seen.ollama++; res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ message: { content: JSON.stringify({ summary: 'Local summary.', cues: '', warnings: '', step: 'Local step', tool: '', reply: 'Local reply.', knowledge_ids: [] }) } })); }
      if (req.url === '/stt') { seen.stt.push({ headers: req.headers, body: b.toString() }); res.writeHead(fail ? 503 : 200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ text: ' はんだごてを当てます。 ' })); }
      res.writeHead(404); res.end();
    });
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r)); mockUrl = 'http://127.0.0.1:' + mock.address().port;
});
after(() => mock.close());
const cfg = (x = {}) => ({ CLOUD_AI: 'text', ANTHROPIC_API_KEY: KEY, CLOUD_BASE_URL: mockUrl, CLOUD_MODEL: 'claude-haiku-5-5', ...x });

test('cloud is off unless CLOUD_AI and a key are both set', () => {
  for (const E of [{}, { CLOUD_AI: 'text' }, { ANTHROPIC_API_KEY: KEY }, { CLOUD_AI: 'yes', ANTHROPIC_API_KEY: KEY }]) {
    const c = createCloud(E); assert.equal(c.route('ask', true), null); assert.equal(c.status().mode, 'off'); assert.equal(c.label, null);
  }
});
test('text mode keeps pictures local; vision mode sends them', () => {
  const t = createCloud(cfg()), v = createCloud(cfg({ CLOUD_AI: 'vision' }));
  assert.equal(t.route('see', true), null); assert.equal(t.route('check', true), null);
  assert.equal(t.route('ask', true), 'text'); assert.equal(t.route('judge', false), 'text'); assert.equal(t.route('draft', false), 'text');
  assert.equal(v.route('see', true), 'vision'); assert.equal(v.route('ask', true), 'vision'); assert.equal(v.route('translate', false), 'text');
});
test('requests use a JSON schema, send the key only in the header, and no image in text mode', async () => {
  seen.claude = []; const c = createCloud(cfg());
  assert.deepEqual(JSON.parse(await c.json('translate', 'Translate: why?')), { ja: 'なぜ横から挟むのですか？' });
  const r = seen.claude.at(-1);
  assert.ok(r.headers['x-api-key'] === KEY || r.headers.authorization === 'Bearer ' + KEY, 'key sent as a request header'); assert.ok(!r.url.includes(KEY) && !JSON.stringify(r.body).includes(KEY)); assert.equal(r.body.model, 'claude-haiku-5-5');
  assert.equal(r.body.output_config.format.type, 'json_schema'); assert.deepEqual(r.body.output_config.format.schema.required, ['ja']);
  assert.equal(r.body.output_config.effort, 'low'); assert.equal(r.body.messages[0].content.length, 1); assert.equal(r.body.fallbacks, undefined);
  await createCloud(cfg({ CLOUD_AI: 'vision' })).json('see', 'Describe', [Buffer.from([0xff, 0xd8, 1]), Buffer.from([0xff, 0xd8, 2])]);
  assert.deepEqual(seen.claude.at(-1).body.messages[0].content.map((x) => x.type), ['image', 'image', 'text']);
});
test('the default Opus model opts into server-side refusal fallbacks', async () => {
  seen.claude = []; await createCloud(cfg({ CLOUD_MODEL: '' })).json('followup', 'Follow up');
  const r = seen.claude.at(-1);
  assert.equal(r.body.model, 'claude-opus-5-5'); assert.equal(r.body.fallbacks, 'default'); assert.match(r.headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
});
test('a failing cloud is paused, and its errors never contain the key', async () => {
  const c = createCloud(cfg()); fail = true; echoKey = true;
  try {
    await assert.rejects(c.json('judge', 'x'), (e) => e.cloud && !e.message.includes(KEY) && e.message.includes('[key]'));
    assert.equal(c.route('judge', false), null, 'paused after a failure: the app goes straight to the local model');
    const s = JSON.stringify(c.status()); assert.ok(!s.includes(KEY)); assert.equal(c.status().paused, true); assert.equal(c.status().fallbacks, 1);
  } finally { fail = false; echoKey = false; }
});

// ---- the whole app in hybrid mode ----
let srv, base, dir, app, cookie, S, links;
const j = (p, o = {}) => fetch(base + p, { ...o, headers: { 'content-type': 'application/json', ...(o.cookie ? { cookie } : {}), ...(o.tok ? { 'x-token': o.tok } : {}), ...(o.headers || {}) }, body: o.body === undefined ? undefined : (Buffer.isBuffer(o.body) ? o.body : JSON.stringify(o.body)) });
const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypmp42'), Buffer.alloc(2000, 1)]);
const until = async (fn) => { for (let i = 0; i < 60; i++) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 50)); } throw new Error('timed out'); };
let cloud;
test('app: hybrid setup', async () => {
  process.env.OLLAMA_URL = mockUrl; process.env.OLLAMA_VISION_MODEL = 'fake-vl';
  cloud = createCloud(cfg({ CLOUD_STT: '1', CLOUD_STT_KEY: STT_KEY, CLOUD_STT_URL: mockUrl + '/stt' }));
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mzc-')); app = createApp({ dataDir: dir, passphrase: 'pw-test', cloud, whisperBin: '', whisperModel: '' });
  await new Promise((r) => { srv = app.listen(0, r); }); base = 'http://127.0.0.1:' + srv.address().port;
  cookie = (await j('/api/login', { method: 'POST', body: { passphrase: 'pw-test' } })).headers.get('set-cookie').split(';')[0];
  S = (await (await j('/api/sessions', { method: 'POST', cookie: 1, body: { title: 'はんだ付け', lang: 'ja' } })).json()).id;
  const L = (await (await j(`/api/sessions/${S}/links`, { cookie: 1 })).json()).links; links = { m: L.master.url.split('#')[1], a: L.apprentice.url.split('#')[1] };
  for (const t of [links.m, links.a]) assert.equal((await j('/api/join', { method: 'POST', tok: t, body: { consent: true } })).status, 200);
});
const { createApp } = await import('../app.js');
test('app: answers are drafted by the cloud, and by the local model when the cloud fails', async () => {
  const rec = (await (await j('/api/recordings', { method: 'POST', tok: links.m, headers: { 'content-type': 'video/mp4' }, body: mp4 })).json()).id;
  for (const t of [10, 40]) await j(`/api/recordings/${rec}/moments`, { method: 'POST', cookie: 1, body: { t, text: 'The iron touches the pad' } });
  const qs = (await (await j(`/api/sessions/${S}`, { cookie: 1 })).json()).questions;
  const k1 = (await (await j(`/api/questions/${qs[0].id}/answer`, { method: 'POST', cookie: 1, body: { text: 'I lift the iron when the solder flows and shines' } })).json()).id;
  const d1 = await until(async () => (await (await j(`/api/sessions/${S}`, { cookie: 1 })).json()).knowledge.find((k) => k.id === k1 && k.ai_draft !== 'drafting'));
  assert.equal(d1.ai_draft, 'claude:claude-haiku-5-5'); assert.equal(d1.summary, 'Cloud summary.');
  const before = seen.ollama; fail = true;
  try {
    const k2 = (await (await j(`/api/questions/${qs[1].id}/answer`, { method: 'POST', cookie: 1, body: { text: 'Old boards need more heat' } })).json()).id;
    const d2 = await until(async () => (await (await j(`/api/sessions/${S}`, { cookie: 1 })).json()).knowledge.find((k) => k.id === k2 && k.ai_draft !== 'drafting'));
    assert.equal(d2.ai_draft, 'ollama:fake-vl'); assert.equal(d2.summary, 'Local summary.'); assert.equal(seen.ollama, before + 1);
  } finally { fail = false; }
  await j(`/api/knowledge/${k1}`, { method: 'PATCH', cookie: 1, body: { status: 'approved' } }); seen.known = k1;
});
test('app: "Suggest a reply" uses approved records only and drops ids the AI made up', async () => {
  // The previous failure paused the cloud for a minute: a fresh cloud object stands in for "a minute later".
  const h = (await (await j('/api/help', { method: 'POST', tok: links.a, body: { question: 'いつこてを離せばいいですか？' } })).json()).id;
  const r = await (await j(`/api/help/${h}/suggest`, { method: 'POST', cookie: 1 })).json();
  assert.equal(r.reply, 'Local reply.', 'cloud paused → local model answers'); assert.deepEqual(r.knowledge_ids, []);
  Object.assign(cloud, createCloud(cfg({ CLOUD_STT: '1', CLOUD_STT_KEY: STT_KEY, CLOUD_STT_URL: mockUrl + '/stt' })));
  const c = await (await j(`/api/help/${h}/suggest`, { method: 'POST', cookie: 1 })).json();
  assert.match(c.reply, /Lift the iron/); assert.deepEqual(c.knowledge_ids, [seen.known]); assert.equal(c.engine, 'claude:claude-haiku-5-5');
  const prompt = seen.claude.at(-1).body.messages[0].content.at(-1).text;
  assert.match(prompt, /APPROVED records/); assert.match(prompt, /polite Japanese/); assert.ok(prompt.includes(seen.known));
});
test('app: cloud speech-to-text gets the craft vocabulary hint and the bearer key', async () => {
  const r = await (await j(`/api/transcribe?lang=ja&session=${S}`, { method: 'POST', cookie: 1, headers: { 'content-type': 'audio/webm' }, body: Buffer.alloc(800, 1) })).json();
  assert.equal(r.text, 'はんだごてを当てます。'); assert.equal(r.engine, 'cloud:gpt-4o-transcribe'); assert.equal(r.cloud, true);
  const s = seen.stt.at(-1); assert.equal(s.headers.authorization, 'Bearer ' + STT_KEY); assert.match(s.body, /はんだごて/); assert.match(s.body, /name="language"\r\n\r\nja/);
  fail = true;
  try {
    const e = await j(`/api/transcribe?lang=ja&session=${S}`, { method: 'POST', cookie: 1, headers: { 'content-type': 'audio/webm' }, body: Buffer.alloc(800, 1) });
    assert.equal(e.status, 502, 'no local whisper in this test, so the failure is reported'); assert.ok(!(await e.text()).includes(STT_KEY));
  } finally { fail = false; }
});
test('app: keys never reach browsers; consent, legal pages and the dashboard say what is sent', async () => {
  const pages = await Promise.all(['/api/ai-mode', '/api/me', `/api/sessions/${S}`, '/privacy', '/privacy?lang=ja', '/cookies', '/terms', '/', '/dashboard'].map(async (p) => (await j(p, { cookie: 1 })).text()));
  for (const p of pages) { assert.ok(!p.includes(KEY), 'Anthropic key leaked'); assert.ok(!p.includes(STT_KEY), 'speech key leaked'); assert.ok(!p.includes('SECRET')); }
  assert.deepEqual(JSON.parse(pages[0]), { cloud: 'text', provider: 'Anthropic', stt: true, sttHost: '127.0.0.1' });
  const me = JSON.parse(pages[1]); assert.equal(me.aiEngines.cloud.mode, 'text'); assert.equal(me.aiEngines.local, 'fake-vl'); assert.equal(me.aiEngines.cloud.model, 'claude-haiku-5-5');
  assert.match(pages[3], /hybrid AI/); assert.match(pages[3], /Anthropic \(claude-haiku-5-5\)/); assert.doesNotMatch(pages[3], /nothing is sent to a cloud AI service/);
  assert.match(pages[4], /ハイブリッドAI/); assert.match(pages[5], /sends AI requests to Anthropic and 127\.0\.0\.1/);
});
test('app: cleanup', () => { srv.close(); app.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('Gemini / OpenAI-compatible provider: images, bearer key, waits out 429, falls back to plain JSON when schemas are rejected', async () => {
  const GKEY = 'AIza-test-SECRET-0123456789abcdef';
  const c = createCloud({ CLOUD_AI: 'vision', CLOUD_PROVIDER: 'gemini', CLOUD_API_KEY: GKEY, CLOUD_BASE_URL: mockUrl + '/compat', CLOUD_MODEL: 'gemini-test' });
  assert.equal(c.status().provider, 'Google Gemini'); assert.equal(c.label, 'gemini:gemini-test'); assert.equal(c.route('see', true), 'vision');
  const out = JSON.parse(await c.json('judge', 'Pick the best.', [Buffer.from('jpeg-bytes')]));
  assert.deepEqual(out, { scores: [5, 3, 2], best: 0 }, 'code fences stripped');
  assert.equal(seen.compat.length, 2, 'one 429, then retried');
  const req = seen.compat[1]; assert.equal(req.headers.authorization, 'Bearer ' + GKEY); assert.equal(req.body.model, 'gemini-test');
  assert.match(req.body.messages[0].content[1].image_url.url, /^data:image\/jpeg;base64,/); assert.equal(req.body.response_format.type, 'json_schema');
  compatNoSchema = true;
  assert.equal(JSON.parse(await c.json('translate', 'Translate.')).ja, 'なぜ横から挟むのですか？');
  const last = seen.compat.at(-1); assert.equal(last.body.response_format.type, 'json_object'); assert.match(last.body.messages[0].content[0].text, /JSON schema/);
  assert.ok(!JSON.stringify(c.status()).includes(GKEY));
  compatNoSchema = false;
});

test('Gemini: a busy model hands the request to the backup model', async () => {
  const c = createCloud({ CLOUD_AI: 'text', CLOUD_PROVIDER: 'gemini', CLOUD_API_KEY: 'AIza-test-SECRET-0123456789abcdef', CLOUD_BASE_URL: mockUrl + '/compat', CLOUD_MODEL: 'gemini-busy', CLOUD_BACKUP_MODEL: 'gemini-lite' });
  const n = seen.compat.length;
  assert.equal(JSON.parse(await c.json('followup', 'Ask a follow-up.')).question, 'Why then?');
  const models = seen.compat.slice(n).map((x) => x.body.model);
  assert.deepEqual(models.slice(0, 2), ['gemini-busy', 'gemini-busy']); assert.equal(models.at(-1), 'gemini-lite');
});
