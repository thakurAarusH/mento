import { $, esc, api, announce, consentHtml, ping, stream, mmss, skillBadge, PHOTO, procHtml, safetyItem, store, connDot, t, tn } from '/common.js';
import { initFx } from '/fx.js';
import { initLang, onLang, trServer } from '/i18n.js';
initLang(); initFx();
const app = $('#app'); let token = '', info, media, pid = null, paused = false, loop = null, spoken = new Set(), voice = true, pinger, es, tab = 'overview', view = 'boot', joinErr = '', online = false;
let lessons = [], learned = new Set(), stats = { approved: 0, practices: 0 }, unreadReplies = 0, repliesSeen = false;
const canSpeak = 'speechSynthesis' in window;
// Read-aloud: Japanese uses the laptop's local Open JTalk voice (phones often have no Japanese voice installed);
// English prefers the phone's own voice and falls back to the laptop (espeak-ng). One reused <audio> player.
const player = new Audio(); let unlocked = false;
const silentWav = () => { const n = 800, b = new ArrayBuffer(44 + n * 2), v = new DataView(b), w = (o, x) => [...x].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 8000, true); v.setUint32(28, 16000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
  return new Blob([b], { type: 'audio/wav' }); };
// Mobile browsers only play audio started by a tap; the first tap anywhere unlocks the player for later (automatic) guidance.
document.addEventListener('pointerdown', () => { if (unlocked) return; unlocked = true; player.src = URL.createObjectURL(silentWav()); player.play().catch(() => {}); }, { capture: true });
const textLang = (x) => (/[぀-ヿ一-鿿]/.test(x) ? 'ja' : 'en');
const phoneVoice = (lang) => (canSpeak ? speechSynthesis.getVoices().find((v) => v.lang?.toLowerCase().startsWith(lang)) : null);
const canRead = () => canSpeak || !!info?.tts?.length;
// A random id kept on this device, so "learned" marks survive reloads without asking for a name.
const learner = store.get('learner') || (() => { const id = 'L' + Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join(''); store.set('learner', id); return id; })();
// Requests carry this phone's invite, its anonymous device id and the interface language.
const req = (path, o = {}) => api(path, { ...o, token, headers: { 'x-learner': learner, ...(o.headers || {}) } });
// Assessment states are shown as returned: an uncertain result is never upgraded to a definite one.
const AS = () => ({
  on_track: [t('✓ On track'), t('On track'), t('Guidance from one still photo — not a competency check.')],
  possible_issue: [t('△ Possible issue'), t('Possible issue'), t('A possible concern seen in one still photo. Compare with the lessons, or ask for help.')],
  cannot_assess: [t('○ Cannot assess'), t('Cannot assess'), t('This photo is not enough for a reliable check. Adjust the camera view, or ask the master for help.')],
  safety_stop: [t('■ Stop — safety'), t('Stop for safety'), t('Stop work and make the situation safe before continuing.')],
});
const HELP_ST = () => ({ pending: t('waiting'), answered: t('answered'), resolved: t('resolved'), rejected: t('closed'), escalated: t('escalated') });
const clipOk = (c) => !!c && typeof c.url === 'string' && !!c.url && c.t !== null && c.t !== '' && Number.isFinite(+c.t) && +c.t >= 0;

