import { $, esc, api, announce, consentHtml, ping, mmss, stream, skillBadge, icon, PHOTO, procHtml, safetyItem, authForm, signOut, whoHtml, connDot, t, tn } from '/common.js';
import { initFx } from '/fx.js';
import { initLang, onLang, when } from '/i18n.js';
initLang(); initFx();
const app = $('#app'); let token = location.hash.slice(1), info, media, mr, chunks = [], blob, mime, sec = 0, tick, state = 'idle', pinger, es, signedIn = false, watching = null, view = 'boot', redrawAuth = null, briefOpen = false;
const MIMES = ['video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
let skills = null, prof = {};

// Requests from this phone carry its invite (x-token) and the interface language.
const req = (path, o = {}) => api(path, { ...o, token });

// ---- entry: an invite QR goes straight to recording; otherwise the master signs in and picks or creates a session ----
async function boot() {
  stopDevices();
  if (token) return consent();
  signedIn = await api('/api/me').then(() => true, () => false);
  return signedIn ? home() : login();
}
function login() {
  view = 'login';
  redrawAuth = authForm(app, { text: () => ({ eyebrow: t('師匠 · Master phone'), title: t('Sign in to record'), intro: t('Create a session or choose one, record your demonstration and upload it. Got a QR code from the dashboard? Just scan it instead.') }), onDone: boot });
}
async function home() {
  view = 'home';
  let ss, me; try { [ss, me] = await Promise.all([api('/api/sessions'), api('/api/me')]); } catch { return login(); }
  app.innerHTML = `<section class="card" aria-labelledby="hh"><span class="eyebrow">${t('師匠 · Master phone')}</span><h1 id="hh">${t('Your sessions')}</h1><p>${whoHtml(me)}</p>
  <p class="hint">${t('Record into an existing session, or start a new one for any skill. Questions and knowledge are reviewed on the laptop.')} <a href="/dashboard#live">${t('Go to live dashboard')}</a></p>
  <button class="btn big primary" id="new" aria-expanded="false">${t('+ New session')}</button><div id="nf"></div>
  ${ss.length ? `<ul class="sess-list">${ss.map((s) => `<li class="sess-item"><div class="info"><strong>${esc(s.title)}</strong><p class="task">${esc(s.task || '')}</p><div class="row">${skillBadge(s.skill_id || 'soldering', s.skill_name || t('Unknown skill'))}</div><p class="hint">${t('{a} rec · {b} to answer · {c} approved', { a: s.recordings, b: s.open_questions, c: s.approved })}</p></div><button class="btn primary" data-pick="${esc(s.id)}" aria-label="${t('Record into {title}', { title: esc(s.title) })}">${t('Record')}</button></li>`).join('')}</ul>` : `<p class="empty">${t('No sessions yet. Create your first one above.')}</p>`}</section>`;
  app.querySelector('[data-signout]').onclick = signOut;
  $('#new').onclick = () => { const open = $('#nf').innerHTML === ''; $('#new').setAttribute('aria-expanded', open); if (open) newForm(); else $('#nf').innerHTML = ''; };
  app.querySelectorAll('[data-pick]').forEach((b) => (b.onclick = () => pick(b.dataset.pick)));
}
async function newForm() {
  const box = $('#nf'); box.innerHTML = `<p class="hint">${t('Loading skills…')}</p>`;
  try { skills ??= (await api('/api/skills')).skills; } catch (e) { box.innerHTML = `<p class="err" role="alert">${t('Could not load skills: {msg}', { msg: esc(e.message) })}</p>`; return; }
  box.innerHTML = `<form id="cf" class="new-sess"><label for="ttl">${t('Session title')}</label><input id="ttl" required maxlength="120" placeholder="${t('e.g. Morning demo')}">
  <fieldset><legend>${t('Skill')}</legend><div class="skill-pick">${[...skills, { id: 'custom', name: t('Another skill'), category: t('Define your own') }].map((s) => `<label class="skill-opt"><input type="radio" name="skill" value="${esc(s.id)}" required><span class="ico">${icon(s.id)}</span><span><b>${esc(s.name)}</b><small>${esc(s.category)}</small></span><span class="chk" aria-hidden="true">✓</span></label>`).join('')}</div></fieldset>
  <div id="taskbox"></div><label for="lng">${t('Language of AI questions and lessons')}</label><select id="lng"><option value="en">${t('English')}</option><option value="ja">${t('Japanese (日本語)')}</option></select>
  <button class="btn big primary" id="mk" disabled>${t('Create and record')}</button><p id="cerr" class="err" role="alert"></p></form>`;
  $('#cf').onchange = async (e) => { if (e.target.name === 'skill') await taskFields(e.target.value); };
  $('#cf').onsubmit = create;
}
async function taskFields(id) {
  const box = $('#taskbox'); $('#mk').disabled = true;
  if (id === 'custom') {
    box.innerHTML = `<label for="cn">${t('Skill name')}</label><input id="cn" required maxlength="80" placeholder="${t('e.g. Woodturning, Calligraphy, Bread baking')}">
    <label for="ct">${t('Task you will demonstrate')}</label><input id="ct" required maxlength="300" placeholder="${t('e.g. Turn a small wooden bowl')}">
    <label for="ctools">${t('Tools')} <span class="hint">${t('(one per line, optionally “name — purpose”)')}</span></label><textarea id="ctools" rows="3"></textarea>
    <label for="csafe">${t('Safety notes')} <span class="hint">${t('(one per line, shown to students)')}</span></label><textarea id="csafe" rows="2"></textarea>
    <label for="cp">${t('Steps')} <span class="hint">${t('(optional, one per line)')}</span></label><textarea id="cp" rows="3"></textarea>`;
  } else {
    if (!prof[id]) { box.innerHTML = `<p class="hint">${t('Loading tasks…')}</p>`; try { prof[id] = await api('/api/skills/' + encodeURIComponent(id)); } catch (e) { box.innerHTML = `<p class="err" role="alert">${esc(e.message)}</p>`; return; } }
    const p = prof[id];
    box.innerHTML = `<label for="tk">${t('Task')}</label><select id="tk" required><option value="">${t('Choose a task…')}</option>${p.tasks.map((x) => `<option value="${esc(x.id)}">${esc(x.title)}</option>`).join('')}</select><p class="hint">${esc(p.description)}</p>`;
  }
  $('#mk').disabled = false;
}
async function create(e) {
  e.preventDefault(); const skill = $('#cf').querySelector('[name=skill]:checked')?.value; if (!skill) return;
  const body = { title: $('#ttl').value, skill_id: skill, lang: $('#lng').value };
  if (skill === 'custom') Object.assign(body, { task: $('#ct').value, procedure: $('#cp').value, custom: { name: $('#cn').value, tools: $('#ctools').value, safety: $('#csafe').value } });
  else {
    body.task_id = $('#tk').value;
    // The task text shown to the phones follows the language the master is using here.
    const tk = prof[skill]?.tasks.find((x) => x.id === body.task_id); if (tk && document.documentElement.lang === 'ja') Object.assign(body, { task: tk.title, procedure: tk.default_procedure || '' });
  }
  $('#mk').disabled = true; $('#mk').textContent = t('Creating…');
  try { const r = await api('/api/sessions', { method: 'POST', body }); announce(t('Session created')); pick(r.id); } catch (x) { $('#cerr').textContent = x.message; $('#mk').disabled = false; $('#mk').textContent = t('Create and record'); }
}
async function pick(id) {
  try { const L = await api(`/api/sessions/${encodeURIComponent(id)}/links`); token = L.links.master.token; history.replaceState(null, '', '#' + token); consent(); } catch (x) { alert(x.message); }
}
function goHome() { token = ''; history.replaceState(null, '', '/m.html'); boot(); }
function stopDevices() { clearInterval(pinger); pinger = null; es?.close(); es = null; media?.getTracks().forEach((x) => x.stop()); media = null; clearInterval(tick); }

// ---- recording into one session ----
async function consent() {
  view = 'consent';
  const mode = await api('/api/ai-mode').catch(() => null);
  app.innerHTML = consentHtml('master', mode);
  $('#cf').onsubmit = async (e) => { e.preventDefault(); if (!$('#ck').checked) return; $('#go').disabled = true; await join((x) => { $('#err').textContent = x.message; $('#go').disabled = false; }); };
}
let online = false;
const conn = () => { const c = $('#conn'); if (c) c.innerHTML = connDot(online); };
async function join(onErr) {
  try { info = await req('/api/join', { method: 'POST', body: { consent: true } }); } catch (x) { return x.code === 'skill_profile_unavailable' ? blocked(x.message) : onErr(x); }
  if (!pinger) pinger = setInterval(() => ping(token), 10000);
  if (!es) es = stream('/api/stream?t=' + encodeURIComponent(token), onLive, (o) => { online = o; conn(); });
  signedIn = await api('/api/me').then(() => true, () => false);
  ui(); status();
}
function blocked(m) {
  view = 'blocked';
  app.innerHTML = `<section class="card narrow blocking" aria-labelledby="bl"><span class="eyebrow">${t('Recording blocked')}</span><h1 id="bl">${t('This session can\'t start yet')}</h1><p class="err" role="alert">${esc(m)}</p><p>${t('Recording stays off because the session\'s safety and tool guidance could not be loaded. Your invitation has not been used up.')}</p><button class="btn big primary" id="retry">${t('Retry')}</button><p id="err" class="err" role="alert"></p></section>`;
  $('#retry').onclick = async () => { $('#retry').disabled = true; $('#retry').textContent = t('Retrying…'); await join((x) => { $('#err').textContent = x.message; $('#retry').disabled = false; $('#retry').textContent = t('Retry'); }); };
  $('#retry').focus();
}
function ui() {
  view = 'session';
  const s = info.session, sk = info.skill, task = sk.task;
  app.innerHTML = `${signedIn ? `<p><button class="linkbtn" id="home">${t('← All my sessions')}</button></p>` : ''}<div id="brief"><section class="card brief-head" aria-labelledby="ttl">${PHOTO.has(sk.id) ? `<div class="banner p-${sk.id}" data-kanji="${({ soldering: '鏝', bonsai: '盆栽', kintsugi: '金継', katana: '刀' })[sk.id] || '技'}" aria-hidden="true"></div>` : ''}<span class="eyebrow">${t('Master phone · 記録 Capture')}</span>
  <div class="row">${skillBadge(sk.id, sk.name)}${sk.category ? `<span class="badge b-off">${esc(sk.category)}</span>` : ''}</div>
  <h1 id="ttl">${esc(s.title)}</h1><dl class="kv"><dt>${t('Task')}</dt><dd>${s.task ? esc(s.task) : `<span class="empty">${t('No task title')}</span>`}</dd>${task?.summary ? `<dt>${t('Objective')}</dt><dd>${esc(task.summary)}</dd>` : ''}${task?.visual_cues ? `<dt>${t('Good result')}</dt><dd>${esc(task.visual_cues)}</dd>` : ''}</dl></section>
  <section class="card safety" aria-labelledby="sf"><h2 id="sf">${t('Safety first')}</h2><ul>${sk.safety_advisories.map((a) => `<li>${safetyItem(a)}</li>`).join('')}</ul></section>
  <section class="card tools-card" aria-labelledby="tl"><h2 id="tl">${t('Tools for this task')}</h2>${sk.tools.length ? `<ul class="tools stack">${sk.tools.map((x) => `<li><strong>${esc(x.name)}</strong>${x.purpose ? `<span>${esc(x.purpose)}</span>` : ''}</li>`).join('')}</ul>` : `<p class="empty">${t('No tools listed.')}</p>`}</section>
  <section class="card steps-card" aria-labelledby="pr"><h2 id="pr">${t('Procedure')}</h2>${procHtml(s.procedure)}</section></div>
  <section class="card" id="sess-st" aria-live="polite"></section>
  <section class="card" id="ready"><p>${t('Do the task naturally; nothing interrupts you. Afterwards the AI asks about what a manual would not tell a beginner — why you do things your way. You answer on the laptop, by typing or speaking.')}</p><button class="btn big primary" id="ok">${t('I\'ve reviewed the briefing — set up recording')}</button><p class="hint">${t('The camera stays off until you turn it on.')}</p>
  <div class="or-file"><span class="hint">${t('Already filmed it?')}</span><label class="btn big" for="vfile">📁 ${t('Upload a video from this phone')}</label><input type="file" id="vfile" class="sr" accept="video/*,.mp4,.m4v,.mov,.webm,.mkv"></div></section>
  <section class="card" id="recsec" aria-labelledby="rh" hidden><h2 id="rh" tabindex="-1">${t('Record the demonstration')}</h2><p class="hint">${t('Limit: {m} min / {mb} MB.', { m: info.limits.maxRecSec / 60, mb: info.limits.maxVideoMb })}</p>
  <div class="cam-wrap"><video id="pv" playsinline muted aria-label="${t('Live camera preview')}"></video><p id="st" role="status" class="rec" hidden><span class="dot"></span> ${t('Recording')} <span id="clk">00:00</span></p></div>
  <div class="row"><button class="btn big primary" id="cam">${t('Turn on camera and microphone')}</button><button class="btn big sos" id="rec" disabled>${t('Start recording')}</button><button class="btn big" id="pau" disabled>${t('Pause')}</button><button class="btn big" id="stp" disabled>${t('Stop')}</button><label class="btn big" for="vfile2">📁 ${t('Upload a video from this phone')}</label><input type="file" id="vfile2" class="sr" accept="video/*,.mp4,.m4v,.mov,.webm,.mkv"></div>
  <div id="up" hidden><label for="pg">${t('Upload progress')}</label><progress id="pg" max="100" value="0"></progress><div class="row"><button class="btn big primary" id="send">${t('Upload recording')}</button><button class="btn big" id="dis">${t('Discard')}</button></div></div><p id="msg" role="alert"></p></section>
  <section class="card" id="next" aria-labelledby="nx" hidden></section>`;
  window.scrollTo(0, 0);
  if (PHOTO.has(sk.id)) app.insertAdjacentHTML('beforeend', `<p class="credits">${t('Photo:')} ${PHOTO.get(sk.id)}. <a href="/img/CREDITS.txt">${t('Sources & licences')}</a></p>`);
  if ($('#home')) $('#home').onclick = goHome;
  $('#ok').onclick = showRecorder; $('#vfile2').onchange = $('#vfile').onchange = (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) pickFile(f); };
  $('#cam').onclick = camera; $('#rec').onclick = start; $('#pau').onclick = pause; $('#stp').onclick = stop; $('#send').onclick = upload; $('#dis').onclick = () => { blob = null; $('#up').hidden = true; msg(t('Discarded.')); };
  conn();
}
function showRecorder() {
  if (!$('#ready')) return; // already set up
  // Keep the briefing one tap away while the camera gets the screen.
  briefOpen = true;
  const b = $('#brief'), d = document.createElement('details'); d.innerHTML = `<summary>${t('Task briefing — safety, tools and steps')}</summary>`; b.before(d); d.append(b);
  $('#ready').remove(); $('#recsec').hidden = false; $('#rh').focus(); announce(t('Recording controls ready. Camera is still off.'));
}
const msg = (m, bad) => { const e = $('#msg'); if (!e) return; e.textContent = m; e.className = bad ? 'err' : ''; announce(m); };
async function camera() {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return msg(t('This browser cannot record video. Use current Chrome, Safari 14.1+ or Firefox. On non-localhost addresses the page must be HTTPS (see README).'), true);
  try { media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: true }); } catch (e) { return msg(e.name === 'NotAllowedError' ? t('Camera/microphone permission was denied. Allow it in the browser site settings, then retry.') : t('Could not open camera: {msg}', { msg: e.message }), true); }
  $('#pv').srcObject = media; $('#pv').play(); $('#rec').disabled = false; $('#cam').disabled = true; msg(t('Camera ready. Nothing is recorded yet.'));
}
function start() {
  mime = MIMES.find((m) => MediaRecorder.isTypeSupported(m)); if (!mime) return msg(t('No supported video format in this browser.'), true);
  chunks = []; sec = 0; mr = new MediaRecorder(media, { mimeType: mime, videoBitsPerSecond: 1_200_000 }); // ~90 MB for 10 min: fits the tunnel's 100 MB upload limit
  mr.ondataavailable = (e) => e.data.size && chunks.push(e.data); mr.onstop = done; mr.start(1000); state = 'rec';
  $('#st').hidden = false; $('#rec').disabled = true; $('#pau').disabled = false; $('#stp').disabled = false; $('#up').hidden = true;
  tick = setInterval(() => { if (state === 'rec') { sec++; $('#clk').textContent = mmss(sec); if (sec >= info.limits.maxRecSec) stop(); } }, 1000); msg(t('Recording started.'));
}
function pause() { if (state === 'rec') { mr.pause(); state = 'pause'; $('#pau').textContent = t('Resume'); msg(t('Paused.')); } else { mr.resume(); state = 'rec'; $('#pau').textContent = t('Pause'); msg(t('Recording resumed.')); } }
function stop() { clearInterval(tick); if (mr && mr.state !== 'inactive') mr.stop(); state = 'idle'; $('#st').hidden = true; $('#pau').disabled = $('#stp').disabled = true; $('#pau').textContent = t('Pause'); $('#rec').disabled = false; if (langPending) { langPending = false; redraw(); } }
function done() { blob = new Blob(chunks, { type: mime.split(';')[0] }); showUpload(); }
const showUpload = () => { const mb = blob.size / 1e6; $('#up').hidden = false; $('#pg').value = 0; msg(t('Recorded {time} ({mb} MB). Upload it, or discard.', { time: mmss(sec), mb: mb.toFixed(1) }), mb > info.limits.maxVideoMb); $('#send').disabled = mb > info.limits.maxVideoMb; };
// A video filmed earlier (phone gallery or another camera) goes through the same upload and AI analysis.
const VIDEO_EXT = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska' };
function pickFile(f) {
  const type = Object.values(VIDEO_EXT).includes(f.type) ? f.type : VIDEO_EXT[(f.name.split('.').pop() || '').toLowerCase()];
  showRecorder();
  if (!type) return msg(t('This file type is not supported. Use MP4, MOV, WebM or MKV.'), true);
  blob = type === f.type ? f : new Blob([f], { type }); blob.fromFile = true;
  const mb = f.size / 1e6, tooBig = mb > info.limits.maxVideoMb;
  $('#up').hidden = false; $('#pg').value = 0; $('#send').disabled = tooBig;
  msg(tooBig ? t('This video is {a} MB; the limit here is {b} MB. Trim it or export it at a lower quality.', { a: mb.toFixed(0), b: info.limits.maxVideoMb }) : t('Selected {name} ({mb} MB). Upload it, or discard.', { name: f.name, mb: mb.toFixed(1) }), tooBig);
  $('#up').scrollIntoView({ block: 'center' });
}
function upload() {
  if (!blob) return; const x = new XMLHttpRequest(); x.open('POST', '/api/recordings'); x.setRequestHeader('x-token', token); x.setRequestHeader('content-type', blob.type); if (blob.fromFile) x.setRequestHeader('x-source', 'file');
  x.upload.onprogress = (e) => { if (e.lengthComputable) $('#pg').value = (e.loaded / e.total) * 100; }; $('#send').disabled = true; msg(t('Uploading…'));
  x.onload = () => { const d = JSON.parse(x.responseText || '{}'); if (x.status === 201) { msg(t('Uploaded.')); blob = null; $('#up').hidden = true; watching = d.id; nextStep(); } else { msg(t('Upload failed: {msg}. Your recording is still on this phone — press Upload to retry.', { msg: d.error || x.status }), true); $('#send').disabled = false; } };
  x.onerror = () => { msg(t('Network error. Your recording is kept — press Upload to retry.'), true); $('#send').disabled = false; }; x.send(blob);
}

