import test, { before, after } from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApp, migrateDatabase } from '../app.js';
let srv, base, dir, app, cookie, S, links;
const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypmp42'), Buffer.alloc(2000, 1)]);
const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(500, 2)]);
const j = (p, o = {}) => fetch(base + p, { ...o, headers: { 'content-type': 'application/json', ...(o.cookie ? { cookie } : {}), ...(o.tok ? { 'x-token': o.tok } : {}), ...(o.headers || {}) }, body: o.body === undefined ? undefined : (Buffer.isBuffer(o.body) ? o.body : JSON.stringify(o.body)) });
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mz-')); app = createApp({ dataDir: dir, passphrase: 'pw-test', maxVideoMb: 1 });
  await new Promise((r) => { srv = app.listen(0, r); }); base = 'http://127.0.0.1:' + srv.address().port;
  const l = await j('/api/login', { method: 'POST', body: { passphrase: 'pw-test' } }); cookie = l.headers.get('set-cookie').split(';')[0];
  S = (await (await j('/api/sessions', { method: 'POST', cookie: 1, body: { title: 'Soldering demo' } })).json()).id;
  const L = (await (await j(`/api/sessions/${S}/links`, { cookie: 1 })).json()).links; links = { m: L.master.url.split('#')[1], a: L.apprentice.url.split('#')[1], raw: L };
});
after(() => { srv.close(); app.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('health endpoint', async () => assert.equal((await (await j('/api/health')).json()).ok, true));
test('master endpoints need sign-in; wrong passphrase rejected', async () => {
  assert.equal((await j('/api/sessions')).status, 401);
  assert.equal((await j('/api/login', { method: 'POST', body: { passphrase: 'nope' } })).status, 401);
});
test('session needs title; QR + role links generated', async () => {
  assert.equal((await j('/api/sessions', { method: 'POST', cookie: 1, body: {} })).status, 400);
  assert.match(links.raw.master.qr, /^data:image\/png/); assert.match(links.raw.apprentice.url, /\/a\.html#/);
});
test('role scoping: apprentice token cannot use master APIs; fake token rejected', async () => {
  assert.equal((await j('/api/recordings', { method: 'POST', tok: links.a, headers: { 'content-type': 'video/mp4' }, body: mp4 })).status, 403);
  assert.equal((await j('/api/sessions', { tok: links.a })).status, 401);
  assert.equal((await j('/api/join', { method: 'POST', tok: 'bogus', body: { consent: true } })).status, 401);
});
test('consent must be explicit; uploads blocked until consent', async () => {
  assert.equal((await j('/api/join', { method: 'POST', tok: links.m, body: { consent: false } })).status, 400);
  assert.equal((await j('/api/recordings', { method: 'POST', tok: links.m, headers: { 'content-type': 'video/mp4' }, body: mp4 })).status, 403);
  assert.equal((await j('/api/join', { method: 'POST', tok: links.m, body: { consent: true } })).status, 200);
  assert.equal((await j('/api/join', { method: 'POST', tok: links.a, body: { consent: true } })).status, 200);
});
let rec, knId;
test('upload validation: type, magic bytes, size limit', async () => {
  assert.equal((await j('/api/recordings', { method: 'POST', tok: links.m, headers: { 'content-type': 'text/plain' }, body: mp4 })).status, 415);
  assert.equal((await j('/api/recordings', { method: 'POST', tok: links.m, headers: { 'content-type': 'video/mp4' }, body: Buffer.alloc(3000) })).status, 400);
  assert.equal((await j('/api/recordings', { method: 'POST', tok: links.m, headers: { 'content-type': 'video/mp4' }, body: Buffer.concat([mp4, Buffer.alloc(1.2e6)]) })).status, 413);
  const r = await j('/api/recordings', { method: 'POST', tok: links.m, headers: { 'content-type': 'video/mp4' }, body: mp4 }); assert.equal(r.status, 201); rec = (await r.json()).id;
});
test('analysis without local AI fails honestly; manual moment creates timestamped question', async () => {
  const a = await j(`/api/recordings/${rec}/analyze`, { method: 'POST', cookie: 1 }); assert.equal(a.status, 503);
  assert.match((await a.json()).error, /No local vision model/);
  assert.equal((await j(`/api/recordings/${rec}/moments`, { method: 'POST', cookie: 1, body: { t: 42, text: 'The iron is lifted away from the joint' } })).status, 201);
  const d = await (await j(`/api/sessions/${S}`, { cookie: 1 })).json();
  assert.equal(d.recordings[0].status, 'failed'); assert.match(d.questions[0].text, /^At 00:42/); assert.equal(d.questions[0].recording_id, rec);
});
test('answer → draft; apprentice sees nothing until approved; edit after approval resets to draft', async () => {
  const d = await (await j(`/api/sessions/${S}`, { cookie: 1 })).json();
  knId = (await (await j(`/api/questions/${d.questions[0].id}/answer`, { method: 'POST', cookie: 1, body: { text: 'I lift the iron when the solder flows and shines' } })).json()).id;
  assert.equal((await (await j('/api/knowledge', { tok: links.a })).json()).length, 0);
  assert.equal((await j(`/api/knowledge/${knId}`, { method: 'PATCH', cookie: 1, body: { status: 'approved', step: 'remove iron' } })).status, 200);
  const k = await (await j('/api/knowledge', { tok: links.a })).json(); assert.equal(k.length, 1); assert.match(k[0].clip.url, /^\/f\/rec\//);
  assert.equal((await (await j(`/api/knowledge/${knId}`, { method: 'PATCH', cookie: 1, body: { summary: 'changed' } })).json()).status, 'draft');
  await j(`/api/knowledge/${knId}`, { method: 'PATCH', cookie: 1, body: { status: 'approved' } });
});
test('AI record filling: honest without local AI, refuses approved records, master-only', async () => {
  const d = await (await j(`/api/sessions/${S}`, { cookie: 1 })).json();
  assert.equal(d.knowledge.find((k) => k.id === knId).ai_draft, null); // no AI configured → nothing pretends to draft
  assert.equal((await j(`/api/knowledge/${knId}/ai-fill`, { method: 'POST', tok: links.m })).status, 401);
  assert.equal((await j(`/api/knowledge/${knId}/ai-fill`, { method: 'POST', cookie: 1 })).status, 409); // approved above
  await j(`/api/knowledge/${knId}`, { method: 'PATCH', cookie: 1, body: { status: 'clarify' } });
  const r = await j(`/api/knowledge/${knId}/ai-fill`, { method: 'POST', cookie: 1 }); assert.equal(r.status, 503); assert.match((await r.json()).error, /No local vision model/);
  await j(`/api/knowledge/${knId}`, { method: 'PATCH', cookie: 1, body: { status: 'approved' } });
});
test('signed file link works, tampering and expiry rejected', async () => {
  const url = (await (await j('/api/knowledge', { tok: links.a })).json())[0].clip.url;
  assert.equal((await fetch(base + url)).status, 200);
  assert.equal((await fetch(base + url.replace(/sig=(.)/, (m, c) => 'sig=' + (c === '0' ? '1' : '0')))).status, 403);
  assert.equal((await fetch(base + url.replace(/exp=\d+/, 'exp=1'))).status, 403);
});
test('apprentice: ask is answered from approved knowledge; unknown question routes to master', async () => {
  const p = (await (await j('/api/practice/start', { method: 'POST', tok: links.a })).json()).id;
  const a = await (await j('/api/ask', { method: 'POST', tok: links.a, body: { text: 'when do I lift the iron?' } })).json(); assert.equal(a.answers.length, 1);
  const b = await (await j('/api/ask', { method: 'POST', tok: links.a, body: { text: 'what flux brand is best?' } })).json(); assert.equal(b.helpRequested, true);
  const d = await (await j(`/api/sessions/${S}`, { cookie: 1 })).json(); assert.equal(d.help[0].status, 'pending');
  global.__p = p;
});
test('snapshots validated; assessment with no AI is cannot_assess and never fabricated', async () => {
  assert.equal((await j(`/api/practice/${global.__p}/snapshot`, { method: 'POST', tok: links.a, headers: { 'content-type': 'image/jpeg' }, body: Buffer.alloc(900) })).status, 400);
  assert.equal((await j(`/api/practice/${global.__p}/snapshot?manual=1`, { method: 'POST', tok: links.a, headers: { 'content-type': 'image/jpeg' }, body: jpg })).status, 202);
  await new Promise((r) => setTimeout(r, 300));
  const d = await (await j(`/api/sessions/${S}`, { cookie: 1 })).json(); const as = d.practices[0].last;
  assert.equal(as.status, 'cannot_assess'); assert.equal(as.source, 'unavailable'); assert.match(as.feedback, /unavailable/);
});
test('help request reaches master; reply visible to apprentice; status flow', async () => {
  const me = { 'x-learner': 'device-help-0001' }, other = { 'x-learner': 'device-help-0002' };
  const h = await (await j('/api/help', { method: 'POST', tok: links.a, headers: me, body: { question: 'Is this joint ok?' } })).json();
  const d = await (await j(`/api/sessions/${S}`, { cookie: 1 })).json(); const row = d.help.find((x) => x.id === h.id); assert.ok(row.frame);
  assert.equal((await j(`/api/help/${h.id}/reply`, { method: 'POST', tok: links.a, body: { text: 'x' } })).status, 401);
  assert.equal((await j(`/api/help/${h.id}/reply`, { method: 'POST', cookie: 1, body: { text: 'Re-flow it' } })).status, 201);
  const mine = await (await j('/api/help', { tok: links.a, headers: me })).json(); assert.equal(mine.find((x) => x.id === h.id).replies[0].text, 'Re-flow it');
  assert.equal((await (await j('/api/help', { tok: links.a, headers: other })).json()).length, 0); // another student's phone does not see it
  assert.equal((await (await j(`/api/sessions/${S}`, { cookie: 1 })).json()).help.find((x) => x.id === h.id).learner_label, 'Student 1');
  assert.equal((await j(`/api/help/${h.id}`, { method: 'PATCH', cookie: 1, body: { status: 'resolved' } })).status, 200);
  assert.equal((await j(`/api/help/${h.id}`, { method: 'PATCH', cookie: 1, body: { status: 'bogus' } })).status, 400);
});
test('session isolation: a second session\'s apprentice cannot see the first session\'s knowledge', async () => {
  const S2 = (await (await j('/api/sessions', { method: 'POST', cookie: 1, body: { title: 'Other' } })).json()).id;
  const t2 = (await (await j(`/api/sessions/${S2}/links`, { cookie: 1 })).json()).links.apprentice.url.split('#')[1];
  await j('/api/join', { method: 'POST', tok: t2, body: { consent: true } });
  assert.equal((await (await j('/api/knowledge', { tok: t2 })).json()).length, 0);
  assert.equal((await j(`/api/practice/${global.__p}/end`, { method: 'POST', tok: t2 })).status, 404);
});
test('rotating links invalidates old tokens', async () => {
  const S3 = (await (await j('/api/sessions', { method: 'POST', cookie: 1, body: { title: 'R' } })).json()).id;
  const old = (await (await j(`/api/sessions/${S3}/links`, { cookie: 1 })).json()).links.apprentice.url.split('#')[1];
  await j(`/api/sessions/${S3}/rotate`, { method: 'POST', cookie: 1 });
  assert.equal((await j('/api/join', { method: 'POST', tok: old, body: { consent: true } })).status, 401);
});
test('deleting a session removes rows and files', async () => {
  const files = () => fs.readdirSync(path.join(dir, 'rec')).length + fs.readdirSync(path.join(dir, 'frames')).length;
  assert.ok(files() > 0); assert.equal((await j(`/api/sessions/${S}`, { method: 'DELETE', cookie: 1 })).status, 200);
  assert.equal(files(), 0); assert.equal((await j(`/api/sessions/${S}`, { cookie: 1 })).status, 404);
  assert.equal((await j('/api/join', { method: 'POST', tok: links.m, body: { consent: true } })).status, 401);
});
test('legal pages, security headers, no third-party refs', async () => {
  for (const p of ['/privacy', '/terms', '/cookies']) { const r = await fetch(base + p); assert.equal(r.status, 200); const t = await r.text(); if (p !== '/cookies') assert.ok(t.includes('ONIGIRI BENTO')); assert.ok(t.includes('<h1>')); }
  const h = await fetch(base + '/api/health'); assert.match(h.headers.get('content-security-policy'), /default-src 'self'/);
  for (const f of fs.readdirSync('public')) if (/\.(html|js|css)$/.test(f)) assert.doesNotMatch(fs.readFileSync('public/' + f, 'utf8'), /https?:\/\/(?!localhost)/, f + ' references external URL');
});

test('skills endpoints return summary and profiles', async () => {
  const sk = await (await j('/api/skills')).json();
  assert.ok(Array.isArray(sk.skills));
  assert.ok(sk.skills.some((x) => x.id === 'soldering'));
  assert.ok(sk.skills.some((x) => x.id === 'bonsai'));

  const s = await j('/api/skills/soldering');
  assert.equal(s.status, 200);
  assert.equal((await s.json()).id, 'soldering');

  const b = await j('/api/skills/bonsai');
  assert.equal(b.status, 200);
  assert.equal((await b.json()).id, 'bonsai');

  const bad = await j('/api/skills/unknown');
  assert.equal(bad.status, 404);
});

test('session creation validates skill_id and task_id', async () => {
  // Invalid skill
  const badSkill = await j('/api/sessions', { method: 'POST', cookie: 1, body: { title: 'T', skill_id: 'origami' } });
  assert.equal(badSkill.status, 400);

  // Valid skill, invalid task
  const badTask = await j('/api/sessions', { method: 'POST', cookie: 1, body: { title: 'T', skill_id: 'bonsai', task_id: 'fake_task' } });
  assert.equal(badTask.status, 400);

  // Valid skill and task
  const bonSess = await j('/api/sessions', { method: 'POST', cookie: 1, body: { title: 'Bonsai Class', skill_id: 'bonsai', task_id: 'secondary_branch_wiring' } });
  assert.equal(bonSess.status, 201);
  const bonData = await bonSess.json();
  assert.equal(bonData.skill_id, 'bonsai');
  assert.equal(bonData.task_id, 'secondary_branch_wiring');

  // Verify join receives skill metadata
  const bonLinks = (await (await j(`/api/sessions/${bonData.id}/links`, { cookie: 1 })).json()).links;
  const aTok = bonLinks.apprentice.url.split('#')[1];
  const joinRes = await (await j('/api/join', { method: 'POST', tok: aTok, body: { consent: true } })).json();
  assert.equal(joinRes.session.skill_id, 'bonsai');
  assert.equal(joinRes.session.task_id, 'secondary_branch_wiring');
  assert.equal(joinRes.skill.id, 'bonsai');
  assert.ok(joinRes.skill.safety_advisories.length >= 2);
  assert.ok(joinRes.skill.tools.some((t) => t.id === 'concave_cutter'));
});

test('convert-to-knowledge creates draft, prevents duplicates, requires explicit approval', async () => {
  // Create a session for testing help promotion
  const sRes = await (await j('/api/sessions', { method: 'POST', cookie: 1, body: { title: 'Help Promo Test', skill_id: 'soldering' } })).json();
  const sId = sRes.id;
  const L = (await (await j(`/api/sessions/${sId}/links`, { cookie: 1 })).json()).links;
  const aTok = L.apprentice.url.split('#')[1];
  await j('/api/join', { method: 'POST', tok: aTok, body: { consent: true } });

  // Start practice and post a help request
  await j('/api/practice/start', { method: 'POST', tok: aTok });
  const hId = (await (await j('/api/help', { method: 'POST', tok: aTok, body: { question: 'What temperature for lead-free solder?' } })).json()).id;

  // Converting before replying should fail with 400
  const earlyConv = await j(`/api/help/${hId}/convert-to-knowledge`, { method: 'POST', cookie: 1 });
  assert.equal(earlyConv.status, 400);

  // Master replies to help request
  await j(`/api/help/${hId}/reply`, { method: 'POST', cookie: 1, body: { text: 'Set iron to 350C for lead-free alloy.' } });

  // Non-master cannot convert
  const anonConv = await j(`/api/help/${hId}/convert-to-knowledge`, { method: 'POST' });
  assert.equal(anonConv.status, 401);

  // Master converts help to draft knowledge
  const conv = await j(`/api/help/${hId}/convert-to-knowledge`, { method: 'POST', cookie: 1 });
  assert.equal(conv.status, 201);
  const convData = await conv.json();
  assert.equal(convData.status, 'draft');
  const kid = convData.knowledgeId;

  // Duplicate conversion should be rejected with 409
  const dup = await j(`/api/help/${hId}/convert-to-knowledge`, { method: 'POST', cookie: 1 });
  assert.equal(dup.status, 409);
  assert.equal((await dup.json()).knowledgeId, kid);

  // Apprentice queries knowledge: since status is draft, nothing is returned
  const askDraft = await (await j('/api/ask', { method: 'POST', tok: aTok, body: { text: 'lead-free temperature' } })).json();
  assert.equal(askDraft.answers.length, 0);

  // Master explicitly approves knowledge
  const appRes = await j(`/api/knowledge/${kid}`, { method: 'PATCH', cookie: 1, body: { status: 'approved', summary: '350C for lead-free solder' } });
  assert.equal(appRes.status, 200);

  // Apprentice queries knowledge again: now the approved record is returned
  const askApp = await (await j('/api/ask', { method: 'POST', tok: aTok, body: { text: 'lead-free temperature' } })).json();
  assert.equal(askApp.answers.length, 1);
  assert.match(askApp.answers[0].verbatim, /350C/);
});

test('idempotent database migration handles legacy and fresh databases', () => {
  // 1. Simulate legacy database without skill_id and task_id
  const memDb = new DatabaseSync(':memory:');
  memDb.exec(`CREATE TABLE sessions(id TEXT PRIMARY KEY,title TEXT NOT NULL,task TEXT,procedure TEXT,created_at TEXT NOT NULL);`);
  memDb.prepare(`INSERT INTO sessions VALUES('s-legacy','Old Session','do something','steps','2026-01-01');`).run();

  // Run migration on legacy db
  migrateDatabase(memDb);
  const row = memDb.prepare(`SELECT * FROM sessions WHERE id='s-legacy'`).get();
  assert.equal(row.skill_id, 'soldering'); // defaults to soldering
  assert.equal(row.task_id, null);

  // Run migration again to verify idempotency (must not throw duplicate column error)
  assert.doesNotThrow(() => migrateDatabase(memDb));

  // 2. Simulate fresh database from updated schema.sql
  const freshDb = new DatabaseSync(':memory:');
  freshDb.exec(fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  // Run migration on fresh db (must be clean no-op)
  assert.doesNotThrow(() => migrateDatabase(freshDb));
  freshDb.prepare(`INSERT INTO sessions(id,title,task,procedure,skill_id,task_id,created_at) VALUES('s-new','New','t','p','bonsai','task-1','2026-01-02');`).run();
  const freshRow = freshDb.prepare(`SELECT * FROM sessions WHERE id='s-new'`).get();
  assert.equal(freshRow.skill_id, 'bonsai');
  assert.equal(freshRow.task_id, 'task-1');
});

// ---- skill-engine refinements ----
const mk = async (body) => {
  const r = await j('/api/sessions', { method: 'POST', cookie: 1, body }); const d = await r.json();
  if (r.status !== 201) return { status: r.status, ...d };
  const L = (await (await j(`/api/sessions/${d.id}/links`, { cookie: 1 })).json()).links;
  return { ...d, status: r.status, m: L.master.url.split('#')[1], a: L.apprentice.url.split('#')[1] };
};
const withDb = (f) => { const d = new DatabaseSync(path.join(dir, 'monozukuri.db')); try { return f(d); } finally { d.close(); } };
const stored = async (id) => (await (await j(`/api/sessions/${id}`, { cookie: 1 })).json()).session;

test('task template supplies task and procedure when they are omitted or blank', async () => {
  const tpl = JSON.parse(fs.readFileSync('skills/bonsai.json', 'utf8')).tasks.find((t) => t.id === 'secondary_branch_wiring');
  for (const extra of [{}, { task: '', procedure: '' }, { task: '   ', procedure: '\n' }, { task: null, procedure: null }]) {
    const s = await mk({ title: 'Template', skill_id: 'bonsai', task_id: 'secondary_branch_wiring', ...extra });
    assert.equal(s.status, 201);
    assert.equal(s.task, tpl.title); assert.equal(s.procedure, tpl.default_procedure);
    const row = await stored(s.id); assert.equal(row.task, tpl.title); assert.equal(row.procedure, tpl.default_procedure);
  }
});

test('explicit custom task and procedure take precedence over the template', async () => {
  const s = await mk({ title: 'Custom', skill_id: 'soldering', task_id: 'wire_splice', task: 'Splice the red lead', procedure: '1. Strip.\n2. Twist.' });
  assert.equal(s.task, 'Splice the red lead'); assert.equal(s.procedure, '1. Strip.\n2. Twist.');
  // only one field overridden: the other still comes from the template
  const p = await mk({ title: 'Partial', skill_id: 'soldering', task_id: 'wire_splice', task: 'Only my task' });
  assert.equal(p.task, 'Only my task'); assert.match(p.procedure, /^1\. Strip 10mm/);
  // legacy client: free text, no skill or task id
  const l = await mk({ title: 'Legacy client', task: 'Old task', procedure: 'Old steps' });
  assert.equal(l.skill_id, 'soldering'); assert.equal(l.task_id, null);
  const row = await stored(l.id); assert.equal(row.task, 'Old task'); assert.equal(row.procedure, 'Old steps');
  // over-length text is still truncated, as before
  const long = await mk({ title: 'Long', task: 'x'.repeat(1500), procedure: 'y'.repeat(5000) });
  assert.equal(long.task.length, 1000); assert.equal(long.procedure.length, 4000);
});

test('session fields must be strings: numbers, arrays and objects are rejected, not coerced', async () => {
  const count = async () => (await (await j('/api/sessions', { cookie: 1 })).json()).length;
  const n = await count();
  // values that String() would coerce into something valid-looking ('bonsai', 'wire_splice', '0', '[object Object]')
  const bad = { number: [42, 0], array: [['bonsai'], []], object: [{ id: 'wire_splice' }, {}] };
  const valid = { skill_id: 'soldering', task_id: 'wire_splice', task: 'Custom task', procedure: '1. Custom.' };
  for (const f of ['skill_id', 'task_id', 'task', 'procedure']) {
    for (const [kind, vals] of Object.entries(bad)) for (const v of vals) {
      const r = await j('/api/sessions', { method: 'POST', cookie: 1, body: { title: 'Bad', ...valid, [f]: v } });
      assert.equal(r.status, 400, `${f} as ${kind} ${JSON.stringify(v)}`);
      assert.deepEqual(await r.json(), { error: `${f} must be a string.` });
    }
  }
  assert.equal(await count(), n, 'no session row created by rejected requests');
  // the same request with string values still succeeds
  const ok = await j('/api/sessions', { method: 'POST', cookie: 1, body: { title: 'Good', ...valid } });
  assert.equal(ok.status, 201);
  const d = await ok.json(); assert.equal(d.task, 'Custom task'); assert.equal(d.procedure, '1. Custom.'); assert.equal(d.task_id, 'wire_splice');
  assert.equal(await count(), n + 1);
});

test('legacy sessions with task_id null (and skill_id null) still join as soldering', async () => {
  const s = await mk({ title: 'No task' });
  assert.equal(s.task_id, null); assert.equal(s.task, ''); assert.equal(s.procedure, '');
  const r = await j('/api/join', { method: 'POST', tok: s.a, body: { consent: true } }); assert.equal(r.status, 200);
  const d = await r.json(); assert.equal(d.session.task_id, null); assert.equal(d.skill.id, 'soldering');
  const old = await mk({ title: 'Pre-migration row' });
  withDb((db) => db.prepare('UPDATE sessions SET skill_id=NULL, task_id=NULL WHERE id=?').run(old.id));
  const o = await j('/api/join', { method: 'POST', tok: old.a, body: { consent: true } }); assert.equal(o.status, 200);
  assert.equal((await o.json()).skill.id, 'soldering');
});

test('join returns tool id, name and purpose only', async () => {
  const s = await mk({ title: 'Tools', skill_id: 'bonsai' });
  const d = await (await j('/api/join', { method: 'POST', tok: s.a, body: { consent: true } })).json();
  const src = JSON.parse(fs.readFileSync('skills/bonsai.json', 'utf8')).tools;
  assert.deepEqual(d.skill.tools, src.map(({ id, name, purpose }) => ({ id, name, purpose })));
  for (const t of d.skill.tools) assert.deepEqual(Object.keys(t), ['id', 'name', 'purpose']);
});

test('missing skill profile: join fails with 409 before any consent or token change', async () => {
  const s = await mk({ title: 'Retired skill', skill_id: 'bonsai' });
  withDb((db) => db.prepare("UPDATE sessions SET skill_id='retired_craft' WHERE id=?").run(s.id));
  const before = withDb((db) => db.prepare('SELECT * FROM tokens WHERE session_id=? ORDER BY role').all(s.id));
  const evBefore = withDb((db) => db.prepare('SELECT COUNT(*) n FROM events WHERE session_id=?').get(s.id).n);
  assert.equal((await j('/api/join', { method: 'POST', tok: s.a, body: { consent: false } })).status, 400);
  for (const tok of [s.a, s.m]) {
    const r = await j('/api/join', { method: 'POST', tok, body: { consent: true } });
    assert.equal(r.status, 409); const b = await r.json();
    assert.equal(b.code, 'skill_profile_unavailable'); assert.ok(b.error);
  }
  assert.deepEqual(withDb((db) => db.prepare('SELECT * FROM tokens WHERE session_id=? ORDER BY role').all(s.id)), before);
  assert.ok(before.every((t) => t.consented_at === null && t.last_seen === null));
  assert.equal(withDb((db) => db.prepare('SELECT COUNT(*) n FROM events WHERE session_id=?').get(s.id).n), evBefore);
  // consent still not given, so phone actions stay blocked
  assert.equal((await j('/api/practice/start', { method: 'POST', tok: s.a })).status, 403);
  // the server keeps serving other sessions
  assert.equal((await j('/api/health')).status, 200);
});

test('missing skill profile: practice cannot start and assessment is an honest cannot_assess with escalation', async () => {
  const s = await mk({ title: 'Profile removed mid-session', skill_id: 'soldering' });
  await j('/api/join', { method: 'POST', tok: s.a, body: { consent: true } });
  const p = (await (await j('/api/practice/start', { method: 'POST', tok: s.a })).json()).id;
  withDb((db) => db.prepare("UPDATE sessions SET skill_id='retired_craft' WHERE id=?").run(s.id));
  const blocked = await j('/api/practice/start', { method: 'POST', tok: s.a });
  assert.equal(blocked.status, 409); assert.equal((await blocked.json()).code, 'skill_profile_unavailable');
  assert.equal(withDb((db) => db.prepare('SELECT COUNT(*) n FROM practice WHERE session_id=?').get(s.id).n), 1);
  assert.equal((await j(`/api/practice/${p}/snapshot`, { method: 'POST', tok: s.a, headers: { 'content-type': 'image/jpeg' }, body: jpg })).status, 202);
  await new Promise((r) => setTimeout(r, 300));
  const d = await (await j(`/api/sessions/${s.id}`, { cookie: 1 })).json(); const as = d.practices[0].last;
  assert.equal(as.status, 'cannot_assess'); assert.equal(as.source, 'rule'); assert.equal(as.needs_help, 1);
  assert.match(as.feedback, /skill profile is missing/);
  assert.equal(d.help.length, 1); assert.equal(d.help[0].assessment_id, as.id); assert.equal(d.help[0].status, 'pending');
  // repeated snapshots do not open duplicate help tickets
  await j(`/api/practice/${p}/snapshot?manual=1`, { method: 'POST', tok: s.a, headers: { 'content-type': 'image/jpeg' }, body: jpg });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal((await (await j(`/api/sessions/${s.id}`, { cookie: 1 })).json()).help.length, 1);
});

test('GET /api/skills/:id rejects encoded path traversal and odd ids', async () => {
  for (const id of ['..%2F..%2F.env', '..%2F..%2Fdata%2Fmonozukuri.db', '%2E%2E%2F%2E%2E%2Fpackage.json', '..%252F..%252Fpackage', '..%2F..%2Fpackage', '..%2Fskills%2Fsoldering', '%2e%2e%2fpackage.json', '..%5C..%5Cpackage', 'soldering%00', 'soldering.json', '__proto__', 'constructor', 'SOLDERING', '%2Fetc%2Fpasswd']) {
    const r = await j('/api/skills/' + id); assert.equal(r.status, 404, id);
    const b = await r.text(); assert.equal(JSON.parse(b).error, 'Skill profile not found.', id);
    assert.doesNotMatch(b, /mento-platform|root:|assessment_rules/, id);
  }
});

// ---- help-derived knowledge has no fabricated clip ----
const joined = async (title) => {
  const s = await mk({ title });
  for (const tok of [s.m, s.a]) assert.equal((await j('/api/join', { method: 'POST', tok, body: { consent: true } })).status, 200);
  return s;
};
const helpToKnowledge = async (s, question, reply) => {
  const hId = (await (await j('/api/help', { method: 'POST', tok: s.a, body: { question } })).json()).id;
  await j(`/api/help/${hId}/reply`, { method: 'POST', cookie: 1, body: { text: reply } });
  const c = await j(`/api/help/${hId}/convert-to-knowledge`, { method: 'POST', cookie: 1 }); assert.equal(c.status, 201);
  return { hId, kid: (await c.json()).knowledgeId };
};
const apprenticeView = async (tok, kid, query) => ({
  list: (await (await j('/api/knowledge', { tok })).json()).find((k) => k.id === kid),
  ask: (await (await j('/api/ask', { method: 'POST', tok, body: { text: query } })).json()).answers.find((k) => k.id === kid)
});

for (const withRecording of [false, true]) {
  test(`help-derived knowledge has clip: null (${withRecording ? 'unrelated recording exists' : 'no recording in session'})`, async () => {
    const s = await joined('Help clip ' + withRecording);
    if (withRecording) assert.equal((await j('/api/recordings', { method: 'POST', tok: s.m, headers: { 'content-type': 'video/mp4' }, body: mp4 })).status, 201);
    const { hId, kid } = await helpToKnowledge(s, 'Can I wire a dry branch in winter?', 'No. Dormant dry branches are brittle; wait for spring sap flow.');
    assert.equal(withDb((db) => db.prepare('SELECT recording_id FROM knowledge WHERE id=?').get(kid).recording_id), '');
    assert.equal((await (await j(`/api/sessions/${s.id}`, { cookie: 1 })).json()).help.find((h) => h.id === hId).status, 'resolved');
    // draft: hidden from the apprentice in both the list and search
    let v = await apprenticeView(s.a, kid, 'dry branch winter'); assert.equal(v.list, undefined); assert.equal(v.ask, undefined);
    // master sees it (as draft) with no clip
    const mine = (await (await j(`/api/knowledge?session=${s.id}`, { cookie: 1 })).json()).find((k) => k.id === kid);
    assert.equal(mine.status, 'draft'); assert.equal(mine.clip, null);
    assert.equal((await j(`/api/knowledge/${kid}`, { method: 'PATCH', cookie: 1, body: { status: 'approved' } })).status, 200);
    v = await apprenticeView(s.a, kid, 'dry branch winter');
    assert.ok(v.list && v.ask, 'approved record now visible');
    assert.equal(v.list.clip, null); assert.equal(v.ask.clip, null);
    assert.match(v.ask.verbatim, /Dormant dry branches/);
  });
}

test('records converted by the old code (pointing at an unrelated recording) no longer expose a clip', async () => {
  const s = await joined('Legacy converted');
  const recId = (await (await j('/api/recordings', { method: 'POST', tok: s.m, headers: { 'content-type': 'video/mp4' }, body: mp4 })).json()).id;
  const { kid } = await helpToKnowledge(s, 'Which flux pen?', 'Use the no-clean flux pen.');
  withDb((db) => db.prepare('UPDATE knowledge SET recording_id=? WHERE id=?').run(recId, kid));
  await j(`/api/knowledge/${kid}`, { method: 'PATCH', cookie: 1, body: { status: 'approved' } });
  const v = await apprenticeView(s.a, kid, 'flux pen'); assert.equal(v.list.clip, null); assert.equal(v.ask.clip, null);
});

test('genuine recording-linked knowledge keeps its working timestamped clip', async () => {
  const s = await joined('Genuine clip');
  const recId = (await (await j('/api/recordings', { method: 'POST', tok: s.m, headers: { 'content-type': 'video/mp4' }, body: mp4 })).json()).id;
  await j(`/api/recordings/${recId}/moments`, { method: 'POST', cookie: 1, body: { t: 32, text: 'Solder wire is fed opposite the iron tip' } });
  const qu = (await (await j(`/api/sessions/${s.id}`, { cookie: 1 })).json()).questions[0];
  const kid = (await (await j(`/api/questions/${qu.id}/answer`, { method: 'POST', cookie: 1, body: { text: 'I feed solder opposite the tip so the joint melts it' } })).json()).id;
  assert.equal((await apprenticeView(s.a, kid, 'feed solder tip')).list, undefined, 'draft hidden');
  await j(`/api/knowledge/${kid}`, { method: 'PATCH', cookie: 1, body: { status: 'approved' } });
  const v = await apprenticeView(s.a, kid, 'feed solder tip');
  for (const c of [v.list.clip, v.ask.clip]) {
    assert.equal(c.t, 32); assert.match(c.url, new RegExp(`^/f/rec/${recId}\\?exp=\\d+&sig=[a-f0-9]+$`));
    const r = await fetch(base + c.url); assert.equal(r.status, 200); assert.equal(Buffer.compare(Buffer.from(await r.arrayBuffer()), mp4), 0);
  }
});

test('convert-to-knowledge: device tokens rejected, rejected tickets refused, converted tickets stay idempotent', async () => {
  const s = await joined('Convert guards');
  const hId = (await (await j('/api/help', { method: 'POST', tok: s.a, body: { question: 'Is the tip too oxidised?' } })).json()).id;
  await j(`/api/help/${hId}/reply`, { method: 'POST', cookie: 1, body: { text: 'Re-tin it.' } });
  for (const tok of [s.a, s.m]) assert.equal((await j(`/api/help/${hId}/convert-to-knowledge`, { method: 'POST', tok })).status, 401);
  // rejected ticket: refused, nothing written, status unchanged
  await j(`/api/help/${hId}`, { method: 'PATCH', cookie: 1, body: { status: 'rejected' } });
  const r = await j(`/api/help/${hId}/convert-to-knowledge`, { method: 'POST', cookie: 1 });
  assert.equal(r.status, 409); assert.equal((await r.json()).code, 'help_rejected');
  assert.equal(withDb((db) => db.prepare('SELECT COUNT(*) n FROM knowledge WHERE question_id=?').get(hId).n), 0);
  assert.equal(withDb((db) => db.prepare('SELECT status FROM help WHERE id=?').get(hId).status), 'rejected');
  // converted first, rejected later: still reports the existing record
  const h2 = (await (await j('/api/help', { method: 'POST', tok: s.a, body: { question: 'Second question' } })).json()).id;
  await j(`/api/help/${h2}/reply`, { method: 'POST', cookie: 1, body: { text: 'Answer two.' } });
  const kid = (await (await j(`/api/help/${h2}/convert-to-knowledge`, { method: 'POST', cookie: 1 })).json()).knowledgeId;
  await j(`/api/help/${h2}`, { method: 'PATCH', cookie: 1, body: { status: 'rejected' } });
  const again = await j(`/api/help/${h2}/convert-to-knowledge`, { method: 'POST', cookie: 1 });
  assert.equal(again.status, 409); const b = await again.json(); assert.equal(b.code, 'already_converted'); assert.equal(b.knowledgeId, kid);
  assert.equal(withDb((db) => db.prepare('SELECT COUNT(*) n FROM knowledge WHERE question_id=?').get(h2).n), 1);
});

test('real startup migrates an on-disk legacy database, keeps rows, and is repeatable', async () => {
  const ld = fs.mkdtempSync(path.join(os.tmpdir(), 'mz-legacy-'));
  const legacySchema = fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8')
    .replace(/CREATE TABLE IF NOT EXISTS sessions\([^;]*\);/, 'CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,title TEXT NOT NULL,task TEXT,procedure TEXT,created_at TEXT NOT NULL);');
  assert.doesNotMatch(legacySchema.split('\n')[0], /skill_id/);
  const created = new Date().toISOString(), exp = new Date(Date.now() + 36e5).toISOString();
  const seed = new DatabaseSync(path.join(ld, 'monozukuri.db'));
  seed.exec(legacySchema);
  seed.prepare('INSERT INTO sessions VALUES(?,?,?,?,?)').run('legacy00000000s1', 'Legacy soldering', 'Old task', 'Old steps', created);
  seed.prepare('INSERT INTO tokens(token,session_id,role,expires_at) VALUES(?,?,?,?)').run('legacy-apprentice-token', 'legacy00000000s1', 'apprentice', exp);
  seed.prepare('INSERT INTO tokens(token,session_id,role,expires_at,consented_at) VALUES(?,?,?,?,?)').run('legacy-master-token', 'legacy00000000s1', 'master', exp, created);
  seed.prepare("INSERT INTO knowledge(id,session_id,question_id,recording_id,t,observed,verbatim,summary,cues,warnings,step,tool,status,approved_at,created_at) VALUES('legacyk000000001','legacy00000000s1','q1','',0,'o','Keep the tip tinned','','','','','','approved',?,?)").run(created, created);
  seed.close();
  const snapshot = () => withDbAt(ld, (db) => ({
    cols: db.prepare("PRAGMA table_info('sessions')").all().map((c) => c.name),
    session: db.prepare('SELECT * FROM sessions').all(),
    knowledge: db.prepare('SELECT * FROM knowledge').all(),
    tokens: db.prepare('SELECT token,session_id,role,expires_at,consented_at FROM tokens ORDER BY role').all()
  }));
  try {
    for (let run = 1; run <= 2; run++) {
      const a2 = createApp({ dataDir: ld, passphrase: 'pw-legacy' });
      const s2 = await new Promise((r) => { const x = a2.listen(0, () => r(x)); });
      try {
        const snap = snapshot();
        assert.deepEqual(snap.cols, ['id', 'title', 'task', 'procedure', 'created_at', 'skill_id', 'task_id', 'custom_skill', 'owner', 'lang', 'manual', 'manual_name']);
        assert.equal(snap.session.length, 1);
        assert.equal(snap.session[0].skill_id, 'soldering'); assert.equal(snap.session[0].task_id, null);
        assert.equal(snap.session[0].task, 'Old task'); assert.equal(snap.knowledge.length, 1); assert.equal(snap.knowledge[0].verbatim, 'Keep the tip tinned');
        assert.equal(snap.tokens.length, 2); assert.equal(snap.tokens.find((t) => t.role === 'master').consented_at, created);
        const r = await fetch(`http://127.0.0.1:${s2.address().port}/api/join`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-token': 'legacy-apprentice-token' }, body: JSON.stringify({ consent: true }) });
        assert.equal(r.status, 200, `join on startup ${run}`);
        const d = await r.json(); assert.equal(d.session.task_id, null); assert.equal(d.session.skill_id, 'soldering'); assert.equal(d.skill.id, 'soldering');
        const k = await (await fetch(`http://127.0.0.1:${s2.address().port}/api/knowledge`, { headers: { 'x-token': 'legacy-apprentice-token' } })).json();
        assert.equal(k.length, 1); assert.equal(k[0].clip, null);
      } finally { s2.close(); a2.close(); }
    }
  } finally { fs.rmSync(ld, { recursive: true, force: true }); }
});
const withDbAt = (d, f) => { const db = new DatabaseSync(path.join(d, 'monozukuri.db')); try { return f(db); } finally { db.close(); } };

test('upload a video file from the dashboard; camera files that open with a "wide" box are accepted', async () => {
  const sv = (await (await j('/api/sessions', { method: 'POST', cookie: 1, body: { title: 'Camera upload' } })).json()).id;
  assert.equal((await j(`/api/sessions/${sv}/recordings`, { method: 'POST', headers: { 'content-type': 'video/mp4' }, body: mp4 })).status, 401, 'needs sign-in');
  assert.equal((await j(`/api/sessions/${sv}/recordings`, { method: 'POST', cookie: 1, headers: { 'content-type': 'video/x-msvideo' }, body: mp4 })).status, 415);
  const cam = Buffer.concat([Buffer.from([0, 0, 0, 8]), Buffer.from('wide'), Buffer.alloc(2000, 3)]);
  const r = await j(`/api/sessions/${sv}/recordings`, { method: 'POST', cookie: 1, headers: { 'content-type': 'video/quicktime' }, body: cam }); assert.equal(r.status, 201);
  const d = await (await j(`/api/sessions/${sv}`, { cookie: 1 })).json();
  assert.equal(d.recordings.length, 1); assert.equal(d.recordings[0].status, 'uploaded'); assert.match(d.events.map((e) => e.detail || '').join(' '), /video file/);
  // the same next step as a phone recording: analysis (here honestly unavailable: no AI in tests)
  assert.equal((await j(`/api/recordings/${d.recordings[0].id}/analyze`, { method: 'POST', cookie: 1 })).status, 503);
});
test('read-aloud translation: text already in the right language comes back unchanged; no AI → honest 503', async () => {
  const sv = (await (await j('/api/sessions', { method: 'POST', cookie: 1, body: { title: 'Read aloud' } })).json()).id;
  const a = (await (await j(`/api/sessions/${sv}/links`, { cookie: 1 })).json()).links.apprentice.url.split('#')[1];
  assert.deepEqual(await (await j('/api/say', { method: 'POST', tok: a, body: { text: 'Lift the iron.', lang: 'en' } })).json(), { text: 'Lift the iron.', translated: false });
  assert.equal((await (await j('/api/say', { method: 'POST', tok: a, body: { text: 'こてを離します。', lang: 'ja' } })).json()).translated, false);
  const r = await j('/api/say', { method: 'POST', tok: a, body: { text: 'Lift the iron.', lang: 'ja' } }); assert.equal(r.status, 503); assert.equal((await r.json()).code, 'ai_unavailable');
  assert.equal((await j('/api/say', { method: 'POST', body: { text: 'x', lang: 'ja' } })).status, 401);
});
test('transcribe: students may speak a question only with a consented invite', async () => {
  const audio = { method: 'POST', headers: { 'content-type': 'audio/webm' }, body: Buffer.alloc(800, 1) };
  assert.equal((await j('/api/transcribe', { ...audio, tok: 'bogus' })).status, 401);
  const sv = (await (await j('/api/sessions', { method: 'POST', cookie: 1, body: { title: 'Voice question' } })).json()).id;
  const a = (await (await j(`/api/sessions/${sv}/links`, { cookie: 1 })).json()).links.apprentice.url.split('#')[1];
  assert.equal((await j('/api/transcribe', { ...audio, tok: a })).status, 403, 'no consent yet on this device');
  const join = await (await j('/api/join', { method: 'POST', tok: a, body: { consent: true } })).json(); assert.equal(typeof join.stt, 'boolean');
  const r = await j('/api/transcribe', { ...audio, tok: a }); // no whisper configured in tests: passes auth, then an honest 503
  assert.equal(r.status, 503); assert.equal((await r.json()).code, 'stt_unavailable');
});
test('transcribe: master-only, and an honest 503 when speech-to-text is not set up', async () => {
  const audio = { method: 'POST', headers: { 'content-type': 'audio/webm' }, body: Buffer.alloc(800, 1) };
  assert.equal((await j('/api/transcribe', audio)).status, 401);
  assert.equal((await j('/api/transcribe', { ...audio, tok: links.m })).status, 401);
  const r = await j('/api/transcribe', { ...audio, cookie: 1 });
  assert.equal(r.status, 503); assert.equal((await r.json()).code, 'stt_unavailable');
  assert.equal((await (await j('/api/me', { cookie: 1 })).json()).sttConfigured, false);
});

test('transcribe: audio is converted locally, whisper noise markers are stripped, temp files removed', { skip: !fs.existsSync('/usr/bin/ffmpeg') && 'ffmpeg not installed' }, async () => {
  const { execFileSync } = await import('node:child_process');
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mz-stt-')), bin = path.join(d, 'fake-whisper'), model = path.join(d, 'model.bin');
  // Stand-in for whisper-cli: proves the 16 kHz WAV exists and echoes typical whisper output including markers.
  fs.writeFileSync(bin, '#!/bin/sh\nwhile [ "$1" != "-f" ]; do shift; done; test -s "$2" || exit 3\necho " [BLANK_AUDIO]"\necho " Heat the pad and the lead together (music)"\necho " for two seconds."\n', { mode: 0o755 });
  fs.writeFileSync(model, 'x');
  const a2 = createApp({ dataDir: d, passphrase: 'pw2', whisperBin: bin, whisperModel: model }); const s2 = await new Promise((r) => { const s = a2.listen(0, () => r(s)); });
  try {
    const b2 = 'http://127.0.0.1:' + s2.address().port;
    const c2 = (await fetch(b2 + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"passphrase":"pw2"}' })).headers.get('set-cookie').split(';')[0];
    assert.equal((await (await fetch(b2 + '/api/me', { headers: { cookie: c2 } })).json()).sttConfigured, true);
    const ogg = execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:a', 'libopus', '-f', 'ogg', 'pipe:1']);
    const r = await fetch(b2 + '/api/transcribe', { method: 'POST', headers: { cookie: c2, 'content-type': 'audio/ogg' }, body: ogg });
    const body = await r.json(); assert.equal(r.status, 200, JSON.stringify(body));
    assert.equal(body.text, 'Heat the pad and the lead together for two seconds.');
    assert.equal(fs.readdirSync(path.join(d, 'tmp')).filter((f) => f.startsWith('stt-')).length, 0);
    assert.equal((await fetch(b2 + '/api/transcribe', { method: 'POST', headers: { cookie: c2, 'content-type': 'text/plain' }, body: ogg })).status, 415);
  } finally { s2.close(); a2.close(); fs.rmSync(d, { recursive: true, force: true }); }
});

// ---- general-purpose sessions, student codes, phone ↔ laptop, learning progress ----
test('custom skill: any craft can be a session; phones get its tools and safety; bad input refused', async () => {
  assert.equal((await j('/api/sessions', { method: 'POST', cookie: 1, body: { title: 'x', skill_id: 'custom', task: 'Fold a crane' } })).status, 400);
  assert.equal((await j('/api/sessions', { method: 'POST', cookie: 1, body: { title: 'x', skill_id: 'custom', custom: { name: 'Origami' } } })).status, 400);
  const r = await j('/api/sessions', { method: 'POST', cookie: 1, body: { title: 'Paper crane', skill_id: 'custom', task: 'Fold a traditional crane', custom: { name: 'Origami', tools: 'Square paper — 15 cm kami\nBone folder: sharp creases', safety: 'Paper cuts: run folds with the bone folder' } } });
  assert.equal(r.status, 201); const sid = (await r.json()).id;
  const list = await (await j('/api/sessions', { cookie: 1 })).json(); assert.equal(list.find((s) => s.id === sid).skill_name, 'Origami');
  const L = (await (await j(`/api/sessions/${sid}/links`, { cookie: 1 })).json()).links;
  const d = await (await j('/api/join', { method: 'POST', tok: L.apprentice.token, body: { consent: true } })).json();
  assert.equal(d.skill.name, 'Origami'); assert.deepEqual(d.skill.tools.map((t) => [t.name, t.purpose]), [['Square paper', '15 cm kami'], ['Bone folder', 'sharp creases']]);
  assert.match(d.skill.safety_advisories[0], /Paper cuts/); assert.equal(d.session.custom_skill, undefined);
  assert.equal((await j('/api/practice/start', { method: 'POST', tok: L.apprentice.token })).status, 201);
});
// A fresh session with an upload and one approved lesson (the shared session above is deleted by an earlier test).
async function fresh() {
  const sid = (await (await j('/api/sessions', { method: 'POST', cookie: 1, body: { title: 'Flow' } })).json()).id;
  const L = (await (await j(`/api/sessions/${sid}/links`, { cookie: 1 })).json()).links;
  for (const t of [L.master.token, L.apprentice.token]) await j('/api/join', { method: 'POST', tok: t, body: { consent: true } });
  const rid = (await (await j('/api/recordings', { method: 'POST', tok: L.master.token, headers: { 'content-type': 'video/mp4' }, body: mp4 })).json()).id;
  await j(`/api/recordings/${rid}/moments`, { method: 'POST', cookie: 1, body: { t: 3, text: 'Hands fold the corner' } });
  const qid = (await (await j(`/api/sessions/${sid}`, { cookie: 1 })).json()).questions[0].id;
  const kid = (await (await j(`/api/questions/${qid}/answer`, { method: 'POST', cookie: 1, body: { text: 'Crease firmly with the nail' } })).json()).id;
  await j(`/api/knowledge/${kid}`, { method: 'PATCH', cookie: 1, body: { status: 'approved' } });
  return { sid, L, m: L.master.token, a: L.apprentice.token, rid, kid };
}
test('student code: typed code resolves to the apprentice invite; wrong codes refused; master code never issued', async () => {
  const { L } = await fresh();
  assert.match(L.apprentice.code, /^[A-HJKMNP-Z2-9]{6}$/); assert.equal(L.master.code, null);
  const r = await j('/api/code', { method: 'POST', body: { code: L.apprentice.code.toLowerCase().replace(/^(...)/, '$1-') } });
  assert.equal(r.status, 200); assert.equal((await r.json()).token, L.apprentice.token);
  assert.equal((await j('/api/code', { method: 'POST', body: { code: 'ZZZZZZ' } })).status, 404);
  const e = await (await j('/api/entry')).json(); assert.match(e.masterPhone.url, /\/m\.html$/); assert.match(e.student.qr, /^data:image\/png/);
});
test('master phone: sees its own upload status and may start analysis only for its own session', async () => {
  const F = await fresh(), G = await fresh();
  const st = await (await j('/api/phone/status', { tok: F.m })).json();
  assert.equal(st.recordings[0].id, F.rid); assert.match(st.dashboard, /\/dashboard$/); assert.equal(st.questions, 1);
  assert.equal((await j('/api/phone/status', { tok: F.a })).status, 403);
  assert.equal((await j(`/api/recordings/${F.rid}/analyze`, { method: 'POST', tok: F.a })).status, 401);
  assert.equal((await j(`/api/recordings/${F.rid}/analyze`, { method: 'POST', tok: G.m })).status, 404);
  assert.equal((await j(`/api/recordings/${F.rid}/analyze`, { method: 'POST', tok: F.m })).status, 503); // own session; no AI here
});
test('learning progress: only approved lessons, per device, visible to the master', async () => {
  const F = await fresh(), H = { 'x-learner': 'device-abc-123' };
  assert.equal((await j('/api/progress', { tok: F.a })).status, 400);
  assert.equal((await j('/api/progress', { method: 'POST', tok: F.a, headers: H, body: { knowledge_id: 'nope' } })).status, 404);
  assert.equal((await j('/api/progress', { method: 'POST', tok: F.a, headers: H, body: { knowledge_id: F.kid } })).status, 200);
  let p = await (await j('/api/progress', { tok: F.a, headers: H })).json(); assert.deepEqual(p.learned.map((x) => x.id), [F.kid]); assert.equal(p.approved, 1);
  const d = await (await j(`/api/sessions/${F.sid}`, { cookie: 1 })).json(); assert.equal(d.learners[0].learned, 1);
  await j('/api/progress', { method: 'POST', tok: F.a, headers: H, body: { knowledge_id: F.kid, learned: false } });
  p = await (await j('/api/progress', { tok: F.a, headers: H })).json(); assert.equal(p.learned.length, 0);
});

// ---- personal master accounts ----
const signup = (body) => j('/api/signup', { method: 'POST', body });
const ck = (r) => r.headers.get('set-cookie').split(';')[0];
test('master accounts: sign up, remembered login, wrong password refused, first account claims old sessions', async () => {
  assert.equal((await signup({ name: 'A', username: 'x', password: 'secret1' })).status, 400); // username too short
  assert.equal((await signup({ name: 'A', username: 'aiko', password: '123' })).status, 400); // password too short
  const legacy = (await (await j('/api/sessions', { method: 'POST', cookie: 1, body: { title: 'Before accounts' } })).json()).id; // admin-made → no owner
  const r = await signup({ name: 'Aiko Tanaka', username: 'Aiko', password: 'secret1' });
  assert.equal(r.status, 201); assert.ok((await r.json()).claimed >= 1);
  assert.match(r.headers.get('set-cookie'), /Max-Age=2592000/); // 30 days: no retyping on every visit
  assert.equal((await signup({ name: 'Other', username: 'aiko', password: 'secret1' })).status, 409);
  assert.equal((await j('/api/login', { method: 'POST', body: { username: 'aiko', password: 'nope!!' } })).status, 401);
  const l = await j('/api/login', { method: 'POST', body: { username: ' AIKO ', password: 'secret1' } }); assert.equal(l.status, 200);
  const me = await (await j('/api/me', { headers: { cookie: ck(l) } })).json(); assert.equal(me.user.name, 'Aiko Tanaka'); assert.equal(me.user.admin, false);
  assert.ok((await (await j('/api/sessions', { headers: { cookie: ck(l) } })).json()).some((s) => s.id === legacy));
  const out = await j('/api/logout', { method: 'POST', headers: { cookie: ck(l) } }); assert.match(out.headers.get('set-cookie'), /Max-Age=0/);
});
test('master accounts: each master sees and changes only their own sessions', async () => {
  const a = ck(await j('/api/login', { method: 'POST', body: { username: 'aiko', password: 'secret1' } }));
  const b = ck(await signup({ name: 'Ben', username: 'ben', password: 'secret2' }));
  const sb = (await (await j('/api/sessions', { method: 'POST', headers: { cookie: b }, body: { title: 'Ben class' } })).json()).id;
  assert.equal((await (await j('/api/sessions', { headers: { cookie: b } })).json()).map((s) => s.id).join(), sb); // new master: only theirs
  assert.ok(!(await (await j('/api/sessions', { headers: { cookie: a } })).json()).some((s) => s.id === sb));
  for (const [m, p] of [['GET', `/api/sessions/${sb}`], ['GET', `/api/sessions/${sb}/links`], ['POST', `/api/sessions/${sb}/rotate`], ['DELETE', `/api/sessions/${sb}`], ['GET', `/api/knowledge?session=${sb}`]])
    assert.equal((await j(p, { method: m, headers: { cookie: a } })).status, 404, `${m} ${p}`);
  assert.equal((await j(`/api/sessions/${sb}`, { headers: { cookie: b } })).status, 200);
  assert.equal((await j(`/api/sessions/${sb}`, { cookie: 1 })).status, 200); // setup passphrase (admin) still sees all
});

// ---- removing mistakes: a wrong upload, an unwanted question ----
test('delete recording: goes to the recycle bin with its questions, knowledge and progress; restore brings it all back; phone may delete only its own session\'s', async () => {
  const F = await fresh(), G = await fresh(), H = { 'x-learner': 'device-del-1234' };
  await j('/api/progress', { method: 'POST', tok: F.a, headers: H, body: { knowledge_id: F.kid } });
  const file = () => fs.readdirSync(path.join(dir, 'rec')).filter((f) => f.startsWith(F.rid)).length;
  assert.equal(file(), 1);
  assert.equal((await j(`/api/recordings/${F.rid}`, { method: 'DELETE', tok: F.a })).status, 401); // students cannot
  assert.equal((await j(`/api/recordings/${F.rid}`, { method: 'DELETE', tok: G.m })).status, 404); // other session's phone cannot
  const r = await j(`/api/recordings/${F.rid}`, { method: 'DELETE', tok: F.m }); assert.equal(r.status, 200);
  const del = await r.json(); assert.deepEqual({ ...del, trashId: undefined }, { ok: true, trashId: undefined, questions: 1, knowledge: 1, approved: 1 });
  assert.equal(file(), 0);
  let d = await (await j(`/api/sessions/${F.sid}`, { cookie: 1 })).json();
  assert.equal(d.recordings.length, 0); assert.equal(d.questions.length, 0); assert.equal(d.knowledge.length, 0); assert.equal(d.learners.length, 0);
  assert.equal((await (await j('/api/knowledge', { tok: F.a })).json()).length, 0);
  assert.equal(d.trash.length, 1); assert.equal(d.trash[0].id, del.trashId); assert.match(d.trash[0].label, /1 question and 1 knowledge record/);
  // Undo: everything comes back exactly — video, question (answered), approved lesson, the student's progress.
  assert.equal((await j(`/api/trash/${del.trashId}/restore`, { method: 'POST', tok: F.m })).status, 401); // phones cannot restore
  assert.equal((await j(`/api/trash/${del.trashId}/restore`, { method: 'POST', cookie: 1 })).status, 200);
  d = await (await j(`/api/sessions/${F.sid}`, { cookie: 1 })).json();
  assert.equal(file(), 1); assert.equal(d.trash.length, 0); assert.equal(d.recordings.length, 1); assert.equal(d.questions[0].status, 'answered'); assert.equal(d.knowledge[0].status, 'approved');
  assert.equal((await (await j('/api/progress', { tok: F.a, headers: H })).json()).learned.length, 1);
  assert.equal((await fetch(base + d.recordings[0].url)).status, 200);
  // Delete again, then remove for good.
  const again = await (await j(`/api/recordings/${F.rid}`, { method: 'DELETE', cookie: 1 })).json();
  assert.equal((await j(`/api/trash/${again.trashId}`, { method: 'DELETE', cookie: 1 })).status, 200);
  assert.equal(fs.existsSync(path.join(dir, 'trash', again.trashId)), false);
  assert.equal((await j(`/api/recordings/${G.rid}`, { method: 'DELETE', cookie: 1 })).status, 200); // laptop (master sign-in) can too
});
test('questions: an open question can be removed or rewritten; answered ones cannot', async () => {
  const F = await fresh();
  await j(`/api/recordings/${F.rid}/moments`, { method: 'POST', cookie: 1, body: { t: 9, text: 'Hands flip the board' } });
  const d = await (await j(`/api/sessions/${F.sid}`, { cookie: 1 })).json(), open = d.questions.find((x) => x.status === 'open'), done = d.questions.find((x) => x.status === 'answered');
  assert.equal((await j(`/api/questions/${done.id}`, { method: 'DELETE', cookie: 1 })).status, 409);
  assert.equal((await j(`/api/questions/${open.id}/rephrase`, { method: 'POST', cookie: 1 })).status, 503); // no local AI here: honest refusal
  assert.equal((await j(`/api/questions/${open.id}`, { method: 'DELETE', tok: F.m })).status, 401);
  assert.equal((await j(`/api/questions/${open.id}`, { method: 'DELETE', cookie: 1 })).status, 200);
  const d2 = await (await j(`/api/sessions/${F.sid}`, { cookie: 1 })).json();
  assert.equal(d2.questions.length, 1); assert.equal(d2.observations.length, 1);
});

// ---- recycle bin for records and help, Japanese, renewals, per-client limits, read-aloud ----
test('delete knowledge record: question opens again; restore re-answers it; help requests can be deleted and restored', async () => {
  const F = await fresh();
  const r = await (await j(`/api/knowledge/${F.kid}`, { method: 'DELETE', cookie: 1 })).json(); assert.ok(r.trashId);
  let d = await (await j(`/api/sessions/${F.sid}`, { cookie: 1 })).json();
  assert.equal(d.knowledge.length, 0); assert.equal(d.questions[0].status, 'open');
  await j(`/api/trash/${r.trashId}/restore`, { method: 'POST', cookie: 1 });
  d = await (await j(`/api/sessions/${F.sid}`, { cookie: 1 })).json(); assert.equal(d.questions[0].status, 'answered'); assert.equal(d.knowledge[0].status, 'approved');
  const H = { 'x-learner': 'device-hdel-0001' }, hid = (await (await j('/api/help', { method: 'POST', tok: F.a, headers: H, body: { question: 'Help?' } })).json()).id;
  await j(`/api/help/${hid}/reply`, { method: 'POST', cookie: 1, body: { text: 'Sure' } });
  const t = await (await j(`/api/help/${hid}`, { method: 'DELETE', cookie: 1 })).json();
  assert.equal((await (await j('/api/help', { tok: F.a, headers: H })).json()).length, 0);
  await j(`/api/trash/${t.trashId}/restore`, { method: 'POST', cookie: 1 });
  assert.equal((await (await j('/api/help', { tok: F.a, headers: H })).json())[0].replies[0].text, 'Sure');
  const G = await fresh(); assert.equal((await j(`/api/trash/${t.trashId}`, { method: 'DELETE', headers: { cookie: ck(await j('/api/login', { method: 'POST', body: { username: 'ben', password: 'secret2' } })) } })).status, 404); // another master
  void G;
});
test('Japanese: lessons are found by a Japanese question; grammar-only overlap does not count', async () => {
  const F = await fresh();
  await j(`/api/knowledge/${F.kid}`, { method: 'PATCH', cookie: 1, body: { verbatim: 'はんだごての先をパッドとリード線に同時に二秒間当ててください。', status: 'approved' } });
  const hit = await (await j('/api/ask', { method: 'POST', tok: F.a, headers: { 'x-learner': 'device-ja-00001' }, body: { text: 'はんだごてはどこに当てますか？' } })).json();
  assert.equal(hit.answers.length, 1);
  const miss = await (await j('/api/ask', { method: 'POST', tok: F.a, headers: { 'x-learner': 'device-ja-00001' }, body: { text: 'これはなんですか？' } })).json();
  assert.equal(miss.answers.length, 0); assert.equal(miss.helpRequested, true);
});
test('session language: set at creation, switchable, given to phones', async () => {
  const r = await (await j('/api/sessions', { method: 'POST', cookie: 1, body: { title: '日本語', lang: 'ja' } })).json(); assert.equal(r.lang, 'ja');
  const L = (await (await j(`/api/sessions/${r.id}/links`, { cookie: 1 })).json()).links;
  assert.equal((await (await j('/api/join', { method: 'POST', tok: L.apprentice.token, body: { consent: true } })).json()).session.lang, 'ja');
  assert.equal((await j(`/api/sessions/${r.id}`, { method: 'PATCH', cookie: 1, body: { lang: 'fr' } })).status, 400);
  assert.equal((await j(`/api/sessions/${r.id}`, { method: 'PATCH', cookie: 1, body: { lang: 'en' } })).status, 200);
});
test('invites renew while in use and keep the same student code', async () => {
  const F = await fresh(), soon = new Date(Date.now() + 60e3).toISOString();
  withDbAt(dir, (db) => db.prepare('UPDATE tokens SET expires_at=? WHERE session_id=?').run(soon, F.sid));
  assert.equal((await j('/api/ping', { method: 'POST', tok: F.a })).status, 200);
  const L = (await (await j(`/api/sessions/${F.sid}/links`, { cookie: 1 })).json()).links;
  assert.equal(L.apprentice.code, F.L.apprentice.code); assert.equal(L.master.token, F.m);
  for (const r of ['master', 'apprentice']) assert.ok(new Date(L[r].expires_at) > new Date(Date.now() + 3600e3), r);
});
test('rate limits apply per client behind the local tunnel (X-Forwarded-For)', async () => {
  const bad = (ip) => j('/api/login', { method: 'POST', headers: { 'x-forwarded-for': ip }, body: { username: 'nobody', password: 'wrong!' } });
  for (let i = 0; i < 8; i++) await bad('203.0.113.7');
  assert.equal((await bad('203.0.113.7')).status, 429);
  assert.equal((await bad('198.51.100.9')).status, 401); // a different phone is not locked out
});
test('read-aloud: honest 503 when an engine is missing; needs an invite or master sign-in', async () => {
  assert.equal((await j('/api/tts?text=hello')).status, 401);
  const r = await j('/api/tts?text=' + encodeURIComponent('こんにちは'), { cookie: 1 }); assert.equal(r.status, 503); assert.equal((await r.json()).code, 'tts_unavailable');
});
const JT = path.join(os.homedir(), '.local/opt/open_jtalk');
test('read-aloud: real Japanese speech from Open JTalk', { skip: !fs.existsSync(path.join(JT, 'bin/open_jtalk')) && 'Open JTalk not installed' }, async () => {
  const d2 = fs.mkdtempSync(path.join(os.tmpdir(), 'mz-tts-'));
  const a2 = createApp({ dataDir: d2, passphrase: 'pw', jtalkBin: path.join(JT, 'bin/open_jtalk'), jtalkDic: path.join(JT, 'dic'), jtalkVoice: path.join(JT, 'voice/mei_normal.htsvoice') });
  const s2 = await new Promise((r) => { const x = a2.listen(0, () => r(x)); });
  try {
    const c = ck(await fetch(`http://127.0.0.1:${s2.address().port}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ passphrase: 'pw' }) }));
    const r = await fetch(`http://127.0.0.1:${s2.address().port}/api/tts?text=` + encodeURIComponent('はんだを溶かしてください。'), { headers: { cookie: c } });
    assert.equal(r.status, 200); assert.equal(r.headers.get('content-type'), 'audio/wav');
    const b = Buffer.from(await r.arrayBuffer()); assert.equal(b.subarray(0, 4).toString(), 'RIFF'); assert.ok(b.length > 48000, 'at least ~0.5 s of audio');
    assert.deepEqual((await (await fetch(`http://127.0.0.1:${s2.address().port}/api/me`, { headers: { cookie: c } })).json()).tts.includes('ja'), true);
  } finally { s2.close(); a2.close(); fs.rmSync(d2, { recursive: true, force: true }); }
});

// ---- skills in two languages, manuals, more questions, transcription modes, legal pages ----
test('skills: kintsugi and katana are installed; profiles come back in Japanese when asked; the AI keeps English', async () => {
  const en = (await (await j('/api/skills')).json()).skills.map((s) => s.id);
  for (const id of ['soldering', 'bonsai', 'kintsugi', 'katana']) assert.ok(en.includes(id), id);
  const ja = (await (await j('/api/skills', { headers: { 'x-lang': 'ja' } })).json()).skills;
  assert.equal(ja.find((s) => s.id === 'kintsugi').name, '金継ぎ'); assert.equal(ja.find((s) => s.id === 'katana').name, '日本刀の鍛錬（刀鍛冶）');
  const p = await (await j('/api/skills/katana?lang=ja')).json();
  assert.equal(p.tasks.find((t) => t.id === 'clay_quench').title, '土置きと焼き入れ'); assert.match(p.manual, /玉鋼/); assert.equal(p.ja, undefined);
  assert.match((await (await j('/api/skills/kintsugi')).json()).tools[0].name, /urushi/);
  // A phone in Japanese gets the Japanese briefing for a bundled skill.
  const sid = (await (await j('/api/sessions', { method: 'POST', cookie: 1, body: { title: 'k', skill_id: 'kintsugi', task_id: 'gold_finishing' } })).json()).id;
  const L = (await (await j(`/api/sessions/${sid}/links`, { cookie: 1 })).json()).links;
  const d = await (await j('/api/join', { method: 'POST', tok: L.apprentice.token, headers: { 'x-lang': 'ja' }, body: { consent: true } })).json();
  assert.equal(d.skill.name, '金継ぎ'); assert.match(d.skill.safety_advisories[0], /漆かぶれ/); assert.equal(d.skill.task.title, '継ぎ目の金仕上げ（粉蒔き）');
});
test('manual: text and PDF uploads become background text; scanned/empty files are refused; master only', async () => {
  const F = await fresh(), put = (body, type, cookie = 1) => j(`/api/sessions/${F.sid}/manual`, { method: 'PUT', cookie, headers: { 'content-type': type, 'x-filename': encodeURIComponent('手引き.txt') }, body: Buffer.from(body) });
  assert.equal((await j(`/api/sessions/${F.sid}/manual`, { method: 'PUT', tok: F.m, headers: { 'content-type': 'text/plain' }, body: Buffer.from('x'.repeat(50)) })).status, 401);
  assert.equal((await put('short', 'text/plain')).status, 400);
  assert.equal((await put('<svg/>', 'image/svg+xml')).status, 415);
  const r = await put('Always tin the tip before each joint.\n\nKeep the iron at 350 degrees for lead-free solder.', 'text/plain'); assert.equal(r.status, 200);
  let s = (await (await j(`/api/sessions/${F.sid}`, { cookie: 1 })).json()).session;
  assert.equal(s.manual_name, '手引き.txt'); assert.ok(s.manual_chars > 30); assert.equal(s.manual, undefined);
  if (fs.existsSync('/usr/bin/pdftotext')) {
    // A minimal one-page PDF with real text.
    const txt = 'BT /F1 18 Tf 72 720 Td (Wipe the tip on brass before every joint) Tj ET';
    const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>', `<< /Length ${txt.length} >>\nstream\n${txt}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
    let pdf = '%PDF-1.4\n'; const off = []; objs.forEach((o, i) => { off.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const x = pdf.length; pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${off.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
    assert.equal((await put(pdf, 'application/pdf')).status, 200);
    s = (await (await j(`/api/sessions/${F.sid}`, { cookie: 1 })).json()).session; assert.match(s.manual_preview, /Wipe the tip on brass/);
  }
  assert.equal((await j(`/api/sessions/${F.sid}/manual`, { method: 'DELETE', cookie: 1 })).status, 200);
  assert.equal((await (await j(`/api/sessions/${F.sid}`, { cookie: 1 })).json()).session.manual_chars, 0);
});
test('more questions: only after analysis, never without local AI, phone limited to its own session', async () => {
  const F = await fresh(), G = await fresh();
  assert.equal((await j(`/api/recordings/${F.rid}/more`, { method: 'POST', cookie: 1, body: { count: 5 } })).status, 409); // not analysed yet
  withDbAt(dir, (db) => db.prepare("UPDATE recordings SET status='analyzed' WHERE id=?").run(F.rid));
  assert.equal((await j(`/api/recordings/${F.rid}/more`, { method: 'POST', tok: G.m, body: { count: 5 } })).status, 404);
  assert.equal((await j(`/api/recordings/${F.rid}/more`, { method: 'POST', tok: F.a, body: { count: 5 } })).status, 401);
  const r = await j(`/api/recordings/${F.rid}/more`, { method: 'POST', tok: F.m, body: { count: 10 } }); assert.equal(r.status, 503); // no AI configured here
});
test('legal pages in English and Japanese (query or language cookie)', async () => {
  assert.match(await (await j('/privacy')).text(), /<html lang="en">[\s\S]*Privacy Policy/);
  const ja = await j('/terms?lang=ja'); assert.match(await ja.text(), /<html lang="ja">[\s\S]*利用規約/); assert.match(ja.headers.get('set-cookie'), /mz_lang=ja/);
  assert.match(await (await j('/cookies', { headers: { cookie: 'mz_lang=ja' } })).text(), /Cookieポリシー/);
});
test('transcribe: Japanese stays Japanese (-l ja / auto); English translation only when asked (-tr)', { skip: !fs.existsSync('/usr/bin/ffmpeg') && 'ffmpeg not installed' }, async () => {
  const { execFileSync } = await import('node:child_process');
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mz-stt2-')), bin = path.join(d, 'fake-whisper'), model = path.join(d, 'model.bin');
  // Stand-in for whisper-cli that reports the language flags it was given.
  fs.writeFileSync(bin, '#!/bin/sh\nL=""; TR=""; while [ $# -gt 0 ]; do case "$1" in -l) L="$2"; shift;; -tr) TR=" translate";; esac; shift; done; echo "lang=$L$TR"\n', { mode: 0o755 }); fs.writeFileSync(model, 'x');
  const a2 = createApp({ dataDir: d, passphrase: 'pw3', whisperBin: bin, whisperModel: model }), s2 = await new Promise((r) => { const s = a2.listen(0, () => r(s)); });
  try {
    const b2 = 'http://127.0.0.1:' + s2.address().port, c2 = (await fetch(b2 + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"passphrase":"pw3"}' })).headers.get('set-cookie').split(';')[0];
    const ogg = execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:a', 'libopus', '-f', 'ogg', 'pipe:1']);
    const tx = async (q) => (await (await fetch(b2 + '/api/transcribe' + q, { method: 'POST', headers: { cookie: c2, 'content-type': 'audio/ogg' }, body: ogg })).json());
    assert.equal((await tx('?lang=ja')).text, 'lang=ja'); assert.equal((await tx('?lang=auto')).text, 'lang=auto'); assert.equal((await tx('?lang=en')).text, 'lang=en');
    const tr = await tx('?lang=translate'); assert.equal(tr.text, 'lang=auto translate'); assert.equal(tr.mode, 'translate');
    // WAV uploads used to collide with the converted file's name.
    const wav = execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-f', 'wav', 'pipe:1']);
    assert.equal((await (await fetch(b2 + '/api/transcribe?lang=ja', { method: 'POST', headers: { cookie: c2, 'content-type': 'audio/wav' }, body: wav })).json()).text, 'lang=ja');
  } finally { s2.close(); a2.close(); fs.rmSync(d, { recursive: true, force: true }); }
});
