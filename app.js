import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import QRCode from 'qrcode';
import { parseAssessment, mmss } from './lib/validate.js';
import { renderLegal } from './lib/legal.js';
import { createCloud } from './lib/cloud.js';
import { getSkillsSummary, getSkill, validateSkillAndTask, buildAssessmentPrompt, localizeSkill } from './lib/skills.js';

export function migrateDatabase(db) {
  const cols = new Set(db.prepare("PRAGMA table_info('sessions')").all().map((c) => c.name));
  if (!cols.has('skill_id')) {
    db.exec("ALTER TABLE sessions ADD COLUMN skill_id TEXT DEFAULT 'soldering'");
  }
  if (!cols.has('task_id')) {
    db.exec("ALTER TABLE sessions ADD COLUMN task_id TEXT");
  }
  // Provenance of AI-filled record fields: NULL (master only), 'drafting', 'ollama:<model>' or 'failed: <reason>'.
  const kcols = new Set(db.prepare("PRAGMA table_info('knowledge')").all().map((c) => c.name));
  if (kcols.size && !kcols.has('ai_draft')) db.exec('ALTER TABLE knowledge ADD COLUMN ai_draft TEXT');
  // Master-defined skills (anything beyond the bundled profiles) live with their session as JSON.
  if (!cols.has('custom_skill')) db.exec('ALTER TABLE sessions ADD COLUMN custom_skill TEXT');
  // Short, typeable student join code (the long token stays the credential behind it).
  const tcols = new Set(db.prepare("PRAGMA table_info('tokens')").all().map((c) => c.name));
  if (tcols.size && !tcols.has('code')) db.exec('ALTER TABLE tokens ADD COLUMN code TEXT');
  // Personal master accounts; each session belongs to the master who created it (NULL = made before accounts existed).
  db.exec('CREATE TABLE IF NOT EXISTS masters(id TEXT PRIMARY KEY,username TEXT UNIQUE NOT NULL,name TEXT NOT NULL,salt TEXT NOT NULL,hash TEXT NOT NULL,created_at TEXT NOT NULL)');
  if (cols.size && !cols.has('owner')) db.exec('ALTER TABLE sessions ADD COLUMN owner TEXT');
  // What each student device has marked as learned (learner = random id kept on that device; no names).
  db.exec('CREATE TABLE IF NOT EXISTS progress(session_id TEXT NOT NULL,learner TEXT NOT NULL,knowledge_id TEXT NOT NULL,learned_at TEXT NOT NULL,PRIMARY KEY(learner,knowledge_id))');
  // Language of the AI's questions, drafts, photo feedback and read-aloud voice for this session ('en' or 'ja').
  if (cols.size && !cols.has('lang')) db.exec("ALTER TABLE sessions ADD COLUMN lang TEXT DEFAULT 'en'");
  // Which student device asked for help, so each student sees only their own questions and replies.
  const hcols = new Set(db.prepare("PRAGMA table_info('help')").all().map((c) => c.name));
  if (hcols.size && !hcols.has('learner')) db.exec('ALTER TABLE help ADD COLUMN learner TEXT');
  // Recycle bin: deleted items are kept as a snapshot (and their files moved aside) until restored or purged.
  // A master's own manual for the session (pasted or uploaded); the AI uses it as background and asks about what it leaves out.
  if (cols.size && !cols.has('manual')) { db.exec('ALTER TABLE sessions ADD COLUMN manual TEXT'); db.exec('ALTER TABLE sessions ADD COLUMN manual_name TEXT'); }
  // Follow-up questions point at the answered question they dig into.
  const qcols = new Set(db.prepare("PRAGMA table_info('questions')").all().map((c) => c.name));
  if (qcols.size && !qcols.has('parent_id')) db.exec('ALTER TABLE questions ADD COLUMN parent_id TEXT');
  // Japanese sessions keep the AI's English original of each translated question, so the master can see what was meant.
  if (qcols.size && !qcols.has('text_en')) db.exec('ALTER TABLE questions ADD COLUMN text_en TEXT');
  // What each sampled frame shows (kept so more questions can be asked without watching the video again).
  db.exec('CREATE TABLE IF NOT EXISTS frames(recording_id TEXT NOT NULL,t INTEGER NOT NULL,step INTEGER,action TEXT,objects TEXT,change TEXT,importance INTEGER,notable INTEGER,starts_run INTEGER,uncertainty TEXT,PRIMARY KEY(recording_id,t))');
  db.exec('CREATE TABLE IF NOT EXISTS trash(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,kind TEXT NOT NULL,label TEXT,data TEXT NOT NULL,deleted_at TEXT NOT NULL)');
}

