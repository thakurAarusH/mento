import { $, esc, api, announce, consentHtml, ping, mmss } from '/common.js';
const app = $('#app'), token = location.hash.slice(1); let info, media, mr, chunks = [], blob, mime, sec = 0, tick, state = 'idle';
const MIMES = ['video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
function consent() {
  if (!token) return (app.innerHTML = '<p class="err" role="alert">No invitation found. Scan the master QR code from the dashboard.</p>');
  app.innerHTML = consentHtml('master');
  $('#cf').onsubmit = async (e) => { e.preventDefault(); if (!$('#ck').checked) return; try { info = await api('/api/join', { method: 'POST', token, body: { consent: true } }); setInterval(() => ping(token), 10000); ui(); } catch (x) { $('#err').textContent = x.message; } };
}
function ui() {
  app.innerHTML = `<section class="card"><h1>${esc(info.session.title)}</h1><p>${esc(info.session.task)}</p><p class="hint">Do the task naturally. Questions come afterwards on the laptop; nothing interrupts you. Limit: ${info.limits.maxRecSec / 60} min / ${info.limits.maxVideoMb} MB.</p>
  <video id="pv" playsinline muted aria-label="Live camera preview"></video><p id="st" role="status" class="rec" hidden><span class="dot"></span> Recording <span id="clk">00:00</span></p>
  <div class="row"><button class="btn big primary" id="cam">Turn on camera and microphone</button><button class="btn big sos" id="rec" disabled>Start recording</button><button class="btn big" id="pau" disabled>Pause</button><button class="btn big" id="stp" disabled>Stop</button></div>
  <div id="up" hidden><label for="pg">Upload progress</label><progress id="pg" max="100" value="0"></progress><div class="row"><button class="btn big primary" id="send">Upload recording</button><button class="btn big" id="dis">Discard</button></div></div><p id="msg" role="alert"></p></section>`;
  $('#cam').onclick = camera; $('#rec').onclick = start; $('#pau').onclick = pause; $('#stp').onclick = stop; $('#send').onclick = upload; $('#dis').onclick = () => { blob = null; $('#up').hidden = true; msg('Discarded.'); };
}
const msg = (t, bad) => { const m = $('#msg'); m.textContent = t; m.className = bad ? 'err' : ''; announce(t); };
async function camera() {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return msg('This browser cannot record video. Use current Chrome, Safari 14.1+ or Firefox. On non-localhost addresses the page must be HTTPS (see README).', true);
  try { media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: true }); } catch (e) { return msg(e.name === 'NotAllowedError' ? 'Camera/microphone permission was denied. Allow it in the browser site settings, then retry.' : 'Could not open camera: ' + e.message, true); }
  $('#pv').srcObject = media; $('#pv').play(); $('#rec').disabled = false; $('#cam').disabled = true; msg('Camera ready. Nothing is recorded yet.');
}
function start() {
  mime = MIMES.find((m) => MediaRecorder.isTypeSupported(m)); if (!mime) return msg('No supported video format in this browser.', true);
  chunks = []; sec = 0; mr = new MediaRecorder(media, { mimeType: mime, videoBitsPerSecond: 1_500_000 });
  mr.ondataavailable = (e) => e.data.size && chunks.push(e.data); mr.onstop = done; mr.start(1000); state = 'rec';
  $('#st').hidden = false; $('#rec').disabled = true; $('#pau').disabled = false; $('#stp').disabled = false; $('#up').hidden = true;
  tick = setInterval(() => { if (state === 'rec') { sec++; $('#clk').textContent = mmss(sec); if (sec >= info.limits.maxRecSec) stop(); } }, 1000); msg('Recording started.');
}
function pause() { if (state === 'rec') { mr.pause(); state = 'pause'; $('#pau').textContent = 'Resume'; msg('Paused.'); } else { mr.resume(); state = 'rec'; $('#pau').textContent = 'Pause'; msg('Recording resumed.'); } }
function stop() { clearInterval(tick); if (mr && mr.state !== 'inactive') mr.stop(); state = 'idle'; $('#st').hidden = true; $('#pau').disabled = $('#stp').disabled = true; $('#rec').disabled = false; }
function done() { blob = new Blob(chunks, { type: mime.split(';')[0] }); const mb = blob.size / 1e6; $('#up').hidden = false; msg(`Recorded ${mmss(sec)} (${mb.toFixed(1)} MB). Upload it, or discard.`, mb > info.limits.maxVideoMb); if (mb > info.limits.maxVideoMb) $('#send').disabled = true; }
function upload() {
  if (!blob) return; const x = new XMLHttpRequest(); x.open('POST', '/api/recordings'); x.setRequestHeader('x-token', token); x.setRequestHeader('content-type', blob.type);
  x.upload.onprogress = (e) => { if (e.lengthComputable) $('#pg').value = (e.loaded / e.total) * 100; }; $('#send').disabled = true; msg('Uploading…');
  x.onload = () => { const d = JSON.parse(x.responseText || '{}'); if (x.status === 201) { msg('Uploaded. Continue on the laptop: it will show your questions. You can close this page.'); blob = null; $('#up').hidden = true; } else { msg(`Upload failed: ${d.error || x.status}. Your recording is still on this phone — press Upload to retry.`, true); $('#send').disabled = false; } };
  x.onerror = () => { msg('Network error. Your recording is kept — press Upload to retry.', true); $('#send').disabled = false; }; x.send(blob);
}
consent();
