import { $, esc, mmss, api, announce, stream, ICON, icon, authForm, signOut, whoHtml, store, connDot, t, tn } from '/common.js';
import { initFx } from '/fx.js';
import { initLang, onLang, LANG, trServer, when } from '/i18n.js';
initLang(); initFx();
const app = $('#app'); let sid = null, D = null, es = null, online = false, timer = null, me = null, redrawAuth = null;
// Skill profiles come only from the server (GET /api/skills, /api/skills/:id), in the interface language.
let LK = null, stt = false, ai = false, skills = null, skillsErr = null, sessions = [], pick = { skill: null, task: null }, draftTitle = '', created = null, flash = null;
let prof = {}, profErr = {}; const converting = new Set(), convBlocked = {}, convErr = {}, rewriting = new Set();
// The open knowledge record (side panel) and the knowledge library filter.
let panelK = null, kFilter = 'all';
// Speech language for 🎤: Japanese stays Japanese; translation only when chosen.
// Speech input follows the interface language (Japanese → Japanese text, English → English text) unless the master picks another mode.
let sttMode = ((s) => (s === 'auto' || s === 'translate' ? s : LANG))(store.get('stt'));
const SESSION_LANGS = () => ({ en: t('English'), ja: t('Japanese (日本語)') });

const badge = (txt, cls) => `<span class="badge ${cls}">${txt}</span>`;
const hst = () => ({ pending: [t('● Pending'), 'b-bad'], answered: [t('✓ Answered'), 'b-warn'], resolved: [t('✓ Resolved'), 'b-ok'], rejected: [t('✕ Rejected'), 'b-off'], escalated: [t('▲ Escalated'), 'b-bad'] });
const kst = () => ({ draft: [t('○ Draft'), 'b-warn'], approved: [t('✓ Approved'), 'b-ok'], rejected: [t('✕ Rejected'), 'b-bad'], clarify: [t('? Needs clarification'), 'b-warn'] });
const kBadge = (k) => { const [a, c] = kst()[k.status] || [esc(k.status), 'b-off']; return badge(a, c); };
const studentLabel = (l) => String(l || '').replace(/^Student (\d+)$/, (m, n) => t('Student {n}', { n }));

// Like common.js api(), but keeps the HTTP status and error `code`: conversion eligibility depends on 409 codes.
const req = (path, o = {}) => api(path, o);

// Bundled, licensed photos (public/img, see CREDITS.txt); a profile without one just shows its icon.
const PHOTO = new Set(['soldering', 'bonsai', 'kintsugi', 'katana', 'custom']);
const credits = () => `<p class="credits">${t('Images via Wikimedia Commons:')} <i>The Great Wave off Kanagawa</i>, Katsushika Hokusai (public domain) · “Soldering workbench” by Windell Oskay (CC BY 2.0) · “Bonsai Tree” by Rennett Stowe (CC BY 2.0). <a href="/img/CREDITS.txt">${t('Sources & licences')}</a></p>`;
const scls = (id) => (ICON[id] ? 's-' + id : '');
// Legacy rows without skill_id are served as soldering by the backend (column DEFAULT), so the label matches what the phones receive.
const skillIdOf = (s) => s.skill_id || 'soldering';
// A master-defined skill carries its own name (from the session); bundled ones come from the profile list.
function skillBadge(id, name) {
  if (id === 'custom') return `<span class="skill-badge s-custom"><span class="ico">${icon('custom')}</span><span>${esc(name || t('Custom skill'))}</span></span>`;
  const s = skills?.find((x) => x.id === id);
  if (s) return `<span class="skill-badge ${scls(id)}"><span class="ico">${icon(id)}</span><span>${esc(s.name)}</span></span>`;
  if (!skills) return `<span class="skill-badge"><span class="ico">${ICON.other}</span><span>${esc(name || id)}</span></span>`;
  return `<span class="skill-badge s-unknown" title="${t('This profile is not installed on the server; phones cannot join this session safely.')}"><span class="ico">${ICON.other}</span><span>${t('⚠ Unknown profile: {id}', { id: esc(id) })}</span></span>`;
}
const procHtml = (p) => {
  const ls = String(p || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (!ls.length) return `<p class="empty">${t('No procedure provided.')}</p>`;
  return ls.length > 1 || /^\d+[.)]\s/.test(ls[0]) ? `<ol class="procedure">${ls.map((l) => `<li>${esc(l.replace(/^\d+[.)]\s*/, ''))}</li>`).join('')}</ol>` : `<p class="pre">${esc(ls[0])}</p>`;
};
const toolsHtml = (tools) => (tools?.length ? `<ul class="tools">${tools.map((x) => `<li><strong>${esc(x.name)}</strong>${x.purpose ? `<span>${esc(x.purpose)}</span>` : ''}</li>`).join('')}</ul>` : `<p class="empty">${t('No tools listed in this profile.')}</p>`);
const safetyItem = (s) => { const m = String(s).match(/^(.{1,40}?)([:：])\s*(.*)$/); return m ? `<b>${esc(m[1] + m[2])}</b> ${esc(m[3])}` : esc(s); };
const emptyArt = (msg) => `<div class="empty-art"><svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M20 34V22c0-3-3-4-6-5"/><path d="M20 24c3-1 6-2 7-5"/><ellipse cx="13" cy="14" rx="7" ry="4"/><ellipse cx="27" cy="16" rx="6" ry="3.5"/><ellipse cx="20" cy="8" rx="6" ry="3.2"/><path d="M10 34h20"/></svg><p class="empty">${msg}</p></div>`;

// ---- sticky section navigation ----
// The header and section bar stay at the top; sections scroll smoothly under them (scroll-margin uses this height).
const setStickyH = () => document.documentElement.style.setProperty('--sticky-h', ($('#sticky-top')?.offsetHeight || 0) + 'px');
window.addEventListener('resize', setStickyH);
function renderNav() {
  const n = $('#dnav'); if (!n) return;
  if (!me) { n.innerHTML = ''; n.hidden = true; setStickyH(); return; }
  const last = store.get('lastSession'), lastOk = last && sessions.some((s) => s.id === last);
  const open = D ? D.questions.filter((x) => x.status === 'open').length : 0, verify = D ? D.knowledge.filter((k) => k.status === 'draft' || k.status === 'clarify').length : 0, pend = D ? D.help.filter((h) => h.status === 'pending').length : 0;
  const a = (id, label, extra = '') => `<a href="#${id}" data-nav="${id}">${label}${extra}</a>`;
  n.hidden = false;
  n.innerHTML = `<div class="dnav-in">${a('sec-sessions', t('Sessions'))}${a('sec-new', t('New session'))}
  ${D ? `<a href="#sec-live" class="live" data-nav="sec-live">▶ ${t('Live session')}: <b>${esc(D.session.title)}</b></a>${a('sec-rec', t('Recordings'))}${a('sec-q', t('Questions'), open ? ` <span class="n">${open}</span>` : '')}${a('sec-k', t('Knowledge'), verify ? ` <span class="n">${verify}</span>` : '')}${a('sec-help', t('Help'), pend ? ` <span class="n bad">${pend}</span>` : '')}${a('sec-students', t('Students'))}${D.trash?.length ? a('sec-trash', t('Recently deleted')) : ''}`
    : lastOk ? `<button type="button" class="live" data-a="golive">▶ ${t('Go to live dashboard')}</button>` : ''}</div>`;
  setStickyH();
}