// ---- joining: a QR invite (#token), a typed code (#code=…), or the session remembered on this phone ----
async function boot() {
  const h = decodeURIComponent(location.hash.slice(1));
  if (h.startsWith('code=')) return byCode(h.slice(5));
  if (h) { token = h; return consent(); }
  joinScreen();
}
function joinScreen(err) {
  view = 'join'; if (err !== undefined) joinErr = err;
  const saved = store.get('student');
  app.innerHTML = `<section class="card narrow" aria-labelledby="jh"><span class="eyebrow">${t('弟子 · Student')}</span><h1 id="jh">${t('Join a session')}</h1><p>${t('Enter the 6-character code from your master, or scan the student QR code on their dashboard.')}</p>
  <form id="jf" class="code-form"><label for="code">${t('Session code')}</label><input id="code" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="7" placeholder="K7PM2Q" required><button class="btn primary big">${t('Join')}</button></form><p id="err" class="err" role="alert">${esc(joinErr || '')}</p>
  ${saved?.token ? `<div class="notice info"><strong>${t('Continue where you left off')}</strong><button class="btn big" id="cont">${esc(saved.title || t('My last session'))}</button></div>` : ''}
  <p class="hint"><a href="/">${t('What is MENTO?')}</a></p></section>`;
  $('#jf').onsubmit = (e) => { e.preventDefault(); byCode($('#code').value); };
  if ($('#cont')) $('#cont').onclick = () => { token = saved.token; history.replaceState(null, '', '#' + token); consent(); };
  $('#code').focus();
}
async function byCode(raw) {
  const code = String(raw).toUpperCase().replace(/[^A-Z0-9]/g, '');
  try { const r = await api('/api/code', { method: 'POST', body: { code } }); token = r.token; history.replaceState(null, '', '#' + token); consent(); }
  catch (x) { history.replaceState(null, '', '/a.html'); joinScreen(x.message); }
}
async function consent() {
  view = 'consent';
  const mode = await api('/api/ai-mode').catch(() => null);
  app.innerHTML = consentHtml('student', mode);
  $('#cf').onsubmit = async (e) => { e.preventDefault(); if (!$('#ck').checked) return; $('#go').disabled = true; await join((x) => { $('#err').textContent = x.message; $('#go').disabled = false; }); };
}
async function join(onErr) {
  try { info = await req('/api/join', { method: 'POST', body: { consent: true } }); } catch (x) {
    if (x.status === 401) { store.set('student', null); history.replaceState(null, '', '/a.html'); return joinScreen(x.message); }
    return x.code === 'skill_profile_unavailable' ? blocked(x.message) : onErr(x);
  }
  store.set('student', { token, title: info.session.title });
  const beat = () => ping(token, { 'x-learner': learner }); beat();
  if (!pinger) pinger = setInterval(beat, 10000);
  ui(); if (!es) es = live();
  loadLessons(); replies();
}
function blocked(m) {
  view = 'blocked';
  app.innerHTML = `<section class="card narrow blocking" aria-labelledby="bl"><span class="eyebrow">${t('Practice blocked')}</span><h1 id="bl">${t('Practice can\'t start yet')}</h1><p class="err" role="alert">${esc(m)}</p><p>${t('Practice and the camera stay off because this session\'s safety instructions could not be loaded. Your invitation has not been used up.')}</p><button class="btn big primary" id="retry">${t('Retry')}</button><p id="err" class="err" role="alert"></p></section>`;
  $('#retry').onclick = async () => { $('#retry').disabled = true; $('#retry').textContent = t('Retrying…'); await join((x) => { $('#err').textContent = x.message; $('#retry').disabled = false; $('#retry').textContent = t('Retry'); }); };
  $('#retry').focus();
}

