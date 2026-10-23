import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import QRCode from 'qrcode';
import { parseAssessment, mmss } from './lib/validate.js';
import { renderLegal } from './lib/legal.js';
import { getSkillsSummary, getSkill, validateSkillAndTask, buildAssessmentPrompt } from './lib/skills.js';

export function migrateDatabase(db) {
  const cols = new Set(db.prepare("PRAGMA table_info('sessions')").all().map((c) => c.name));
  if (!cols.has('skill_id')) {
    db.exec("ALTER TABLE sessions ADD COLUMN skill_id TEXT DEFAULT 'soldering'");
  }
  if (!cols.has('task_id')) {
    db.exec("ALTER TABLE sessions ADD COLUMN task_id TEXT");
  }
}

const rid = () => crypto.randomBytes(8).toString('hex');
const now = () => new Date().toISOString();
const safeEq = (a, b) => { a = Buffer.from(String(a)); b = Buffer.from(String(b)); return a.length === b.length && crypto.timingSafeEqual(a, b); };
const STOP = new Set('the and for how what why when with that this you your are can did does have not but was from into'.split(' '));
const words = (s) => (String(s || '').toLowerCase().match(/[a-z0-9]{3,}/g) || []).filter((w) => !STOP.has(w));
const VIDEO = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' };
const isVideo = (b, mime) => (mime === 'video/webm' ? b.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) : b.subarray(4, 8).toString() === 'ftyp');
const isJpeg = (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
// Legacy rows predate skill profiles and were all soldering (matches the column DEFAULT).
const sessionSkill = (s) => getSkill(s?.skill_id || 'soldering');
const NO_PROFILE = { error: 'This session\'s skill profile is unavailable on the server, so its safety guidance cannot be shown. Ask the master to check the installation or create a new session.', code: 'skill_profile_unavailable' };

export function createApp(o = {}) {
  const E = process.env;
  const C = {
    dir: o.dataDir || E.DATA_DIR || './data', pass: o.passphrase || E.MASTER_PASSPHRASE || '',
    maxVideoMb: +(o.maxVideoMb || E.MAX_VIDEO_MB || 200), maxFrameKb: +(E.MAX_FRAME_KB || 400), maxRecSec: +(E.MAX_RECORDING_SEC || 600),
    snapMs: +(E.SNAPSHOT_INTERVAL_MS || 3500), retDays: +(E.RETENTION_DAYS || 30), ttlH: +(E.TOKEN_TTL_HOURS || 24),
    ollama: E.OLLAMA_URL || '', vModel: E.OLLAMA_VISION_MODEL || '', pub: E.PUBLIC_URL || '',
  };
  if (!C.pass) throw new Error('MASTER_PASSPHRASE is required');
  for (const d of ['rec', 'frames', 'tmp']) fs.mkdirSync(path.join(C.dir, d), { recursive: true });
  const sf = path.join(C.dir, '.secret');
  if (!fs.existsSync(sf)) fs.writeFileSync(sf, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  const secret = fs.readFileSync(sf, 'utf8');
  const sign = (s) => crypto.createHmac('sha256', secret).update(s).digest('hex');

  const db = new DatabaseSync(path.join(C.dir, 'monozukuri.db'));
  db.exec(fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  migrateDatabase(db);
  const q = (s, ...a) => db.prepare(s).all(...a);
  const q1 = (s, ...a) => db.prepare(s).get(...a);
  const run = (s, ...a) => db.prepare(s).run(...a);

  // ---- realtime (Server-Sent Events) ----
  const clients = new Set();
  const emit = (sid, type, data = {}) => { for (const c of clients) if (c.master || c.sid === sid) c.res.write(`data: ${JSON.stringify({ type, sid, ...data })}\n\n`); };
  const ev = (sid, kind, detail = '') => { run('INSERT INTO events(session_id,kind,detail,created_at) VALUES(?,?,?,?)', sid, kind, String(detail).slice(0, 300), now()); emit(sid, 'event', { kind }); };

  // ---- auth ----
  const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((s) => s.trim().split('=')).filter((a) => a[0]));
  const isMaster = (req) => { const c = cookies(req).mz; if (!c) return false; const [exp, sig] = c.split('.'); return +exp > Date.now() && !!sig && safeEq(sig, sign('m' + exp)); };
  const M = (req, res, next) => (isMaster(req) ? next() : res.status(401).json({ error: 'Master sign-in required.' }));
  const tokOf = (req) => { const t = req.get('x-token') || req.query.t; const r = t && q1('SELECT * FROM tokens WHERE token=?', String(t)); return r && new Date(r.expires_at) > new Date() ? r : null; };
  const P = (...roles) => (req, res, next) => {
    const r = tokOf(req);
    if (!r) return res.status(401).json({ error: 'Invalid or expired invitation. Ask the master for a new QR code.' });
    if (roles.length && !roles.includes(r.role)) return res.status(403).json({ error: 'This invitation cannot do that.' });
    req.tok = r; next();
  };
  const consented = (req, res, next) => (req.tok.consented_at ? next() : res.status(403).json({ error: 'Recording consent has not been given on this device.' }));
  const A = (f) => (req, res, next) => Promise.resolve(f(req, res)).catch(next);
  const attempts = new Map();

  // ---- signed, expiring file links ----
  const fileUrl = (kind, id, ttl = 900) => { const exp = Date.now() + ttl * 1000; return `/f/${kind}/${id}?exp=${exp}&sig=${sign(`${kind}|${id}|${exp}`)}`; };
  const filePath = (kind, id) => {
    const r = kind === 'rec' ? q1('SELECT file f,mime FROM recordings WHERE id=?', id) : kind === 'help' ? q1('SELECT frame_file f FROM help WHERE id=?', id) : kind === 'live' ? q1('SELECT frame_file f FROM practice WHERE id=?', id) : null;
    return r && r.f ? { p: path.resolve(C.dir, r.f), mime: r.mime || 'image/jpeg' } : null;
  };

  // ---- domain helpers ----
  function deleteSession(sid) {
    for (const r of q('SELECT file FROM recordings WHERE session_id=?', sid)) fs.rmSync(path.join(C.dir, r.file), { force: true });
    for (const r of q('SELECT frame_file f FROM practice WHERE session_id=? AND frame_file IS NOT NULL UNION SELECT frame_file FROM help WHERE session_id=? AND frame_file IS NOT NULL', sid, sid)) fs.rmSync(path.join(C.dir, r.f), { force: true });
    run('DELETE FROM replies WHERE help_id IN (SELECT id FROM help WHERE session_id=?)', sid);
    for (const t of ['assessments', 'help', 'practice', 'knowledge', 'questions', 'observations', 'recordings', 'tokens', 'events']) run(`DELETE FROM ${t} WHERE session_id=?`, sid);
    run('DELETE FROM sessions WHERE id=?', sid);
  }
  const purge = () => { const cut = new Date(Date.now() - C.retDays * 864e5).toISOString(); for (const s of q('SELECT id FROM sessions WHERE created_at<?', cut)) deleteSession(s.id); };
  purge(); const purgeTimer = setInterval(purge, 36e5); purgeTimer.unref();

  function addMoment(rec, t, text, unc, source) {
    const oid = rid(); run('INSERT INTO observations VALUES(?,?,?,?,?,?,?)', oid, rec.session_id, rec.id, t, text, unc, source);
    run('INSERT INTO questions VALUES(?,?,?,?,?,?,?,?)', rid(), rec.session_id, oid, rec.id, t, `At ${mmss(t)} — ${text} What were you noticing or deciding at this point?`, 'open', now());
  }
  // A clip only for records that genuinely come from a recording in their own session; help-derived records have none.
  const clipOf = (k) => (k.recording_id && !q1('SELECT 1 FROM help WHERE id=?', k.question_id) && q1('SELECT 1 FROM recordings WHERE id=? AND session_id=?', k.recording_id, k.session_id) ? { url: fileUrl('rec', k.recording_id), t: k.t } : null);
  const approved = (sid) => q("SELECT * FROM knowledge WHERE session_id=? AND status='approved'", sid);
  function search(sid, text, onlyApproved = true) {
    const w = new Set(words(text));
    return q(`SELECT * FROM knowledge WHERE session_id=? ${onlyApproved ? "AND status='approved'" : ''}`, sid)
      .map((k) => ({ k, s: words([k.observed, k.verbatim, k.summary, k.cues, k.warnings, k.step, k.tool].join(' ')).filter((x) => w.has(x)).length }))
      .filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 3).map((x) => ({ ...x.k, clip: clipOf(x.k) }));
  }

  // ---- optional local AI (Ollama). Never faked: failures are surfaced. ----
  function aiReady() {
    if (!C.ollama || !C.vModel) throw new Error('No local vision model configured (set OLLAMA_URL and OLLAMA_VISION_MODEL).');
    const host = new URL(C.ollama).hostname;
    if (!/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$)/.test(host) && E.OLLAMA_ALLOW_REMOTE !== '1') throw new Error('Refusing to send footage to a non-local AI host (OLLAMA_ALLOW_REMOTE not set).');
  }
  async function ollama(prompt, img) {
    aiReady();
    const r = await fetch(C.ollama.replace(/\/$/, '') + '/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(120000),
      body: JSON.stringify({ model: C.vModel, stream: false, format: 'json', messages: [{ role: 'user', content: prompt, images: [img.toString('base64')] }] }) });
    if (!r.ok) throw new Error('Ollama HTTP ' + r.status);
    return (await r.json()).message.content;
  }
  const OBS = 'You see one still frame from a craftsperson\'s work. Describe ONLY what is visibly present. Do not guess reasons or intent. Return JSON {"visible":string,"notable":boolean,"uncertainty":string}. notable=true only if the frame shows a clear tool change, inspection, correction or change of approach.';
  async function analyzeRec(rec) {
    aiReady();
    const out = path.join(C.dir, 'tmp', rec.id); fs.mkdirSync(out, { recursive: true });
    try {
      await new Promise((ok, no) => execFile('ffmpeg', ['-v', 'error', '-y', '-i', path.join(C.dir, rec.file), '-vf', 'fps=1/5,scale=640:-2', '-frames:v', '24', path.join(out, 'f%03d.jpg')], { timeout: 120000 }, (e) => (e ? no(new Error('ffmpeg failed: ' + e.message)) : ok())));
      const frames = fs.readdirSync(out).sort();
      if (!frames.length) throw new Error('No frames could be extracted (unsupported codec?).');
      let n = 0;
      for (const [i, f] of frames.entries()) {
        let j; try { j = JSON.parse(await ollama(OBS, fs.readFileSync(path.join(out, f)))); } catch (e) { if (/Ollama|fetch|timeout/i.test(e.message)) throw e; continue; }
        if (j && j.notable === true && typeof j.visible === 'string' && j.visible) { addMoment(rec, i * 5, 'the footage shows: ' + j.visible.slice(0, 300) + '.', String(j.uncertainty || '').slice(0, 200), 'ollama:' + C.vModel); n++; }
      }
      return n;
    } finally { fs.rmSync(out, { recursive: true, force: true }); }
  }
  const busy = new Set();
  function openHelp(sid, practiceId, question, step, frame, assessmentId) {
    const id = rid(); let ff = null;
    if (frame) { ff = `frames/help-${id}.jpg`; fs.writeFileSync(path.join(C.dir, ff), frame); }
    run('INSERT INTO help VALUES(?,?,?,?,?,?,?,?,?)', id, sid, practiceId, question, step || '', ff, assessmentId || null, 'pending', now());
    ev(sid, 'help_requested', question); emit(sid, 'help'); return id;
  }
  async function assess(pr, buf, manual) {
    busy.add(pr.id);
    try {
      const skill = sessionSkill(q1('SELECT skill_id FROM sessions WHERE id=?', pr.session_id));
      const kn = approved(pr.session_id); let r;
      if (!skill) r = { status: 'cannot_assess', stage: '', evidence: '', confidence: 'low', knowledge_ids: [], feedback: 'Automatic check unavailable: this session\'s skill profile is missing, so no domain safety rules can be applied. Asking the master.', needs_help: true, source: 'rule' };
      else if (!kn.length) r = { status: 'cannot_assess', stage: '', evidence: '', confidence: 'low', knowledge_ids: [], feedback: 'No approved master knowledge exists for this task yet.', needs_help: true, source: 'rule' };
      else {
        try {
          aiReady();
          r = { ...parseAssessment(await ollama(buildAssessmentPrompt(skill, kn), buf), kn.map((k) => k.id)), source: 'ollama:' + C.vModel };
        } catch (e) { r = { status: 'cannot_assess', stage: '', evidence: '', confidence: 'low', knowledge_ids: [], feedback: 'Automatic check unavailable: ' + e.message, needs_help: manual, source: 'unavailable' }; }
      }
      const aid = rid();
      run('INSERT INTO assessments VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', aid, pr.id, pr.session_id, r.status, r.stage, r.evidence, r.confidence, JSON.stringify(r.knowledge_ids), r.feedback, r.needs_help ? 1 : 0, r.source, now());
      emit(pr.session_id, 'assessment', { practice: pr.id, assessment: { ...r, id: aid } });
      const open = q1("SELECT id FROM help WHERE practice_id=? AND status IN ('pending','answered')", pr.id);
      if (r.needs_help && (manual || r.status === 'safety_stop' || !skill) && !open) openHelp(pr.session_id, pr.id, r.feedback, r.stage, buf, aid);
    } finally { busy.delete(pr.id); }
  }

  // ================= HTTP =================
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set({ 'Content-Security-Policy': "default-src 'self'; media-src 'self' blob:; img-src 'self' data: blob:; style-src 'self'; style-src-attr 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Permissions-Policy': 'camera=(self), microphone=(self), geolocation=()', 'Cache-Control': 'no-store' });
    next();
  });
  app.use(express.json({ limit: '100kb' }));
  const raw = (mb) => express.raw({ type: () => true, limit: mb + 'mb' });

  app.get('/api/health', (req, res) => res.json({ ok: true, db: !!q1('SELECT 1 x'), ai: !!(C.ollama && C.vModel), time: now() }));
  app.get(['/privacy', '/terms', '/cookies'], (req, res) => res.type('html').send(renderLegal(req.path.slice(1))));

  app.post('/api/login', (req, res) => {
    const k = req.ip, a = attempts.get(k) || { n: 0, t: Date.now() };
    if (Date.now() - a.t > 6e4) { a.n = 0; a.t = Date.now(); }
    if (++a.n > 8) return res.status(429).json({ error: 'Too many attempts. Wait a minute.' });
    attempts.set(k, a);
    const h = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
    if (!safeEq(h(req.body?.passphrase), h(C.pass))) return res.status(401).json({ error: 'Incorrect passphrase.' });
    const exp = Date.now() + 12 * 36e5;
    res.set('Set-Cookie', `mz=${exp}.${sign('m' + exp)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${req.secure || req.get('x-forwarded-proto') === 'https' ? '; Secure' : ''}`);
    res.json({ ok: true });
  });
  app.get('/api/me', M, (req, res) => res.json({ ok: true, limits: { maxVideoMb: C.maxVideoMb, retentionDays: C.retDays }, aiConfigured: !!(C.ollama && C.vModel) }));
  app.get('/api/skills', (req, res) => res.json({ skills: getSkillsSummary() }));
  app.get('/api/skills/:id', (req, res) => {
    const s = /^[a-z0-9_-]{1,64}$/.test(req.params.id) ? getSkill(req.params.id) : null;
    if (!s) return res.status(404).json({ error: 'Skill profile not found.' });
    res.json(s);
  });

  // sessions (master)
  const mint = (sid) => { run('DELETE FROM tokens WHERE session_id=?', sid); const exp = new Date(Date.now() + C.ttlH * 36e5).toISOString(); for (const role of ['master', 'apprentice']) run('INSERT INTO tokens(token,session_id,role,expires_at) VALUES(?,?,?,?)', crypto.randomBytes(24).toString('base64url'), sid, role, exp); };
  app.post('/api/sessions', M, (req, res) => {
    const { title, task, procedure, skill_id, task_id } = req.body || {};
    if (typeof title !== 'string' || !title.trim() || title.length > 120) return res.status(400).json({ error: 'A title (max 120 characters) is required.' });
    for (const [f, v] of [['task', task], ['procedure', procedure], ['skill_id', skill_id], ['task_id', task_id]]) if (v != null && typeof v !== 'string') return res.status(400).json({ error: `${f} must be a string.` });
    const sk = skill_id || 'soldering', tid = task_id || null;
    const val = validateSkillAndTask(sk, tid);
    if (!val.valid) return res.status(400).json({ error: val.error });
    // Explicit non-empty text wins; otherwise the selected task template supplies the defaults.
    const tk = (task?.trim() ? task : val.task?.title || '').slice(0, 1000), pc = (procedure?.trim() ? procedure : val.task?.default_procedure || '').slice(0, 4000);
    const id = rid(); run('INSERT INTO sessions(id,title,task,procedure,skill_id,task_id,created_at) VALUES(?,?,?,?,?,?,?)', id, title.trim(), tk, pc, sk, tid, now()); mint(id); ev(id, 'session_created', title);
    res.status(201).json({ id, skill_id: sk, task_id: tid, task: tk, procedure: pc });
  });
  app.get('/api/sessions', M, (req, res) => res.json(q('SELECT * FROM sessions ORDER BY created_at DESC')));
  app.delete('/api/sessions/:id', M, (req, res) => { if (!q1('SELECT 1 FROM sessions WHERE id=?', req.params.id)) return res.status(404).json({ error: 'Not found' }); deleteSession(req.params.id); emit(req.params.id, 'deleted'); res.json({ ok: true }); });
  app.post('/api/sessions/:id/rotate', M, (req, res) => { mint(req.params.id); ev(req.params.id, 'links_rotated'); res.json({ ok: true }); });
  app.get('/api/sessions/:id/links', M, A(async (req, res) => {
    const base = C.pub || `${req.protocol}://${req.get('host')}`;
    const out = {};
    for (const t of q('SELECT * FROM tokens WHERE session_id=?', req.params.id)) { const url = `${base}/${t.role === 'master' ? 'm' : 'a'}.html#${t.token}`; out[t.role] = { url, qr: await QRCode.toDataURL(url, { margin: 1, width: 240 }), expires_at: t.expires_at }; }
    res.json({ links: out, warning: /localhost|127\.0\.0\.1/.test(base) ? 'You opened the dashboard via localhost. Phones cannot reach that: open the dashboard via your laptop\'s LAN IP or set PUBLIC_URL.' : null });
  }));
  app.get('/api/sessions/:id', M, (req, res) => {
    const id = req.params.id, s = q1('SELECT * FROM sessions WHERE id=?', id);
    if (!s) return res.status(404).json({ error: 'Not found' });
    const cutoff = Date.now() - 30000;
    const devices = q('SELECT role,consented_at,last_seen,expires_at FROM tokens WHERE session_id=?', id).map((d) => ({ ...d, connected: !!d.last_seen && new Date(d.last_seen).getTime() > cutoff }));
    const help = q('SELECT * FROM help WHERE session_id=? ORDER BY created_at DESC', id).map((h) => ({ ...h, frame: h.frame_file ? fileUrl('help', h.id) : null, replies: q('SELECT * FROM replies WHERE help_id=? ORDER BY created_at', h.id) }));
    const practices = q('SELECT id,started_at,ended_at FROM practice WHERE session_id=? ORDER BY started_at DESC', id).map((p) => { const as = q('SELECT * FROM assessments WHERE practice_id=? ORDER BY created_at', p.id); const c = {}; for (const a of as) c[a.status] = (c[a.status] || 0) + 1; return { ...p, counts: c, total: as.length, last: as.at(-1) || null }; });
    res.json({ session: s, devices, recordings: q('SELECT * FROM recordings WHERE session_id=? ORDER BY created_at DESC', id).map((r) => ({ ...r, url: fileUrl('rec', r.id) })),
      observations: q('SELECT * FROM observations WHERE session_id=? ORDER BY t', id), questions: q('SELECT * FROM questions WHERE session_id=? ORDER BY t', id),
      knowledge: q('SELECT * FROM knowledge WHERE session_id=? ORDER BY created_at DESC', id), help, practices, events: q('SELECT * FROM events WHERE session_id=? ORDER BY id DESC LIMIT 40', id) });
  });

  // phones
  app.post('/api/join', P(), (req, res) => {
    if (req.body?.consent !== true) return res.status(400).json({ error: 'Consent must be actively given (the box must be ticked).' });
    // Resolve the safety context before recording consent or touching the token.
    const s = q1('SELECT title,task,procedure,skill_id,task_id FROM sessions WHERE id=?', req.tok.session_id);
    if (!s) return res.status(404).json({ error: 'Session not found.' });
    const sk = sessionSkill(s);
    if (!sk) return res.status(409).json(NO_PROFILE);
    run('UPDATE tokens SET consented_at=COALESCE(consented_at,?), last_seen=? WHERE token=?', now(), now(), req.tok.token);
    const skill = { id: sk.id, name: sk.name, safety_advisories: sk.safety_advisories, tools: sk.tools.map(({ id, name, purpose }) => ({ id, name, purpose })) };
    ev(req.tok.session_id, 'device_joined', req.tok.role + ' consented and joined');
    res.json({ role: req.tok.role, session: s, skill, limits: { maxVideoMb: C.maxVideoMb, maxRecSec: C.maxRecSec, snapshotMs: C.snapMs, maxFrameKb: C.maxFrameKb } });
  });
  app.post('/api/ping', P(), (req, res) => { run('UPDATE tokens SET last_seen=? WHERE token=?', now(), req.tok.token); emit(req.tok.session_id, 'ping'); res.json({ ok: true }); });

  app.post('/api/recordings', P('master'), consented, raw(C.maxVideoMb), A(async (req, res) => {
    const mime = String(req.get('content-type') || '').split(';')[0].trim();
    if (!VIDEO[mime]) return res.status(415).json({ error: `Unsupported video type "${mime}". Use MP4, WebM or MOV.` });
    if (!Buffer.isBuffer(req.body) || req.body.length < 1000 || !isVideo(req.body, mime)) return res.status(400).json({ error: 'File is empty or is not a valid video of the declared type.' });
    const id = rid(), file = `rec/${id}.${VIDEO[mime]}`; fs.writeFileSync(path.join(C.dir, file), req.body);
    run('INSERT INTO recordings VALUES(?,?,?,?,?,?,?,?)', id, req.tok.session_id, file, mime, req.body.length, 'uploaded', null, now());
    ev(req.tok.session_id, 'recording_uploaded', `${(req.body.length / 1e6).toFixed(1)} MB`); res.status(201).json({ id });
  }));
  app.post('/api/recordings/:id/analyze', M, (req, res) => {
    const rec = q1('SELECT * FROM recordings WHERE id=?', req.params.id); if (!rec) return res.status(404).json({ error: 'Not found' });
    try { aiReady(); } catch (e) { run("UPDATE recordings SET status='failed',error=? WHERE id=?", e.message, rec.id); ev(rec.session_id, 'analysis_failed', e.message); return res.status(503).json({ error: e.message + ' Add moments manually instead.' }); }
    run("UPDATE recordings SET status='analyzing',error=NULL WHERE id=?", rec.id); ev(rec.session_id, 'analysis_started', rec.id); res.status(202).json({ ok: true });
    analyzeRec(rec).then((n) => { run("UPDATE recordings SET status='analyzed' WHERE id=?", rec.id); ev(rec.session_id, 'analysis_done', `${n} candidate moments (still frames every 5 s)`); })
      .catch((e) => { run("UPDATE recordings SET status='failed',error=? WHERE id=?", e.message, rec.id); ev(rec.session_id, 'analysis_failed', e.message); });
  });
  app.post('/api/recordings/:id/moments', M, (req, res) => {
    const rec = q1('SELECT * FROM recordings WHERE id=?', req.params.id); const { t, text } = req.body || {};
    if (!rec) return res.status(404).json({ error: 'Not found' });
    if (!(t >= 0) || typeof text !== 'string' || !text.trim()) return res.status(400).json({ error: 'Time (seconds) and a description of what is visible are required.' });
    addMoment(rec, Math.floor(t), text.trim().slice(0, 300).replace(/\.?$/, '.'), '', 'manual'); ev(rec.session_id, 'moment_added', mmss(t)); res.status(201).json({ ok: true });
  });
  app.get('/f/:kind/:id', (req, res) => {
    const { kind, id } = req.params, { exp, sig } = req.query;
    if (!/^[a-f0-9]{16}$/.test(id) || !(+exp > Date.now()) || !safeEq(sig || '', sign(`${kind}|${id}|${exp}`))) return res.status(403).send('Link invalid or expired.');
    const f = filePath(kind, id); if (!f || !fs.existsSync(f.p)) return res.status(404).send('Not found');
    res.type(f.mime).sendFile(f.p, { headers: { 'Cache-Control': 'private, no-store' } });
  });

  // questions → knowledge (master)
  app.post('/api/questions/:id/answer', M, (req, res) => {
    const qu = q1('SELECT * FROM questions WHERE id=?', req.params.id), text = req.body?.text;
    if (!qu) return res.status(404).json({ error: 'Not found' });
    if (typeof text !== 'string' || !text.trim() || text.length > 4000) return res.status(400).json({ error: 'An answer (max 4000 characters) is required.' });
    const ob = q1('SELECT text FROM observations WHERE id=?', qu.observation_id); const id = rid();
    run("INSERT INTO knowledge(id,session_id,question_id,recording_id,t,observed,verbatim,summary,cues,warnings,step,tool,status,approved_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", id, qu.session_id, qu.id, qu.recording_id, qu.t, ob?.text || '', text.trim(), '', '', '', '', '', 'draft', null, now());
    run("UPDATE questions SET status='answered' WHERE id=?", qu.id); ev(qu.session_id, 'answer_saved', mmss(qu.t)); res.status(201).json({ id });
  });
  app.patch('/api/knowledge/:id', M, (req, res) => {
    const k = q1('SELECT * FROM knowledge WHERE id=?', req.params.id); if (!k) return res.status(404).json({ error: 'Not found' });
    const b = req.body || {}, F = ['verbatim', 'summary', 'cues', 'warnings', 'step', 'tool'], n = { ...k }; let changed = false;
    for (const f of F) if (typeof b[f] === 'string' && b[f] !== k[f]) { n[f] = b[f].slice(0, 4000); changed = true; }
    if (b.status !== undefined && !['draft', 'approved', 'rejected', 'clarify'].includes(b.status)) return res.status(400).json({ error: 'Invalid status' });
    n.status = b.status ?? (changed && k.status === 'approved' ? 'draft' : k.status);
    if (n.status === 'approved' && !n.verbatim.trim()) return res.status(400).json({ error: 'Cannot approve a record without the expert\'s words.' });
    n.approved_at = n.status === 'approved' ? (k.status === 'approved' && !changed ? k.approved_at : now()) : null;
    run('UPDATE knowledge SET verbatim=?,summary=?,cues=?,warnings=?,step=?,tool=?,status=?,approved_at=? WHERE id=?', n.verbatim, n.summary, n.cues, n.warnings, n.step, n.tool, n.status, n.approved_at, k.id);
    ev(k.session_id, 'knowledge_' + n.status, mmss(k.t)); res.json({ ok: true, status: n.status });
  });
  app.get('/api/knowledge', (req, res) => {
    const tk = tokOf(req), m = isMaster(req); if (!m && !tk) return res.status(401).json({ error: 'Not signed in.' });
    const sid = m ? req.query.session : tk.session_id; if (!sid) return res.status(400).json({ error: 'session required' });
    const t = String(req.query.q || '').trim();
    res.json(t ? search(sid, t, !m) : q(`SELECT * FROM knowledge WHERE session_id=? ${m ? '' : "AND status='approved'"} ORDER BY created_at DESC`, sid).map((k) => ({ ...k, clip: clipOf(k) })));
  });

  // apprentice
  app.post('/api/practice/start', P('apprentice'), consented, (req, res) => { if (!sessionSkill(q1('SELECT skill_id FROM sessions WHERE id=?', req.tok.session_id))) return res.status(409).json(NO_PROFILE); const id = rid(); run('INSERT INTO practice(id,session_id,started_at) VALUES(?,?,?)', id, req.tok.session_id, now()); ev(req.tok.session_id, 'practice_started'); res.status(201).json({ id }); });
  app.post('/api/practice/:id/end', P('apprentice'), (req, res) => { const p = q1('SELECT * FROM practice WHERE id=? AND session_id=?', req.params.id, req.tok.session_id); if (!p) return res.status(404).json({ error: 'Not found' }); run('UPDATE practice SET ended_at=COALESCE(ended_at,?) WHERE id=?', now(), p.id); ev(p.session_id, 'practice_ended'); res.json({ ok: true }); });
  const lastAt = new Map();
  app.post('/api/practice/:id/snapshot', P('apprentice'), consented, raw(Math.ceil(C.maxFrameKb / 1024) + 1), (req, res) => {
    const p = q1('SELECT * FROM practice WHERE id=? AND session_id=?', req.params.id, req.tok.session_id);
    if (!p || p.ended_at) return res.status(404).json({ error: 'No active practice session.' });
    const b = req.body, manual = req.query.manual === '1';
    if (!Buffer.isBuffer(b) || b.length > C.maxFrameKb * 1024 || !isJpeg(b)) return res.status(400).json({ error: `Snapshot must be a JPEG under ${C.maxFrameKb} KB.` });
    if (busy.has(p.id)) return res.status(202).json({ queued: false, reason: 'previous check still running' });
    if (!manual && Date.now() - (lastAt.get(p.id) || 0) < C.snapMs * 0.8) return res.status(202).json({ queued: false, reason: 'rate limited' });
    lastAt.set(p.id, Date.now());
    const ff = `frames/live-${p.id}.jpg`; fs.writeFileSync(path.join(C.dir, ff), b); run('UPDATE practice SET frame_file=? WHERE id=?', ff, p.id);
    assess(p, b, manual).catch((e) => emit(p.session_id, 'assessment_error', { error: e.message }));
    res.status(202).json({ queued: true });
  });
  app.post('/api/ask', P('apprentice'), consented, (req, res) => {
    const text = String(req.body?.text || '').trim(); if (!text || text.length > 500) return res.status(400).json({ error: 'Type a question (max 500 characters).' });
    const hits = search(req.tok.session_id, text);
    if (hits.length) return res.json({ answers: hits.map((k) => ({ id: k.id, step: k.step, verbatim: k.verbatim, summary: k.summary, warnings: k.warnings, clip: k.clip })), helpRequested: false });
    const pr = q1('SELECT id FROM practice WHERE session_id=? AND ended_at IS NULL ORDER BY started_at DESC', req.tok.session_id);
    openHelp(req.tok.session_id, pr?.id || null, text, '', null, null); res.json({ answers: [], helpRequested: true });
  });
  app.post('/api/help', P('apprentice'), consented, (req, res) => {
    const text = String(req.body?.question || '').trim().slice(0, 500) || 'The apprentice asked for help.';
    const pr = q1('SELECT * FROM practice WHERE session_id=? AND ended_at IS NULL ORDER BY started_at DESC', req.tok.session_id);
    const a = pr && q1('SELECT id FROM assessments WHERE practice_id=? ORDER BY created_at DESC', pr.id);
    const fr = pr?.frame_file && fs.existsSync(path.join(C.dir, pr.frame_file)) ? fs.readFileSync(path.join(C.dir, pr.frame_file)) : null;
    res.status(201).json({ id: openHelp(req.tok.session_id, pr?.id || null, text, a ? q1('SELECT stage FROM assessments WHERE id=?', a.id).stage : '', fr, a?.id) });
  });
  app.get('/api/help', P('apprentice'), (req, res) => res.json(q('SELECT id,question,status,created_at FROM help WHERE session_id=? ORDER BY created_at DESC LIMIT 20', req.tok.session_id).map((h) => ({ ...h, replies: q('SELECT id,text,created_at FROM replies WHERE help_id=? ORDER BY created_at', h.id) }))));
  app.post('/api/help/:id/reply', M, (req, res) => {
    const h = q1('SELECT * FROM help WHERE id=?', req.params.id), text = String(req.body?.text || '').trim().slice(0, 1000);
    if (!h) return res.status(404).json({ error: 'Not found' }); if (!text) return res.status(400).json({ error: 'Reply text required.' });
    run('INSERT INTO replies VALUES(?,?,?,?)', rid(), h.id, text, now()); run("UPDATE help SET status='answered' WHERE id=? AND status='pending'", h.id); ev(h.session_id, 'help_answered'); emit(h.session_id, 'help'); res.status(201).json({ ok: true });
  });
  app.patch('/api/help/:id', M, (req, res) => {
    const h = q1('SELECT * FROM help WHERE id=?', req.params.id); if (!h) return res.status(404).json({ error: 'Not found' });
    if (!['pending', 'answered', 'resolved', 'rejected', 'escalated'].includes(req.body?.status)) return res.status(400).json({ error: 'Invalid status' });
    run('UPDATE help SET status=? WHERE id=?', req.body.status, h.id); ev(h.session_id, 'help_' + req.body.status); emit(h.session_id, 'help'); res.json({ ok: true });
  });
  app.post('/api/help/:id/convert-to-knowledge', M, (req, res) => {
    const h = q1('SELECT * FROM help WHERE id=?', req.params.id);
    if (!h) return res.status(404).json({ error: 'Help request not found.' });
    const existing = q1('SELECT id FROM knowledge WHERE session_id=? AND question_id=?', h.session_id, h.id);
    if (existing) return res.status(409).json({ error: 'This help request has already been converted to draft knowledge.', code: 'already_converted', knowledgeId: existing.id });
    if (h.status === 'rejected') return res.status(409).json({ error: 'A rejected help request cannot be converted into knowledge.', code: 'help_rejected' });
    const rep = q1('SELECT * FROM replies WHERE help_id=? ORDER BY created_at DESC LIMIT 1', h.id);
    if (!rep || !rep.text.trim()) return res.status(400).json({ error: 'Cannot convert a help request before replying to it.' });
    const kid = rid();
    // A typed reply is not evidence from any recording: recording_id stays '' (column is NOT NULL), so no clip is offered.
    run('INSERT INTO knowledge(id,session_id,question_id,recording_id,t,observed,verbatim,summary,cues,warnings,step,tool,status,approved_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      kid, h.session_id, h.id, '', 0, h.question, rep.text.trim(), '', '', '', h.step || '', '', 'draft', null, now());
    run("UPDATE help SET status='resolved' WHERE id=?", h.id);
    ev(h.session_id, 'knowledge_draft_from_help', kid);
    emit(h.session_id, 'help');
    res.status(201).json({
      knowledgeId: kid,
      status: 'draft',
      message: 'Answer saved as draft knowledge. Please review, add decision cues and warnings, and click Approve before it can be used by apprentices.'
    });
  });

  app.get('/api/stream', (req, res) => {
    const m = isMaster(req), tk = m ? null : tokOf(req); if (!m && !tk) return res.status(401).end();
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' }); res.flushHeaders(); res.write('retry: 3000\n\n');
    const c = { res, master: m, sid: tk?.session_id }; clients.add(c); const hb = setInterval(() => res.write(': hb\n\n'), 20000);
    req.on('close', () => { clients.delete(c); clearInterval(hb); });
  });

  app.use(express.static(new URL('./public', import.meta.url).pathname, { extensions: ['html'] }));
  app.use((err, req, res, next) => { // safe errors only
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'File too large for the configured limit.' });
    console.error('[error]', err.message); res.status(500).json({ error: 'Something went wrong. Please retry.' });
  });
  app.close = () => { clearInterval(purgeTimer); for (const c of clients) c.res.end(); db.close(); };
  return app;
}