async function boot() {
  try { me = await api('/api/me'); } catch { me = null; renderNav(); return login(); }
  await list();
  // /dashboard#live opens the session the master last worked on.
  const last = store.get('lastSession');
  if (location.hash === '#live' && last && sessions.some((s) => s.id === last)) open(last);
}
function login() {
  redrawAuth = authForm(app, { text: () => ({ eyebrow: t('師匠 · Master'), title: t('MENTO · Master sign-in'), intro: t('Experience becomes expertise. Sign in to review questions and approve knowledge, or create your master account.') }), onDone: boot });
}
async function list() {
  redrawAuth = null;
  const ss = await api('/api/sessions'); me = await api('/api/me'); sessions = ss; stt = !!me.sttConfigured; ai = !!me.aiConfigured;
  if (!es) es = stream('/api/stream', (m) => { if (m.type === 'analysis_progress') return onProgress(m); if (m.sid === sid || m.type === 'deleted') refreshSoon(); }, (o) => { online = o; announce(o ? t('Live updates connected') : t('Live updates disconnected')); side(); });
  app.innerHTML = `<section class="hero compact" aria-labelledby="hero-t" data-sticker-box><div class="stickers app-stickers" aria-hidden="true"><span class="sticker s-red" style="--x:58%;--y:16%;--r:-7deg"><b>問</b><span>${t('Asks why')}</span></span><span class="sticker s-ink" style="--x:74%;--y:62%;--r:6deg"><b>承</b><span>${t('You approve')}</span></span></div><div><span class="eyebrow">${t('技能を受け継ぐ · Passing down skills')}</span><h1 id="hero-t">${t('Preserve what your hands know.')}</h1><p>${t('Manuals explain the standard steps. MENTO captures what they leave out: your reasons, instincts and techniques, in your own words.')}</p><p>${whoHtml(me)}</p>
  <div class="stats"><div class="stat"><b>${ss.length}</b><span>${tn(ss.length, 'session', 'sessions')}</span></div><div class="stat"><b id="st-skills">…</b><span>${t('skill profiles')}</span></div><div class="stat"><b>${me.aiConfigured ? t('On') : t('Off')}</b><span>${t('local AI')}</span></div></div></div><span class="petal" aria-hidden="true"></span><span class="petal" aria-hidden="true"></span><span class="petal" aria-hidden="true"></span></section>
  <div class="split"><section class="card" id="sec-new" aria-labelledby="ns"><span class="eyebrow">${t('新しい稽古 · New session')}</span><h2 id="ns">${t('Create a learning session')}</h2>
  <form id="nf"><label for="t">${t('Session title')} <span class="hint">${t('(required)')}</span></label><input id="t" required maxlength="120" placeholder="${t('e.g. Saturday demo — first attempt')}" aria-describedby="t-h"><p id="t-h" class="hint">${t('Names this session on the dashboard and both phones. It is separate from the task below.')}</p>
  <fieldset aria-describedby="sk-st"><legend>${t('Choose a skill')}</legend><div id="skills" class="skill-pick"></div><div id="sk-st" class="hint" aria-live="polite"></div></fieldset>
  <label for="task">${t('Choose a task')}</label><select id="task" disabled required aria-describedby="task-h"><option value="">${t('Select a skill first')}</option></select><p id="task-h" class="hint">${t('Tasks come from the selected skill profile.')}</p>
  <div id="brief" aria-live="polite"></div>
  <div id="edit" hidden><div class="field-row"><label for="k">${t('Task title for this session')} <span id="k-ed" class="edited" hidden>${t('Edited')}</span></label><button type="button" class="linkbtn" data-reset="k">${t('Reset to template')}</button></div><input id="k" maxlength="1000">
  <div class="field-row"><label for="p">${t('Procedure')} <span id="p-ed" class="edited" hidden>${t('Edited')}</span></label><button type="button" class="linkbtn" data-reset="p">${t('Reset to template')}</button></div><textarea id="p" rows="7" maxlength="4000"></textarea>
  <p class="hint">${t('Pre-filled from the task template — review or adjust for this session.')}</p></div>
  <label for="lang">${t('Language of AI questions, lessons and read-aloud')}</label><select id="lang">${Object.entries(SESSION_LANGS()).map(([v, n]) => `<option value="${v}"${v === LANG ? ' selected' : ''}>${n}</option>`).join('')}</select><p class="hint">${t('The AI asks its questions, drafts records and gives photo feedback in this language; students hear lessons read aloud in it.')}</p>
  <div class="form-actions"><button class="btn primary" id="create" disabled>${t('Create session')}</button><span id="create-h" class="hint">${t('Choose a skill and task first.')}</span></div><div id="err" role="alert" class="notice bad"></div></form></section>
  <section class="card" id="sec-sessions" aria-labelledby="ls"><span class="eyebrow">${t('稽古 · Sessions')}</span><h2 id="ls">${t('Your sessions')}</h2><div id="slist"></div>
  <p class="hint">${aiLine()} ${!stt && !me.aiEngines?.cloud?.stt ? t('Spoken answers: off (speech-to-text not set up).') : me.aiEngines?.cloud?.stt ? t('Spoken answers: on (cloud speech-to-text, this computer as fallback).') : t('Spoken answers: on (transcribed on this computer).')} ${t('Retention: {n} days.', { n: esc(me.limits.retentionDays) })}</p></section></div><div id="sess"></div>${credits()}`;
  $('#t').value = draftTitle;
  $('#nf').onsubmit = createSession;
  renderSessions(); renderNav(); loadSkills();
  if (sid && ss.some((s) => s.id === sid)) open(sid, true);
}

// ---- new-session form: skill → task → editable defaults ----
async function loadSkills() {
  if (!skills) {
    if ($('#skills')) { $('#skills').innerHTML = '<div class="skel" style="height:4.2rem"></div><div class="skel" style="height:4.2rem"></div>'; $('#sk-st').textContent = t('Loading skill profiles…'); }
    try { skills = (await api('/api/skills')).skills; skillsErr = null; if (!Array.isArray(skills)) throw new Error(t('Unexpected response from the server.')); } catch (e) { skills = null; skillsErr = e.message; }
  }
  if (!$('#skills')) return;
  renderSkills(); renderSessions();
  if (D) render();
}
function renderSkills() {
  const box = $('#skills'), st = $('#sk-st'); $('#st-skills').textContent = skills ? skills.length : '—';
  if (skillsErr) { box.innerHTML = `<div class="notice bad" role="alert"><strong>${t('Could not load skill profiles from the server.')}</strong>${esc(skillsErr)}<div class="row" style="margin-top:.5rem"><button type="button" class="btn" data-a="retry-skills">${t('Retry')}</button></div></div>`; st.textContent = ''; return renderTask(); }
  if (!skills.length) { box.innerHTML = `<div class="notice warn" role="alert"><strong>${t('No skill profiles are installed on the server.')}</strong>${t('Add a manifest under skills/ and restart the server.')}</div>`; st.textContent = ''; return renderTask(); }
  if (pick.skill && pick.skill !== 'custom' && !skills.some((s) => s.id === pick.skill)) pick = { skill: null, task: null };
  box.innerHTML = skills.map((s) => `<label class="skill-opt${PHOTO.has(s.id) ? ' has-photo' : ''}"><input type="radio" name="skill" value="${esc(s.id)}"${s.id === pick.skill ? ' checked' : ''}>${PHOTO.has(s.id) ? `<span class="photo p-${s.id}" aria-hidden="true"></span>` : ''}<span class="ico">${icon(s.id)}</span><span><b>${esc(s.name)}</b><small>${esc(s.category)}</small><span class="meta">${t('{a} tasks · {b} tools', { a: esc(s.taskCount), b: esc(s.toolCount) })}</span></span><span class="chk" aria-hidden="true">${t('✓ Selected')}</span></label>`).join('')
    + `<label class="skill-opt has-photo"><input type="radio" name="skill" value="custom"${pick.skill === 'custom' ? ' checked' : ''}><span class="photo p-custom" aria-hidden="true"></span><span class="ico">${icon('custom')}</span><span><b>${t('Another skill')}</b><small>${t('Define your own')}</small><span class="meta">${t('Any hands-on craft')}</span></span><span class="chk" aria-hidden="true">${t('✓ Selected')}</span></label>`;
  st.textContent = pick.skill ? '' : t('{n} profiles available. Choose one to see its tasks.', { n: skills.length });
  renderTask();
}
async function profile(id) {
  const key = LANG + ':' + id;
  if (!prof[key]) {
    try { const p = await api('/api/skills/' + encodeURIComponent(id)); if (p?.id !== id || !Array.isArray(p.tasks)) throw new Error(t('The server returned a different or malformed profile.')); prof[key] = p; delete profErr[key]; } catch (e) { profErr[key] = e.message; }
  }
  return prof[key];
}
const curProf = () => prof[LANG + ':' + pick.skill], curErr = () => profErr[LANG + ':' + pick.skill];
async function selectSkill(id) {
  pick = { skill: id, task: null }; renderTask();
  if (id === 'custom') return;
  await profile(id);
  if (pick.skill !== id || !$('#task')) return; // a newer selection won
  renderTask(); const p = curProf(); if (p) announce(t('{name} selected. {n} tasks available.', { name: p.name, n: p.tasks.length })); else announce(t('Skill profile failed to load'));
}
function renderTask() {
  const sel = $('#task'), brief = $('#brief'), edit = $('#edit'); if (!sel) return;
  const id = pick.skill, p = id && curProf();
  const off = (msg, html = '') => { sel.disabled = true; sel.innerHTML = `<option value="">${msg}</option>`; brief.innerHTML = html; edit.hidden = true; ready(); };
  sel.closest('form').querySelector('label[for=task]').hidden = sel.hidden = $('#task-h').hidden = id === 'custom';
  if (id === 'custom') {
    // Any craft: the master describes it; the AI's questions and the students' safety notes are built from this.
    sel.disabled = true; edit.hidden = true;
    if (!$('#cu')) brief.innerHTML = `<div class="brief" id="cu"><h3>${skillBadge('custom', t('Your own skill'))}</h3>
    <label for="cu-n">${t('Skill name')} <span class="hint">${t('(required)')}</span></label><input id="cu-n" maxlength="80" placeholder="${t('e.g. Woodturning, Calligraphy, Bread baking')}">
    <label for="cu-d">${t('Short description')}</label><input id="cu-d" maxlength="400" placeholder="${t('What the skill is about')}">
    <label for="cu-t">${t('Task to demonstrate')} <span class="hint">${t('(required)')}</span></label><input id="cu-t" maxlength="1000" placeholder="${t('e.g. Turn a small wooden bowl')}">
    <label for="cu-tools">${t('Tools')} <span class="hint">${t('(one per line, optionally “name — purpose”)')}</span></label><textarea id="cu-tools" rows="3"></textarea>
    <label for="cu-s">${t('Safety notes')} <span class="hint">${t('(one per line; shown on both phones)')}</span></label><textarea id="cu-s" rows="3"></textarea>
    <label for="cu-p">${t('Steps')} <span class="hint">${t('(optional, one per line)')}</span></label><textarea id="cu-p" rows="4"></textarea>
    <p class="hint">${t('The AI uses this description to ask detailed questions about your craft. You can add your own manual after creating the session. Without safety notes, students see a general safety reminder.')}</p></div>`;
    return ready();
  }
  if (!id) return off(skillsErr || (skills && !skills.length) ? t('No skills available') : t('Select a skill first'));
  if (curErr()) return off(t('Profile unavailable'), `<div class="notice bad" role="alert"><strong>${t('Could not load this skill profile, so a session cannot be configured safely.')}</strong>${esc(curErr())}<div class="row" style="margin-top:.5rem"><button type="button" class="btn" data-a="retry-profile">${t('Retry')}</button></div></div>`);
  if (!p) return off(t('Loading tasks…'), '<div class="brief" aria-busy="true"><div class="skel" style="width:40%"></div><div class="skel"></div><div class="skel" style="width:75%"></div></div>');
  sel.disabled = !p.tasks.length;
  sel.innerHTML = p.tasks.length ? `<option value="">${t('Choose a task…')}</option>` + p.tasks.map((x) => `<option value="${esc(x.id)}">${esc(x.title)}</option>`).join('') : `<option value="">${t('This profile has no tasks')}</option>`;
  sel.value = pick.task || '';
  const tk = p.tasks.find((x) => x.id === pick.task);
  brief.innerHTML = `<div class="brief"><h3>${skillBadge(p.id)}<span class="badge b-off">${esc(p.category)}</span></h3>${p.description ? `<p class="hint">${esc(p.description)}</p>` : ''}
  ${tk ? `<span class="tag">${t('Task objective')}</span><p class="objective"><strong>${esc(tk.title)}</strong>${tk.summary ? `<br>${esc(tk.summary)}` : ''}</p>${tk.visual_cues ? `<p class="cues"><span class="tag">${t('What a good result looks like')}</span><br>${esc(tk.visual_cues)}</p>` : ''}` : `<p class="hint">${p.tasks.length ? t('Choose a task to preview its objective and procedure.') : ''}</p>`}
  <span class="tag">${t('Required tools & purpose')}</span>${toolsHtml(p.tools)}
  <details><summary>${t('Safety advisories ({n}) — shown on both phones', { n: p.safety_advisories.length })}</summary><ul class="plain">${p.safety_advisories.map((s) => `<li>${safetyItem(s)}</li>`).join('')}</ul></details></div>`;
  edit.hidden = !tk && p.tasks.length > 0;
  fillDefaults(); ready();
}
const norm = (s) => String(s || '').replace(/\r\n/g, '\n').trim();
const curTask = () => curProf()?.tasks.find((x) => x.id === pick.task) || null;
function fillDefaults() { const tk = curTask(); $('#k').value = tk?.title || ''; $('#p').value = tk?.default_procedure || ''; markEdited(); }
function markEdited() { const tk = curTask(); if (!$('#k')) return; $('#k-ed').hidden = norm($('#k').value) === norm(tk?.title); $('#p-ed').hidden = norm($('#p').value) === norm(tk?.default_procedure); }
function ready() {
  const b = $('#create'), h = $('#create-h'); if (!b) return; const p = curProf();
  if (pick.skill === 'custom') { const ok = !!$('#cu-n')?.value.trim() && !!$('#cu-t')?.value.trim(); b.disabled = !ok; h.textContent = ok ? '' : t('Name the skill and the task.'); return; }
  const ok = !!p && (p.tasks.length ? !!curTask() : true);
  b.disabled = !ok; h.textContent = ok ? '' : !pick.skill ? t('Choose a skill and task first.') : curErr() ? t('Blocked: the skill profile did not load.') : !p ? t('Loading the skill profile…') : t('Choose a task.');
}
async function createSession(e) {
  e.preventDefault(); const p = curProf(), tk = curTask(), err = $('#err'); err.textContent = '';
  const custom = pick.skill === 'custom';
  if (!custom && (!p || (p.tasks.length && !tk))) { err.textContent = t('Choose a skill and a task first.'); return; }
  const lang = $('#lang').value;
  const body = custom ? { lang, title: $('#t').value, skill_id: 'custom', task: $('#cu-t').value, procedure: $('#cu-p').value, custom: { name: $('#cu-n').value, description: $('#cu-d').value, tools: $('#cu-tools').value, safety: $('#cu-s').value } } : { lang, title: $('#t').value, skill_id: p.id };
  if (!custom) {
    if (tk) body.task_id = tk.id;
    // English: only text the master changed is sent (the server fills in the template). Japanese: the form shows the
    // Japanese template, which is what the phones should show, so it is always sent.
    const k = norm($('#k').value), pr = norm($('#p').value);
    if (k && (LANG === 'ja' || k !== norm(tk?.title))) body.task = k;
    if (pr && (LANG === 'ja' || pr !== norm(tk?.default_procedure))) body.procedure = pr;
  }
  const b = $('#create'); b.disabled = true; b.textContent = t('Creating…');
  try {
    const r = await api('/api/sessions', { method: 'POST', body });
    created = r; draftTitle = ''; sid = r.id; flash = null; announce(t('Session created'));
    await list(); open(r.id);
  } catch (x) { err.textContent = t('Session not created: {msg}', { msg: x.message }); b.textContent = t('Create session'); ready(); announce(x.message); }
}
function renderSessions() {
  const box = $('#slist'); if (!box) return;
  box.innerHTML = sessions.length ? `<ul class="sess-list">${sessions.map((s) => `<li class="sess-item${s.id === sid ? ' active' : ''}"><div class="info"><strong>${esc(s.title)}</strong><p class="task">${s.task ? esc(s.task) : `<span class="empty">${t('No task title')}</span>`}</p><div class="row">${skillBadge(skillIdOf(s), s.skill_name)}<span class="hint">${t('{a} rec · {b} to answer · {c} approved', { a: s.recordings, b: s.open_questions, c: s.approved })}</span><span class="hint">${esc(when(s.created_at, true))}</span>${s.id === sid ? badge(t('● Open below'), 'b-info') : ''}</div></div><button class="btn" data-open="${esc(s.id)}" aria-label="${t('Open session: {title}', { title: esc(s.title) })}">${t('Open')}</button></li>`).join('')}</ul>` : emptyArt(t('No sessions yet. Create one to get started.'));
  box.querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => open(b.dataset.open)));
}

