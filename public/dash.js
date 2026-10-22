import { $, esc, mmss, api, announce, stream } from '/common.js';
const app = $('#app'); let sid = null, D = null, es = null, online = false, timer = null;
const badge = (txt, cls) => `<span class="badge ${cls}">${txt}</span>`;
const hst = { pending: ['● Pending', 'b-bad'], answered: ['✓ Answered', 'b-warn'], resolved: ['✓ Resolved', 'b-ok'], rejected: ['✕ Rejected', 'b-off'], escalated: ['▲ Escalated', 'b-bad'] };
async function boot() { try { await api('/api/me'); await list(); } catch { login(); } }
function login() {
  app.innerHTML = `<form id="lf" class="card narrow"><h1>MENTO · Master sign-in</h1><p class="hint">Experience becomes expertise.</p><label for="pp">Passphrase</label><input id="pp" type="password" autocomplete="current-password" required aria-describedby="h"><p id="h" class="hint">Set as MASTER_PASSPHRASE on the server. Sign-in uses one strictly necessary cookie (see Cookies).</p><button class="btn primary">Sign in</button><p id="err" role="alert" class="err"></p></form>`;
  $('#lf').onsubmit = async (e) => { e.preventDefault(); try { await api('/api/login', { method: 'POST', body: { passphrase: $('#pp').value } }); boot(); } catch (x) { $('#err').textContent = x.message; } };
}
async function list() {
  const ss = await api('/api/sessions'); const me = await api('/api/me');
  if (!es) es = stream('/api/stream', (m) => { if (m.sid === sid || m.type === 'deleted') refreshSoon(); }, (o) => { online = o; announce(o ? 'Live updates connected' : 'Live updates disconnected'); if (D) head(); });
  app.innerHTML = `<div class="grid"><section class="card" aria-labelledby="ns"><h1 id="ns">New craft session</h1><form id="nf"><label for="t">Title</label><input id="t" required maxlength="120" placeholder="e.g. Through-hole soldering — resistor"><label for="k">Task description (optional)</label><textarea id="k" rows="2"></textarea><label for="p">Procedure (optional)</label><textarea id="p" rows="3"></textarea><p class="hint">Used only as context for this session.</p><button class="btn primary">Create session</button><p id="err" role="alert" class="err"></p></form></section>
  <section class="card" aria-labelledby="ls"><h2 id="ls">Sessions</h2>${ss.length ? '<ul class="plain">' + ss.map((s) => `<li class="row sp"><span><strong>${esc(s.title)}</strong><br><span class="hint">${esc(s.created_at.slice(0, 16).replace('T', ' '))} UTC</span></span><button class="btn" data-open="${s.id}">Open</button></li>`).join('') + '</ul>' : '<p class="empty">No sessions yet. Create one to get started.</p>'}
  <p class="hint">${me.aiConfigured ? 'Local AI configured.' : 'No local AI configured: video analysis is unavailable; add moments manually.'} Retention: ${me.limits.retentionDays} days.</p></section></div><div id="sess"></div>`;
  $('#nf').onsubmit = async (e) => { e.preventDefault(); try { const r = await api('/api/sessions', { method: 'POST', body: { title: $('#t').value, task: $('#k').value, procedure: $('#p').value } }); announce('Session created'); open(r.id); } catch (x) { $('#err').textContent = x.message; } };
  app.querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => open(b.dataset.open)));
  if (sid && ss.some((s) => s.id === sid)) open(sid);
}
const refreshSoon = () => { clearTimeout(timer); timer = setTimeout(() => open(sid, true), 250); };
async function open(id, quiet) {
  sid = id; try { D = await api('/api/sessions/' + id); } catch (e) { sid = null; return list(); }
  const L = quiet && $('#links')?.dataset.loaded ? null : await api(`/api/sessions/${id}/links`).catch(() => null);
  render(L); if (!quiet) $('#sess').scrollIntoView();
}
function head() { const h = $('#conn'); if (h) h.innerHTML = online ? badge('● Live updates on', 'b-ok') : badge('○ Offline — retrying', 'b-bad'); }
function render(L) {
  const { session: s, devices, recordings, observations, questions, knowledge, help, practices, events } = D;
  const dev = (r) => { const d = devices.find((x) => x.role === r); return !d ? badge('○ none', 'b-off') : d.connected ? badge('● Connected', 'b-ok') : d.consented_at ? badge('○ Disconnected', 'b-warn') : badge('○ Not joined yet', 'b-off'); };
  const lk = (r, n) => L ? `<div><h3>${n} phone ${dev(r === 'master' ? 'master' : 'apprentice')}</h3><img class="qr" alt="QR code to join as ${n}" src="${L.links[r].qr}"><p class="hint" style="word-break:break-all">${esc(L.links[r].url)}</p></div>` : '';
  const pend = help.filter((h) => h.status === 'pending').length;
  $('#sess').innerHTML = `<section class="card"><div class="row sp"><h1>${esc(s.title)}</h1><span id="conn"></span></div><p>${esc(s.task)}</p>
  <div id="links" data-loaded="1">${L ? `${L.warning ? `<p class="err" role="alert">${esc(L.warning)}</p>` : ''}<div class="row" style="align-items:flex-start;gap:2rem">${lk('master', 'Master')}${lk('apprentice', 'Apprentice')}</div>` : '<p class="hint">Join codes shown above when loaded.</p>'}</div>
  <div class="row"><button class="btn" data-a="rotate">Rotate join links</button><button class="btn danger" data-a="del">Delete session and all data</button></div><p class="hint">Invites expire automatically. Devices show “Connected” while they send a heartbeat (every 10 s).</p></section>
  <div class="grid"><section class="card" aria-labelledby="h-rec"><h2 id="h-rec">Master recordings</h2>${recordings.length ? recordings.map(recHtml).join('') : '<p class="empty">No recording yet. Open the master link on the phone and record the task.</p>'}</section>
  <section class="card" aria-labelledby="h-help"><h2 id="h-help">Help requests ${pend ? badge(pend + ' pending', 'b-bad') : ''}</h2>${help.length ? help.map(helpHtml).join('') : '<p class="empty">None.</p>'}</section></div>
  <section class="card" aria-labelledby="h-q"><h2 id="h-q">Questions for the master</h2><p class="hint">Questions only point at a moment; the AI never states why you acted. Answer in your own words.</p>${questions.length ? questions.map((x) => qHtml(x, observations)).join('') : '<p class="empty">No questions yet. Run analysis (needs a local model) or add a moment manually.</p>'}</section>
  <section class="card" aria-labelledby="h-k"><h2 id="h-k">Knowledge library</h2><p class="hint">Only <b>approved</b> records are given to apprentices. Expert words and the structured summary are kept separate.</p>${knowledge.length ? knowledge.map(kHtml).join('') : '<p class="empty">No records yet.</p>'}</section>
  <div class="grid"><section class="card" aria-labelledby="h-p"><h2 id="h-p">Practice sessions</h2>${practices.length ? practices.map((p) => `<p><strong>${esc(p.started_at.slice(11, 16))}</strong> ${p.ended_at ? 'ended' : badge('● active', 'b-ok')} — ${p.total} snapshot checks: ${Object.entries(p.counts).map(([k, v]) => `${esc(k.replace('_', ' '))} ${v}`).join(', ') || 'none'}<br><span class="hint">AI checks are guidance only, not a competency score.</span></p>`).join('') : '<p class="empty">No apprentice practice yet.</p>'}</section>
  <section class="card" aria-labelledby="h-e"><h2 id="h-e">History</h2><ul class="plain">${events.map((e) => `<li><span class="hint">${esc(e.created_at.slice(11, 19))}</span> ${esc(e.kind.replaceAll('_', ' '))} ${esc(e.detail || '')}</li>`).join('')}</ul></section></div>`;
  head();
}
const recHtml = (r) => `<div><div class="row sp"><strong>${esc(r.created_at.slice(11, 16))} · ${(r.bytes / 1e6).toFixed(1)} MB</strong>${badge({ uploaded: '○ Uploaded', analyzing: '◔ Analysing…', analyzed: '✓ Analysed', failed: '✕ Analysis failed' }[r.status] || r.status, r.status === 'failed' ? 'b-bad' : r.status === 'analyzed' ? 'b-ok' : 'b-warn')}</div>
<video id="v-${r.id}" controls preload="metadata" src="${r.url}" aria-label="Master recording"></video>
${r.error ? `<p class="err" role="alert">${esc(r.error)}</p>` : ''}<div class="row"><button class="btn" data-a="analyze" data-id="${r.id}">${r.status === 'failed' ? 'Retry analysis' : 'Analyse with local AI'}</button></div>
<form data-a="moment" data-id="${r.id}" class="row" style="align-items:end"><div><label for="mt-${r.id}">Moment (seconds)</label><input id="mt-${r.id}" type="number" min="0" required style="width:7rem"></div><div style="flex:1;min-width:200px"><label for="mx-${r.id}">What is visible?</label><input id="mx-${r.id}" required maxlength="300"></div><button class="btn">Add moment</button></form></div>`;
const qHtml = (x, obs) => { const o = obs.find((y) => y.id === x.observation_id); return `<div class="moment ${o?.source === 'manual' ? '' : 'ai'}"><div class="row sp"><span class="tag">${o?.source === 'manual' ? 'Added by master' : 'AI-detected moment — ' + esc(o?.source)}</span><button class="btn" data-a="play" data-rec="${x.recording_id}" data-t="${x.t}">▶ Play ${mmss(x.t)}</button></div><p>${esc(x.text)}</p>${o?.uncertainty ? `<p class="hint">Uncertainty: ${esc(o.uncertainty)}</p>` : ''}${x.status === 'open' ? `<form data-a="answer" data-id="${x.id}"><label for="an-${x.id}">Your answer</label><textarea id="an-${x.id}" rows="2" required></textarea><button class="btn primary">Save as draft record</button></form>` : badge('✓ Answered', 'b-ok')}</div>`; };
const kHtml = (k) => `<div class="moment expert"><div class="row sp"><span>${badge({ draft: '○ Draft', approved: '✓ Approved', rejected: '✕ Rejected', clarify: '? Needs clarification' }[k.status], k.status === 'approved' ? 'b-ok' : k.status === 'rejected' ? 'b-bad' : 'b-warn')} ${k.approved_at ? `<span class="hint">approved ${esc(k.approved_at.slice(0, 16).replace('T', ' '))} UTC</span>` : ''}</div><button class="btn" data-a="play" data-rec="${k.recording_id}" data-t="${k.t}">▶ ${mmss(k.t)}</button></div>
<p class="hint">Observed: ${esc(k.observed)}</p><form data-a="kn" data-id="${k.id}"><label for="kv-${k.id}">Expert's words (verbatim — correct transcription errors only)</label><textarea id="kv-${k.id}" name="verbatim" rows="2">${esc(k.verbatim)}</textarea>
<label for="ks-${k.id}">Structured summary (written by the master — not AI)</label><textarea id="ks-${k.id}" name="summary" rows="2">${esc(k.summary)}</textarea>
<div class="grid" style="gap:.5rem"><div><label for="kc-${k.id}">Decision cues / conditions</label><input id="kc-${k.id}" name="cues" value="${esc(k.cues)}"></div><div><label for="kw-${k.id}">Exceptions / warnings</label><input id="kw-${k.id}" name="warnings" value="${esc(k.warnings)}"></div><div><label for="kp-${k.id}">Step</label><input id="kp-${k.id}" name="step" value="${esc(k.step)}"></div><div><label for="kt-${k.id}">Tool</label><input id="kt-${k.id}" name="tool" value="${esc(k.tool)}"></div></div>
<div class="row"><button class="btn" data-s="">Save edits</button><button class="btn primary" data-s="approved">Approve</button><button class="btn" data-s="clarify">Needs clarification</button><button class="btn danger" data-s="rejected">Reject</button></div></form></div>`;
const helpHtml = (h) => { const [t, c] = hst[h.status]; return `<div class="moment ${h.status === 'pending' ? '' : 'ai'}"><div class="row sp">${badge(t, c)}<span class="hint">${esc(h.created_at.slice(11, 19))}${h.step ? ' · step: ' + esc(h.step) : ''}</span></div><p><strong>${esc(h.question)}</strong></p>${h.frame ? `<img src="${h.frame}" alt="Latest snapshot from the apprentice's camera" style="max-width:100%;border-radius:8px">` : '<p class="hint">No snapshot attached.</p>'}${h.replies.map((r) => `<p class="expert moment"><span class="tag">Your reply</span><br>${esc(r.text)}</p>`).join('')}
<form data-a="reply" data-id="${h.id}"><label for="r-${h.id}">Reply to the apprentice's phone</label><textarea id="r-${h.id}" rows="2" required></textarea><div class="row"><button class="btn primary">Send reply</button>${['resolved', 'rejected', 'escalated'].map((s) => `<button type="button" class="btn" data-a="hs" data-id="${h.id}" data-s="${s}">${s[0].toUpperCase() + s.slice(1)}</button>`).join('')}</div></form></div>`; };
const act = async (fn, ok) => { try { await fn(); if (ok) announce(ok); } catch (e) { announce('Error: ' + e.message); alert(e.message); } await open(sid, true); };
app.addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return; const a = b.dataset.a;
  if (b.dataset.open) return;
  if (a === 'play') { const v = $('#v-' + b.dataset.rec); if (v) { v.currentTime = +b.dataset.t; v.play().catch(() => {}); v.scrollIntoView({ block: 'center' }); v.focus(); } }
  if (a === 'analyze') act(() => api(`/api/recordings/${b.dataset.id}/analyze`, { method: 'POST' }), 'Analysis started');
  if (a === 'rotate') act(() => api(`/api/sessions/${sid}/rotate`, { method: 'POST' }).then(() => { const l = $('#links'); if (l) delete l.dataset.loaded; }), 'Join links rotated');
  if (a === 'del' && confirm('Permanently delete this session, its recordings, snapshots, knowledge and help requests?')) api('/api/sessions/' + sid, { method: 'DELETE' }).then(() => { sid = null; D = null; list(); announce('Session deleted'); });
  if (a === 'hs') act(() => api('/api/help/' + b.dataset.id, { method: 'PATCH', body: { status: b.dataset.s } }), 'Status updated');
});
app.addEventListener('submit', (e) => {
  const f = e.target, a = f.dataset.a; if (!a) return; e.preventDefault(); const id = f.dataset.id;
  if (a === 'moment') act(() => api(`/api/recordings/${id}/moments`, { method: 'POST', body: { t: +f.querySelector('input[type=number]').value, text: f.querySelector('input:not([type=number])').value } }), 'Moment added');
  if (a === 'answer') act(() => api(`/api/questions/${id}/answer`, { method: 'POST', body: { text: f.querySelector('textarea').value } }), 'Draft record saved');
  if (a === 'reply') act(() => api(`/api/help/${id}/reply`, { method: 'POST', body: { text: f.querySelector('textarea').value } }), 'Reply sent');
  if (a === 'kn') { const body = Object.fromEntries(new FormData(f)); if (e.submitter.dataset.s) body.status = e.submitter.dataset.s; act(() => api('/api/knowledge/' + id, { method: 'PATCH', body }), 'Record updated'); }
});
boot();
