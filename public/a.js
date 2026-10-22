import { $, esc, api, announce, consentHtml, ping, stream, mmss } from '/common.js';
const app = $('#app'), token = location.hash.slice(1); let info, media, pid = null, paused = false, loop = null, spoken = new Set(), voice = true;
function consent() {
  if (!token) return (app.innerHTML = '<p class="err" role="alert">No invitation found. Scan the apprentice QR code from the dashboard.</p>');
  app.innerHTML = consentHtml('apprentice');
  $('#cf').onsubmit = async (e) => { e.preventDefault(); if (!$('#ck').checked) return; try { info = await api('/api/join', { method: 'POST', token, body: { consent: true } }); setInterval(() => ping(token), 10000); ui(); live(); } catch (x) { $('#err').textContent = x.message; } };
}
function ui() {
  app.innerHTML = `<section class="card"><h1>${esc(info.session.title)}</h1><p>${esc(info.session.task)}</p>
  <video id="pv" playsinline muted aria-label="Your live camera preview"></video><p id="mon" class="hint" role="status">Camera off.</p>
  <p class="hint"><strong>How checking works:</strong> the app sends a still photo about every ${(info.limits.snapshotMs / 1000).toFixed(1)} s while monitoring is on — not a continuous video stream. Guidance is based only on the master's approved notes and can be wrong or say “cannot assess”.</p>
  <button class="btn big primary" id="cam">Turn on camera</button><button class="btn big" id="start" disabled>Start practice</button><div class="row"><button class="btn big" id="pause" disabled>Pause monitoring</button><button class="btn big" id="chk" disabled>Check my work</button></div><button class="btn big sos" id="help">I need help</button><button class="btn big" id="end" disabled>End practice</button>
  <label class="check" for="vo"><input type="checkbox" id="vo" checked> <span>Read guidance aloud (text is always shown)</span></label><p id="msg" role="alert"></p></section>
  <section class="card" aria-labelledby="fb"><h2 id="fb">Guidance</h2><div id="log" role="log" aria-live="polite"><p class="empty">Nothing yet.</p></div></section>
  <section class="card" aria-labelledby="ak"><h2 id="ak">Ask a question</h2><form id="qf"><label for="q">Your question (typed)</label><input id="q" maxlength="500" required><button class="btn big primary">Ask</button></form><div id="ans"></div><p class="hint">Voice input is not included in this build because browser speech recognition may send audio to a cloud service.</p></section>
  <section class="card" aria-labelledby="hp"><h2 id="hp">Replies from the master</h2><div id="rep"><p class="empty">No help requested.</p></div></section>`;
  $('#cam').onclick = camera; $('#start').onclick = startP; $('#pause').onclick = () => { paused = !paused; $('#pause').textContent = paused ? 'Resume monitoring' : 'Pause monitoring'; mon(); }; $('#chk').onclick = () => snap(true);
  $('#help').onclick = async () => { try { await api('/api/help', { method: 'POST', token, body: { question: 'The apprentice pressed “I need help”.' } }); note('Help request sent to the master.'); } catch (e) { note(e.message, true); } };
  $('#end').onclick = endP; $('#vo').onchange = (e) => { voice = e.target.checked; speechSynthesis.cancel(); };
  $('#qf').onsubmit = ask; replies();
}
const note = (t, bad) => { $('#msg').textContent = t; $('#msg').className = bad ? 'err' : ''; announce(t); };
const mon = () => { $('#mon').textContent = !media ? 'Camera off.' : !pid ? 'Camera on. Not monitoring.' : paused ? 'Monitoring paused — no photos are sent.' : 'Monitoring ON — sending a still photo every few seconds.'; };
function say(t) { if (voice && 'speechSynthesis' in window) { speechSynthesis.cancel(); speechSynthesis.speak(new SpeechSynthesisUtterance(t)); } }
function log(t, cls = '') { const l = $('#log'); if (l.querySelector('.empty')) l.innerHTML = ''; l.insertAdjacentHTML('afterbegin', `<p class="moment ${cls}"><span class="hint">${new Date().toLocaleTimeString()}</span><br>${esc(t)}</p>`); say(t); }
async function camera() {
  if (!navigator.mediaDevices?.getUserMedia) return note('Camera not available. On non-localhost addresses the page must be HTTPS (see README).', true);
  try { media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }); } catch (e) { return note(e.name === 'NotAllowedError' ? 'Camera permission denied. Allow it in browser site settings and retry.' : 'Camera error: ' + e.message, true); }
  $('#pv').srcObject = media; $('#pv').play(); $('#cam').disabled = true; $('#start').disabled = false; mon();
}
async function startP() { try { pid = (await api('/api/practice/start', { method: 'POST', token })).id; } catch (e) { return note(e.message, true); } $('#start').disabled = true; $('#pause').disabled = $('#chk').disabled = $('#end').disabled = false; mon(); schedule(); }
async function endP() { clearTimeout(loop); try { await api(`/api/practice/${pid}/end`, { method: 'POST', token }); } catch {} pid = null; $('#start').disabled = false; $('#pause').disabled = $('#chk').disabled = $('#end').disabled = true; mon(); note('Practice ended. The master can review it.'); }
const schedule = () => { clearTimeout(loop); if (pid) loop = setTimeout(async () => { if (!paused) await snap(false); schedule(); }, info.limits.snapshotMs); }; // next photo only after the previous request finished
async function snap(manual) {
  const v = $('#pv'); if (!pid || !v.videoWidth) return; const c = document.createElement('canvas'); const w = Math.min(640, v.videoWidth); c.width = w; c.height = Math.round(w * v.videoHeight / v.videoWidth); c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
  let q = 0.6, b; do { b = await new Promise((r) => c.toBlob(r, 'image/jpeg', q)); q -= 0.15; } while (b.size > info.limits.maxFrameKb * 1024 && q > 0.2);
  try { await api(`/api/practice/${pid}/snapshot${manual ? '?manual=1' : ''}`, { method: 'POST', token, raw: b, type: 'image/jpeg' }); if (manual) note('Checking… result will appear below.'); } catch (e) { note(e.message, true); }
}
async function ask(e) {
  e.preventDefault(); try { const r = await api('/api/ask', { method: 'POST', token, body: { text: $('#q').value } });
    $('#ans').innerHTML = r.answers.length ? r.answers.map((a, i) => `<div class="moment expert"><span class="tag">Master's approved explanation</span><p>“${esc(a.verbatim)}”</p>${a.summary ? `<p><span class="tag">Summary by the master</span><br>${esc(a.summary)}</p>` : ''}${a.warnings ? `<p class="err">Warning: ${esc(a.warnings)}</p>` : ''}<button class="btn" data-clip="${i}">▶ Play master's clip (${mmss(a.clip.t)})</button><video id="c${i}" controls playsinline hidden aria-label="Master reference clip"></video></div>`).join('') : '<p class="moment">No approved answer found. Your question was sent to the master.</p>';
    r.answers.forEach((a, i) => { $('#ans').querySelector(`[data-clip="${i}"]`).onclick = () => { const v = $('#c' + i); v.hidden = false; v.src = a.clip.url + '#t=' + a.clip.t; v.play().catch(() => {}); }; });
    if (r.answers.length) say(r.answers[0].summary || r.answers[0].verbatim); else replies(); announce(r.answers.length ? 'Answer found' : 'Sent to master');
  } catch (x) { $('#ans').innerHTML = `<p class="err" role="alert">${esc(x.message)}</p>`; }
}
async function replies() { try { const h = await api('/api/help', { token }); if (!h.length) return; $('#rep').innerHTML = h.map((x) => `<div class="moment ${x.replies.length ? 'expert' : ''}"><strong>${esc(x.question)}</strong> <span class="badge">${esc(x.status)}</span>${x.replies.map((r) => { if (!spoken.has(r.id)) { spoken.add(r.id); if (spoken.size > 0 && x.status !== 'pending') say('Master says: ' + r.text); } return `<p><span class="tag">Master</span><br>${esc(r.text)}</p>`; }).join('') || '<p class="hint">Waiting for the master…</p>'}</div>`).join(''); } catch {} }
function live() {
  stream('/api/stream?t=' + encodeURIComponent(token), (m) => {
    if (m.type === 'help') replies();
    if (m.type === 'assessment' && m.practice === pid) { const a = m.assessment; const lab = { on_track: '✓ On track', possible_issue: '△ Possible issue', cannot_assess: '○ Cannot assess', safety_stop: '■ Pause — safety' }[a.status]; log(`${lab}: ${a.feedback}`, a.status === 'on_track' ? 'expert' : ''); }
  }, (o) => { $('#conn').innerHTML = o ? '<span class="badge b-ok">● Connected</span>' : '<span class="badge b-bad">○ Disconnected — retrying</span>'; });
}
consent();