// ---- session detail ----
const refreshSoon = () => { clearTimeout(timer); timer = setTimeout(() => open(sid, true), 250); };
async function open(id, quiet) {
  if (!id) return; if (id !== sid) { flash = null; created = null; panelK = null; } sid = id; store.set('lastSession', id);
  try { D = await api('/api/sessions/' + id); } catch { sid = null; D = null; return list(); }
  // Links are cached per session so live refreshes keep the QR codes.
  if (LK?.sid !== id) LK = null;
  if (!LK) { const l = await api(`/api/sessions/${id}/links`).catch(() => null); if (l && sid === id) LK = { sid: id, ...l }; }
  const sk = skillIdOf(D.session); if (sk !== 'custom') profile(sk).then(() => { if (sid === id && $('#man-builtin') && !$('#man-builtin').dataset.done) render(); });
  render(); renderSessions(); if (!quiet) $('#sec-live')?.scrollIntoView();
}
// Which AI does the work: local only, or hybrid (cloud for some tasks, the local model as fallback).
const cloudOf = () => me?.aiEngines?.cloud || { mode: 'off' };
function aiLine() {
  const c = cloudOf(), local = me?.aiEngines?.local;
  if (c.mode === 'off') return me.aiConfigured ? t('Local AI configured.') : t('No local AI configured: video analysis is unavailable; add moments manually.');
  return t('Hybrid AI: {p} helps with {what}; {fb}', { p: esc(c.provider), what: c.mode === 'vision' ? t('video frames, questions, Japanese and records') : t('questions, Japanese and records'), fb: local ? t('the local model takes over if the cloud is unavailable.') : t('no local fallback is configured.') });
}
const aiSide = () => { const c = cloudOf(); return c.mode === 'off' ? t('Local') : `${t('Hybrid')} <span class="hint">${esc(c.model)}</span>${c.paused || c.lastError ? `<br><span class="hint err">${t('Cloud unavailable — using local AI')}</span>` : ''}`; };
// Activity, quietly: one master, any number of students. Shown in a small side panel, not as banners.
function side() {
  const box = $('#side'); if (!box || !D) return;
  const m = D.devices.find((x) => x.role === 'master'), pr = D.presence || {};
  const mp = !m?.last_seen ? t('not used yet') : m.connected ? t('active now') : t('last seen {time}', { time: esc(when(m.last_seen)) });
  const analysing = D.recordings.find((r) => r.status === 'analyzing');
  const open = D.questions.filter((x) => x.status === 'open').length, verify = D.knowledge.filter((k) => k.status === 'draft' || k.status === 'clarify').length, pend = D.help.filter((h) => h.status === 'pending').length;
  box.innerHTML = `<h2 class="side-h">${t('Activity')} <span class="side-conn">${connDot(online)}</span></h2>
  <dl class="side-kv"><dt>${t('Master phone')}</dt><dd>${mp}</dd>
  <dt>${t('Students')}</dt><dd>${pr.studentsOnline ? `<span class="conn-dot ok"></span> ${tn(pr.studentsOnline, '{n} online now', '{n} online now')}` : t('none online')}<br><span class="hint">${tn(pr.studentsToday || 0, '{n} active today', '{n} active today')} · ${tn(D.learners.length, '{n} with progress', '{n} with progress')}</span></dd>
  <dt>${t('AI')}</dt><dd>${aiSide()}${analysing ? `<br><span class="hint">${t('working on a recording…')}</span>` : ''}</dd></dl>
  <ul class="side-todo">${open ? `<li><a href="#sec-q">${tn(open, '{n} question to answer', '{n} questions to answer')}</a></li>` : ''}${verify ? `<li><a href="#sec-k">${tn(verify, '{n} record to verify', '{n} records to verify')}</a></li>` : ''}${pend ? `<li><a href="#sec-help" class="bad">${tn(pend, '{n} help request waiting', '{n} help requests waiting')}</a></li>` : ''}${!open && !verify && !pend ? `<li class="hint">${t('Nothing waiting for you.')}</li>` : ''}</ul>`;
}
function render() {
  const { session: s, recordings, observations, questions, knowledge, help, practices, events } = D, L = LK;
  // Live updates re-render this panel: keep half-typed (or dictated) text and the caret where the master left them.
  const keep = {}, act0 = document.activeElement, focusId = $('#sess')?.contains(act0) ? act0.id : null, sel = focusId && act0.selectionStart != null ? [act0.selectionStart, act0.selectionEnd] : null;
  $('#sess')?.querySelectorAll('textarea[id], input[id]:not([type=file])').forEach((e) => { if (e.value !== e.defaultValue) keep[e.id] = e.value; });
  const lk = (r, n) => `<div class="join ${r === 'master' ? 'm' : 'a'}"><h3>${n}</h3><p class="hint">${r === 'master' ? t('Records the demonstration. Or open <b>{url}</b> on your phone and sign in.', { url: esc(L.links.base) + '/m.html' }) : t('Lessons, practice with camera checks, progress and help.')}</p>
  ${r === 'master' ? '' : `<p class="join-code">${t('Student code')} <b>${esc(L.links.apprentice.code || '—')}</b><span class="hint">${t('Students enter it at {url}', { url: esc(L.links.base) })}</span></p>`}<img class="qr" alt="${t('QR code to join as {who}', { who: n })}" src="${L.links[r === 'student' ? 'apprentice' : r].qr}"><p class="hint url">${esc(L.links[r === 'student' ? 'apprentice' : r].url)}</p></div>`;
  const pend = help.filter((h) => h.status === 'pending').length;
  const sk = skillIdOf(s), unknown = sk === 'custom' ? !D.skill_name : skills && !skills.some((x) => x.id === sk);
  const justMade = created?.id === s.id ? created : null;
  $('#sess').innerHTML = `<section class="card" id="sec-live" aria-labelledby="h-s"><div class="sess-head"><div><span class="eyebrow">${t('Live session')}</span><h1 id="h-s">${esc(s.title)}</h1><div class="row">${skillBadge(sk, D.skill_name)}<label class="qcount" for="s-lang">${t('AI language')} <select id="s-lang" data-a="slang">${Object.entries(SESSION_LANGS()).map(([v, n]) => `<option value="${v}"${(s.lang || 'en') === v ? ' selected' : ''}>${n}</option>`).join('')}</select></label></div></div></div>
  ${justMade ? `<div class="notice ok" role="status"><strong>${t('Session created.')}</strong>${t('Scan the codes below with the phones.')}</div>` : ''}
  ${unknown ? `<div class="notice bad" role="alert"><strong>${t('This session\'s skill profile is not installed on the server.')}</strong>${t('Phones will be blocked from joining because its safety guidance cannot be shown.')}</div>` : ''}
  <p class="objective" style="margin-top:.6rem"><span class="tag">${t('Task')}</span><br>${s.task ? esc(s.task) : `<span class="empty">${t('No task title')}</span>`}</p>
  ${s.procedure ? `<details><summary>${t('Procedure for this session')}</summary>${procHtml(s.procedure)}</details>` : ''}
  <details class="joins"${justMade || (!recordings.length && !D.learners.length) ? ' open' : ''}><summary>${t('Join codes for phones')} — ${t('student code')} <b>${esc(L?.links.apprentice.code || '—')}</b></summary>
  <div id="links">${L ? `${L.warning ? `<p class="notice warn" role="alert">${esc(trServer(L.warning))}</p>` : ''}<div class="join-grid">${lk('master', t('Master phone'))}${lk('student', t('Student phone'))}</div>` : `<p class="hint">${t('Join codes could not be loaded. Use “Rotate join links” or reopen the session.')}</p>`}</div>
  <div class="row"><button class="btn" data-a="rotate">${t('Rotate join links')}</button><button class="btn danger" data-a="del">${t('Delete session and all data')}</button></div><p class="hint">${t('Invites stay valid while the session is in use; “Rotate join links” issues new ones and cuts off the old code.')}</p></details></section>
  <div class="sess-layout"><div class="sess-main">
  ${manualHtml(s, sk)}
  <section class="card" id="sec-rec" aria-labelledby="h-rec"><h2 id="h-rec" class="panel-title">${t('Master recordings')}</h2>${upHtml()}${recordings.length ? recordings.map(recHtml).join('') : emptyArt(t('No recording yet. Record the task with the master phone, or upload a video filmed with any camera.'))}</section>
  <section class="card" id="sec-q" aria-labelledby="h-q"><div class="row sp"><h2 id="h-q" class="panel-title">${t('Questions for you')} ${qCounts(questions)}</h2>${stt ? sttPicker() : ''}</div><p class="hint">${t('The AI asks about what manuals do not explain — why you do things your way. Answer in your own words (type or 🎤); the AI then drafts a knowledge record <b>from your words only</b>. Open it with <b>📖</b>, check it and press <b>Approve</b>.')}</p>${questions.length ? questions.map((x) => qHtml(x, observations)).join('') : emptyArt(t('No questions yet. Run analysis (needs a local model) or add a moment manually.'))}</section>
  <section class="card" id="sec-k" aria-labelledby="h-k"><h2 id="h-k" class="panel-title">${t('Knowledge library')} ${badge(tn(knowledge.filter((k) => k.status === 'approved').length, '{n} approved', '{n} approved'), 'b-ok')}</h2>${libraryHtml(knowledge, questions, help)}</section>
  <section class="card" id="sec-help" aria-labelledby="h-help"><h2 id="h-help" class="panel-title">${t('Help requests')} ${pend ? badge(t('{n} pending', { n: pend }), 'b-bad') : ''}</h2>${flash ? `<div class="notice ${flash.kind}" role="${flash.kind === 'ok' ? 'status' : 'alert'}">${flash.html()}</div>` : ''}${help.length ? help.map(helpHtml).join('') : emptyArt(t('No help requests.'))}</section>
  <div class="grid"><section class="card" id="sec-students" aria-labelledby="h-p"><h2 id="h-p" class="panel-title">${t('Students')}</h2>${learnersHtml(D.learners, knowledge)}<h3>${t('Practice sessions')}</h3>${practices.length ? practices.map((p) => `<p><strong>${esc(when(p.started_at))}</strong> ${p.ended_at ? t('ended') : badge(t('● active'), 'b-ok')} — ${tn(p.total, '{n} snapshot check', '{n} snapshot checks')}: ${Object.entries(p.counts).map(([k, v]) => `${esc(t(ASSESS[k] || k))} ${v}`).join(', ') || t('none')}<br><span class="hint">${t('AI checks are guidance only, not a competency score.')}</span></p>`).join('') : emptyArt(t('No student practice yet.'))}</section>
  <section class="card" aria-labelledby="h-e"><h2 id="h-e" class="panel-title">${t('History')}</h2><ul class="plain">${events.map((e) => `<li><span class="hint">${esc(when(e.created_at))}</span> ${esc(t(EVT[e.kind] || e.kind.replaceAll('_', ' ')))} ${esc(trServer(e.detail || ''))}</li>`).join('')}</ul></section></div>
  ${trashHtml(D.trash || [], D.trashDays)}
  </div><aside class="sess-side card" id="side" aria-label="${t('Activity')}"></aside></div>`;
  for (const [id, v] of Object.entries(keep)) { const e = document.getElementById(id); if (e) e.value = v; }
  if (focusId) { const e = document.getElementById(focusId); if (e) { e.focus({ preventScroll: true }); if (sel && e.setSelectionRange) try { e.setSelectionRange(...sel); } catch {} } }
  side(); renderNav(); renderPanel(); micUi();
}
const ASSESS = { on_track: 'on track', possible_issue: 'possible issue', cannot_assess: 'cannot assess', safety_stop: 'safety stop' };
const EVT = { session_created: 'Session created', recording_uploaded: 'Recording uploaded', analysis_started: 'Analysis started', analysis_done: 'Analysis finished', analysis_failed: 'Analysis failed', more_questions_started: 'More questions requested', more_questions_done: 'More questions written', answer_saved: 'Answer saved', knowledge_approved: 'Record approved', knowledge_draft: 'Record saved as draft', knowledge_rejected: 'Record rejected', knowledge_clarify: 'Record needs clarification', knowledge_ai_drafted: 'AI drafted a record', knowledge_ai_draft_failed: 'AI could not draft a record', knowledge_deleted: 'Record deleted', knowledge_draft_from_help: 'Help reply saved as draft knowledge', device_joined: 'Device joined', help_requested: 'Help requested', help_answered: 'Help answered', help_resolved: 'Help resolved', help_rejected: 'Help rejected', help_escalated: 'Help escalated', help_pending: 'Help reopened', help_deleted: 'Help request deleted', practice_started: 'Practice started', practice_ended: 'Practice ended', links_rotated: 'Join links rotated', moment_added: 'Moment added', question_removed: 'Question removed', question_rewritten: 'Question rewritten', recording_deleted: 'Recording deleted', restored: 'Restored', deleted_forever: 'Deleted for good', language_changed: 'AI language changed', manual_added: 'Manual added', manual_removed: 'Manual removed' };
// The master's manual (and the skill's built-in standard guidance) are background for the AI: it asks about what they leave out.
function manualHtml(s, sk) {
  const p = sk === 'custom' ? null : prof[LANG + ':' + sk], builtin = p?.manual;
  return `<section class="card" id="sec-manual" aria-labelledby="h-man"><h2 id="h-man" class="panel-title">${t('Reference manual')}</h2>
  <p class="hint">${t('Manuals already explain the standard steps. The AI reads them as background and asks only about what they do not explain: your reasons, instincts and personal technique.')}</p>
  <div id="man-builtin" data-done="${builtin ? 1 : ''}">${builtin ? `<details><summary>${t('Built-in standard guidance for {skill} (used automatically)', { skill: esc(p.name) })}</summary><div class="manual-text">${esc(builtin)}</div></details>` : sk === 'custom' ? `<p class="hint">${t('This is your own skill, so there is no built-in guidance. Add your manual below for better questions.')}</p>` : ''}</div>
  ${s.manual_chars ? `<div class="notice ok"><strong>${t('Your manual: {name}', { name: esc(s.manual_name || '') })}</strong>${t('{n} characters of text. The AI uses the passages relevant to each moment.', { n: s.manual_chars })}<details><summary>${t('Preview')}</summary><div class="manual-text">${esc(s.manual_preview)}…</div></details><div class="row"><button class="btn danger" data-a="delmanual">${t('Remove manual')}</button></div></div>` : ''}
  <details class="man-add"${s.manual_chars ? '' : ''}><summary>${s.manual_chars ? t('Replace your manual') : t('Add your own manual (PDF, text or pasted)')}</summary>
  <div class="row" style="align-items:end"><div style="flex:1"><label for="man-file">${t('Upload a file')}</label><input id="man-file" type="file" accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown"></div><button class="btn" data-a="upmanual">${t('Upload')}</button></div>
  <label for="man-text">${t('Or paste text')}</label><textarea id="man-text" rows="4" placeholder="${t('Paste the relevant part of your manual or teaching notes…')}"></textarea><button class="btn" data-a="pastemanual">${t('Save pasted text')}</button><p class="hint" id="man-st" role="status"></p></details></section>`;
}
// Students are anonymous devices ("Student 1, 2…" in the order they first did something here).
const learnersHtml = (ls, ks) => { const n = ks.filter((k) => k.status === 'approved').length; return ls.length ? `<ul class="plain">${ls.map((l) => `<li><strong>${esc(studentLabel(l.label))}</strong> — ${t('learned {a} of {b} lessons', { a: l.learned, b: n })}${l.helps ? ` · ${tn(l.helps, '{n} help request', '{n} help requests')}` : ''} <progress max="${n || 1}" value="${l.learned}"></progress>${l.last ? ` <span class="hint">${t('last marked {time}', { time: esc(when(l.last)) })}</span>` : ''}</li>`).join('')}</ul>` : `<p class="hint">${t('No student activity yet. {n} approved lessons are available to students.', { n })}</p>`; };
const KIND = () => ({ recording: t('🎬 Recording'), question: t('❓ Question'), knowledge: t('📖 Knowledge record'), help: t('🙋 Help request') });
const trashHtml = (list, days) => (list.length ? `<section class="card" id="sec-trash" aria-labelledby="h-t"><h2 id="h-t" class="panel-title">${t('Recently deleted')} ${badge(list.length, 'b-off')}</h2><p class="hint">${t('Deleted items stay here for {n} days, then are removed for good. Restore brings back everything that was deleted with them.', { n: days })}</p>
  <ul class="plain trash">${list.map((x) => `<li><span><b>${KIND()[x.kind] || esc(x.kind)}</b> — ${esc(trServer(x.label))} <span class="hint">${t('deleted {time}', { time: esc(when(x.deleted_at, true)) })}</span></span><span class="row"><button class="btn" data-a="restore" data-id="${esc(x.id)}">${t('↩ Restore')}</button><button class="btn danger" data-a="purge" data-id="${esc(x.id)}">${t('Delete for good')}</button></span></li>`).join('')}</ul></section>` : '');