// ---- the student's space: Overview · Learn · Practise · Ask, all on the same session ----
const TABS = () => [['overview', t('Overview')], ['learn', t('Learn')], ['practise', t('Practise')], ['ask', t('Ask')]];
function ui() {
  view = 'session';
  const s = info.session, sk = info.skill, task = sk.task;
  app.innerHTML = `<section class="card brief-head" aria-labelledby="ttl">${PHOTO.has(sk.id) ? `<div class="banner p-${sk.id}" data-kanji="${({ soldering: '鏝', bonsai: '盆栽', kintsugi: '金継', katana: '刀' })[sk.id] || '技'}" aria-hidden="true"></div>` : ''}<span class="eyebrow">${t('Student · 稽古 Practice')}</span>
  <div class="row">${skillBadge(sk.id, sk.name)}${sk.category ? `<span class="badge b-off">${esc(sk.category)}</span>` : ''}</div>
  <h1 id="ttl">${esc(s.title)}</h1><dl class="kv"><dt>${t('Task')}</dt><dd><strong>${s.task ? esc(s.task) : t('No task title')}</strong></dd>${task?.summary ? `<dt>${t('Objective')}</dt><dd>${esc(task.summary)}</dd>` : ''}${task?.visual_cues ? `<dt>${t('Good result')}</dt><dd>${esc(task.visual_cues)}</dd>` : ''}</dl>
  <p><button class="linkbtn" id="leave">${t('Join a different session')}</button></p></section>
  <nav class="tabs" role="tablist" aria-label="${t('Student sections')}">${TABS().map(([id, n]) => `<button role="tab" id="tab-${id}" aria-controls="p-${id}" aria-selected="${id === tab}" data-tab="${id}">${n}<span class="tab-n" id="n-${id}"></span></button>`).join('')}</nav>

  <section class="tabpanel" id="p-overview" role="tabpanel" aria-labelledby="tab-overview">
  <div class="card" aria-labelledby="pg-h"><h2 id="pg-h">${t('Your progress')}</h2><div id="prog"></div></div>
  <div class="card safety" aria-labelledby="sf"><h2 id="sf">${t('Safety first — read before you start')}</h2><ul>${sk.safety_advisories.map((a) => `<li>${safetyItem(a)}</li>`).join('')}</ul></div>
  <div class="card tools-card" aria-labelledby="tl"><h2 id="tl">${t('Tools you need')}</h2>${sk.tools.length ? `<p class="hint">${t('Tick each tool as you lay it out. This checklist stays on your phone.')}</p><ul class="tools stack check-list">${sk.tools.map((x, i) => `<li><label for="tool-${i}"><input type="checkbox" id="tool-${i}"><span><strong>${esc(x.name)}</strong>${x.purpose ? `<span class="hint">${esc(x.purpose)}</span>` : ''}</span></label></li>`).join('')}</ul>` : `<p class="empty">${t('No tools listed.')}</p>`}</div>
  <div class="card steps-card" aria-labelledby="pr"><h2 id="pr">${t('Procedure')}</h2>${procHtml(s.procedure)}</div></section>

  <section class="tabpanel" id="p-learn" role="tabpanel" aria-labelledby="tab-learn"><div class="card" aria-labelledby="lh"><h2 id="lh">${t('Lessons from your master')}</h2><p class="hint">${t('Each lesson is your master\'s own explanation of a moment in their demonstration — the reasons and instincts a manual does not give. Mark a lesson as learned once you understand it.')}</p><div id="lessons"><p class="hint">${t('Loading…')}</p></div></div></section>

  <section class="tabpanel" id="p-practise" role="tabpanel" aria-labelledby="tab-practise"><div class="card" aria-labelledby="ph"><h2 id="ph">${t('Practise with camera checks')}</h2>
  <div class="gate"><label class="check" for="ack"><input type="checkbox" id="ack"> <span>${t('I have read the safety advisories (Overview) and my tools are ready.')}</span></label></div>
  <div id="stop" class="stop-banner" hidden><h2 tabindex="-1" id="stop-h">${t('■ Stop — safety concern')}</h2><p id="stop-t" role="alert"></p><p>${t('Do not continue until the situation is safe. If you are unsure, ask the master before carrying on.')}</p><div class="row"><button class="btn sos" data-help="1">${t('Ask the master for help')}</button><button class="btn" id="stop-ok">${t('It is safe now — hide this')}</button></div></div>
  <div class="cam-wrap"><video id="pv" playsinline muted aria-label="${t('Your live camera preview')}"></video></div><p id="mon" class="status-line" role="status" data-s="off">${t('Camera off.')}</p>
  <p class="hint">${t('<strong>How checking works:</strong> while monitoring is on, the app sends a still photo about every {n} s (not a video stream). Guidance is based only on the master\'s approved lessons and can be wrong or say “cannot assess”.', { n: (info.limits.snapshotMs / 1000).toFixed(1) })}</p>
  <button class="btn big primary" id="cam" disabled>${t('Turn on camera')}</button><button class="btn big" id="start" disabled>${t('Start practice')}</button><div class="row"><button class="btn big" id="pause" disabled>${t('Pause monitoring')}</button><button class="btn big" id="chk" disabled>${t('Check my work')}</button></div><button class="btn big sos" id="help">${t('I need help')}</button><button class="btn big" id="end" disabled>${t('End practice')}</button>
  <label class="check" for="vo"><input type="checkbox" id="vo"${canRead() ? (voice ? ' checked' : '') : ' disabled'}> <span>${t('Read guidance aloud (text is always shown)')}${canRead() ? (info.tts?.includes('ja') ? t(' — Japanese uses the laptop\'s voice') : '') : t(' — not available in this browser')}</span></label><p id="msg" role="alert"></p></div>
  <div class="card" aria-labelledby="fb"><h2 id="fb">${t('Guidance')}</h2><div id="log" role="log" aria-live="polite"><p class="empty">${t('Nothing yet. Results from photo checks appear here.')}</p></div></div></section>

  <section class="tabpanel" id="p-ask" role="tabpanel" aria-labelledby="tab-ask"><div class="card" aria-labelledby="ak"><h2 id="ak">${t('Ask a question')}</h2><form id="qf"><label for="q">${t('Your question')}</label><input id="q" maxlength="500" required placeholder="${t('e.g. How do I know when it\'s ready?')}">${info.stt ? `<div class="row mic-row"><button type="button" class="btn mic" id="qmic">🎤 ${t('Speak your question')}</button><span class="hint mic-st" id="qmic-st" role="status"></span></div>` : ''}<button class="btn big primary">${t('Ask')}</button></form><div id="ans" aria-live="polite"></div><p class="hint">${t('Answers come only from the master\'s approved lessons. If none fits, your question goes to the master.')}</p>
  <button class="btn big sos" data-help="1">${t('Ask the master directly')}</button></div>
  <div class="card" aria-labelledby="hp"><h2 id="hp">${t('Replies from the master')}</h2><div id="rep"><p class="empty">${t('No questions sent to the master yet.')}</p></div></div></section>`;
  window.scrollTo(0, 0);
  if (PHOTO.has(sk.id)) app.insertAdjacentHTML('beforeend', `<p class="credits">${t('Photo:')} ${PHOTO.get(sk.id)}. <a href="/img/CREDITS.txt">${t('Sources & licences')}</a></p>`);
  if (!canRead()) voice = false; show(tab);
  $('#leave').onclick = () => { if (pid) endP(); store.set('student', null); location.href = '/a.html'; };
  $('#ack').onchange = gate; $('#cam').onclick = camera; $('#start').onclick = startP; $('#pause').onclick = () => { paused = !paused; $('#pause').textContent = paused ? t('Resume monitoring') : t('Pause monitoring'); mon(); }; $('#chk').onclick = () => snap(true);
  $('#help').onclick = () => askHelp('The student pressed “I need help”.');
  $('#stop-ok').onclick = () => { $('#stop').hidden = true; };
  $('#end').onclick = endP; $('#vo').onchange = (e) => { voice = e.target.checked; if (canSpeak) speechSynthesis.cancel(); player.pause(); };
  $('#qf').onsubmit = ask; if ($('#qmic')) $('#qmic').onclick = speakQuestion;
  conn();
}
const conn = () => { const c = $('#conn'); if (c) c.innerHTML = connDot(online); };
// Panels stay in the page (practice keeps running on other tabs); inactive ones are only moved out of view.
function show(id) {
  tab = id;
  for (const [x] of TABS()) { $('#tab-' + x).setAttribute('aria-selected', x === id); $('#p-' + x).classList.toggle('tab-off', x !== id); $('#p-' + x).toggleAttribute('inert', x !== id); }
  if (id === 'ask') { unreadReplies = 0; counts(); }
}
function counts() {
  if (view !== 'session') return;
  const left = lessons.filter((k) => !learned.has(k.id)).length;
  $('#n-learn').textContent = lessons.length ? ` ${learned.size}/${lessons.length}` : '';
  $('#n-practise').textContent = pid ? ' ●' : '';
  $('#n-ask').textContent = unreadReplies ? ' ' + t('{n} new', { n: unreadReplies }) : '';
  const pct = lessons.length ? Math.round((learned.size / lessons.length) * 100) : 0, next = lessons.find((k) => !learned.has(k.id));
  $('#prog').innerHTML = lessons.length ? `<p><strong>${t('{a} of {b} lessons learned', { a: learned.size, b: lessons.length })}</strong> (${pct}%)</p><progress max="${lessons.length}" value="${learned.size}" aria-label="${t('Lessons learned')}">${pct}%</progress>
    ${next ? `<p>${t('Next lesson:')} <button class="linkbtn" data-goto="${esc(next.id)}">${esc(next.step || next.summary || next.verbatim).slice(0, 80)}</button></p>` : `<p class="notice ok"><strong>${t('All lessons learned.')}</strong>${t('Practise with camera checks to put them into your hands.')}</p>`}
    <p class="hint">${tn(stats.practices, '{n} practice session in this class', '{n} practice sessions in this class')} · ${tn(left, '{n} lesson to go', '{n} lessons to go')}</p>`
    : `<p>${t('Your master has not approved any lessons yet. They appear here automatically as soon as they do; meanwhile, read the safety notes and procedure below.')}</p>`;
}