// ---- after upload: start the AI from the phone, watch it, then hand over to the laptop ----
let aiOn = false;
async function nextStep() {
  const st = await req('/api/phone/status').catch(() => null), n = $('#next'); n.hidden = false; aiOn = !!st?.aiConfigured;
  const w = st?.recordings.find((x) => x.id === watching);
  n.innerHTML = `<h2 id="nx" tabindex="-1">${t('✓ Uploaded — next, the questions')}</h2>${aiOn ? `<p>${t('The AI looks for the key moments and asks about what a manual would not tell a beginner. It starts with 5 questions; you can ask for more later.')}</p>
  ${w?.status === 'analyzed' ? '' : `<button class="btn big primary" id="an"${w?.status === 'analyzing' ? ' disabled' : ''}>${t('Find 5 questions with AI')}</button>`}`
    : `<p>${t('No local AI is set up on the laptop, so add the key moments by hand on the dashboard.')}</p>`}
  <div id="aprog" role="status"></div><p class="hint">${t('You can also do this later from the laptop dashboard.')}</p><div class="row"><button class="btn big" id="again">${t('Record another take')}</button><button class="btn big danger" data-delrec="${watching}">${t('Uploaded by mistake? Delete it')}</button></div>`;
  $('#nx').focus();
  if ($('#an')) $('#an').onclick = analyse;
  $('#again').onclick = () => { n.hidden = true; $('#recsec').scrollIntoView(); };
  status();
}
async function analyse() {
  $('#an').disabled = true;
  try { await req(`/api/recordings/${watching}/analyze`, { method: 'POST', body: { maxQuestions: 5 } }); $('#aprog').innerHTML = `<p><strong>${t('Starting…')}</strong></p><progress></progress>`; announce(t('Analysis started')); }
  catch (x) { $('#aprog').innerHTML = `<p class="err">${esc(x.message)}</p>`; $('#an').disabled = false; }
}
async function more(n) {
  try { await req(`/api/recordings/${watching}/more`, { method: 'POST', body: { count: n } }); $('#aprog').innerHTML = `<p><strong>${t('Writing {n} more questions…', { n })}</strong></p><progress></progress>`; }
  catch (x) { $('#aprog').innerHTML = `<p class="err">${esc(x.message)}</p>`; }
}
function onLive(m) {
  if (m.type === 'analysis_progress' && m.recording === watching && $('#aprog')) {
    $('#aprog').innerHTML = m.phase === 'extracting' ? `<p><strong>${t('Preparing still frames…')}</strong></p><progress></progress>`
      : m.phase === 'questions' || m.phase === 'followups' ? `<p><strong>${m.phase === 'followups' ? t('Writing follow-up questions on your answers…') : t('Writing question {a} of {b}', { a: Math.min((m.qDone || 0) + 1, m.qTotal || 1), b: m.qTotal || '?' })}</strong></p><progress max="${m.qTotal || 1}" value="${m.qDone || 0}"></progress>`
      : `<p><strong>${t('Looking at frame {a} of {b}', { a: Math.min(m.done + 1, m.total), b: m.total })}</strong></p><progress max="${m.total}" value="${m.done}"></progress><p class="hint">${t('The laptop stays usable while this runs.')}</p>`;
  }
  if (m.type === 'event' && /^(analysis_|more_questions|answer_saved|knowledge_approved|recording_|question_|restored)/.test(m.kind || '')) status();
}
// Session summary on the phone: what is waiting on the laptop.
async function status() {
  const st = await req('/api/phone/status').catch(() => null), box = $('#sess-st'); if (!st || !box) return;
  const r = st.recordings, w = watching && r.find((x) => x.id === watching), live = esc(st.dashboard) + '#live';
  if (w && $('#aprog') && w.status !== 'analyzing') {
    if (w.status === 'analyzed') $('#aprog').innerHTML = (w.questions
      ? `<p class="notice ok"><strong>${tn(w.questions, '{n} question is ready.', '{n} questions are ready.')}</strong>${t('Answer them on your laptop:')} <a href="${live}">${t('Go to live dashboard')}</a></p>`
      : `<p class="notice warn"><strong>${t('The AI found no moments worth asking about in this video.')}</strong>${t('Record a clearer take with your hands and the work in view, or add a moment by hand on the dashboard:')} <a href="${live}">${t('Go to live dashboard')}</a></p>`)
      + (aiOn ? `<div class="row"><button class="btn" data-more="5">${t('+5 more questions')}</button><button class="btn" data-more="10">${t('+10 more questions')}</button></div>` : '');
    if (w.status === 'failed') { $('#aprog').innerHTML = `<p class="err" role="alert">${t('Analysis failed: {msg}', { msg: esc(w.error || '') })}</p>`; if ($('#an')) { $('#an').disabled = false; $('#an').textContent = t('Try again'); } }
    if ($('#an') && w.status === 'analyzed') $('#an').remove();
  }
  const LBL = { uploaded: t('not analysed yet'), analyzing: t('analysing…'), analyzed: t('analysed'), failed: t('analysis failed') };
  box.innerHTML = `<h2>${t('This session so far')}</h2><p>${t('{a} recordings · {b} questions ({c} still to answer) · {d} approved for students', { a: r.length, b: st.questions, c: st.openQuestions, d: st.approved })}</p>${st.openQuestions ? `<p class="hint">${t('Answer the questions on the laptop:')} <a href="${live}">${t('Go to live dashboard')}</a></p>` : ''}
  ${r.length ? `<ul class="plain rec-list">${r.map((x) => `<li><span>${esc(when(x.created_at, true))} · ${(x.bytes / 1e6).toFixed(1)} MB · ${LBL[x.status] || esc(x.status)}</span><button class="btn danger" data-delrec="${esc(x.id)}"${x.status === 'analyzing' ? ' disabled' : ''}>${t('Delete')}</button></li>`).join('')}</ul>` : ''}`;
}
// Deleting moves the video and every question and knowledge record made from it to "Recently deleted" on the dashboard.
async function delRec(id) {
  if (!confirm(t('Delete this recording? Any questions and knowledge records made from it go with it. You can restore it from “Recently deleted” on the laptop dashboard.'))) return;
  try {
    await req('/api/recordings/' + encodeURIComponent(id), { method: 'DELETE' });
    if (watching === id) { watching = null; $('#next').hidden = true; }
    msg(t('Recording deleted. It can be restored from “Recently deleted” on the dashboard.')); status();
  } catch (x) { alert(x.message); }
}
app.addEventListener('click', (e) => { const b = e.target.closest('[data-delrec]'); if (b) return delRec(b.dataset.delrec); const m = e.target.closest('[data-more]'); if (m) more(+m.dataset.more); });
window.addEventListener('hashchange', () => { if (location.hash.slice(1) !== token) { token = location.hash.slice(1); boot(); } });
// Switching language redraws the current screen; during a recording it waits until the take is stopped.
let langPending = false;
function redraw() {
  if (view === 'login') return redrawAuth?.();
  if (view === 'home') return home();
  if (view === 'consent') return consent();
  if (view !== 'session') return;
  ui(); if (briefOpen) showRecorder();
  if (media) { $('#pv').srcObject = media; $('#pv').play(); $('#rec').disabled = false; $('#cam').disabled = true; }
  if (blob) showUpload();
  if (watching) nextStep(); else status();
}
onLang(() => { skills = null; prof = {}; if (state !== 'idle') { langPending = true; return; } redraw(); });
boot();