const recStatus = (r) => ({ uploaded: t('○ Uploaded'), analyzing: t('◔ Analysing…'), analyzed: t('✓ Analysed'), failed: t('✕ Analysis failed') }[r.status] || esc(r.status));
// ---- upload a video filmed with any camera; it then goes through the same AI analysis as a phone recording ----
const VIDEO_EXT = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska' };
let up = null; // { name, pct, msg, bad } while uploading or after an error
const upHtml = () => `<div class="upload-box"><label class="btn" for="vfile">📁 ${t('Upload a video file')}</label><input type="file" id="vfile" class="sr" accept="video/mp4,video/quicktime,video/webm,video/x-matroska,.mp4,.m4v,.mov,.webm,.mkv">
  <span class="hint">${t('Filmed with another camera? MP4, MOV, WebM or MKV, up to {mb} MB. It is analysed just like a phone recording.', { mb: me?.limits?.uploadMb || me?.limits?.maxVideoMb || 200 })}</span>
  ${up ? `<div class="up-st${up.bad ? ' err' : ''}" role="status"><span>${esc(up.name)}</span> ${up.pct != null && !up.bad ? `<progress id="up-pg" max="100" value="${up.pct}"></progress>` : ''}<span id="up-msg">${esc(up.msg || '')}</span></div>` : ''}</div>`;