const rid = () => crypto.randomBytes(8).toString('hex');
const now = () => new Date().toISOString();
const safeEq = (a, b) => { a = Buffer.from(String(a)); b = Buffer.from(String(b)); return a.length === b.length && crypto.timingSafeEqual(a, b); };
const STOP = new Set('the and for how what why when with that this you your are can did does have not but was from into'.split(' '));
// Latin words, plus character pairs for Japanese (which has no spaces). Pairs made only of hiragana are grammar
// (です, ます, ての…) and would match every sentence, so a pair must contain a kanji or katakana character.
const CJK = /[\u3040-\u30ff\u3400-\u9fff\uff66-\uff9f]+/g, CONTENT = /[\u30a0-\u30ff\u3400-\u9fff\uff66-\uff9f]/;
const words = (s) => {
  const t = String(s || '').toLowerCase(), out = (t.match(/[a-z0-9]{3,}/g) || []).filter((w) => !STOP.has(w));
  for (const run of t.match(CJK) || []) {
    if (run.length === 1 && CONTENT.test(run)) out.push(run);
    for (let i = 0; i + 1 < run.length; i++) { const bg = run.slice(i, i + 2); if (CONTENT.test(bg)) out.push(bg); }
  }
  return out;
};
export const isJapanese = (s) => /[\u3040-\u30ff]/.test(String(s || '')) || (/[\u4e00-\u9fff]/.test(String(s || '')) && !/[a-z]{4,}/i.test(String(s || '')));
const VIDEO = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'video/x-matroska': 'mkv' };
// Phone recordings start with an "ftyp" box; files from separate cameras may open with "wide", "mdat", "moov" or "free" first.
const isVideo = (b, mime) => (mime === 'video/webm' || mime === 'video/x-matroska' ? b.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) : /^(ftyp|wide|mdat|moov|free|skip|pnot)$/.test(b.subarray(4, 8).toString('latin1')));
const isJpeg = (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
// A master-defined skill has no bundled rule set, so photo checks may only compare against the approved records.
const CUSTOM_RULES = 'This skill was defined by the master and has no built-in rule set. Judge only against the approved expert records; if they do not cover what is visible, return cannot_assess. Never invent technique or safety rules.';
const GENERIC_SAFETY = 'General safety: Follow the safety practice of this craft, keep your workspace clear, and stop and ask the master whenever you are unsure.';
const SESSION_SKILL_COLS = 'skill_id,custom_skill';
function customProfile(json) {
  let c; try { c = JSON.parse(json || ''); } catch { return null; }
  if (!c || typeof c.name !== 'string' || !c.name.trim()) return null;
  return { id: 'custom', name: c.name, category: c.category || 'Custom skill', description: c.description || '', safety_advisories: c.safety?.length ? c.safety : [GENERIC_SAFETY],
    tools: (c.tools || []).map((t, i) => ({ id: 'tool-' + i, name: t.name, purpose: t.purpose || '' })), tasks: [], assessment_rules: CUSTOM_RULES };
}
// Legacy rows predate skill profiles and were all soldering (matches the column DEFAULT).
const sessionSkill = (s) => (s?.skill_id === 'custom' ? customProfile(s.custom_skill) : getSkill(s?.skill_id || 'soldering'));
const lines = (v, max) => (typeof v === 'string' ? v.split(/\r?\n/).map((x) => x.trim()).filter(Boolean).slice(0, max) : []);
// "Name — purpose", "Name: purpose" or "Name - purpose" per line.
const toolLines = (v) => lines(v, 30).map((l) => { const m = l.match(/^(.{1,80}?)\s*(?:—|–|:|\s-\s)\s*(.{0,200})$/); return m ? { name: m[1].trim(), purpose: m[2].trim() } : { name: l.slice(0, 80), purpose: '' }; });
const CODE_ABC = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I/L to mistype
const newCode = () => Array.from({ length: 6 }, () => CODE_ABC[crypto.randomInt(CODE_ABC.length)]).join('');
const NO_PROFILE = { error: 'This session\'s skill profile is unavailable on the server, so its safety guidance cannot be shown. Ask the master to check the installation or create a new session.', code: 'skill_profile_unavailable' };

export function createApp(o = {}) {
  const E = process.env;
  const C = {
    dir: o.dataDir || E.DATA_DIR || './data', pass: o.passphrase || E.MASTER_PASSPHRASE || '',
    maxVideoMb: +(o.maxVideoMb || E.MAX_VIDEO_MB || 200), maxFrameKb: +(E.MAX_FRAME_KB || 400), maxRecSec: +(E.MAX_RECORDING_SEC || 600),
    snapMs: +(E.SNAPSHOT_INTERVAL_MS || 3500), retDays: +(E.RETENTION_DAYS || 30), ttlH: +(E.TOKEN_TTL_HOURS || 24),
    signup: (E.ALLOW_SIGNUP ?? '1') !== '0', ollama: E.OLLAMA_URL || '', vModel: E.OLLAMA_VISION_MODEL || '', pub: E.PUBLIC_URL || '',
    // Local-AI pacing: a pause between frames keeps the desktop usable; one slow frame is retried, then skipped.
    // Optional local speech-to-text (whisper.cpp) for the master's typed-or-spoken answers. Audio never leaves this computer.
    // Optional local text-to-speech: Open JTalk + an HTS voice for Japanese, espeak-ng for English.
    jtalkBin: o.jtalkBin ?? E.OPENJTALK_BIN ?? '', jtalkDic: o.jtalkDic ?? E.OPENJTALK_DIC ?? '', jtalkVoice: o.jtalkVoice ?? E.OPENJTALK_VOICE ?? '', espeakBin: o.espeakBin ?? E.ESPEAK_BIN ?? (fs.existsSync('/usr/bin/espeak-ng') ? '/usr/bin/espeak-ng' : ''),
    whisperBin: o.whisperBin ?? E.WHISPER_BIN ?? '', whisperModel: o.whisperModel ?? E.WHISPER_MODEL ?? '', whisperLang: E.WHISPER_LANG || 'en', whisperThreads: +(E.WHISPER_THREADS || 4),
    // Optional hybrid mode (lib/cloud.js): off unless CLOUD_AI and a key are set; the local models stay the fallback.
    cloud: o.cloud || createCloud(E),
    aiPauseMs: +(E.AI_FRAME_PAUSE_MS ?? 1500), aiTimeoutMs: +(E.AI_FRAME_TIMEOUT_MS || 90000), aiMaxTokens: +(E.AI_MAX_TOKENS || 1536), aiMaxFrames: +(E.AI_MAX_FRAMES || 24), aiFrameW: +(E.AI_FRAME_WIDTH || 512),
  };
  if (!C.pass) throw new Error('MASTER_PASSPHRASE is required');
  // The public address phones use. A quick tunnel gets a new address every time it restarts, so when cloudflared's metrics
  // endpoint is configured (TUNNEL_METRICS=127.0.0.1:20241) its current address is used and PUBLIC_URL is only the fallback.
  let tunnelHost = null;
  const readTunnel = async () => { try { const r = await fetch(`http://${E.TUNNEL_METRICS}/quicktunnel`, { signal: AbortSignal.timeout(2000) }); const h = (await r.json()).hostname; if (h) tunnelHost = 'https://' + h; } catch { /* tunnel down: keep the last known address */ } };
  const tunnelTimer = E.TUNNEL_METRICS ? setInterval(readTunnel, 30000) : null; tunnelTimer?.unref();
  // At startup the tunnel may still be connecting: retry every 3 s until its address is known.
  if (E.TUNNEL_METRICS) (async () => { for (let i = 0; i < 20 && !tunnelHost; i++) { await readTunnel(); if (!tunnelHost) await new Promise((r) => setTimeout(r, 3000).unref()); } })();
  const pubBase = (req) => tunnelHost || C.pub || `${req.protocol}://${req.get('host')}`;
  // Self-healing (TUNNEL_SELFHEAL=1): Cloudflare can drop a quick tunnel after a network stall, and cloudflared then keeps
  // retrying a tunnel that no longer exists. If our public address fails 3 checks in a row, restart the tunnel service
  // (at most every 10 min); the new address is picked up from the metrics endpoint above.
  let tunnelFails = 0, lastHeal = 0;
  const healTimer = E.TUNNEL_METRICS && E.TUNNEL_SELFHEAL === '1' ? setInterval(async () => {
    if (!tunnelHost) return;
    const ok = await fetch(tunnelHost + '/api/health', { signal: AbortSignal.timeout(15000) }).then((r) => r.ok, () => false);
    tunnelFails = ok ? 0 : tunnelFails + 1;
    if (tunnelFails >= 3 && Date.now() - lastHeal > 6e5) {
      lastHeal = Date.now(); tunnelFails = 0; console.error('[tunnel] public address unreachable 3 times; restarting', E.TUNNEL_SERVICE || 'mento-tunnel');
      execFile('systemctl', ['--user', 'restart', E.TUNNEL_SERVICE || 'mento-tunnel'], (e) => { if (e) console.error('[tunnel] restart failed:', e.message); else tunnelHost = null; });
    }
  }, 60000) : null; healTimer?.unref();
  // Cloudflare's free quick tunnel rejects request bodies over 100 MB; phones are told the real limit instead of failing at the end of an upload.
  const phoneVideoMb = () => (/\.trycloudflare\.com/.test(tunnelHost || C.pub) ? Math.min(C.maxVideoMb, 95) : C.maxVideoMb);
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
  // Analyses do not survive a restart; don't leave them looking like they are still running.
  run("UPDATE recordings SET status='failed',error='Interrupted because the server restarted. Retry analysis.' WHERE status='analyzing'");
  run("UPDATE knowledge SET ai_draft='failed: interrupted because the server restarted' WHERE ai_draft='drafting'");

  // ---- realtime (Server-Sent Events) ----
  const clients = new Set();
  const emit = (sid, type, data = {}) => { let owner; for (const c of clients) if (c.master ? c.master === 'admin' || c.master === (owner ??= ownerOf(sid) ?? '') : c.sid === sid) c.res.write(`data: ${JSON.stringify({ type, sid, ...data })}\n\n`); };
  const ev = (sid, kind, detail = '') => { run('INSERT INTO events(session_id,kind,detail,created_at) VALUES(?,?,?,?)', sid, kind, String(detail).slice(0, 300), now()); emit(sid, 'event', { kind }); };

  // ---- auth ----
  const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((s) => s.trim().split('=')).filter((a) => a[0]));
  // Cookie "mz" = <master id>.<expiry>.<signature>; 'admin' is the setup-passphrase login, which sees every session.
  const isMaster = (req) => { const c = cookies(req).mz; if (!c) return false; const [uid, exp, sig] = c.split('.'); return uid && +exp > Date.now() && !!sig && safeEq(sig, sign(`m${uid}.${exp}`)) && (uid === 'admin' || !!q1('SELECT 1 FROM masters WHERE id=?', uid)) ? uid : false; };
  const M = (req, res, next) => { const uid = isMaster(req); if (!uid) return res.status(401).json({ error: 'Master sign-in required.' }); req.uid = uid; next(); };
  const ownerOf = (sid) => q1('SELECT owner FROM sessions WHERE id=?', sid)?.owner ?? null;
  const canSee = (uid, sid) => uid === 'admin' || (!!uid && ownerOf(sid) === uid);
  // Master routes on one session's data: another master's rows look exactly like missing ones.
  const own = (table) => (req, res, next) => {
    const r = q1(`SELECT ${table === 'sessions' ? 'id' : 'session_id'} sid FROM ${table} WHERE id=?`, req.params.id);
    if (r && !canSee(req.uid, r.sid)) return res.status(404).json({ error: 'Not found' });
    next();
  };
  const SESSION_DAYS = 30;
  const setLogin = (req, res, uid) => { const exp = Date.now() + SESSION_DAYS * 864e5; res.set('Set-Cookie', `mz=${uid}.${exp}.${sign(`m${uid}.${exp}`)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}${req.secure || req.get('x-forwarded-proto') === 'https' ? '; Secure' : ''}`); };
  const hashPw = (pw, salt) => crypto.scryptSync(String(pw), salt, 32).toString('hex');
  const tokOf = (req) => { const t = req.get('x-token') || req.query.t; const r = t && q1('SELECT * FROM tokens WHERE token=?', String(t)); return r && new Date(r.expires_at) > new Date() ? r : null; };
  const P = (...roles) => (req, res, next) => {
    const r = tokOf(req);
    if (!r) return res.status(401).json({ error: 'Invalid or expired invitation. Ask the master for a new QR code.' });
    if (roles.length && !roles.includes(r.role)) return res.status(403).json({ error: 'This invitation cannot do that.' });
    req.tok = r; next();
  };
  // Invites renew while they are in use (the master opening the session, or the device itself), keeping the same code:
  // a class code should not silently die after a day. "Rotate join links" is the deliberate way to cut old codes off.
  const renewTokens = (where, ...args) => { const exp = new Date(Date.now() + C.ttlH * 36e5).toISOString(), half = new Date(Date.now() + C.ttlH * 18e5).toISOString(); run(`UPDATE tokens SET expires_at=? WHERE ${where} AND expires_at<?`, exp, ...args, half); };
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
    for (const t of q('SELECT id FROM trash WHERE session_id=?', sid)) dropTrash(t.id);
    run('DELETE FROM frames WHERE recording_id IN (SELECT id FROM recordings WHERE session_id=?)', sid);
    for (const t of ['progress', 'assessments', 'help', 'practice', 'knowledge', 'questions', 'observations', 'recordings', 'tokens', 'events']) run(`DELETE FROM ${t} WHERE session_id=?`, sid);
    run('DELETE FROM sessions WHERE id=?', sid);
  }
  // ---- recycle bin: a snapshot of the rows plus the files moved aside, so a mistaken delete can be undone ----
  const TRASH_DAYS = 7, TRASH_ORDER = ['recordings', 'observations', 'questions', 'knowledge', 'progress', 'help', 'replies'];
  const rowKey = (t, r) => (t === 'progress' ? ['learner=? AND knowledge_id=?', [r.learner, r.knowledge_id]] : ['id=?', [r.id]]);
  const trashDir = (id) => path.join(C.dir, 'trash', id);
  function toTrash(sid, kind, label, rows, files = []) {
    const id = rid(); fs.mkdirSync(trashDir(id), { recursive: true });
    const moved = files.filter((f) => f && fs.existsSync(path.join(C.dir, f)));
    for (const f of moved) fs.renameSync(path.join(C.dir, f), path.join(trashDir(id), path.basename(f)));
    for (const t of [...TRASH_ORDER].reverse()) for (const r of rows[t] || []) { const [w, a] = rowKey(t, r); run(`DELETE FROM ${t} WHERE ${w}`, ...a); }
    run('INSERT INTO trash VALUES(?,?,?,?,?,?)', id, sid, kind, label, JSON.stringify({ rows, files: moved }), now());
    return id;
  }
  // Questions are 'answered' exactly when a knowledge record exists for them.
  const syncQuestions = (ids) => { for (const qid of new Set(ids)) run("UPDATE questions SET status=CASE WHEN EXISTS(SELECT 1 FROM knowledge WHERE question_id=questions.id) THEN 'answered' ELSE 'open' END WHERE id=?", qid); };
  function restoreTrash(item) {
    const { rows, files } = JSON.parse(item.data), have = {};
    for (const t of TRASH_ORDER) for (const r of rows[t] || []) {
      have[t] ??= new Set(q(`PRAGMA table_info('${t}')`).map((c) => c.name));
      const cols = Object.keys(r).filter((c) => have[t].has(c));
      run(`INSERT OR IGNORE INTO ${t}(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`, ...cols.map((c) => r[c]));
    }
    for (const f of files) { const src = path.join(trashDir(item.id), path.basename(f)), dst = path.join(C.dir, f); if (fs.existsSync(src) && !fs.existsSync(dst)) fs.renameSync(src, dst); }
    syncQuestions([...(rows.questions || []).map((x) => x.id), ...(rows.knowledge || []).map((k) => k.question_id)]);
    run('DELETE FROM trash WHERE id=?', item.id); fs.rmSync(trashDir(item.id), { recursive: true, force: true });
  }
  const dropTrash = (id) => {
    const t = q1('SELECT data FROM trash WHERE id=?', id);
    for (const r of t ? JSON.parse(t.data).rows.recordings || [] : []) run('DELETE FROM frames WHERE recording_id=?', r.id);
    run('DELETE FROM trash WHERE id=?', id); fs.rmSync(trashDir(id), { recursive: true, force: true });
  };
  const purge = () => {
    const cut = new Date(Date.now() - C.retDays * 864e5).toISOString(); for (const s of q('SELECT id FROM sessions WHERE created_at<?', cut)) deleteSession(s.id);
    const tcut = new Date(Date.now() - TRASH_DAYS * 864e5).toISOString(); for (const t of q('SELECT id FROM trash WHERE deleted_at<?', tcut)) dropTrash(t.id);
  };
  purge(); const purgeTimer = setInterval(purge, 36e5); purgeTimer.unref();

  // question: an AI-written, moment-specific question; without one, a fallback that still asks for cues, not "what were you thinking".
  function addMoment(rec, t, text, unc, source, question, en = null) {
    const oid = rid(); run('INSERT INTO observations VALUES(?,?,?,?,?,?,?)', oid, rec.session_id, rec.id, t, text, unc, source);
    const fallback = langOf(rec.session_id) === 'ja' ? `${text} このとき何を確かめていましたか。うまくいっていない場合、何が見えたり聞こえたりしますか？` : `${text} What were you checking at this moment, and what would you see, hear or feel if it were going wrong?`;
    run('INSERT INTO questions(id,session_id,observation_id,recording_id,t,text,status,created_at,text_en) VALUES(?,?,?,?,?,?,?,?,?)', rid(), rec.session_id, oid, rec.id, t, `At ${mmss(t)} — ${question || fallback}`, 'open', now(), question ? en : null);
  }
  const addFollowUp = (parent, text, en = null) => run('INSERT INTO questions(id,session_id,observation_id,recording_id,t,text,status,created_at,parent_id,text_en) VALUES(?,?,?,?,?,?,?,?,?,?)', rid(), parent.session_id, parent.observation_id, parent.recording_id, parent.t, `At ${mmss(parent.t)} — ${text}`, 'open', now(), parent.id, en);
  // A clip only for records that genuinely come from a recording in their own session; help-derived records have none.
  const clipOf = (k) => (k.recording_id && !q1('SELECT 1 FROM help WHERE id=?', k.question_id) && q1('SELECT 1 FROM recordings WHERE id=? AND session_id=?', k.recording_id, k.session_id) ? { url: fileUrl('rec', k.recording_id), t: k.t } : null);
  const approved = (sid) => q("SELECT * FROM knowledge WHERE session_id=? AND status='approved'", sid);
  function search(sid, text, onlyApproved = true) {
    const w = new Set(words(text));
    return q(`SELECT * FROM knowledge WHERE session_id=? ${onlyApproved ? "AND status='approved'" : ''}`, sid)
      .map((k) => ({ k, s: new Set(words([k.observed, k.verbatim, k.summary, k.cues, k.warnings, k.step, k.tool].join(' ')).filter((x) => w.has(x))).size }))
      .filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 3).map((x) => ({ ...x.k, clip: clipOf(x.k) }));
  }

  // ---- AI: local Ollama, optionally helped by cloud AI (hybrid). Never faked: failures are surfaced. ----
  const localOk = () => { try { localReady(); return true; } catch { return false; } };
  // kind: 'see' (frames), 'ask', 'judge', 'translate', 'followup', 'draft', 'check' (student photo), 'reply'.
  function aiReady(kind = 'see') { if (!C.cloud.route(kind, true)) localReady(); }
  const aiAvailable = (kind = 'see') => { try { aiReady(kind); return true; } catch { return false; } };
  const aiInfo = () => ({ local: localOk() ? C.vModel : null, cloud: C.cloud.status() });
  // Cloud first when the operator allowed it for this kind of task, the local model otherwise or whenever the cloud fails.
  const NO_IMG = 'No image is attached; rely on the description above.';
  async function ai(kind, prompt, img) {
    const way = C.cloud.route(kind, !!img);
    if (way) {
      try { return { out: await C.cloud.json(kind, way === 'text' ? prompt.replace('The image shows this moment.', NO_IMG) : prompt, way === 'vision' ? [].concat(img) : []), engine: C.cloud.label }; }
      catch (e) { if (!localOk()) throw e; console.warn(e.message + ' — using the local model instead'); }
    }
    return { out: await ollama(prompt, img), engine: 'ollama:' + C.vModel };
  }
  function localReady() {
    if (!C.ollama || !C.vModel) throw new Error('No local vision model configured (set OLLAMA_URL and OLLAMA_VISION_MODEL).');
    const host = new URL(C.ollama).hostname;
    if (!/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$)/.test(host) && E.OLLAMA_ALLOW_REMOTE !== '1') throw new Error('Refusing to send footage to a non-local AI host (OLLAMA_ALLOW_REMOTE not set).');
  }
  // One local-AI request at a time: overlapping requests queue on the GPU, freeze the desktop and blow the per-request timeout.
  let aiTail = Promise.resolve(), aiActive = 0;
  const aiExclusive = (fn) => { aiActive++; const r = aiTail.then(fn); aiTail = r.catch(() => {}); return r.finally(() => { aiActive--; }); };
  const fatal = (m) => Object.assign(new Error(m), { fatal: true });
  function ollama(prompt, img) { // img: one JPEG buffer, or several (e.g. before/now frames)
    localReady();
    return aiExclusive(async () => {
      let r;
      try {
        r = await fetch(C.ollama.replace(/\/$/, '') + '/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(C.aiTimeoutMs),
          body: JSON.stringify({ model: C.vModel, stream: false, format: 'json', keep_alive: '15m', options: { num_ctx: 4096, num_predict: C.aiMaxTokens } /* caps runaway output from 'thinking' models */, messages: [{ role: 'user', content: prompt, ...(img ? { images: [].concat(img).map((b) => b.toString('base64')) } : {}) }] }) });
      } catch (e) {
        if (e.name === 'TimeoutError') throw new Error(`Local AI took longer than ${Math.round(C.aiTimeoutMs / 1000)} s on one image`);
        throw fatal('Cannot reach Ollama at ' + C.ollama + ' — is "ollama serve" running?');
      }
      if (r.status === 404) throw fatal(`Model "${C.vModel}" is not installed in Ollama (run: ollama pull ${C.vModel}).`);
      if (!r.ok) throw new Error('Ollama HTTP ' + r.status);
      return (await r.json()).message.content;
    });
  }
  // A single still cannot show a *change*, so frames are judged against the one before (Qwen3-VL accepts several images).
  // Frames are described as ACTIONS (what the hands do), not inventories of objects: questions are then about doing, not about things lying on the bench.
  const PAIR = 'You see two still frames from a craftsperson\'s work, taken a few seconds apart: image 1 is BEFORE, image 2 is NOW. Describe ONLY what is visible, without guessing reasons or intent. Return JSON {"action":string,"objects":string,"change":string,"notable":boolean,"importance":number,"uncertainty":string}. "action": what the hands and tools are DOING in image 2, starting with a verb, naming the exact part being worked on (e.g. "Presses the iron tip against the pad where the lead comes through"; "Holds the board up close to inspect the joints"); write "Idle — no work happening" if nothing is being worked on. "objects": only the 2-4 tools or materials in use, not everything on the bench. notable=true ONLY if image 2 clearly shows a different tool being used, the work being closely inspected, something being fixed or redone, or a new step starting; continuing the same action, small hand movements or camera shake are NOT notable. "importance" is 1-5: how much an apprentice would learn by asking the expert about image 2 (5 = a decisive technique, judgement or correction; 1 = idle or nothing new). "change": what visibly changed, or "none". Keep "action" under 25 words, "objects" under 12, "change" under 15, "uncertainty" under 15.';
  const OBS = 'You see one still frame from a craftsperson\'s work. Describe ONLY what is visible, without guessing reasons or intent. Return JSON {"action":string,"objects":string,"notable":boolean,"importance":number,"uncertainty":string}. "action": what the hands and tools are DOING, starting with a verb and naming the exact part being worked on, or "Idle — no work happening". "objects": only the 2-4 tools or materials in use. notable=true only for a clear tool change, inspection, correction or change of approach. "importance" 1-5: how much an apprentice would learn by asking about this frame. Keep "action" under 25 words, "objects" under 12, "uncertainty" under 15.';
  // Skill/task context lets the AI ask about this craft's real decisions (heat, timing, angle, amount) instead of generic "what were you thinking".
  const langOf = (sid) => (q1('SELECT lang FROM sessions WHERE id=?', sid)?.lang === 'ja' ? 'ja' : 'en');
  const craftContext = (sid) => {
    const s = q1(`SELECT task,procedure,${SESSION_SKILL_COLS} FROM sessions WHERE id=?`, sid), sk = sessionSkill(s);
    return [sk ? `Craft: ${sk.name} — ${sk.description}` : '', s?.task ? `Task: ${s.task}` : '', s?.procedure ? `Planned procedure:\n${s.procedure.slice(0, 900)}` : '',
      sk?.tools?.length ? `Tools available: ${sk.tools.map((t) => t.name).join(', ')}` : ''].filter(Boolean).join('\n');
  };
  // ---- manuals as background: MENTO should capture what manuals do NOT say ----
  // The skill's built-in "manual" (standard guidance) plus any manual the master uploaded for the session are split into
  // passages; for each moment only the passages that share words with what the hands are doing are given to the AI (small context).
  const manualPassages = (sid) => {
    const s = q1(`SELECT manual,${SESSION_SKILL_COLS} FROM sessions WHERE id=?`, sid), sk = sessionSkill(s);
    return [s?.manual || '', sk?.manual || ''].join('\n').split(/\n\s*\n|\n(?=\s*[-•*\d])/).map((x) => x.replace(/\s+/g, ' ').trim()).filter((x) => x.length > 20);
  };
  const manualFor = (sid, query, max = 900) => {
    const ps = manualPassages(sid); if (!ps.length) return '';
    const w = new Set(words(query)), scored = ps.map((x, i) => ({ x, i, s: new Set(words(x).filter((y) => w.has(y))).size })).sort((a, b) => b.s - a.s || a.i - b.i);
    let out = ''; for (const { x } of scored) { if (out.length + x.length > max) break; out += '- ' + x + '\n'; }
    return out.trim();
  };
  // Each moment gets candidates from different angles, always including WHY; a separate judging pass keeps the most insightful one.
  const WHY = ['why', 'WHY you do it this particular way here — the reason behind your choice, compared with the obvious alternative'];
  const FOCI = [['instinct', 'how you KNOW at this moment — the sign in the work itself (look, sound, smell, how the tool responds) that tells you it is right or time to act'],
    ['beyond', 'what you do here that the manual does not say, or where you deliberately do it differently from the manual — and why'],
    ['adapt', 'what you would do DIFFERENTLY if conditions changed (material, size, heat, humidity, a slip) — and why'],
    ['mistake', 'what beginners typically get wrong at this kind of step and how you would spot it — asked in general terms, never inventing a specific incident']];
  const fociFor = (n) => [WHY, FOCI[n % FOCI.length], FOCI[(n + 1) % FOCI.length]];
  // Examples from other crafts, so the model learns the shape of a good question without copying its content.
  const EXAMPLES = `GOOD questions (about this exact action, and about knowledge no manual contains):
- "You lifted the brush earlier than most people would there — why, and what would the stroke look like if you held on?" (calligraphy)
- "Why did you turn the board round before this cut instead of cutting from the side you were on?" (woodworking)
- "When you pressed the dough with your knuckle, what told you it had proved enough — and what would make you wait longer?" (baking)
- "You placed the cut a little away from the trunk rather than flush — why on this branch?" (bonsai)
BAD questions (never write these):
- "What were you thinking at this moment?" (generic)
- "What temperature should the iron be?" (the manual already answers it)
- "What tools are on the bench?" (the video already shows it)
- "How does the hot metal feel?" / "How do you do it without looking?" (impossible or unsafe)
- "Is the joint good?" (yes/no)
- "How did you know the clay was off-centre?" (assumes something the image does not show)`;
  // The question prompt must fit a 4096-token context with its image, so the timeline is a window around the moment.
  const timelineText = (tl, t) => { const i = Math.max(0, tl.findIndex((x) => x.t >= t)); return tl.slice(Math.max(0, i - 4), i + 5).map((x) => `${x.t === t ? '>>' : '  '} ${mmss(x.t)} ${x.action.slice(0, 110)}`).join('\n'); };
  const GEN = (ctx, m, tl, foci, asked, manual) => `You are interviewing a master craftsperson. Manuals already explain the standard procedure; your job is to capture what manuals do NOT contain: the master's reasons, instincts, judgement and personal technique.
${ctx}
${manual ? `\nWHAT THE MANUAL ALREADY SAYS (do NOT ask about any of this):\n${manual}\n` : ''}
What the hands do through the video (>> marks the moment you are asking about):
${timelineText(tl, m.t)}

At ${mmss(m.t)}: ${m.action}${m.objects ? ` (using: ${m.objects})` : ''}${m.change ? `\nJust before, this changed: ${m.change}` : ''}
The image shows this moment.

${EXAMPLES}

First, in one line, note what the manual already covers about this action (or "nothing"). Then write THREE different candidate questions about the action at ${mmss(m.t)}, one for each angle:
${foci.map((f, i) => `${i + 1}. ${f[1]}`).join('\n')}
Write in English, in plain words a craftsperson would use (no "hidden", "secret" or "subtle" flourishes). Each question: speaks to the master as "you" (never "the master"); names what the hands are doing so they recall the moment; asks about something the manual does not answer; open (not yes/no); one sentence under 30 words; no timestamp; claims nothing the description does not show.${asked.length ? `\nAlready asked — do not repeat these topics:\n${asked.map((a) => '- ' + a).join('\n')}` : ''}
Return JSON {"manual_covers":string,"questions":[string,string,string]}.`;
  const JUDGE = (ctx, m, cands, asked, manual) => `You review interview questions for a master craftsperson. The goal is to record knowledge that manuals do not contain: reasons, instincts, judgement and personal technique.
${ctx}
The moment: ${m.action}${m.objects ? ` (using: ${m.objects})` : ''}
${manual ? `The manual already says:\n${manual}\n` : ''}${asked.length ? `Questions already asked:\n${asked.map((a) => '- ' + a).join('\n')}\n` : ''}
Candidates:
${cands.map((c, i) => `${i}. ${c}`).join('\n')}

Score each candidate 1-5 (5 = excellent). Give 5 only to a question that is clearly about THIS action AND asks WHY the master does it this way, or HOW they know, or what they do beyond or differently from the manual. A good question is open, easy to understand, safe to answer and speaks to the master as "you". Score 1 if the manual above already answers it, or if it is generic, yes/no, impossible or a repeat; at most 2 if it assumes facts the description does not show or invents a story (e.g. "a beginner who dropped…").
Return JSON {"scores":[number for each candidate],"best":index of the best candidate}.`;
  // Small models echo timestamps and quotes; the card already shows the time.
  const cleanQ = (x) => (typeof x === 'string' ? x.trim().replace(/^["“「]|["”」]$/g, '').replace(/\s+/g, ' ').replace(/^(at )?\d+:\d+[,、]?\s*(の時点で|で)?[,、]?\s*/i, '').replace(/,?\s*(at|by) (this exact moment|\d+:\d+)(?=\?$)/i, '').replace(/^./, (c) => c.toUpperCase()) : '');
  // Japanese questions are shorter in characters and end in ？ or か。
  const okQ = (x) => (isJapanese(x) ? x.length >= 8 && /[？?]$|か。?$/.test(x) : x.length >= 15 && x.endsWith('?')) && x.length <= 300 && !/without (looking|seeing)|what were you (thinking|doing|deciding|noticing)|\bthe (master|craftsperson|expert)\b|師匠は/i.test(x);
  // Small models write far better questions in English, so Japanese sessions translate the judged winner afterwards,
  // asking for the words Japanese craftspeople actually use (a soldering iron is はんだごて, not 鉄).
  const TRANSLATE = (ctx, x) => `Translate this interview question for a Japanese master craftsperson into natural, polite Japanese (です/ます調).
${ctx}
Use the terms Japanese practitioners of this craft actually use (for example: soldering iron = はんだごて, solder = はんだ, flux = フラックス, urushi = 漆, tamahagane = 玉鋼; for other crafts, the established Japanese craft terms). Address the master directly and politely without a name. Keep it ONE question ending with か？ or ？. Do not add or remove meaning.
Question: ${x}
Return JSON {"ja":string}.`;
  async function toJapanese(ctx, x) {
    try { const ja = cleanQ(JSON.parse((await ai('translate', TRANSLATE(ctx, x))).out).ja); return isJapanese(ja) && okQ(ja) ? ja : null; } catch (e) { if (e.fatal) throw e; return null; }
  }
  // Returns { question, score } (null question = no candidate was good enough).
  async function askAbout(ctx, m, tl, foci, asked, manual = '') {
    let cands = [], engine = null;
    try {
      const g = await ai('ask', GEN(ctx, m, tl, foci, asked, manual), m.img), j = JSON.parse(g.out); engine = g.engine; // one image keeps the prompt inside the context window
      cands = [...new Set((Array.isArray(j.questions) ? j.questions : [j.question]).map(cleanQ).filter(okQ))].slice(0, 3);
    } catch (e) { if (e.fatal) throw e; }
    if (!cands.length) return { question: null, score: 0 };
    try {
      const j = JSON.parse((await ai('judge', JUDGE(ctx, m, cands, asked, manual))).out);
      // MENTO exists to capture reasons: the WHY candidate (always first) wins ties and near-ties.
      const sc = cands.map((_, i) => Math.max(0, Math.min(5, +j.scores?.[i] || 0)) + (i === 0 && /\bwhy\b/i.test(cands[0]) ? 0.6 : 0)), best = sc.indexOf(Math.max(...sc));
      return await localise(ctx, m, { question: cands[best], score: sc[best], engine });
    } catch (e) { if (e.fatal) throw e; return localise(ctx, m, { question: cands[0], score: 3, engine }); } // judge failed: keep the first well-formed candidate
  }
  // A Japanese session gets the translated question; if translation fails the English one is kept rather than losing the moment.
  const localise = async (ctx, m, r) => { if (m.lang !== 'ja' || !r.question || r.score < 3) return r; const ja = await toJapanese(ctx, r.question); return ja ? { ...r, question: ja, en: r.question } : r; };
  // Follow-ups dig into an answer the master already gave: the reason or instinct behind it that a manual would not contain.
  const FOLLOWUP = (ctx, question, answer, manual) => `You are interviewing a master craftsperson to capture knowledge that manuals do not contain.
${ctx}
${manual ? `The manual already says:\n${manual}\n` : ''}
You asked: ${question}
The master answered: """${answer}"""

Write ONE short follow-up question that digs deeper into this answer: the reason behind what they said, how they know, or what they would do differently in other conditions. It must build on something specific in the answer and must not be answered by the manual. Speak to the master as "you"; open, one sentence under 30 words, in English. If the answer is empty or says nothing about the work, return "".
Return JSON {"question":string}.`;
  async function followUp(sid, qu, k) {
    const ctx = craftContext(sid), manual = manualFor(sid, `${qu.text} ${k.verbatim}`, 600);
    try {
      const x = cleanQ(JSON.parse((await ai('followup', FOLLOWUP(ctx, qu.text.replace(/^At \d+:\d+ — /, ''), k.verbatim.slice(0, 1500), manual))).out).question);
      if (!okQ(x)) return null;
      const ja = langOf(sid) === 'ja' ? await toJapanese(ctx, x) : null;
      return ja ? { text: ja, en: x } : { text: x, en: null };
    } catch (e) { if (e.fatal) throw e; return null; }
  }
  // The master answers in their own words; the AI only restructures those words into the record's fields for the master to verify.
  // The record is written in the language of the master's own answer (decided here, not left to the model: small models copy the examples' language).
  const DRAFT = (ctx, observed, question, answer, ja = isJapanese(answer)) => `You turn a master craftsperson's spoken answer into a knowledge record for apprentices.
${ctx}
What the footage showed: ${observed || '(no footage — this came from an apprentice\'s question)'}
Question asked: ${question || '(none)'}
The master's answer (verbatim; may contain speech-to-text errors): """${answer}"""

${ja ? 'Write every field in natural Japanese (日本語), like the answer.' : 'Write every field in English, like the answer.'}
Use ONLY what the master said. Do not add techniques, numbers, warnings or reasons the master did not state; leave a field as "" only if the answer truly does not cover it. Fix obvious speech-to-text errors only in your own fields, never invent.
Capture EVERYTHING the master said: every action, every number (temperatures, seconds, amounts) and every "if this happens, do that".
Return JSON {"summary":string,"cues":string,"warnings":string,"step":string,"tool":string}:
- summary: 2-4 sentences instructing an apprentice directly in the imperative ("Clamp the board…", never "The master was…"), covering every action the master described in the order they described it;
- cues: every sign, setting or number the master uses to decide (e.g. temperatures, durations, what it looks or sounds like when right), separated by "; ";
- warnings: every mistake, bad sign, exception or correction the master mentioned (e.g. "if it looks X, it means Y — do Z"), separated by "; ";
- step: a short NAME for the step (${ja ? '例「パッドとリードを加熱」' : '3-6 words, e.g. "Heat pad and lead"'}), never a number;
- tool: ONLY the tools and materials the master actually mentioned in the answer (use the tools-available name when one matches); "" if none were mentioned.`;
  const DRAFT_FIELDS = ['summary', 'cues', 'warnings', 'step', 'tool'];
  function startDraft(kid) {
    if (!aiAvailable('draft')) return false;
    const k = q1('SELECT * FROM knowledge WHERE id=?', kid); if (!k || k.status === 'approved' || !k.verbatim.trim()) return false;
    const help = q1('SELECT question FROM help WHERE id=?', k.question_id), question = help ? 'An apprentice asked: ' + help.question : q1('SELECT text FROM questions WHERE id=?', k.question_id)?.text || '';
    run("UPDATE knowledge SET ai_draft='drafting' WHERE id=?", kid); emit(k.session_id, 'knowledge_drafting');
    ai('draft', DRAFT(craftContext(k.session_id), help ? '' : k.observed, question, k.verbatim.slice(0, 3000))).then(({ out, engine }) => {
      const j = JSON.parse(out), cur = q1('SELECT * FROM knowledge WHERE id=?', kid); if (!cur) return;
      // Never overwrite what the master typed meanwhile, and never change a record after it was approved.
      const n = {}; if (cur.status !== 'approved') for (const f of DRAFT_FIELDS) n[f] = !cur[f].trim() && typeof j[f] === 'string' ? j[f].trim().slice(0, 1000) : cur[f];
      if (cur.status !== 'approved') run('UPDATE knowledge SET summary=?,cues=?,warnings=?,step=?,tool=?,ai_draft=? WHERE id=?', n.summary, n.cues, n.warnings, n.step, n.tool, engine, kid);
      else run('UPDATE knowledge SET ai_draft=NULL WHERE id=?', kid);
      ev(k.session_id, 'knowledge_ai_drafted', mmss(k.t));
    }).catch((e) => { run('UPDATE knowledge SET ai_draft=? WHERE id=?', 'failed: ' + String(e.message).slice(0, 200), kid); ev(k.session_id, 'knowledge_ai_draft_failed', e.message); });
    return true;
  }
  const progress = new Map(); // recording id → live analysis progress (in memory only)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const run$ = (cmd, args, timeout) => new Promise((ok, no) => execFile(cmd, args, { timeout }, (e, out) => (e ? no(e) : ok(String(out)))));
  const grabFrame = async (rec, t, dir, name) => { await run$('ffmpeg', ['-v', 'error', '-y', '-ss', String(Math.max(0, t)), '-i', path.join(C.dir, rec.file), '-frames:v', '1', '-vf', `scale=${C.aiFrameW}:-2`, path.join(dir, name)], 60000); return fs.readFileSync(path.join(dir, name)); };
  // Moments ranked for asking: starts of notable runs first, then other important frames; never two neighbours, never next to an existing question.
  function rankMoments(cands, used, step, want) {
    const pool = [], rank = (a, b) => b.imp - a.imp || a.t - b.t, near = (t) => used.some((u) => Math.abs(u - t) < step);
    for (const c of [...cands.filter((c) => c.startsRun).sort(rank), ...cands.filter((c) => !c.startsRun && c.imp >= 2).sort(rank)]) {
      if (pool.length >= want + 3) break; // spares: the judge may reject every candidate for a moment
      if (!near(c.t) && !pool.some((p) => Math.abs(p.t - c.t) < 2 * step)) pool.push(c);
    }
    return pool;
  }
  // Writes up to `want` judged questions for the pooled moments (frames are re-extracted when not in memory).
  async function writeQuestions(rec, P, pool, timeline, want, tell) {
    P.phase = 'questions'; P.qDone = 0; P.qTotal = Math.min(want, pool.length); tell();
    const ctx = craftContext(rec.session_id), lang = langOf(rec.session_id), kept = [], weak = [], dir = path.join(C.dir, 'tmp', 'q-' + rec.id);
    const asked = q('SELECT text FROM questions WHERE recording_id=? ORDER BY t', rec.id).map((x) => x.text.replace(/^At \d+:\d+ — /, '').slice(0, 200)).slice(-15);
    fs.mkdirSync(dir, { recursive: true });
    try {
      for (const [n, m] of pool.entries()) {
        if (kept.length >= want) break;
        const way = C.cloud.route('ask', true); // cloud: no GPU to rest; text-only cloud needs no picture
        if (C.aiPauseMs && !way) await sleep(C.aiPauseMs);
        if (!m.img && way !== 'text') { m.img = await grabFrame(rec, m.t, dir, 'now.jpg'); m.prev = m.t >= P.step ? await grabFrame(rec, m.t - P.step, dir, 'prev.jpg').catch(() => null) : null; }
        m.lang = lang;
        const r = await askAbout(ctx, m, timeline, fociFor(n), asked.slice(-8), manualFor(rec.session_id, `${m.action} ${m.objects}`, 700));
        m.img = m.prev = null;
        if (r.question && asked.includes(r.question)) continue; // never the same wording twice
        if (r.question && r.score >= 3) { kept.push({ m, q: r.question, en: r.en, engine: r.engine }); asked.push(r.question); P.qDone = kept.length; tell(); }
        else if (r.question) weak.push({ m, q: r.question, en: r.en, engine: r.engine, score: r.score });
      }
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    // Fewer, better questions; only if nothing passed does the best weak one get through, so a video never yields zero questions silently.
    if (!kept.length && weak.length) kept.push(weak.sort((a, b) => b.score - a.score)[0]);
    for (const { m, q: question, en, engine } of kept.sort((a, b) => a.m.t - b.m.t)) addMoment(rec, m.t, `${m.action}${m.change ? ` (changed since ${mmss(m.t - P.step)}: ${m.change})` : ''}.`, m.unc, engine || 'ollama:' + C.vModel, question, en);
    return kept.length;
  }
  async function analyzeRec(rec, maxQ = 5) {
    aiReady();
    const P = { phase: 'extracting', done: 0, total: 0, skipped: 0, moments: 0, step: 5, maxQ, started: Date.now() };
    const tell = () => emit(rec.session_id, 'analysis_progress', { recording: rec.id, ...P });
    progress.set(rec.id, P); tell();
    const out = path.join(C.dir, 'tmp', rec.id); fs.mkdirSync(out, { recursive: true });
    try {
      // Spread the frame budget over the whole video (at least 5 s apart) instead of covering only its start.
      const dur = await run$('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path.join(C.dir, rec.file)], 30000).then(parseFloat, () => 0);
      P.step = Math.max(5, Math.ceil((dur || 0) / C.aiMaxFrames));
      await run$('ffmpeg', ['-v', 'error', '-y', '-i', path.join(C.dir, rec.file), '-vf', `fps=1/${P.step},scale=${C.aiFrameW}:-2`, '-frames:v', String(C.aiMaxFrames), path.join(out, 'f%03d.jpg')], 300000).catch((e) => { throw new Error('ffmpeg failed: ' + e.message); });
      const frames = fs.readdirSync(out).sort();
      if (!frames.length) throw new Error('No frames could be extracted (unsupported codec?).');
      P.phase = 'analysing'; P.total = frames.length; tell();
      let fails = 0, prev = null, inRun = false; const cands = [], timeline = [], rows = [];
      for (const [i, f] of frames.entries()) {
        if (i && C.aiPauseMs && !C.cloud.route('see', true)) await sleep(C.aiPauseMs);
        const img = fs.readFileSync(path.join(out, f)); let j = null, err = null;
        for (let attempt = 0; attempt < 2; attempt++) {
          try { j = JSON.parse((await (prev ? ai('see', PAIR, [prev, img]) : ai('see', OBS, img))).out); err = null; break; } catch (e) { if (e.fatal) throw e; err = e; if (e instanceof SyntaxError) break; }
        }
        // The first frame is only the baseline; afterwards a run of consecutive "notable" frames is one moment, asked at its start.
        const hit = i > 0 && j?.notable === true, startsRun = hit && !inRun; inRun = hit;
        if (err) { P.skipped++; if (++fails >= 3) throw new Error(`Local AI failed on 3 frames in a row (last: ${err.message}). Nothing was saved; retry later.`); } else fails = 0;
        const t = i * P.step, action = String(j?.action || j?.visible || '').trim().replace(/\.$/, '').slice(0, 300);
        if (!err && action) {
          timeline.push({ t, action: action.slice(0, 140) });
          const change = typeof j.change === 'string' && j.change.trim() && !/^none\.?$/i.test(j.change.trim()) ? j.change.trim().replace(/\.$/, '').slice(0, 150) : '';
          const c = { t, startsRun, imp: Math.min(5, Math.max(1, Math.round(+j.importance) || (hit ? 3 : 1))), action, objects: String(j.objects || '').slice(0, 120), change, unc: String(j.uncertainty || '').slice(0, 200), notable: hit };
          rows.push(c);
          if (i > 0 && !/^idle/i.test(action)) cands.push({ ...c, img, prev });
        }
        prev = img;
        P.done++; tell();
      }
      // Keep what the frames show, so "more questions" later does not have to watch the video again.
      run('DELETE FROM frames WHERE recording_id=?', rec.id);
      for (const c of rows) run('INSERT INTO frames(recording_id,t,step,action,objects,change,importance,notable,starts_run,uncertainty) VALUES(?,?,?,?,?,?,?,?,?,?)', rec.id, c.t, P.step, c.action, c.objects, c.change, c.imp, c.notable ? 1 : 0, c.startsRun ? 1 : 0, c.unc);
      const used = q('SELECT DISTINCT t FROM questions WHERE recording_id=?', rec.id).map((x) => x.t);
      const pool = rankMoments(cands, used, P.step, maxQ);
      P.moments = await writeQuestions(rec, P, pool, timeline, maxQ, tell);
      P.rejected = pool.length - P.moments; P.qDone = P.qTotal = P.moments; tell();
      return { ...P };
    } finally { progress.delete(rec.id); fs.rmSync(out, { recursive: true, force: true }); }
  }
  // "Ask 5 / 10 more": new moments from the saved frame descriptions first, then follow-ups that dig into answers already given.
  async function moreQuestions(rec, want) {
    const fr = q('SELECT * FROM frames WHERE recording_id=? ORDER BY t', rec.id);
    if (!fr.length) return analyzeRec(rec, want); // analysed before frames were kept: watch the video once more
    const P = { phase: 'questions', done: fr.length, total: fr.length, skipped: 0, moments: 0, followups: 0, step: fr[0].step || 5, maxQ: want, more: true, started: Date.now() };
    const tell = () => emit(rec.session_id, 'analysis_progress', { recording: rec.id, ...P });
    progress.set(rec.id, P); tell();
    try {
      const timeline = fr.filter((f) => f.action).map((f) => ({ t: f.t, action: f.action.slice(0, 140) }));
      const cands = fr.filter((f) => f.t > 0 && f.action && !/^idle/i.test(f.action)).map((f) => ({ t: f.t, startsRun: !!f.starts_run, imp: f.importance || 1, action: f.action, objects: f.objects || '', change: f.change || '', unc: f.uncertainty || '' }));
      const used = q('SELECT DISTINCT t FROM questions WHERE recording_id=?', rec.id).map((x) => x.t);
      P.moments = await writeQuestions(rec, P, rankMoments(cands, used, P.step, want), timeline, want, tell);
      // Not enough new moments: ask the master to go deeper on answers they already gave (one follow-up per answer).
      if (P.moments < want) {
        const answered = q(`SELECT q.*, k.verbatim FROM questions q JOIN knowledge k ON k.question_id=q.id WHERE q.recording_id=? AND length(k.verbatim)>15
          AND NOT EXISTS(SELECT 1 FROM questions c WHERE c.parent_id=q.id) ORDER BY q.t`, rec.id);
        P.phase = 'followups'; P.qTotal = want; tell();
        for (const a of answered) {
          if (P.moments + P.followups >= want) break;
          const x = await followUp(rec.session_id, a, a);
          if (x) { addFollowUp(a, x.text, x.en); P.followups++; P.qDone = P.moments + P.followups; tell(); }
        }
      }
      return { ...P };
    } finally { progress.delete(rec.id); }
  }
  const busy = new Set(), presence = new Map(); // presence: session id → Map(student device → last heartbeat ms)
  function openHelp(sid, practiceId, question, step, frame, assessmentId, learner = null) {
    const id = rid(); let ff = null;
    if (frame) { ff = `frames/help-${id}.jpg`; fs.writeFileSync(path.join(C.dir, ff), frame); }
    run('INSERT INTO help(id,session_id,practice_id,question,step,frame_file,assessment_id,status,created_at,learner) VALUES(?,?,?,?,?,?,?,?,?,?)', id, sid, practiceId, question, step || '', ff, assessmentId || null, 'pending', now(), learner);
    ev(sid, 'help_requested', question); emit(sid, 'help'); return id;
  }
  async function assess(pr, buf, manual) {
    busy.add(pr.id);
    try {
      const skill = sessionSkill(q1(`SELECT ${SESSION_SKILL_COLS} FROM sessions WHERE id=?`, pr.session_id));
      const kn = approved(pr.session_id); let r;
      if (!skill) r = { status: 'cannot_assess', stage: '', evidence: '', confidence: 'low', knowledge_ids: [], feedback: 'Automatic check unavailable: this session\'s skill profile is missing, so no domain safety rules can be applied. Asking the master.', needs_help: true, source: 'rule' };
      else if (!kn.length) r = { status: 'cannot_assess', stage: '', evidence: '', confidence: 'low', knowledge_ids: [], feedback: 'No approved master knowledge exists for this task yet.', needs_help: true, source: 'rule' };
      else {
        try {
          aiReady('check');
          const a = await ai('check', buildAssessmentPrompt(skill, kn, langOf(pr.session_id)), buf);
          r = { ...parseAssessment(a.out, kn.map((k) => k.id)), source: a.engine };
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
  // Phones reach the app through the local tunnel (cloudflared on this machine): trust its X-Forwarded-For/-Proto,
  // so rate limits apply per real client instead of to everyone at once, and links know they are HTTPS.
  app.set('trust proxy', 'loopback');
  app.use((req, res, next) => {
    res.set({ 'Content-Security-Policy': "default-src 'self'; media-src 'self' blob:; img-src 'self' data: blob:; style-src 'self'; style-src-attr 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Permissions-Policy': 'camera=(self), microphone=(self), geolocation=()', 'Cache-Control': 'no-store' });
    next();
  });
  app.use(express.json({ limit: '100kb' }));
  const raw = (mb) => express.raw({ type: () => true, limit: mb + 'mb' });

  // What leaves this computer, for consent screens: never keys.
  app.get('/api/ai-mode', (req, res) => { const c = C.cloud.status(); res.json({ cloud: c.mode, provider: c.provider, stt: !!c.stt, sttHost: c.stt?.host || null }); });
  app.get('/api/health', (req, res) => res.json({ ok: true, db: !!q1('SELECT 1 x'), ai: aiAvailable(), time: now() }));
  // Legal pages follow the interface language (?lang=ja|en, else the mz_lang cookie set by the language switch).
  app.get(['/privacy', '/terms', '/cookies'], (req, res) => {
    const q = req.query.lang, lang = q === 'ja' || q === 'en' ? q : cookies(req).mz_lang === 'ja' ? 'ja' : 'en';
    if (q === 'ja' || q === 'en') res.append('Set-Cookie', `mz_lang=${q}; Path=/; Max-Age=31536000; SameSite=Lax`);
    res.type('html').send(renderLegal(req.path.slice(1), lang, C.cloud.status()));
  });

  // Only failed attempts count towards the limit (8 per minute per address).
  const tries = (req) => { const k = req.ip, a = attempts.get(k) || { n: 0, t: Date.now() }; if (Date.now() - a.t > 6e4) { a.n = 0; a.t = Date.now(); } attempts.set(k, a); return a; };
  const tooMany = (req) => tries(req).n >= 8, failed = (req) => { tries(req).n++; };
  const USER_RE = /^[a-z0-9_.-]{3,32}$/;
  app.post('/api/login', (req, res) => {
    if (tooMany(req)) return res.status(429).json({ error: 'Too many attempts. Wait a minute.' });
    const b = req.body || {};
    if (b.passphrase !== undefined) { // setup/admin login (sees every session)
      const h = (x) => crypto.createHash('sha256').update(String(x)).digest('hex');
      if (!safeEq(h(b.passphrase), h(C.pass))) { failed(req); return res.status(401).json({ error: 'Incorrect passphrase.' }); }
      setLogin(req, res, 'admin'); return res.json({ ok: true });
    }
    const m = q1('SELECT * FROM masters WHERE username=?', String(b.username || '').trim().toLowerCase());
    if (!m || !safeEq(hashPw(b.password || '', m.salt), m.hash)) { failed(req); return res.status(401).json({ error: 'Wrong username or password.' }); }
    setLogin(req, res, m.id); res.json({ ok: true, name: m.name });
  });
  app.post('/api/signup', (req, res) => {
    if (!C.signup) return res.status(403).json({ error: 'New master accounts are switched off on this server.' });
    if (tooMany(req)) return res.status(429).json({ error: 'Too many attempts. Wait a minute.' });
    const { name, username, password } = req.body || {}, u = String(username || '').trim().toLowerCase();
    if (typeof name !== 'string' || !name.trim() || name.length > 60) return res.status(400).json({ error: 'Enter your name (max 60 characters).' });
    if (!USER_RE.test(u)) return res.status(400).json({ error: 'Username: 3–32 characters, letters, numbers, dot, dash or underscore.' });
    if (typeof password !== 'string' || password.length < 6 || password.length > 200) return res.status(400).json({ error: 'Password: at least 6 characters.' });
    if (q1('SELECT 1 FROM masters WHERE username=?', u)) { failed(req); return res.status(409).json({ error: 'That username is taken.' }); }
    const id = rid(), salt = crypto.randomBytes(16).toString('hex'), first = !q1('SELECT 1 FROM masters');
    run('INSERT INTO masters VALUES(?,?,?,?,?,?)', id, u, name.trim(), salt, hashPw(password, salt), now());
    // Sessions made before accounts existed belong to whoever sets the system up first.
    const claimed = first ? run('UPDATE sessions SET owner=? WHERE owner IS NULL', id).changes : 0;
    setLogin(req, res, id); res.status(201).json({ ok: true, name: name.trim(), claimed });
  });
  app.post('/api/logout', (req, res) => { res.set('Set-Cookie', 'mz=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'); res.json({ ok: true }); });
  app.get('/api/me', M, (req, res) => res.json({ ok: true, user: req.uid === 'admin' ? { name: 'Administrator', username: null, admin: true } : { ...q1('SELECT name,username FROM masters WHERE id=?', req.uid), admin: false }, signup: C.signup, limits: { maxVideoMb: C.maxVideoMb, uploadMb: req.hostname === tunnelHost ? phoneVideoMb() : C.maxVideoMb, retentionDays: C.retDays }, aiConfigured: aiAvailable(), aiEngines: aiInfo(), sttConfigured: sttReady(), tts: ttsLangs() }));

  // ---- local speech-to-text: master dictates answers; whisper.cpp runs on the CPU so the GPU stays free for vision ----
  const AUDIO = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav' };
  function sttReady() { return !!(C.whisperBin && C.whisperModel && fs.existsSync(C.whisperBin) && fs.existsSync(C.whisperModel)); }
  let sttBusy = false;
  // A short hint with the craft's own words (はんだごて, 玉鋼 …) helps the recogniser spell trade terms; it also nudges punctuation.
  // Short core terms work far better than full tool names (measured: long names with brackets made it worse).
  const sttHint = (sid, lang) => {
    const s = sid && q1(`SELECT task,${SESSION_SKILL_COLS} FROM sessions WHERE id=?`, sid), sk = s && sessionSkill(s); if (!sk) return '';
    const ja = lang === 'ja' || (lang !== 'en' && langOf(sid) === 'ja'), p = ja && sk.id !== 'custom' ? localizeSkill(sk, 'ja') : sk;
    const terms = p.terms?.length ? p.terms : [p.name, ...p.tools.map((x) => x.name.replace(/[（(][^）)]*[）)]/g, '').split(/[／/]/)[0].trim())];
    return [...new Set(terms)].filter(Boolean).join(ja ? '、' : ', ').slice(0, 160) + (ja ? '。' : '.');
  };
  // Masters dictate answers on the laptop; students may speak their question on the phone (their invite, after consent).
  const masterOrStudent = (req, res, next) => {
    const uid = isMaster(req); if (uid) { req.uid = uid; return next(); }
    const tk = tokOf(req); if (!tk || tk.role !== 'apprentice') return res.status(401).json({ error: 'Master sign-in required.' });
    if (!tk.consented_at) return res.status(403).json({ error: 'Recording consent has not been given on this device.' });
    req.tok = tk; next();
  };
  app.post('/api/transcribe', masterOrStudent, express.raw({ type: () => true, limit: '10mb' }), A(async (req, res) => {
    const sid = req.tok ? req.tok.session_id : typeof req.query.session === 'string' && canSee(req.uid, req.query.session) ? req.query.session : null;
    const mode0 = ['en', 'ja', 'auto', 'translate'].includes(req.query.lang) ? req.query.lang : C.whisperLang;
    // Cloud speech-to-text first when the operator turned it on (not for translation, which stays local); local whisper on any failure.
    if (C.cloud.sttLabel && mode0 !== 'translate') {
      const mime = String(req.get('content-type') || '').split(';')[0].trim();
      if (AUDIO[mime] && Buffer.isBuffer(req.body) && req.body.length >= 500) {
        const t0 = Date.now();
        try {
          const text = (await C.cloud.transcribe(req.body, 'answer.' + AUDIO[mime], mime, { language: mode0, prompt: sttHint(sid, mode0) })).replace(/\s+/g, ' ').trim();
          return res.json({ text, mode: mode0, ms: Date.now() - t0, engine: C.cloud.sttLabel, cloud: true });
        } catch (e) { if (!sttReady()) return res.status(502).json({ error: e.message }); console.warn(e.message + ' — using local whisper instead'); }
      }
    }
    if (!sttReady()) return res.status(503).json({ error: 'Speech-to-text is not set up on this computer (set WHISPER_BIN and WHISPER_MODEL). You can still type the answer.', code: 'stt_unavailable' });
    const mime = String(req.get('content-type') || '').split(';')[0].trim();
    if (!AUDIO[mime]) return res.status(415).json({ error: `Unsupported audio type "${mime}".` });
    if (!Buffer.isBuffer(req.body) || req.body.length < 500) return res.status(400).json({ error: 'No audio was recorded. Check the microphone and try again.' });
    if (sttBusy) return res.status(409).json({ error: 'Another answer is being transcribed. Try again in a moment.', code: 'stt_busy' });
    sttBusy = true; const id = rid(), src = path.join(C.dir, 'tmp', `stt-${id}.${AUDIO[mime]}`), wav = path.join(C.dir, 'tmp', `stt-${id}-16k.wav`), t0 = Date.now();
    try {
      fs.writeFileSync(src, req.body);
      await run$('ffmpeg', ['-v', 'error', '-y', '-i', src, '-t', '300', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav], 60000).catch(() => { throw Object.assign(new Error('Could not read the recorded audio.'), { status: 400 }); });
      // ?lang=ja|en|auto keeps the speech in the language spoken (Japanese stays Japanese); only ?lang=translate turns it into English.
      const mode = mode0, lang = mode === 'translate' ? 'auto' : mode, hint = mode === 'translate' ? '' : sttHint(sid, mode);
      const out = await run$('nice', ['-n', '10', C.whisperBin, '-m', C.whisperModel, '-f', wav, '-l', lang, ...(mode === 'translate' ? ['-tr'] : []), ...(hint ? ['--prompt', hint] : []), '-t', String(C.whisperThreads), '-nt', '-np'], 180000)
        .catch((e) => { throw Object.assign(new Error('Transcription failed: ' + (e.killed ? 'took too long' : e.message.split('\n')[0])), { status: 500 }); });
      // whisper marks silence/noise as [BLANK_AUDIO], (music) etc. — never put those into an expert's words
      // …and a hint must never come back as the answer (the recogniser can echo it on silence).
      let text = out.replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
      if (hint && text.replace(/\s/g, '') === hint.replace(/\s/g, '')) text = '';
      res.json({ text, mode, ms: Date.now() - t0, engine: 'whisper.cpp:' + path.basename(C.whisperModel) });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
    finally { sttBusy = false; fs.rmSync(src, { force: true }); fs.rmSync(wav, { force: true }); }
  }));
  // ---- local text-to-speech for read-aloud guidance: Open JTalk (Japanese), espeak-ng (English). Nothing leaves this computer. ----
  const TTS = {
    ja: C.jtalkBin && C.jtalkDic && C.jtalkVoice ? (txt, out) => run$('sh', ['-c', 'printf %s "$1" | "$2" -x "$3" -m "$4" -ow "$5"', 'tts', txt, C.jtalkBin, C.jtalkDic, C.jtalkVoice, out], 30000) : null,
    en: C.espeakBin ? (txt, out) => run$(C.espeakBin, ['-v', 'en-us', '-s', '160', '-w', out, txt], 30000) : null,
  };
  const ttsOk = (l) => { const ok = { ja: [C.jtalkBin, C.jtalkDic, C.jtalkVoice], en: [C.espeakBin] }[l]; return !!TTS[l] && ok.every((f) => f && fs.existsSync(f)); };
  const ttsLangs = () => ['en', 'ja'].filter(ttsOk);
  const ttsCache = new Map(); let ttsChain = Promise.resolve();
  app.get('/api/tts', A(async (req, res) => {
    if (!tokOf(req) && !isMaster(req)) return res.status(401).json({ error: 'Not signed in.' });
    const text = String(req.query.text || '').replace(/\s+/g, ' ').trim().slice(0, 600); if (!text) return res.status(400).json({ error: 'text required' });
    const lang = req.query.lang === 'ja' || req.query.lang === 'en' ? req.query.lang : isJapanese(text) ? 'ja' : 'en';
    if (!ttsOk(lang)) return res.status(503).json({ error: `Read-aloud in ${lang === 'ja' ? 'Japanese' : 'English'} is not set up on this computer.`, code: 'tts_unavailable' });
    const key = lang + '|' + text; let wav = ttsCache.get(key);
    if (!wav) {
      // One synthesis at a time (they take well under a second); the last 40 phrases are kept in memory.
      wav = await (ttsChain = ttsChain.catch(() => {}).then(async () => {
        const out = path.join(C.dir, 'tmp', `tts-${rid()}.wav`);
        try { await TTS[lang](text, out); return fs.readFileSync(out); } finally { fs.rmSync(out, { force: true }); }
      }));
      ttsCache.set(key, wav); if (ttsCache.size > 40) ttsCache.delete(ttsCache.keys().next().value);
    }
    res.set({ 'Content-Type': 'audio/wav', 'Cache-Control': 'private, max-age=3600' }).send(wav);
  }));
  // ?lang=ja returns the Japanese text of a profile (the interface language); the AI always works from the English profile.
  const uiLang = (req) => (req.query.lang === 'ja' || req.body?.lang === 'ja' || req.get('x-lang') === 'ja' ? 'ja' : 'en');
  app.get('/api/skills', (req, res) => res.json({ skills: getSkillsSummary(uiLang(req)) }));
  app.get('/api/skills/:id', (req, res) => {
    const s = /^[a-z0-9_-]{1,64}$/.test(req.params.id) ? getSkill(req.params.id) : null;
    if (!s) return res.status(404).json({ error: 'Skill profile not found.' });
    res.json(localizeSkill(s, uiLang(req)));
  });

  // sessions (master)
  const freeCode = () => { for (;;) { const c = newCode(); if (!q1('SELECT 1 FROM tokens WHERE code=?', c)) return c; } };
  const mint = (sid) => { run('DELETE FROM tokens WHERE session_id=?', sid); const exp = new Date(Date.now() + C.ttlH * 36e5).toISOString(); for (const role of ['master', 'apprentice']) run('INSERT INTO tokens(token,session_id,role,expires_at,code) VALUES(?,?,?,?,?)', crypto.randomBytes(24).toString('base64url'), sid, role, exp, role === 'apprentice' ? freeCode() : null); };
  // Invites minted before join codes existed get one, so students can type it instead of scanning.
  for (const t of q("SELECT token FROM tokens WHERE role='apprentice' AND code IS NULL")) run('UPDATE tokens SET code=? WHERE token=?', freeCode(), t.token);
  app.post('/api/sessions', M, (req, res) => {
    const { title, task, procedure, skill_id, task_id } = req.body || {}, lang = req.body?.lang === 'ja' ? 'ja' : 'en';
    if (typeof title !== 'string' || !title.trim() || title.length > 120) return res.status(400).json({ error: 'A title (max 120 characters) is required.' });
    for (const [f, v] of [['task', task], ['procedure', procedure], ['skill_id', skill_id], ['task_id', task_id]]) if (v != null && typeof v !== 'string') return res.status(400).json({ error: `${f} must be a string.` });
    const sk = skill_id || 'soldering', tid = sk === 'custom' ? null : task_id || null;
    let val = { task: null }, custom = null;
    if (sk === 'custom') {
      // Any craft: the master names it and lists its tools and safety notes; the AI then works from those.
      const c = req.body.custom;
      if (!c || typeof c !== 'object' || typeof c.name !== 'string' || !c.name.trim() || c.name.length > 80) return res.status(400).json({ error: 'Name the skill (max 80 characters).' });
      if (!task?.trim()) return res.status(400).json({ error: 'Describe the task to be demonstrated.' });
      for (const f of ['description', 'tools', 'safety']) if (c[f] != null && typeof c[f] !== 'string') return res.status(400).json({ error: `custom.${f} must be a string.` });
      custom = JSON.stringify({ name: c.name.trim(), description: String(c.description || '').trim().slice(0, 400), tools: toolLines(c.tools), safety: lines(c.safety, 20).map((x) => x.slice(0, 300)) });
    } else {
      val = validateSkillAndTask(sk, tid);
      if (!val.valid) return res.status(400).json({ error: val.error });
    }
    // Explicit non-empty text wins; otherwise the selected task template supplies the defaults.
    const tk = (task?.trim() ? task : val.task?.title || '').slice(0, 1000), pc = (procedure?.trim() ? procedure : val.task?.default_procedure || '').slice(0, 4000);
    const id = rid(); run('INSERT INTO sessions(id,title,task,procedure,skill_id,task_id,custom_skill,owner,lang,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)', id, title.trim(), tk, pc, sk, tid, custom, req.uid === 'admin' ? null : req.uid, lang, now()); mint(id); ev(id, 'session_created', title);
    res.status(201).json({ id, skill_id: sk, task_id: tid, task: tk, procedure: pc, lang });
  });
  app.get('/api/sessions', M, (req, res) => res.json(q(`SELECT s.*, (SELECT COUNT(*) FROM recordings r WHERE r.session_id=s.id) recordings,
    (SELECT COUNT(*) FROM questions x WHERE x.session_id=s.id AND x.status='open') open_questions, (SELECT COUNT(*) FROM knowledge k WHERE k.session_id=s.id AND k.status='approved') approved
    FROM sessions s WHERE ?='admin' OR s.owner=? ORDER BY s.created_at DESC`, req.uid, req.uid).map((s) => ({ ...s, skill_name: sessionSkill(s)?.name || null }))));
  app.delete('/api/sessions/:id', M, own('sessions'), (req, res) => { if (!q1('SELECT 1 FROM sessions WHERE id=?', req.params.id)) return res.status(404).json({ error: 'Not found' }); deleteSession(req.params.id); emit(req.params.id, 'deleted'); res.json({ ok: true }); });
  // The session's language can be switched later (affects new AI output and the read-aloud voice, not existing text).
  app.patch('/api/sessions/:id', M, own('sessions'), (req, res) => {
    if (!['en', 'ja'].includes(req.body?.lang)) return res.status(400).json({ error: 'lang must be "en" or "ja".' });
    if (!q1('SELECT 1 FROM sessions WHERE id=?', req.params.id)) return res.status(404).json({ error: 'Not found' });
    run('UPDATE sessions SET lang=? WHERE id=?', req.body.lang, req.params.id); ev(req.params.id, 'language_changed', req.body.lang); res.json({ ok: true });
  });
  // The master's own manual for the session (text, Markdown or PDF). The AI reads it as background and asks about what it leaves out.
  app.put('/api/sessions/:id/manual', M, own('sessions'), express.raw({ type: () => true, limit: '20mb' }), A(async (req, res) => {
    if (!q1('SELECT 1 FROM sessions WHERE id=?', req.params.id)) return res.status(404).json({ error: 'Not found' });
    const type = String(req.get('content-type') || '').split(';')[0].trim(), name = (() => { try { return decodeURIComponent(req.get('x-filename') || 'manual'); } catch { return 'manual'; } })().slice(0, 120);
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'The manual is empty.' });
    let text;
    if (type === 'application/pdf' || req.body.subarray(0, 5).toString() === '%PDF-') {
      const f = path.join(C.dir, 'tmp', `man-${rid()}.pdf`);
      try { fs.writeFileSync(f, req.body); text = await run$('pdftotext', ['-layout', '-enc', 'UTF-8', f, '-'], 60000); }
      catch { return res.status(415).json({ error: 'This PDF could not be read as text (scanned PDFs are not supported). Paste the text instead.' }); }
      finally { fs.rmSync(f, { force: true }); }
    } else if (/^text\//.test(type) || type === 'application/json' || type === '') text = req.body.toString('utf8');
    else return res.status(415).json({ error: 'Use a PDF, .txt or .md file, or paste the text.' });
    text = text.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 60000);
    if (text.length < 30) return res.status(400).json({ error: 'No readable text was found in this manual.' });
    run('UPDATE sessions SET manual=?, manual_name=? WHERE id=?', text, name, req.params.id); ev(req.params.id, 'manual_added', `${name} (${text.length} characters)`);
    res.json({ ok: true, chars: text.length });
  }));
  app.delete('/api/sessions/:id/manual', M, own('sessions'), (req, res) => { run('UPDATE sessions SET manual=NULL, manual_name=NULL WHERE id=?', req.params.id); ev(req.params.id, 'manual_removed'); res.json({ ok: true }); });
  app.post('/api/sessions/:id/rotate', M, own('sessions'), (req, res) => { mint(req.params.id); ev(req.params.id, 'links_rotated'); res.json({ ok: true }); });
  app.get('/api/sessions/:id/links', M, own('sessions'), A(async (req, res) => {
    renewTokens('session_id=?', req.params.id);
    const base = pubBase(req);
    const out = {};
    for (const t of q('SELECT * FROM tokens WHERE session_id=?', req.params.id)) { const url = `${base}/${t.role === 'master' ? 'm' : 'a'}.html#${t.token}`; out[t.role] = { url, qr: await QRCode.toDataURL(url, { margin: 1, width: 240 }), expires_at: t.expires_at, code: t.code || null, token: t.token }; }
    out.base = base;
    res.json({ links: out, warning: /localhost|127\.0\.0\.1/.test(base) ? 'You opened the dashboard via localhost. Phones cannot reach that: open the dashboard via your laptop\'s LAN IP or set PUBLIC_URL.' : null });
  }));
  app.get('/api/sessions/:id', M, own('sessions'), (req, res) => {
    const id = req.params.id, s = q1('SELECT * FROM sessions WHERE id=?', id);
    if (!s) return res.status(404).json({ error: 'Not found' });
    const cutoff = Date.now() - 30000;
    const devices = q('SELECT role,consented_at,last_seen,expires_at FROM tokens WHERE session_id=?', id).map((d) => ({ ...d, connected: !!d.last_seen && new Date(d.last_seen).getTime() > cutoff }));
    const help = q('SELECT * FROM help WHERE session_id=? ORDER BY created_at DESC', id).map((h) => ({ ...h, frame: h.frame_file ? fileUrl('help', h.id) : null, replies: q('SELECT * FROM replies WHERE help_id=? ORDER BY created_at', h.id) }));
    // Students are anonymous devices, numbered in the order they first did something in this session.
    const seen = q("SELECT learner, MIN(t) first FROM (SELECT learner, learned_at t FROM progress WHERE session_id=? UNION ALL SELECT learner, created_at t FROM help WHERE session_id=? AND learner IS NOT NULL) GROUP BY learner ORDER BY first", id, id);
    const label = Object.fromEntries(seen.map((l, i) => [l.learner, 'Student ' + (i + 1)]));
    const learners = seen.map((l) => ({ label: label[l.learner], ...q1("SELECT COUNT(k.id) learned, MAX(p.learned_at) last FROM progress p LEFT JOIN knowledge k ON k.id=p.knowledge_id AND k.status='approved' WHERE p.session_id=? AND p.learner=?", id, l.learner), helps: q1('SELECT COUNT(*) n FROM help WHERE session_id=? AND learner=?', id, l.learner).n }));
    const practices = q('SELECT id,started_at,ended_at FROM practice WHERE session_id=? ORDER BY started_at DESC', id).map((p) => { const as = q('SELECT * FROM assessments WHERE practice_id=? ORDER BY created_at', p.id); const c = {}; for (const a of as) c[a.status] = (c[a.status] || 0) + 1; return { ...p, counts: c, total: as.length, last: as.at(-1) || null }; });
    const { manual, ...sess } = s, pres = presence.get(id) || new Map(), nowMs = Date.now();
    res.json({ session: { ...sess, manual_chars: manual?.length || 0, manual_preview: manual ? manual.slice(0, 400) : '' }, devices,
      presence: { studentsOnline: [...pres.values()].filter((t) => nowMs - t < 40000).length, studentsToday: [...pres.values()].filter((t) => nowMs - t < 864e5).length }, recordings: q('SELECT * FROM recordings WHERE session_id=? ORDER BY created_at DESC', id).map((r) => ({ ...r, url: fileUrl('rec', r.id), progress: progress.get(r.id) || null })),
      observations: q('SELECT * FROM observations WHERE session_id=? ORDER BY t', id), questions: q('SELECT * FROM questions WHERE session_id=? ORDER BY t', id),
      knowledge: q('SELECT * FROM knowledge WHERE session_id=? ORDER BY created_at DESC', id), help: help.map((h) => ({ ...h, learner_label: label[h.learner] || null })), practices, skill_name: sessionSkill(s)?.name || null,
      learners, trash: q('SELECT id,kind,label,deleted_at FROM trash WHERE session_id=? ORDER BY deleted_at DESC', id), trashDays: TRASH_DAYS, events: q('SELECT * FROM events WHERE session_id=? ORDER BY id DESC LIMIT 40', id) });
  });

  // phones
  app.post('/api/join', P(), (req, res) => {
    if (req.body?.consent !== true) return res.status(400).json({ error: 'Consent must be actively given (the box must be ticked).' });
    // Resolve the safety context before recording consent or touching the token.
    const s = q1(`SELECT title,task,procedure,task_id,lang,${SESSION_SKILL_COLS} FROM sessions WHERE id=?`, req.tok.session_id);
    if (!s) return res.status(404).json({ error: 'Session not found.' });
    const sk = sessionSkill(s);
    if (!sk) return res.status(409).json(NO_PROFILE);
    run('UPDATE tokens SET consented_at=COALESCE(consented_at,?), last_seen=? WHERE token=?', now(), now(), req.tok.token); renewTokens('token=?', req.tok.token);
    const L = sk.id === 'custom' ? sk : localizeSkill(getSkill(sk.id), req.get('x-lang') === 'ja' ? 'ja' : 'en') || sk;
    const tk = L.tasks.find((t) => t.id === s.task_id);
    const skill = { id: sk.id, name: L.name, category: L.category, description: L.description, safety_advisories: L.safety_advisories, tools: L.tools.map(({ id, name, purpose }) => ({ id, name, purpose })), task: tk ? { title: tk.title, summary: tk.summary || '', visual_cues: tk.visual_cues || '' } : null };
    ev(req.tok.session_id, 'device_joined', (req.tok.role === 'master' ? 'master phone' : 'student') + ' consented and joined');
    delete s.custom_skill;
    res.json({ role: req.tok.role, session: s, skill, tts: ttsLangs(), stt: sttReady() || !!C.cloud.sttLabel, limits: { maxVideoMb: phoneVideoMb(), maxRecSec: C.maxRecSec, snapshotMs: C.snapMs, maxFrameKb: C.maxFrameKb } });
  });
  // Students type the short code shown on the dashboard / master phone; it resolves to the session's apprentice invite.
  const codeTries = new Map();
  app.post('/api/code', (req, res) => {
    const k = req.ip, a = codeTries.get(k) || { n: 0, t: Date.now() };
    if (Date.now() - a.t > 6e4) { a.n = 0; a.t = Date.now(); }
    if (++a.n > 10) return res.status(429).json({ error: 'Too many attempts. Wait a minute.' });
    codeTries.set(k, a);
    const code = String(req.body?.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const t = code.length === 6 && q1("SELECT token,session_id,expires_at FROM tokens WHERE code=? AND role='apprentice'", code);
    if (!t || new Date(t.expires_at) <= new Date()) return res.status(404).json({ error: 'That code is not recognised or has expired. Ask the master for the current code.' });
    const s = q1('SELECT title FROM sessions WHERE id=?', t.session_id);
    res.json({ token: t.token, title: s?.title || '' });
  });
  // Landing page: where each device should go (public — no session data).
  app.get('/api/entry', A(async (req, res) => {
    const base = pubBase(req), qr = (u) => QRCode.toDataURL(u, { margin: 1, width: 200 });
    res.json({ base, masterPhone: { url: base + '/m.html', qr: await qr(base + '/m.html') }, student: { url: base + '/a.html', qr: await qr(base + '/a.html') }, localhost: /localhost|127\.0\.0\.1/.test(base) });
  }));
  // Master phone: what happened to its uploads, so it can say "questions are ready on the laptop".
  app.get('/api/phone/status', P('master'), (req, res) => {
    const sid = req.tok.session_id, base = pubBase(req);
    res.json({ recordings: q('SELECT r.id,r.status,r.error,r.bytes,r.created_at,(SELECT COUNT(*) FROM questions x WHERE x.recording_id=r.id) questions FROM recordings r WHERE r.session_id=? ORDER BY r.created_at DESC', sid).map((r) => ({ ...r, progress: progress.get(r.id) || null })),
      openQuestions: q1("SELECT COUNT(*) n FROM questions WHERE session_id=? AND status='open'", sid).n, questions: q1('SELECT COUNT(*) n FROM questions WHERE session_id=?', sid).n,
      approved: q1("SELECT COUNT(*) n FROM knowledge WHERE session_id=? AND status='approved'", sid).n, aiConfigured: aiAvailable(), dashboard: base + '/dashboard' });
  });
  // Student learning progress: which approved records this device has marked as learned.
  const learnerOf = (req) => { const l = String(req.get('x-learner') || ''); return /^[A-Za-z0-9_-]{8,64}$/.test(l) ? l : null; };
  app.get('/api/progress', P('apprentice'), (req, res) => {
    const l = learnerOf(req); if (!l) return res.status(400).json({ error: 'Missing learner id.' });
    res.json({ learned: q("SELECT p.knowledge_id id, p.learned_at FROM progress p JOIN knowledge k ON k.id=p.knowledge_id AND k.status='approved' WHERE p.session_id=? AND p.learner=?", req.tok.session_id, l),
      approved: q1("SELECT COUNT(*) n FROM knowledge WHERE session_id=? AND status='approved'", req.tok.session_id).n,
      practices: q1('SELECT COUNT(*) n FROM practice WHERE session_id=?', req.tok.session_id).n });
  });
  app.post('/api/progress', P('apprentice'), consented, (req, res) => {
    const l = learnerOf(req), kid = req.body?.knowledge_id; if (!l) return res.status(400).json({ error: 'Missing learner id.' });
    if (!q1("SELECT 1 FROM knowledge WHERE id=? AND session_id=? AND status='approved'", String(kid), req.tok.session_id)) return res.status(404).json({ error: 'That lesson is not available.' });
    if (req.body?.learned === false) run('DELETE FROM progress WHERE learner=? AND knowledge_id=?', l, kid);
    else run('INSERT OR IGNORE INTO progress(session_id,learner,knowledge_id,learned_at) VALUES(?,?,?,?)', req.tok.session_id, l, kid, now());
    emit(req.tok.session_id, 'progress'); res.json({ ok: true });
  });
  // Students share one invite, so presence is counted per student device (x-learner), in memory only.
  app.post('/api/ping', P(), (req, res) => { run('UPDATE tokens SET last_seen=? WHERE token=?', now(), req.tok.token); renewTokens('token=?', req.tok.token);
    const l = req.tok.role === 'apprentice' && learnerOf(req); if (l) { if (!presence.has(req.tok.session_id)) presence.set(req.tok.session_id, new Map()); presence.get(req.tok.session_id).set(l, Date.now()); } emit(req.tok.session_id, 'ping'); res.json({ ok: true }); });

  // A recording from the master phone (just recorded, or a video picked from the phone) or from the laptop dashboard
  // (a file filmed with a separate camera). Every upload then follows the same analysis and question workflow.
  function saveVideo(req, res, sid, source) {
    const mime = String(req.get('content-type') || '').split(';')[0].trim();
    if (!VIDEO[mime]) return res.status(415).json({ error: `Unsupported video type "${mime}". Use MP4, WebM or MOV.` });
    if (!Buffer.isBuffer(req.body) || req.body.length < 1000 || !isVideo(req.body, mime)) return res.status(400).json({ error: 'File is empty or is not a valid video of the declared type.' });
    const id = rid(), file = `rec/${id}.${VIDEO[mime]}`; fs.writeFileSync(path.join(C.dir, file), req.body);
    run('INSERT INTO recordings VALUES(?,?,?,?,?,?,?,?)', id, sid, file, mime, req.body.length, 'uploaded', null, now());
    ev(sid, 'recording_uploaded', `${(req.body.length / 1e6).toFixed(1)} MB${source ? ' · ' + source : ''}`); res.status(201).json({ id });
  }
  app.post('/api/recordings', P('master'), consented, raw(C.maxVideoMb), (req, res) => saveVideo(req, res, req.tok.session_id, req.get('x-source') === 'file' ? 'video file' : ''));
  app.post('/api/sessions/:id/recordings', M, own('sessions'), raw(C.maxVideoMb), (req, res) => saveVideo(req, res, req.params.id, 'video file'));
  app.post('/api/recordings/:id/analyze', (req, res) => {
    // The master's laptop (signed in) or the master phone that recorded it (invite token, same session only).
    const uid = isMaster(req), mt = uid ? null : tokOf(req); if (!uid && mt?.role !== 'master') return res.status(401).json({ error: 'Master sign-in required.' });
    const rec = q1('SELECT * FROM recordings WHERE id=?', req.params.id); if (!rec || (mt ? rec.session_id !== mt.session_id : !canSee(uid, rec.session_id))) return res.status(404).json({ error: 'Not found' });
    if (progress.has(rec.id)) return res.status(409).json({ error: 'This recording is already being analysed.', code: 'analysis_running' });
    if (progress.size) return res.status(409).json({ error: 'Another recording is being analysed. Wait for it to finish — one analysis at a time keeps the laptop responsive.', code: 'analysis_busy' });
    try { aiReady(); } catch (e) { run("UPDATE recordings SET status='failed',error=? WHERE id=?", e.message, rec.id); ev(rec.session_id, 'analysis_failed', e.message); return res.status(503).json({ error: e.message + ' Add moments manually instead.' }); }
    const maxQ = Math.min(10, Math.max(1, Math.round(+req.body?.maxQuestions) || 5));
    run("UPDATE recordings SET status='analyzing',error=NULL WHERE id=?", rec.id); ev(rec.session_id, 'analysis_started', `up to ${maxQ} questions`); res.status(202).json({ ok: true, maxQuestions: maxQ });
    analyzeRec(rec, maxQ).then((p) => { run("UPDATE recordings SET status='analyzed' WHERE id=?", rec.id); ev(rec.session_id, 'analysis_done', `${p.moments} new question${p.moments === 1 ? '' : 's'} (asked for up to ${maxQ}) from ${p.done} still frames (one every ${p.step} s)${p.skipped ? `; ${p.skipped} skipped after timeouts` : ''}`); })
      .catch((e) => { run("UPDATE recordings SET status='failed',error=? WHERE id=?", e.message, rec.id); ev(rec.session_id, 'analysis_failed', e.message); });
  });
  // "Ask 5 / 10 more": from the laptop (signed in) or the master phone (its own session).
  app.post('/api/recordings/:id/more', (req, res) => {
    const uid = isMaster(req), mt = uid ? null : tokOf(req); if (!uid && mt?.role !== 'master') return res.status(401).json({ error: 'Master sign-in required.' });
    const rec = q1('SELECT * FROM recordings WHERE id=?', req.params.id); if (!rec || (mt ? rec.session_id !== mt.session_id : !canSee(uid, rec.session_id))) return res.status(404).json({ error: 'Not found' });
    if (rec.status !== 'analyzed') return res.status(409).json({ error: 'Analyse this recording first.', code: 'not_analyzed' });
    if (progress.size) return res.status(409).json({ error: 'The local AI is busy with another recording. Try again when it finishes.', code: 'analysis_busy' });
    try { aiReady('ask'); } catch (e) { return res.status(503).json({ error: e.message }); }
    const want = +req.body?.count === 10 ? 10 : 5;
    run("UPDATE recordings SET status='analyzing',error=NULL WHERE id=?", rec.id); ev(rec.session_id, 'more_questions_started', String(want)); res.status(202).json({ ok: true, count: want });
    moreQuestions(rec, want).then((p) => { run("UPDATE recordings SET status='analyzed' WHERE id=?", rec.id); ev(rec.session_id, 'more_questions_done', `${(p.moments || 0) + (p.followups || 0)} new question(s): ${p.moments || 0} new moment(s), ${p.followups || 0} follow-up(s) (asked for ${want})`); })
      .catch((e) => { run("UPDATE recordings SET status='analyzed',error=? WHERE id=?", e.message, rec.id); ev(rec.session_id, 'analysis_failed', e.message); });
  });
  // Uploaded by mistake: the video and everything made from it (moments, questions, knowledge, progress) go to the recycle bin.
  app.delete('/api/recordings/:id', (req, res) => {
    const uid = isMaster(req), mt = uid ? null : tokOf(req); if (!uid && mt?.role !== 'master') return res.status(401).json({ error: 'Master sign-in required.' });
    const rec = q1('SELECT * FROM recordings WHERE id=?', req.params.id); if (!rec || (mt ? rec.session_id !== mt.session_id : !canSee(uid, rec.session_id))) return res.status(404).json({ error: 'Not found' });
    if (progress.has(rec.id)) return res.status(409).json({ error: 'This recording is being analysed. Wait for it to finish, then delete it.' });
    const questions = q('SELECT * FROM questions WHERE recording_id=?', rec.id), knowledge = q('SELECT * FROM knowledge WHERE recording_id=? AND question_id IN (SELECT id FROM questions WHERE recording_id=?)', rec.id, rec.id);
    const rows = { recordings: [rec], observations: q('SELECT * FROM observations WHERE recording_id=?', rec.id), questions, knowledge,
      progress: knowledge.length ? q(`SELECT * FROM progress WHERE knowledge_id IN (${knowledge.map(() => '?').join(',')})`, ...knowledge.map((k) => k.id)) : [] };
    const label = `Recording from ${rec.created_at.slice(0, 16).replace('T', ' ')} UTC (${(rec.bytes / 1e6).toFixed(1)} MB) with ${questions.length} question${questions.length === 1 ? '' : 's'} and ${knowledge.length} knowledge record${knowledge.length === 1 ? '' : 's'}`;
    const trashId = toTrash(rec.session_id, 'recording', label, rows, [rec.file]);
    ev(rec.session_id, 'recording_deleted', label + ' — in Recently deleted');
    res.json({ ok: true, trashId, questions: questions.length, knowledge: knowledge.length, approved: knowledge.filter((k) => k.status === 'approved').length });
  });
  // Recently deleted: restore, or remove for good. Items are purged automatically after TRASH_DAYS.
  app.post('/api/trash/:id/restore', M, own('trash'), (req, res) => {
    const t = q1('SELECT * FROM trash WHERE id=?', req.params.id); if (!t) return res.status(404).json({ error: 'Not found (it may have been purged).' });
    restoreTrash(t); ev(t.session_id, 'restored', t.label); res.json({ ok: true });
  });
  app.delete('/api/trash/:id', M, own('trash'), (req, res) => {
    const t = q1('SELECT * FROM trash WHERE id=?', req.params.id); if (!t) return res.status(404).json({ error: 'Not found' });
    dropTrash(t.id); ev(t.session_id, 'deleted_forever', t.label); res.json({ ok: true });
  });
  // A moment the master adds by hand (its description ends in 。 when written in Japanese).
  app.post('/api/recordings/:id/moments', M, own('recordings'), (req, res) => {
    const rec = q1('SELECT * FROM recordings WHERE id=?', req.params.id); const { t, text } = req.body || {};
    if (!rec) return res.status(404).json({ error: 'Not found' });
    if (!(t >= 0) || typeof text !== 'string' || !text.trim()) return res.status(400).json({ error: 'Time (seconds) and a description of what is visible are required.' });
    addMoment(rec, Math.floor(t), text.trim().slice(0, 300).replace(/[.。]?$/, isJapanese(text) ? '。' : '.'), '', 'manual'); ev(rec.session_id, 'moment_added', mmss(t)); res.status(201).json({ ok: true });
  });
  app.get('/f/:kind/:id', (req, res) => {
    const { kind, id } = req.params, { exp, sig } = req.query;
    if (!/^[a-f0-9]{16}$/.test(id) || !(+exp > Date.now()) || !safeEq(sig || '', sign(`${kind}|${id}|${exp}`))) return res.status(403).send('Link invalid or expired.');
    const f = filePath(kind, id); if (!f || !fs.existsSync(f.p)) return res.status(404).send('Not found');
    res.type(f.mime).sendFile(f.p, { headers: { 'Cache-Control': 'private, no-store' } });
  });

  // questions → knowledge (master)
  // A question the master does not want: remove it (only while unanswered — answers become knowledge).
  app.delete('/api/questions/:id', M, own('questions'), (req, res) => {
    const qu = q1('SELECT * FROM questions WHERE id=?', req.params.id); if (!qu) return res.status(404).json({ error: 'Not found' });
    if (qu.status !== 'open') return res.status(409).json({ error: 'This question is already answered. Delete or reject its knowledge record instead.' });
    const trashId = toTrash(qu.session_id, 'question', `Question at ${mmss(qu.t)}: ${qu.text.replace(/^At \d+:\d+ — /, '').slice(0, 120)}`, { questions: [qu], observations: q('SELECT * FROM observations WHERE id=?', qu.observation_id) });
    ev(qu.session_id, 'question_removed', mmss(qu.t)); res.json({ ok: true, trashId });
  });
  // "Ask differently": fresh candidates for the same moment, judged again, excluding the current wording.
  const rephrasing = new Set();
  app.post('/api/questions/:id/rephrase', M, own('questions'), A(async (req, res) => {
    const qu = q1('SELECT * FROM questions WHERE id=?', req.params.id); if (!qu) return res.status(404).json({ error: 'Not found' });
    if (qu.status !== 'open') return res.status(409).json({ error: 'Only unanswered questions can be rewritten.' });
    if (rephrasing.has(qu.id)) return res.status(409).json({ error: 'Already writing a new question for this moment.' });
    try { aiReady('ask'); } catch (e) { return res.status(503).json({ error: e.message }); }
    const rec = q1('SELECT * FROM recordings WHERE id=?', qu.recording_id); if (!rec) return res.status(404).json({ error: 'The recording for this question was deleted.' });
    rephrasing.add(qu.id); const dir = path.join(C.dir, 'tmp', 'rq-' + qu.id); fs.mkdirSync(dir, { recursive: true });
    try {
      const grab = async (t, f) => { await run$('ffmpeg', ['-v', 'error', '-y', '-ss', String(Math.max(0, t)), '-i', path.join(C.dir, rec.file), '-frames:v', '1', '-vf', `scale=${C.aiFrameW}:-2`, path.join(dir, f)], 60000); return fs.readFileSync(path.join(dir, f)); };
      const img = await grab(qu.t, 'now.jpg'), prev = qu.t >= 3 ? await grab(qu.t - 3, 'prev.jpg').catch(() => null) : null;
      const ob = q1('SELECT * FROM observations WHERE id=?', qu.observation_id), action = String(ob?.text || '').replace(/^the footage shows:\s*/i, '').replace(/\.$/, '');
      const timeline = q('SELECT t,text FROM observations WHERE recording_id=? ORDER BY t', rec.id).map((o) => ({ t: o.t, action: o.text.replace(/^the footage shows:\s*/i, '').slice(0, 140) }));
      const asked = q('SELECT text FROM questions WHERE recording_id=? ORDER BY t', rec.id).map((x) => x.text.replace(/^At \d+:\d+ — /, '').slice(0, 200));
      const start = Math.floor(Math.random() * FOCI.length);
      const r = await askAbout(craftContext(qu.session_id), { t: qu.t, action, objects: '', change: '', img, prev, lang: langOf(qu.session_id) }, timeline, [0, 1, 2].map((k) => FOCI[(start + k) % FOCI.length]), asked);
      if (!r.question) return res.status(422).json({ error: 'The AI could not come up with a better question for this moment. Remove it, or answer it as it is.' });
      const text = `At ${mmss(qu.t)} — ${r.question}`; run('UPDATE questions SET text=?, text_en=? WHERE id=?', text, r.en || null, qu.id);
      ev(qu.session_id, 'question_rewritten', mmss(qu.t)); res.json({ ok: true, text });
    } finally { rephrasing.delete(qu.id); fs.rmSync(dir, { recursive: true, force: true }); }
  }));
  app.post('/api/questions/:id/answer', M, own('questions'), (req, res) => {
    const qu = q1('SELECT * FROM questions WHERE id=?', req.params.id), text = req.body?.text;
    if (!qu) return res.status(404).json({ error: 'Not found' });
    if (typeof text !== 'string' || !text.trim() || text.length > 4000) return res.status(400).json({ error: 'An answer (max 4000 characters) is required.' });
    const ob = q1('SELECT text FROM observations WHERE id=?', qu.observation_id); const id = rid();
    run("INSERT INTO knowledge(id,session_id,question_id,recording_id,t,observed,verbatim,summary,cues,warnings,step,tool,status,approved_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", id, qu.session_id, qu.id, qu.recording_id, qu.t, ob?.text || '', text.trim(), '', '', '', '', '', 'draft', null, now());
    run("UPDATE questions SET status='answered' WHERE id=?", qu.id); ev(qu.session_id, 'answer_saved', mmss(qu.t)); res.status(201).json({ id, aiDrafting: startDraft(id) });
  });
  app.post('/api/knowledge/:id/ai-fill', M, own('knowledge'), (req, res) => {
    const k = q1('SELECT * FROM knowledge WHERE id=?', req.params.id); if (!k) return res.status(404).json({ error: 'Not found' });
    if (k.status === 'approved') return res.status(409).json({ error: 'This record is already approved. Edit it by hand, or mark it "Needs clarification" first.', code: 'approved' });
    if (k.ai_draft === 'drafting') return res.status(409).json({ error: 'The AI is already filling this record.', code: 'drafting' });
    if (!k.verbatim.trim()) return res.status(400).json({ error: 'Add the expert\'s words first — the AI only works from them.' });
    try { aiReady('draft'); } catch (e) { return res.status(503).json({ error: e.message }); }
    res.status(202).json({ ok: startDraft(k.id) });
  });
  app.patch('/api/knowledge/:id', M, own('knowledge'), (req, res) => {
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
  // An unwanted knowledge record: to the recycle bin; its question opens again so it can be re-answered.
  app.delete('/api/knowledge/:id', M, own('knowledge'), (req, res) => {
    const k = q1('SELECT * FROM knowledge WHERE id=?', req.params.id); if (!k) return res.status(404).json({ error: 'Not found' });
    if (k.ai_draft === 'drafting') return res.status(409).json({ error: 'The AI is still filling this record. Try again in a few seconds.' });
    const trashId = toTrash(k.session_id, 'knowledge', `Knowledge record (${k.status}): “${k.verbatim.slice(0, 100)}”`, { knowledge: [k], progress: q('SELECT * FROM progress WHERE knowledge_id=?', k.id) });
    syncQuestions([k.question_id]); ev(k.session_id, 'knowledge_deleted', mmss(k.t)); res.json({ ok: true, trashId });
  });
  app.get('/api/knowledge', (req, res) => {
    // A student invite wins over a master cookie, so a master previewing the student page sees exactly what students see.
    const tk = tokOf(req), m = !tk && isMaster(req); if (!m && !tk) return res.status(401).json({ error: 'Not signed in.' });
    const sid = m ? req.query.session : tk.session_id; if (!sid) return res.status(400).json({ error: 'session required' });
    if (m && !canSee(m, sid)) return res.status(404).json({ error: 'Not found' });
    const t = String(req.query.q || '').trim();
    res.json(t ? search(sid, t, !m) : q(`SELECT * FROM knowledge WHERE session_id=? ${m ? '' : "AND status='approved'"} ORDER BY created_at DESC`, sid).map((k) => ({ ...k, clip: clipOf(k) })));
  });

  // apprentice
  // Read-aloud in the student's interface language: a tip written in the other language is translated first (cached).
  const SAY = (ctx, text, ja) => `Translate this guidance from a master craftsperson to an apprentice into ${ja ? 'natural, polite Japanese (です/ます調)' : 'clear, natural English'}.
${ctx}
Use the established craft terms in both languages (for example: はんだごて / こて = soldering iron, こて先 = iron tip, はんだ = solder, フラックス = flux, 基板 = circuit board, 漆 = urushi lacquer, 玉鋼 = tamahagane, 針金かけ = wiring). Keep every instruction, number and warning; add nothing.
Text: """${text}"""
Return JSON {"text":string}.`;
  const sayCache = new Map();
  app.post('/api/say', P('apprentice'), A(async (req, res) => {
    const text = String(req.body?.text || '').replace(/\s+/g, ' ').trim().slice(0, 600), lang = req.body?.lang === 'ja' ? 'ja' : 'en';
    if (!text) return res.status(400).json({ error: 'text required' });
    if (isJapanese(text) === (lang === 'ja')) return res.json({ text, translated: false });
    const key = lang + '|' + text; if (sayCache.has(key)) return res.json({ text: sayCache.get(key), translated: true });
    try { aiReady('say'); } catch (e) { return res.status(503).json({ error: e.message, code: 'ai_unavailable' }); }
    try {
      const out = String(JSON.parse((await ai('say', SAY(craftContext(req.tok.session_id), text, lang === 'ja'))).out).text || '').trim().slice(0, 800);
      if (!out || isJapanese(out) !== (lang === 'ja')) throw new Error('translation came back in the wrong language');
      sayCache.set(key, out); if (sayCache.size > 300) sayCache.delete(sayCache.keys().next().value);
      res.json({ text: out, translated: true });
    } catch (e) { res.status(502).json({ error: 'Could not translate for read-aloud: ' + String(e.message).slice(0, 160), code: 'translate_failed' }); }
  }));
  app.post('/api/practice/start', P('apprentice'), consented, (req, res) => { if (!sessionSkill(q1(`SELECT ${SESSION_SKILL_COLS} FROM sessions WHERE id=?`, req.tok.session_id))) return res.status(409).json(NO_PROFILE); const id = rid(); run('INSERT INTO practice(id,session_id,started_at) VALUES(?,?,?)', id, req.tok.session_id, now()); ev(req.tok.session_id, 'practice_started'); res.status(201).json({ id }); });
  app.post('/api/practice/:id/end', P('apprentice'), (req, res) => { const p = q1('SELECT * FROM practice WHERE id=? AND session_id=?', req.params.id, req.tok.session_id); if (!p) return res.status(404).json({ error: 'Not found' }); run('UPDATE practice SET ended_at=COALESCE(ended_at,?) WHERE id=?', now(), p.id); ev(p.session_id, 'practice_ended'); res.json({ ok: true }); });
  const lastAt = new Map();
  app.post('/api/practice/:id/snapshot', P('apprentice'), consented, raw(Math.ceil(C.maxFrameKb / 1024) + 1), (req, res) => {
    const p = q1('SELECT * FROM practice WHERE id=? AND session_id=?', req.params.id, req.tok.session_id);
    if (!p || p.ended_at) return res.status(404).json({ error: 'No active practice session.' });
    const b = req.body, manual = req.query.manual === '1';
    if (!Buffer.isBuffer(b) || b.length > C.maxFrameKb * 1024 || !isJpeg(b)) return res.status(400).json({ error: `Snapshot must be a JPEG under ${C.maxFrameKb} KB.` });
    if (busy.has(p.id)) return res.status(202).json({ queued: false, reason: 'previous check still running' });
    if (progress.size) return res.status(202).json({ queued: false, reason: 'The local AI is busy analysing a master recording. Photo checks resume when it finishes — ask the master if you need help now.' });
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
    openHelp(req.tok.session_id, pr?.id || null, text, '', null, null, learnerOf(req)); res.json({ answers: [], helpRequested: true });
  });
  app.post('/api/help', P('apprentice'), consented, (req, res) => {
    const text = String(req.body?.question || '').trim().slice(0, 500) || 'The student asked for help.';
    const pr = q1('SELECT * FROM practice WHERE session_id=? AND ended_at IS NULL ORDER BY started_at DESC', req.tok.session_id);
    const a = pr && q1('SELECT id FROM assessments WHERE practice_id=? ORDER BY created_at DESC', pr.id);
    const fr = pr?.frame_file && fs.existsSync(path.join(C.dir, pr.frame_file)) ? fs.readFileSync(path.join(C.dir, pr.frame_file)) : null;
    res.status(201).json({ id: openHelp(req.tok.session_id, pr?.id || null, text, a ? q1('SELECT stage FROM assessments WHERE id=?', a.id).stage : '', fr, a?.id, learnerOf(req)) });
  });
  // Each student sees only their own questions to the master (and the master's replies to them).
  app.get('/api/help', P('apprentice'), (req, res) => res.json(q('SELECT id,question,status,created_at FROM help WHERE session_id=? AND learner=? ORDER BY created_at DESC LIMIT 20', req.tok.session_id, learnerOf(req) || '-').map((h) => ({ ...h, replies: q('SELECT id,text,created_at FROM replies WHERE help_id=? ORDER BY created_at', h.id) }))));
  app.post('/api/help/:id/reply', M, own('help'), (req, res) => {
    const h = q1('SELECT * FROM help WHERE id=?', req.params.id), text = String(req.body?.text || '').trim().slice(0, 1000);
    if (!h) return res.status(404).json({ error: 'Not found' }); if (!text) return res.status(400).json({ error: 'Reply text required.' });
    run('INSERT INTO replies VALUES(?,?,?,?)', rid(), h.id, text, now()); run("UPDATE help SET status='answered' WHERE id=? AND status='pending'", h.id); ev(h.session_id, 'help_answered'); emit(h.session_id, 'help'); res.status(201).json({ ok: true });
  });
  // "Suggest a reply": the AI drafts an answer to a student's question from APPROVED records only; the master edits and sends it.
  const REPLY = (ctx, question, stage, records, ja) => `You help a master craftsperson reply to an apprentice's question during practice.
${ctx}
The apprentice asked: """${question}"""${stage ? `\nWhat the apprentice was doing: ${stage}` : ''}
The master's APPROVED records (the only facts you may use):
${records.map((k) => `[${k.id}] ${k.step ? k.step + ': ' : ''}${k.summary || k.verbatim}${k.cues ? ' | Cues: ' + k.cues : ''}${k.warnings ? ' | Warnings: ' + k.warnings : ''}`).join('\n').slice(0, 6000)}

Write the reply the master could send: 1-3 short, warm, practical sentences addressed to the apprentice as "you", ${ja ? 'in natural polite Japanese (です/ます調)' : 'in English'}. Use ONLY what the records say; never add techniques, numbers or safety claims they do not contain. If no record answers the question, return "" as the reply so the master answers in their own words. List the ids of the records you used.
Return JSON {"reply":string,"knowledge_ids":[string]}.`;
  app.post('/api/help/:id/suggest', M, own('help'), A(async (req, res) => {
    const h = q1('SELECT * FROM help WHERE id=?', req.params.id); if (!h) return res.status(404).json({ error: 'Not found' });
    try { aiReady('reply'); } catch (e) { return res.status(503).json({ error: e.message }); }
    const kn = approved(h.session_id);
    if (!kn.length) return res.json({ reply: '', knowledge_ids: [], reason: 'no_records' });
    // The records that share words with the question go first (bigrams make this work for Japanese too).
    const rel = search(h.session_id, `${h.question} ${h.step || ''}`), ids = new Set(rel.map((k) => k.id)), list = [...rel, ...kn.filter((k) => !ids.has(k.id))].slice(0, 12);
    try {
      const { out, engine } = await ai('reply', REPLY(craftContext(h.session_id), h.question, h.step, list, isJapanese(h.question) || langOf(h.session_id) === 'ja'));
      const j = JSON.parse(out), known = new Set(kn.map((k) => k.id));
      res.json({ reply: typeof j.reply === 'string' ? j.reply.trim().slice(0, 1000) : '', knowledge_ids: (Array.isArray(j.knowledge_ids) ? j.knowledge_ids : []).filter((x) => known.has(x)), engine });
    } catch (e) { res.status(502).json({ error: 'The AI could not suggest a reply: ' + String(e.message).slice(0, 200) }); }
  }));
  app.patch('/api/help/:id', M, own('help'), (req, res) => {
    const h = q1('SELECT * FROM help WHERE id=?', req.params.id); if (!h) return res.status(404).json({ error: 'Not found' });
    if (!['pending', 'answered', 'resolved', 'rejected', 'escalated'].includes(req.body?.status)) return res.status(400).json({ error: 'Invalid status' });
    run('UPDATE help SET status=? WHERE id=?', req.body.status, h.id); ev(h.session_id, 'help_' + req.body.status); emit(h.session_id, 'help'); res.json({ ok: true });
  });
  app.delete('/api/help/:id', M, own('help'), (req, res) => {
    const h = q1('SELECT * FROM help WHERE id=?', req.params.id); if (!h) return res.status(404).json({ error: 'Not found' });
    const trashId = toTrash(h.session_id, 'help', `Help request: “${String(h.question).slice(0, 100)}”`, { help: [h], replies: q('SELECT * FROM replies WHERE help_id=?', h.id) }, [h.frame_file]);
    ev(h.session_id, 'help_deleted'); emit(h.session_id, 'help'); res.json({ ok: true, trashId });
  });
  app.post('/api/help/:id/convert-to-knowledge', M, own('help'), (req, res) => {
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
    ev(h.session_id, 'knowledge_draft_from_help', kid); startDraft(kid);
    emit(h.session_id, 'help');
    res.status(201).json({
      knowledgeId: kid,
      status: 'draft',
      message: 'Answer saved as draft knowledge. Please review, add decision cues and warnings, and click Approve before it can be used by apprentices.'
    });
  });

  app.get('/api/stream', (req, res) => {
    // A phone's invite wins over a master cookie in the same browser, so the phone page gets its own session's events.
    const tk = tokOf(req), m = tk ? false : isMaster(req); if (!m && !tk) return res.status(401).end();
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' }); res.flushHeaders(); res.write('retry: 3000\n\n');
    const c = { res, master: m, sid: tk?.session_id }; clients.add(c); const hb = setInterval(() => res.write(': hb\n\n'), 20000);
    req.on('close', () => { clients.delete(c); clearInterval(hb); });
  });

  // Fonts (versioned file names) and artwork never change between visits, so phones may cache them; pages and scripts stay no-store.
  app.use(express.static(fileURLToPath(new URL('./public', import.meta.url)), { extensions: ['html'], setHeaders: (res, p) => {
    if (/[\\/]fonts[\\/]/.test(p)) res.set('Cache-Control', 'public, max-age=31536000, immutable');
    else if (/[\\/]img[\\/]|favicon\.ico$/.test(p)) res.set('Cache-Control', 'public, max-age=86400');
  } })); // fileURLToPath: .pathname keeps %20 for spaces in the install path
  app.use((err, req, res, next) => { // safe errors only
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'File too large for the configured limit.' });
    console.error('[error]', err.message); res.status(500).json({ error: 'Something went wrong. Please retry.' });
  });
  app.close = () => { clearInterval(purgeTimer); clearInterval(tunnelTimer); clearInterval(healTimer); for (const c of clients) c.res.end(); db.close(); };
  return app;
}