// ---- Learn: approved lessons grouped by step, with the master's clip ----
async function loadLessons() {
  try {
    const [ks, p] = await Promise.all([req('/api/knowledge'), req('/api/progress')]);
    lessons = ks.sort((a, b) => (a.t ?? 0) - (b.t ?? 0)); learned = new Set(p.learned.map((x) => x.id)); stats = p;
  } catch (e) { if ($('#lessons')) $('#lessons').innerHTML = `<p class="err" role="alert">${esc(e.message)}</p>`; return; }
  renderLessons(); counts();
}
function renderLessons() {
  if (!$('#lessons')) return;
  if (!lessons.length) { $('#lessons').innerHTML = `<p class="empty">${t('No approved lessons yet. They will appear here automatically when your master approves them.')}</p>`; return; }
  const groups = new Map(); for (const k of lessons) { const g = k.step?.trim() || t('General'); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(k); }
  $('#lessons').innerHTML = [...groups].map(([g, ks]) => `<h3 class="lesson-step">${esc(g)}</h3>${ks.map(lessonHtml).join('')}`).join('');
}
const lessonHtml = (k) => { const done = learned.has(k.id); return `<article class="moment expert lesson${done ? ' learned' : ''}" id="ls-${esc(k.id)}" tabindex="-1">
  ${k.summary ? `<p class="lesson-sum">${esc(k.summary)}</p>` : ''}<p><span class="tag">${t('In the master\'s words')}</span><br>“${esc(k.verbatim)}”</p>
  ${k.cues ? `<p><span class="tag">${t('What to look for')}</span><br>${esc(k.cues)}</p>` : ''}${k.warnings ? `<p class="notice bad"><strong>${t('Watch out')}</strong>${esc(k.warnings)}</p>` : ''}${k.tool ? `<p class="hint">${t('Tool:')} ${esc(k.tool)}</p>` : ''}
  <div class="row">${canRead() ? `<button class="btn" data-say="${esc(k.id)}" aria-label="${t('Listen to this lesson')}">🔊 ${t('Listen')}</button>` : ''}${clipOk(k.clip) ? `<button class="btn" data-lclip="${esc(k.id)}">${t('▶ Watch the master ({time})', { time: mmss(k.clip.t) })}</button>` : ''}<button class="btn${done ? '' : ' primary'}" data-learn="${esc(k.id)}" aria-pressed="${done}">${done ? t('✓ Learned') : t('Mark as learned')}</button></div>
  <video id="lv-${esc(k.id)}" controls playsinline hidden aria-label="${t('Master\'s demonstration clip')}"></video></article>`; };