function uploadVideo(file) {
  const limit = me?.limits?.uploadMb || me?.limits?.maxVideoMb || 200, ext = (file.name.split('.').pop() || '').toLowerCase();
  const type = Object.values(VIDEO_EXT).includes(file.type) ? file.type : VIDEO_EXT[ext];
  const fail = (m) => { up = { name: file.name, msg: m, bad: true }; render(); announce(m); };
  if (!type) return fail(t('This file type is not supported. Use MP4, MOV, WebM or MKV.'));
  if (file.size > limit * 1e6) return fail(t('This video is {a} MB; the limit here is {b} MB. Trim it or export it at a lower quality.', { a: (file.size / 1e6).toFixed(0), b: limit }));
  const x = new XMLHttpRequest(), target = sid; up = { name: file.name, pct: 0, msg: t('Uploading…') }; render();
  x.open('POST', `/api/sessions/${encodeURIComponent(target)}/recordings`); x.setRequestHeader('content-type', type); x.setRequestHeader('x-lang', LANG);
  x.upload.onprogress = (e) => { if (!e.lengthComputable) return; up.pct = Math.round((e.loaded / e.total) * 100); const pg = $('#up-pg'); if (pg) pg.value = up.pct; };
  x.onload = async () => {
    let d = {}; try { d = JSON.parse(x.responseText || '{}'); } catch { /* not JSON */ }
    if (x.status === 201) { up = null; announce(t('Video uploaded. Press “Find 5 questions with AI” to analyse it.')); await open(target, true); document.querySelector('.recitem')?.scrollIntoView({ block: 'center' }); }
    else fail(trServer(d.error) || t('Upload failed ({n})', { n: x.status }));
  };
  x.onerror = () => fail(t('Network error. Check the connection and try again.'));
  x.send(file);
}
document.addEventListener('change', (e) => { if (e.target.id === 'vfile' && e.target.files?.[0]) { uploadVideo(e.target.files[0]); e.target.value = ''; } });
const recHtml = (r) => { const busy = r.status === 'analyzing', nq = D.questions.filter((x) => x.recording_id === r.id).length; return `<div class="recitem"><div class="row sp"><strong>${esc(when(r.created_at, true))} · ${(r.bytes / 1e6).toFixed(1)} MB</strong>${badge(recStatus(r), r.status === 'failed' ? 'b-bad' : r.status === 'analyzed' ? 'b-ok' : 'b-warn')}</div>
<video id="v-${r.id}" controls preload="metadata" src="${r.url}" aria-label="${t('Master recording')}"></video>
${busy ? `<div class="aprog" id="prog-${r.id}" role="status">${progInner(r.progress)}</div>` : ''}${r.error ? `<p class="err" role="alert">${esc(trServer(r.error))}</p>` : ''}${r.status === 'analyzed' && !nq ? `<p class="notice warn"><strong>${t('No moments worth asking about were found.')}</strong>${t('Add a moment by hand below, ask for more questions, or record a clearer take with the hands and the work in view.')}</p>` : ''}
<div class="row">${r.status === 'analyzed' ? `<span class="hint">${tn(nq, '{n} question from this video', '{n} questions from this video')}</span><button class="btn" data-a="more" data-n="5" data-id="${r.id}"${busy ? ' disabled' : ''}>${t('+5 more questions')}</button><button class="btn" data-a="more" data-n="10" data-id="${r.id}"${busy ? ' disabled' : ''}>${t('+10 more questions')}</button>`
  : `<button class="btn primary" data-a="analyze" data-id="${r.id}"${busy ? ' disabled' : ''}>${busy ? t('Analysing…') : r.status === 'failed' ? t('Retry analysis') : t('Find 5 questions with AI')}</button>`}<button class="btn danger" data-a="delrec" data-id="${r.id}"${busy ? ` disabled title="${t('Wait for the analysis to finish')}"` : ''}>${t('Delete recording')}</button></div>
<details class="addm"><summary>${t('Add a moment by hand')}</summary><form data-a="moment" data-id="${r.id}" class="row" style="align-items:end"><div><label for="mt-${r.id}">${t('Moment (seconds)')}</label><input id="mt-${r.id}" type="number" min="0" required style="width:7rem"></div><div style="flex:1;min-width:min(100%,200px)"><label for="mx-${r.id}">${t('What is visible?')}</label><input id="mx-${r.id}" required maxlength="300"></div><button class="btn">${t('Add moment')}</button></form></details></div>`; };
const progInner = (p) => {
  if (!p || p.phase === 'extracting') return `<div class="row sp"><strong>${t('Preparing still frames…')}</strong></div><progress aria-label="${t('Preparing frames')}"></progress>`;
  if (p.phase === 'questions' || p.phase === 'followups') return `<div class="row sp"><strong>${p.phase === 'followups' ? t('Writing follow-up questions on your answers…') : t('Writing question {a} of {b}', { a: Math.min(p.qDone + 1, p.qTotal || 1), b: p.qTotal || '?' })}</strong><span class="hint">${t('frames checked ✓')}</span></div><progress max="${p.qTotal || 1}" value="${p.qDone || 0}" aria-label="${t('Writing questions')}"></progress><p class="hint">${t('Each question is checked against the manual and judged before you see it, so you get fewer but better questions.')}</p>`;
  const left = p.done ? Math.round(((Date.now() - p.started) / p.done) * (p.total - p.done) / 1000) : null;
  return `<div class="row sp"><strong>${t('Looking at frame {a} of {b}', { a: Math.min(p.done + 1, p.total), b: p.total })}</strong><span class="hint">${left == null ? t('estimating time…') : left < 60 ? t('~{n} s left', { n: left }) : t('~{n} min left', { n: Math.round(left / 60) })}</span></div><progress max="${p.total}" value="${p.done}" aria-label="${t('Analysis progress')}"></progress><p class="hint">${t('One still every {n} s. The laptop stays usable; other AI checks wait until this finishes.', { n: p.step })}</p>`;
};
// Progress events update the bar in place; a full re-render would restart videos and wipe half-typed answers.
function onProgress(m) {
  if (m.sid !== sid || !D) return; const r = D.recordings.find((x) => x.id === m.recording); const el = $('#prog-' + m.recording);
  if (r) r.progress = m; if (el) el.innerHTML = progInner(m); else refreshSoon();
}
const STT = () => ({ auto: t('Auto-detect language'), ja: t('Japanese (日本語)'), en: t('English'), translate: t('Translate speech into English') });
const sttPicker = () => `<label class="qcount" for="stt">🎤 ${t('Speech')} <select id="stt" data-a="stt">${Object.entries(STT()).map(([v, n]) => `<option value="${v}"${v === sttMode ? ' selected' : ''}>${n}</option>`).join('')}</select></label>`;
const qHtml = (x, obs) => {
  const o = obs.find((y) => y.id === x.observation_id), ks = D.knowledge.filter((k) => k.question_id === x.id), seen = o ? o.text.replace(/^the footage shows:\s*/, '') : '', parent = x.parent_id && D.questions.find((y) => y.id === x.parent_id);
  const st = x.status === 'open' ? badge(t('○ Waiting for your answer'), 'b-warn') : ks.some((k) => k.status === 'approved') ? badge(t('✓ Approved knowledge'), 'b-ok') : badge(t('✓ Answered · verify record'), 'b-info');
  const src = x.parent_id ? t('↳ Follow-up to your answer at {time}', { time: mmss(x.t) }) : o?.source === 'manual' ? t('Added by you') : t('AI question');
  return `<div class="moment ${o?.source === 'manual' ? '' : 'ai'}${x.parent_id ? ' follow' : ''}" id="q-${x.id}"><div class="row sp"><span class="tag">${src}</span><span class="row">${st}<button class="btn sm" data-a="play" data-rec="${x.recording_id}" data-t="${x.t}">▶ ${mmss(x.t)}</button></span></div><p class="question">${esc(x.text.replace(/^At \d+:\d+ — /, ''))}</p>${x.text_en ? `<details class="q-en"><summary>${t('Original question (English)')}</summary><p>${esc(x.text_en)}</p></details>` : ''}${parent ? '' : seen && !x.text.includes(seen) ? `<p class="hint">${t('What the AI saw:')} ${esc(seen)}</p>` : ''}${x.status === 'open' ? `<form data-a="answer" data-id="${x.id}"><label for="an-${x.id}">${t('Your answer')}</label><textarea id="an-${x.id}" rows="3" required></textarea>${micBtn('an-' + x.id, t('Speak your answer'))}<div class="row"><button class="btn primary">${ai ? t('Save answer — AI drafts the record') : t('Save answer')}</button>${ai ? `<button type="button" class="btn" data-a="rephrase" data-id="${x.id}"${rewriting.has(x.id) ? ' disabled aria-busy="true"' : ''}>${rewriting.has(x.id) ? t('Writing a new question…') : t('↻ Ask differently')}</button>` : ''}<button type="button" class="btn danger" data-a="delq" data-id="${x.id}">${t('✕ Remove')}</button></div></form>` : ''}${ks.map(kChip).join('')}</div>`;
};
const qCounts = (qs) => { const open = qs.filter((x) => x.status === 'open').length; return open ? badge(t('{n} to answer', { n: open }), 'b-warn') : ''; };
const aiBadge = (k) => (k.ai_draft === 'drafting' ? badge(t('✨ AI drafting…'), 'b-info') : k.ai_draft && !k.ai_draft.startsWith('failed') ? badge(t('✨ AI-drafted'), 'b-off') : '');
const kSum = (k) => esc((k.summary || k.verbatim || '').slice(0, 140)) + ((k.summary || k.verbatim || '').length > 140 ? '…' : '');
// Under a question, a record is one compact line; the full record opens in the side panel.
const kChip = (k) => `<div class="kchip"><span class="kchip-l">📖 ${kBadge(k)} ${aiBadge(k)}</span><span class="kchip-sum">${kSum(k)}</span><button type="button" class="btn sm" data-a="openk" data-id="${k.id}">${k.status === 'approved' ? t('View') : t('Check & approve')}</button></div>`;
function libraryHtml(ks, qs, hs) {
  if (!ks.length) return emptyArt(t('No knowledge records yet. They appear here when you answer questions or convert a help reply.'));
  const F = { all: () => true, verify: (k) => k.status === 'draft' || k.status === 'clarify', approved: (k) => k.status === 'approved' }, shown = ks.filter(F[kFilter]);
  const src = (k) => { const h = hs.find((x) => x.id === k.question_id); if (h) return t('From a help reply'); const q = qs.find((x) => x.id === k.question_id); return q ? mmss(q.t) : '—'; };
  return `<div class="seg filt" role="group" aria-label="${t('Filter')}">${[['all', t('All')], ['verify', t('To verify')], ['approved', t('Approved')]].map(([v, n]) => `<button type="button" data-a="kfilter" data-v="${v}" aria-pressed="${kFilter === v}">${n} <span class="hint">${ks.filter(F[v]).length}</span></button>`).join('')}</div>
  ${shown.length ? `<ul class="klist">${shown.map((k) => `<li><span class="kl-st">${kBadge(k)}</span><span class="kl-main"><b>${esc(k.step || '—')}</b><span>${kSum(k)}</span></span><span class="hint">${esc(src(k))}</span><button type="button" class="btn sm" data-a="openk" data-id="${k.id}">${t('Open')}</button></li>`).join('')}</ul>` : `<p class="hint">${t('Nothing in this view.')}</p>`}`;
}
const aiNote = (k) => (k.ai_draft === 'drafting' ? `<p class="notice info" role="status"><strong>${t('✨ The AI is drafting this record from your answer…')}</strong>${t('Usually a few seconds. You can keep answering other questions.')}</p>`
  : k.ai_draft?.startsWith('failed') ? `<p class="notice bad" role="alert"><strong>${t('The AI could not draft this record.')}</strong>${esc(trServer(k.ai_draft.replace(/^failed:\s*/, '')))}. ${t('Fill it in by hand or try again.')}</p>`
  : k.ai_draft && k.status !== 'approved' ? `<p class="notice warn"><strong>${t('Drafted by the AI from your words — check before approving.')}</strong>${t('Correct anything you did not mean. Your own words are never changed.')}</p>` : '');
