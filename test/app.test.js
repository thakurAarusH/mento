import test, { before, after } from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { createApp } from '../app.js';
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
test('signed file link works, tampering and expiry rejected', async () => {
  const url = (await (await j('/api/knowledge', { tok: links.a })).json())[0].clip.url;
  assert.equal((await fetch(base + url)).status, 200);
  assert.equal((await fetch(base + url.replace(/sig=./, 'sig=0'))).status, 403);
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
  const h = await (await j('/api/help', { method: 'POST', tok: links.a, body: { question: 'Is this joint ok?' } })).json();
  const d = await (await j(`/api/sessions/${S}`, { cookie: 1 })).json(); const row = d.help.find((x) => x.id === h.id); assert.ok(row.frame);
  assert.equal((await j(`/api/help/${h.id}/reply`, { method: 'POST', tok: links.a, body: { text: 'x' } })).status, 401);
  assert.equal((await j(`/api/help/${h.id}/reply`, { method: 'POST', cookie: 1, body: { text: 'Re-flow it' } })).status, 201);
  const mine = await (await j('/api/help', { tok: links.a })).json(); assert.equal(mine.find((x) => x.id === h.id).replies[0].text, 'Re-flow it');
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