async function toggleLearned(id) {
  const on = !learned.has(id);
  try { await req('/api/progress', { method: 'POST', body: { knowledge_id: id, learned: on } }); } catch (e) { return alert(e.message); }
  if (on) learned.add(id); else learned.delete(id);
  const el = $('#ls-' + CSS.escape(id)); if (el) el.outerHTML = lessonHtml(lessons.find((k) => k.id === id));
  counts(); announce(on ? t('Marked as learned') : t('Marked as not learned'));
}

// ---- Practise ----
function gate() { const ok = $('#ack').checked; $('#cam').disabled = !ok || !!media; $('#start').disabled = !(ok && media && !pid); }
async function askHelp(q) { try { await req('/api/help', { method: 'POST', body: { question: q } }); note(t('Help request sent to the master. Their reply appears under Ask.')); announce(t('Help request sent')); } catch (e) { note(e.message, true); } }
const note = (m, bad) => { const e = $('#msg'); if (!e) return; e.textContent = m; e.className = bad ? 'err' : ''; announce(m); };
const mon = (busy) => { const e = $('#mon'); if (!e) return; const [s, m] = !media ? ['off', t('Camera off.')] : !pid ? ['off', t('Camera on. Not monitoring.')] : paused ? ['paused', t('Monitoring paused — no photos are sent.')] : busy ? ['paused', busy] : ['live', t('Monitoring ON — sending a still photo every few seconds.')]; e.dataset.s = s; e.textContent = m; };
// Read-aloud always speaks the interface language. A tip written in the other language is translated on the laptop
// first; if that is not possible it is read in its own language, and the student is told so.
const uiLang = () => (document.documentElement.lang === 'ja' ? 'ja' : 'en');
function speak(text, lang) {
  const server = info?.tts?.includes(lang), viaPhone = () => { const x = new SpeechSynthesisUtterance(text); x.lang = lang === 'ja' ? 'ja-JP' : 'en-US'; const pv = phoneVoice(lang); if (pv) x.voice = pv; speechSynthesis.speak(x); };
  if (canSpeak) speechSynthesis.cancel(); player.pause();
  // English: the phone's own voice when it has one; otherwise (and for Japanese) the laptop's local voice.
  if (lang === 'en' && phoneVoice('en')) return viaPhone();
  if (server) { player.src = `/api/tts?t=${encodeURIComponent(token)}&lang=${lang}&text=${encodeURIComponent(text.slice(0, 600))}`; return player.play().catch(() => { if (canSpeak) viaPhone(); }); }
  if (canSpeak) viaPhone();
}
async function say(text, force, btn) {
  if ((!voice && !force) || !text) return;
  const want = uiLang(); let words = text, lang = textLang(text);
  if (lang !== want) {
    const label = btn?.textContent; if (btn) { btn.disabled = true; btn.textContent = t('Translating…'); }
    try { words = (await req('/api/say', { method: 'POST', body: { text, lang: want } })).text; lang = want; }
    catch { if (force) announce(t('This tip could not be translated right now, so it is read in its original language.')); }
    finally { if (btn) { btn.disabled = false; btn.textContent = label; } }
  }
  speak(words, lang);
}
function logAssessment(a) {
  const known = AS()[a.status], [lab, spoken0, expl] = known || ['○ ' + String(a.status), t('Unrecognised result'), t('Unrecognised result — treat it as uncertain.')];
  const l = $('#log'); if (l.querySelector('.empty')) l.innerHTML = '';
  const askBtn = a.status === 'on_track' ? '' : `<div class="row" style="margin-top:.4rem"><button class="btn${a.status === 'safety_stop' ? ' sos' : ''}" data-help="1">${t('Ask the master for help')}</button></div>`;
  l.insertAdjacentHTML('afterbegin', `<div class="moment as as-${known ? a.status : 'cannot_assess'}"><span class="hint">${new Date().toLocaleTimeString(document.documentElement.lang === 'ja' ? 'ja-JP' : undefined)}</span><span class="as-label">${esc(lab)}</span><p style="margin:.2rem 0">${esc(trServer(a.feedback))}</p>${a.evidence ? `<p class="hint">${t('Visible evidence:')} ${esc(a.evidence)}</p>` : ''}${a.confidence ? `<p class="hint">${t('Model-reported confidence:')} ${esc(t(a.confidence))}</p>` : ''}<span class="as-note">${esc(expl)}</span>${askBtn}</div>`);
  say(`${spoken0}: ${trServer(a.feedback)}`);
  if (a.status === 'safety_stop') { show('practise'); $('#stop-t').textContent = trServer(a.feedback) || t('A safety concern was flagged.'); $('#stop').hidden = false; $('#stop').scrollIntoView({ block: 'center' }); $('#stop-h').focus(); }
}
async function camera() {
  if (!navigator.mediaDevices?.getUserMedia) return note(t('Camera not available. On non-localhost addresses the page must be HTTPS (see README).'), true);
  try { media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }); } catch (e) { return note(e.name === 'NotAllowedError' ? t('Camera permission denied. Allow it in browser site settings and retry.') : t('Camera error: {msg}', { msg: e.message }), true); }
  $('#pv').srcObject = media; $('#pv').play(); gate(); mon();
}
async function startP() {
  $('#start').disabled = true;
  try { pid = (await req('/api/practice/start', { method: 'POST' })).id; } catch (e) {
    pid = null; gate();
    return note(e.code === 'skill_profile_unavailable' ? t('Practice blocked: {msg} No photos will be sent. Press Start practice to retry.', { msg: e.message }) : e.message, true);
  }
  practiceButtons(); mon(); counts(); note(t('Practice started. Monitoring is on.')); schedule();
}
const practiceButtons = () => { $('#pause').disabled = $('#chk').disabled = $('#end').disabled = !pid; $('#pause').textContent = paused ? t('Resume monitoring') : t('Pause monitoring'); };
async function endP() { clearTimeout(loop); try { await req(`/api/practice/${pid}/end`, { method: 'POST' }); } catch {} pid = null; paused = false; practiceButtons(); gate(); mon(); counts(); note(t('Practice ended. The master can review it.')); loadLessons(); }
const schedule = () => { clearTimeout(loop); if (pid) loop = setTimeout(async () => { if (!paused) await snap(false); schedule(); }, info.limits.snapshotMs); }; // next photo only after the previous request finished
async function snap(manual) {
  const v = $('#pv'); if (!pid || !v.videoWidth) return; const c = document.createElement('canvas'); const w = Math.min(640, v.videoWidth); c.width = w; c.height = Math.round(w * v.videoHeight / v.videoWidth); c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
  let q = 0.6, b; do { b = await new Promise((r) => c.toBlob(r, 'image/jpeg', q)); q -= 0.15; } while (b.size > info.limits.maxFrameKb * 1024 && q > 0.2);
  try { const r = await req(`/api/practice/${pid}/snapshot${manual ? '?manual=1' : ''}`, { method: 'POST', raw: b, type: 'image/jpeg' }); if (manual) note(r.queued === false ? t('Not checked: {msg}', { msg: trServer(r.reason) }) : t('Checking… the result will appear under Guidance.')); else mon(r.queued === false && /busy/.test(r.reason || '') ? trServer(r.reason) : undefined); } catch (e) { note(e.message, true); }
}