// ---- knowledge record side panel ----
function renderPanel() {
  const box = $('#kpanel'), back = $('#kback'), k = panelK && D?.knowledge.find((x) => x.id === panelK);
  if (!k) { if (!box.hidden) { box.hidden = true; back.hidden = true; document.body.classList.remove('panel-open'); } panelK = null; return; }
  // Keep what the master typed in the panel across live refreshes.
  const keep = {}; box.querySelectorAll('textarea[id], input[id]:not([type=file])').forEach((e) => { if (e.value !== e.defaultValue) keep[e.id] = e.value; });
  const fromHelp = D.help.find((h) => h.id === k.question_id), q = D.questions.find((x) => x.id === k.question_id);
  box.innerHTML = `<div class="kp-head"><h2 id="kp-h">📖 ${t('Knowledge record')}</h2><button type="button" class="kp-x" data-a="closek" aria-label="${t('Close')}">✕</button></div>
  <div class="row">${kBadge(k)} ${aiBadge(k)} ${k.approved_at ? `<span class="hint">${t('approved {time}', { time: esc(when(k.approved_at, true)) })}</span>` : ''}</div>
  <p class="kp-src">${fromHelp ? `<span class="tag">${t('Student asked')}</span><br>${esc(fromHelp.question)}` : q ? `<span class="tag">${t('Question')}</span><br>${esc(q.text.replace(/^At \d+:\d+ — /, ''))}` : `<span class="tag">${t('Observed')}</span><br>${esc(k.observed)}`}</p>
  ${k.recording_id ? `<button class="btn sm" data-a="play" data-rec="${k.recording_id}" data-t="${k.t}">▶ ${t('Play the moment ({time})', { time: mmss(k.t) })}</button>` : `<p class="hint">${t('No reference clip (from a help reply).')}</p>`}
  ${aiNote(k)}<form data-a="kn" data-id="${k.id}" class="kp-form"><label for="kv-${k.id}">${t('Your words (verbatim — correct transcription errors only)')}</label><textarea id="kv-${k.id}" name="verbatim" rows="3">${esc(k.verbatim)}</textarea>${micBtn('kv-' + k.id, t('Add spoken words'))}
  <label for="ks-${k.id}">${t('Summary for students')}</label><textarea id="ks-${k.id}" name="summary" rows="3">${esc(k.summary)}</textarea>
  <label for="kc-${k.id}">${t('How you decide (cues, conditions)')}</label><input id="kc-${k.id}" name="cues" value="${esc(k.cues)}">
  <label for="kw-${k.id}">${t('Exceptions / warnings')}</label><input id="kw-${k.id}" name="warnings" value="${esc(k.warnings)}">
  <div class="grid two"><div><label for="kp-${k.id}">${t('Step')}</label><input id="kp-${k.id}" name="step" value="${esc(k.step)}"></div><div><label for="kt-${k.id}">${t('Tool')}</label><input id="kt-${k.id}" name="tool" value="${esc(k.tool)}"></div></div>
  <div class="kp-actions"><button class="btn primary" data-s="approved">${t('Approve')}</button><button class="btn" data-s="">${t('Save edits')}</button>${ai && k.status !== 'approved' && k.ai_draft !== 'drafting' ? `<button type="button" class="btn" data-a="aifill" data-id="${k.id}" title="${t('Fills only empty fields, using only your words')}">${t('✨ Fill empty fields')}</button>` : ''}</div>
  <details class="kp-more"><summary>${t('More actions')}</summary><div class="row"><button class="btn" data-s="clarify">${t('Needs clarification')}</button><button class="btn danger" data-s="rejected">${t('Reject')}</button><button type="button" class="btn danger" data-a="delk" data-id="${k.id}"${k.ai_draft === 'drafting' ? ' disabled' : ''}>${t('🗑 Delete record')}</button></div></details></form>`;
  for (const [id, v] of Object.entries(keep)) { const e = document.getElementById(id); if (e) e.value = v; }
  box.setAttribute('role', 'dialog'); box.setAttribute('aria-labelledby', 'kp-h');
  if (box.hidden) { box.hidden = false; back.hidden = false; document.body.classList.add('panel-open'); $('.kp-x', box).focus(); }
  micUi();
}
let panelReturn = null;
function openPanel(id, from) { panelK = id; panelReturn = from || null; renderPanel(); }
function closePanel() { panelK = null; renderPanel(); panelReturn?.focus?.(); }
$('#kback').onclick = closePanel;
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && panelK) closePanel(); });
function convHtml(h) {
  const conv = D.knowledge.find((k) => k.question_id === h.id), why = convBlocked[h.id];
  if (conv) return `<div class="convert">${kChip(conv)}${conv.status === 'approved' ? '' : `<p class="hint">${t('Not available to the student until you approve it.')}</p>`}</div>`;
  if (h.status === 'rejected' || why === 'help_rejected') return `<p class="hint">${t('Rejected help requests cannot be converted into knowledge.')}</p>`;
  if (why === 'already_converted') return `<p class="hint">${t('This request was already converted to draft knowledge.')}</p>`;
  if (!h.replies.length) return `<p class="hint">${t('Reply first — your reply can then be saved as draft knowledge.')}</p>`;
  const busy = converting.has(h.id);
  return `<div class="convert">${convErr[h.id] ? `<p class="err" role="alert">${t('Conversion failed: {msg}', { msg: esc(convErr[h.id]) })}</p>` : ''}<button type="button" class="btn" data-a="convert" data-id="${h.id}"${busy ? ' disabled aria-busy="true"' : ''}>${busy ? t('Converting…') : t('Save reply as draft knowledge')}</button><p class="hint">${t('Saves your latest reply as a <strong>draft</strong> record. It stays hidden from students until you review it and press <b>Approve</b>.')}</p></div>`;
}
const HS_BTN = () => ({ resolved: t('Resolved'), rejected: t('Reject'), escalated: t('Escalate') });
const helpHtml = (h) => { const [a, c] = hst()[h.status] || [esc(h.status), 'b-off']; return `<div class="moment ${h.status === 'pending' ? '' : 'ai'}"><div class="row sp">${badge(a, c)}<span class="hint">${h.learner_label ? esc(studentLabel(h.learner_label)) + ' · ' : ''}${esc(when(h.created_at))}${h.step ? ' · ' + t('step: {s}', { s: esc(h.step) }) : ''}</span></div><p><strong>${esc(trServer(h.question))}</strong></p>${h.frame ? `<img src="${h.frame}" alt="${t('Latest snapshot from the student\'s camera')}" style="max-width:100%;border-radius:8px">` : `<p class="hint">${t('No snapshot attached.')}</p>`}${h.replies.map((r) => `<p class="expert moment"><span class="tag">${t('Your reply')}</span><br>${esc(r.text)}</p>`).join('')}
<form data-a="reply" data-id="${h.id}"><label for="r-${h.id}">${t('Reply to the student\'s phone')}</label><textarea id="r-${h.id}" rows="2" required></textarea>${micBtn('r-' + h.id, t('Speak your reply'))}<div class="row"><button class="btn primary">${t('Send reply')}</button>${ai ? `<button type="button" class="btn" data-a="suggest" data-id="${h.id}">${t('✨ Suggest a reply')}</button>` : ''}${Object.entries(HS_BTN()).map(([s, n]) => `<button type="button" class="btn" data-a="hs" data-id="${h.id}" data-s="${s}">${n}</button>`).join('')}<button type="button" class="btn danger" data-a="delh" data-id="${h.id}">${t('🗑 Delete')}</button></div></form>${convHtml(h)}</div>`; };
async function convert(id) {
  if (converting.has(id)) return; converting.add(id); delete convErr[id]; render();
  try {
    const r = await req(`/api/help/${encodeURIComponent(id)}/convert-to-knowledge`, { method: 'POST' });
    flash = { kind: 'ok', html: () => `<strong>${t('Saved as a draft knowledge record — not approved.')}</strong>${t('Check it and press Approve before students can use it.')} <button type="button" class="linkbtn" data-a="openk" data-id="${esc(r.knowledgeId)}">${t('Open the draft')}</button>` };
    announce(t('Reply saved as draft knowledge. Approval is still required.'));
  } catch (e) {
    if (e.code === 'already_converted') { convBlocked[id] = e.code; flash = { kind: 'warn', html: () => `<strong>${t('Already converted.')}</strong>${t('This help request was converted earlier; no new record was created.')}` }; }
    else if (e.code === 'help_rejected') { convBlocked[id] = e.code; flash = { kind: 'warn', html: () => `<strong>${t('Cannot convert.')}</strong>${t('Rejected help requests cannot become knowledge.')}` }; }
    else convErr[id] = e.message;
    announce(e.message);
  } finally { converting.delete(id); }
  await open(sid, true);
}
// "Suggest a reply": the AI drafts from approved records only; the master reads, edits and sends it.
async function suggestReply(b) {
  const id = b.dataset.id, label = b.textContent; b.disabled = true; b.setAttribute('aria-busy', 'true'); b.textContent = t('Writing a suggestion…');
  try {
    const r = await api(`/api/help/${encodeURIComponent(id)}/suggest`, { method: 'POST' }), ta = $('#r-' + id);
    if (r.reply && ta) { ta.value = r.reply; ta.focus(); announce(t('Suggested reply added from your approved records — check it, then send.')); }
    else alert(r.reason === 'no_records' ? t('There are no approved records yet, so there is nothing to suggest from. Reply in your own words.') : t('None of your approved records answers this question. Reply in your own words.'));
  } catch (e) { announce(e.message); alert(e.message); }
  finally { b.disabled = false; b.removeAttribute('aria-busy'); b.textContent = label; }
}
// ---- dictation: record on this laptop, transcribe locally with whisper.cpp (POST /api/transcribe) ----
let dict = null; const micMsg = {};
const MIC_TYPES = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm'];
const micBtn = (target, label) => (stt ? `<div class="row mic-row"><button type="button" class="btn mic" data-a="mic" data-target="${target}" data-label="${esc(label)}">🎤 ${esc(label)}</button><span class="hint mic-st" id="ms-${target}" role="status"></span></div>` : '');
function micUi() {
  document.querySelectorAll('[data-a=mic]').forEach((b) => {
    const mine = dict?.target === b.dataset.target, secs = mine ? Math.floor((Date.now() - dict.t0) / 1000) : 0;
    b.classList.toggle('recording', mine && dict.phase === 'rec'); b.disabled = !!dict && (!mine || dict.phase === 'busy');
    b.textContent = !mine ? '🎤 ' + b.dataset.label : dict.phase === 'rec' ? t('Stop and transcribe ({time})', { time: mmss(secs) }) : t('Transcribing…');
    const st = $('#ms-' + b.dataset.target), m = micMsg[b.dataset.target]; if (st) { st.textContent = m?.text || ''; st.className = 'hint mic-st' + (m?.bad ? ' err' : ''); }
  });
}
const micNote = (target, text, bad) => { micMsg[target] = { text, bad }; micUi(); announce(text); };
async function dictate(target) {
  if (dict?.target === target && dict.phase === 'rec') return dict.mr.stop();
  if (dict) return;
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return micNote(target, t('This browser cannot record audio on this address. Open the dashboard via localhost or the HTTPS tunnel address.'), true);
  let ms; try { ms = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); } catch (e) { return micNote(target, e.name === 'NotAllowedError' ? t('Microphone permission denied. Allow it in the browser, then try again.') : t('Microphone error: {msg}', { msg: e.message }), true); }
  const type = MIC_TYPES.find((x) => MediaRecorder.isTypeSupported(x)) || '', mr = new MediaRecorder(ms, type ? { mimeType: type } : {}), chunks = [];
  dict = { target, mr, phase: 'rec', t0: Date.now() }; delete micMsg[target];
  mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  mr.onstop = async () => {
    ms.getTracks().forEach((x) => x.stop()); clearInterval(dict.timer); dict.phase = 'busy'; micUi();
    const blob = new Blob(chunks, { type: (mr.mimeType || type || 'audio/webm').split(';')[0] });
    try {
      const d = await api('/api/transcribe?lang=' + encodeURIComponent(sttMode) + '&session=' + encodeURIComponent(sid || ''), { method: 'POST', raw: blob, type: blob.type });
      dict = null; const ta = document.getElementById(target);
      if (!d.text) micNote(target, t('No speech was recognised. Try again a little closer to the microphone.'), true);
      else { if (ta) { ta.value = (ta.value.trim() ? ta.value.trim() + ' ' : '') + d.text; ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } const n = (d.ms / 1000).toFixed(1); micNote(target, d.cloud ? t('Transcribed by the cloud service in {n} s — check the wording, then save.', { n }) : t('Transcribed on this computer in {n} s — check the wording, then save.', { n })); }
    } catch (e) { dict = null; micNote(target, e.message, true); }
  };
  mr.start(); dict.timer = setInterval(() => { if (Date.now() - dict.t0 > 180000) mr.stop(); else micUi(); }, 500);
  micUi(); announce(t('Recording. Press stop when you have finished speaking.'));
}
// Manual upload: a PDF/text file, or pasted text.
async function saveManual(blob, name) {
  const st = $('#man-st'); if (st) st.textContent = t('Reading the manual…');
  try { const r = await api(`/api/sessions/${sid}/manual`, { method: 'PUT', raw: blob, type: blob.type || 'text/plain', headers: { 'x-filename': encodeURIComponent(name).slice(0, 100) } }); announce(t('Manual saved ({n} characters).', { n: r.chars })); await open(sid, true); }
  catch (e) { if (st) st.textContent = e.message; announce(e.message); }
}
const act = async (fn, ok) => { try { await fn(); if (ok) announce(ok); } catch (e) { announce(e.message); alert(e.message); } await open(sid, true); };
document.addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return; const a = b.dataset.a;
  if (b.dataset.signout) return signOut();
  if (b.dataset.open || b.id === 'lang-toggle') return;
  if (b.dataset.reset) { fillDefaults(); return; }
  if (a === 'golive') { const last = store.get('lastSession'); if (last) open(last); }
  if (a === 'retry-skills') { skills = null; skillsErr = null; loadSkills(); }
  if (a === 'retry-profile' && pick.skill) { delete profErr[LANG + ':' + pick.skill]; selectSkill(pick.skill); }
  if (a === 'openk') openPanel(b.dataset.id, b);
  if (a === 'closek') closePanel();
  if (a === 'kfilter') { kFilter = b.dataset.v; render(); }
  if (a === 'convert') convert(b.dataset.id);
  if (a === 'mic') dictate(b.dataset.target);
  if (a === 'suggest') suggestReply(b);
  if (a === 'play') { const v = $('#v-' + b.dataset.rec); if (v) { if (panelK && window.innerWidth < 900) closePanel(); v.currentTime = +b.dataset.t; v.play().catch(() => {}); v.scrollIntoView({ block: 'center' }); } }
  if (a === 'analyze') act(() => api(`/api/recordings/${b.dataset.id}/analyze`, { method: 'POST', body: { maxQuestions: 5 } }), t('Analysis started — up to 5 questions'));
  if (a === 'more') act(() => api(`/api/recordings/${b.dataset.id}/more`, { method: 'POST', body: { count: +b.dataset.n } }), t('Writing {n} more questions…', { n: b.dataset.n }));
  // Deletes go to "Recently deleted" (restorable); only "Delete for good" there is permanent.
  if (a === 'delrec') {
    const qs = D.questions.filter((x) => x.recording_id === b.dataset.id), ks = D.knowledge.filter((k) => k.recording_id === b.dataset.id && qs.some((x) => x.id === k.question_id)), ap = ks.filter((k) => k.status === 'approved').length;
    if (confirm(t('Delete this recording?') + '\n\n' + t('Its {q} questions and {k} knowledge records go with it.', { q: qs.length, k: ks.length }) + (ap ? ' ' + t('This includes {n} APPROVED lessons students can see now.', { n: ap }) : '') + '\n\n' + t('You can restore it from “Recently deleted” for {n} days.', { n: D.trashDays })))
      act(() => api('/api/recordings/' + b.dataset.id, { method: 'DELETE' }), t('Recording moved to Recently deleted'));
  }
  if (a === 'delq' && confirm(t('Remove this question? You can restore it from “Recently deleted”.'))) act(() => api('/api/questions/' + b.dataset.id, { method: 'DELETE' }), t('Question removed'));
  if (a === 'delk') { const k = D.knowledge.find((x) => x.id === b.dataset.id); if (confirm(t('Delete this knowledge record?') + (k?.status === 'approved' ? ' ' + t('Students can see it now.') : '') + ' ' + t('Its question opens again so you can re-answer it. You can restore it from “Recently deleted”.'))) { panelK = null; act(() => api('/api/knowledge/' + b.dataset.id, { method: 'DELETE' }), t('Knowledge record deleted')); } }
  if (a === 'delh' && confirm(t('Delete this help request and your replies? The student will no longer see it. You can restore it from “Recently deleted”.'))) act(() => api('/api/help/' + b.dataset.id, { method: 'DELETE' }), t('Help request deleted'));
  if (a === 'restore') act(() => api(`/api/trash/${b.dataset.id}/restore`, { method: 'POST' }), t('Restored'));
  if (a === 'purge' && confirm(t('Delete this for good? This cannot be undone.'))) act(() => api('/api/trash/' + b.dataset.id, { method: 'DELETE' }), t('Deleted for good'));
  if (a === 'rephrase' && !rewriting.has(b.dataset.id)) {
    const id = b.dataset.id; rewriting.add(id); render(); announce(t('Writing a different question…'));
    act(() => api(`/api/questions/${id}/rephrase`, { method: 'POST' }).finally(() => rewriting.delete(id)), t('New question written'));
  }
  if (a === 'aifill') act(() => api(`/api/knowledge/${b.dataset.id}/ai-fill`, { method: 'POST' }), t('The AI is filling the record from your words'));
  if (a === 'upmanual') { const f = $('#man-file')?.files?.[0]; if (!f) { $('#man-st').textContent = t('Choose a file first.'); return; } saveManual(f, f.name); }
  if (a === 'pastemanual') { const v = $('#man-text')?.value.trim(); if (!v) { $('#man-st').textContent = t('Paste some text first.'); return; } saveManual(new Blob([v], { type: 'text/plain' }), t('Pasted text')); }
  if (a === 'delmanual' && confirm(t('Remove your manual from this session? The built-in guidance stays.'))) act(() => api(`/api/sessions/${sid}/manual`, { method: 'DELETE' }), t('Manual removed'));
  if (a === 'rotate') act(() => api(`/api/sessions/${sid}/rotate`, { method: 'POST' }).then(() => { LK = null; }), t('Join links rotated'));
  if (a === 'del' && confirm(t('Permanently delete this session, its recordings, snapshots, knowledge and help requests? This cannot be undone.'))) api('/api/sessions/' + sid, { method: 'DELETE' }).then(() => { sid = null; D = null; store.set('lastSession', null); list(); announce(t('Session deleted')); }, (x) => alert(x.message));
  if (a === 'hs') act(() => api('/api/help/' + b.dataset.id, { method: 'PATCH', body: { status: b.dataset.s } }), t('Status updated'));
});
document.addEventListener('change', (e) => {
  if (e.target.name === 'skill') selectSkill(e.target.value);
  if (e.target.dataset.a === 'stt') { sttMode = e.target.value; store.set('stt', sttMode); }
  if (e.target.dataset.a === 'slang') act(() => api('/api/sessions/' + sid, { method: 'PATCH', body: { lang: e.target.value } }), t('AI language changed'));
  if (e.target.id === 'task') { pick.task = e.target.value || null; renderTask(); const tk = curTask(); if (tk) announce(t('{title} selected. Procedure updated.', { title: tk.title })); }
});
document.addEventListener('input', (e) => { if (e.target.id === 't') draftTitle = e.target.value; if (e.target.id === 'k' || e.target.id === 'p') markEdited(); if (e.target.id?.startsWith('cu-')) ready(); });
document.addEventListener('submit', (e) => {
  const f = e.target, a = f.dataset.a; if (!a) return; e.preventDefault(); const id = f.dataset.id;
  if (a === 'moment') act(() => api(`/api/recordings/${id}/moments`, { method: 'POST', body: { t: +f.querySelector('input[type=number]').value, text: f.querySelector('input:not([type=number])').value } }), t('Moment added'));
  if (a === 'answer') act(() => api(`/api/questions/${id}/answer`, { method: 'POST', body: { text: f.querySelector('textarea').value } }), t('Answer saved'));
  if (a === 'reply') act(() => api(`/api/help/${id}/reply`, { method: 'POST', body: { text: f.querySelector('textarea').value } }), t('Reply sent'));
  if (a === 'kn') { const body = Object.fromEntries(new FormData(f)); if (e.submitter.dataset.s) body.status = e.submitter.dataset.s; act(() => api('/api/knowledge/' + id, { method: 'PATCH', body }), body.status === 'approved' ? t('Record approved') : t('Record updated')); }
});
// Switching the interface language redraws everything in place (profiles are fetched again in that language).
// Switching language redraws the page; anything typed (answers, replies, forms) is put back once its field reappears.
function keepTyped() {
  const v = {}; document.querySelectorAll('textarea[id], input[id]:not([type=radio]):not([type=checkbox]):not([type=file]), select[id]').forEach((e) => { if (e.value && !(e.tagName === 'SELECT' && e.id === 'lang')) v[e.id] = e.value; });
  if (!Object.keys(v).length) return;
  const put = () => { for (const [id, val] of Object.entries(v)) { const e = document.getElementById(id); if (e && !e.value) { e.value = val; delete v[id]; } } return !Object.keys(v).length; };
  const mo = new MutationObserver(() => { if (put()) mo.disconnect(); }); mo.observe(document.body, { childList: true, subtree: true });
  setTimeout(() => mo.disconnect(), 8000);
}
onLang(() => { keepTyped(); if (!['auto', 'translate'].includes(sttMode)) { sttMode = LANG; store.set('stt', sttMode); } skills = null; prof = {}; profErr = {}; if (redrawAuth) { redrawAuth(); renderNav(); } else if (me) list(); });
boot();