// ---- Ask ----
// ---- speak a question: recorded on the phone, transcribed on the laptop (Whisper), in the interface language ----
let rec = null;
const MIC_TYPES = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm'];
async function speakQuestion() {
  const b = $('#qmic'), st = $('#qmic-st'), say2 = (m, bad) => { if (st) { st.textContent = m; st.className = 'hint mic-st' + (bad ? ' err' : ''); } announce(m); };
  if (rec) return rec.mr.state === 'recording' && rec.mr.stop();
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return say2(t('This browser cannot record audio on this address. Open the dashboard via localhost or the HTTPS tunnel address.'), true);
  let ms; try { ms = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); } catch { return say2(t('Microphone permission denied. Allow it in the browser, then try again.'), true); }
  const type = MIC_TYPES.find((x) => MediaRecorder.isTypeSupported(x)) || '', mr = new MediaRecorder(ms, type ? { mimeType: type } : {}), chunks = [], t0 = Date.now();
  rec = { mr }; b.classList.add('recording');
  const tick = setInterval(() => { const s = Math.floor((Date.now() - t0) / 1000); b.textContent = t('Stop and transcribe ({time})', { time: mmss(s) }); if (s >= 60) mr.stop(); }, 300);
  mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  mr.onstop = async () => {
    clearInterval(tick); ms.getTracks().forEach((x) => x.stop()); b.classList.remove('recording'); b.disabled = true; b.textContent = t('Transcribing…');
    const blob = new Blob(chunks, { type: (mr.mimeType || type || 'audio/webm').split(';')[0] });
    try {
      const d = await req('/api/transcribe?lang=' + uiLang(), { method: 'POST', raw: blob, type: blob.type });
      if (!d.text) say2(t('No speech was recognised. Try again a little closer to the microphone.'), true);
      else { const q = $('#q'); q.value = (q.value.trim() ? q.value.trim() + ' ' : '') + d.text; q.focus(); say2(t('Check the words, then press Ask.')); }
    } catch (e) { say2(e.message, true); }
    finally { rec = null; b.disabled = false; b.textContent = '🎤 ' + t('Speak your question'); }
  };
  mr.start(); say2(t('Recording. Press stop when you have finished speaking.'));
}
async function ask(e) {
  e.preventDefault(); try { const r = await req('/api/ask', { method: 'POST', body: { text: $('#q').value } });
    $('#ans').innerHTML = r.answers.length ? r.answers.map((a, i) => `<div class="moment expert answer"><div class="row"><span class="tag">${t('Master\'s approved explanation')}</span>${a.step ? `<span class="badge b-off">${t('Step: {s}', { s: esc(a.step) })}</span>` : ''}</div><p>“${esc(a.verbatim)}”</p>${a.summary ? `<p><span class="tag">${t('Summary')}</span><br>${esc(a.summary)}</p>` : ''}${a.warnings ? `<p class="notice bad"><strong>${t('Warning')}</strong>${esc(a.warnings)}</p>` : ''}${clipOk(a.clip) ? `<button class="btn" data-clip="${i}">${t('▶ Play master\'s clip ({time})', { time: mmss(a.clip.t) })}</button><video id="c${i}" controls playsinline hidden aria-label="${t('Master reference clip')}"></video>` : `<p class="clip-none">${t('No reference clip is linked to this answer.')}</p>`}</div>`).join('') : `<p class="moment">${t('No approved answer found. Your question was sent to the master — the reply will appear below.')}</p>`;
    r.answers.forEach((a, i) => { if (!clipOk(a.clip)) return; $('#ans').querySelector(`[data-clip="${i}"]`).onclick = () => { const v = $('#c' + i); v.hidden = false; v.src = a.clip.url + '#t=' + a.clip.t; v.play().catch(() => {}); }; });
    if (r.answers.length) say(r.answers[0].summary || r.answers[0].verbatim); else replies(); announce(r.answers.length ? t('Answer found') : t('Sent to the master'));
  } catch (x) { $('#ans').innerHTML = `<p class="err" role="alert">${esc(x.message)}</p>`; }
}
async function replies() {
  try {
    const h = await req('/api/help'); if (!h.length || !$('#rep')) return;
    $('#rep').innerHTML = h.map((x) => `<div class="moment ${x.replies.length ? 'expert' : ''}"><strong>${esc(trServer(x.question))}</strong> <span class="badge">${esc(HELP_ST()[x.status] || x.status)}</span>${x.replies.map((r) => { if (!spoken.has(r.id)) { spoken.add(r.id); if (repliesSeen && x.status !== 'pending') { say(t('Master says:') + ' ' + r.text); if (tab !== 'ask') unreadReplies++; } } return `<p><span class="tag">${t('Master')}</span><br>${esc(r.text)}</p>`; }).join('') || `<p class="hint">${t('Waiting for the master…')}</p>`}</div>`).join('');
    repliesSeen = true; counts();
  } catch {}
}
function live() {
  return stream('/api/stream?t=' + encodeURIComponent(token), (m) => {
    if (m.type === 'help') replies();
    if (m.type === 'assessment' && m.practice === pid) logAssessment(m.assessment);
    // The master approving (or withdrawing) a lesson on the laptop shows up here straight away.
    // Deleting or restoring a recording takes its lessons with it, so those refresh the list too.
    if (m.type === 'event' && /^(knowledge_|recording_deleted|restored|deleted_forever|language_changed)/.test(m.kind || '')) loadLessons();
  }, (o) => { online = o; conn(); });
}
app.addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.tab) return show(b.dataset.tab);
  if (b.dataset.help) return askHelp('The student asked for help.');
  if (b.dataset.learn) return toggleLearned(b.dataset.learn);
  if (b.dataset.say) { const k = lessons.find((x) => x.id === b.dataset.say); if (k) say([k.summary, k.warnings].filter(Boolean).join(' ') || k.verbatim, true, b); return; }
  if (b.dataset.goto) { show('learn'); const el = $('#ls-' + CSS.escape(b.dataset.goto)); el?.scrollIntoView({ block: 'center' }); el?.focus(); }
  if (b.dataset.lclip) { const k = lessons.find((x) => x.id === b.dataset.lclip), v = $('#lv-' + CSS.escape(k.id)); v.hidden = false; v.src = k.clip.url + '#t=' + k.clip.t; v.play().catch(() => {}); }
});
window.addEventListener('hashchange', () => location.reload());
// Switching language redraws the screen and keeps what is running: camera, practice, guidance and replies.
onLang(async () => {
  if (view === 'join') return joinScreen();
  if (view === 'consent') return consent();
  if (view !== 'session') return;
  const keepLog = $('#log').innerHTML, ack = $('#ack').checked, q = $('#q').value;
  if (token) info = await req('/api/join', { method: 'POST', body: { consent: true } }).catch(() => info); // briefing in the new language
  ui(); $('#log').innerHTML = keepLog; $('#ack').checked = ack; $('#q').value = q;
  if (media) { $('#pv').srcObject = media; $('#pv').play(); }
  gate(); practiceButtons(); mon(); renderLessons(); counts(); repliesSeen = false; replies();
});
boot();
