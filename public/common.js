export const $ = (s, r = document) => r.querySelector(s);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const mmss = (t) => { t = Math.max(0, Math.floor(+t || 0)); return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0'); };
export function announce(msg) { const l = $('#live'); if (!l) return; l.textContent = ''; setTimeout(() => { l.textContent = msg; }, 60); }
export async function api(path, { method = 'GET', body, token, raw, type } = {}) {
  const h = {}; if (token) h['x-token'] = token;
  let b = body; if (raw) { h['content-type'] = type; b = raw; } else if (body !== undefined) { h['content-type'] = 'application/json'; b = JSON.stringify(body); }
  let r; try { r = await fetch(path, { method, headers: h, body: b }); } catch { throw new Error('Cannot reach the server. Check the connection and retry.'); }
  const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || `Request failed (${r.status})`); return d;
}
export function stream(url, onmsg, onstate) {
  const es = new EventSource(url); es.onopen = () => onstate?.(true); es.onerror = () => onstate?.(false);
  es.onmessage = (e) => onmsg(JSON.parse(e.data)); return es;
}
export const consentHtml = (who) => `<form id="cf" class="card narrow"><h1>MENTO · Before we start</h1><p class="hint">Experience becomes expertise.</p>
<p>This ${who} page will use your <strong>camera${who === 'master' ? ' and microphone' : ''}</strong> once you press the button below. Recording and analysis only start when you tell it to, and a red “Recording” indicator is always visible while it runs.</p>
<ul><li>Stored privately on the operator's computer; shown only to people in this session.</li><li>Analysed only by a local AI model if the operator set one up; nothing is sent to cloud AI in this build.</li><li>Deleted automatically after the retention period, or earlier by the master.</li><li>Not used to train any model.</li></ul>
<p><a href="/privacy" target="_blank" rel="noopener">Privacy Policy</a> · <a href="/terms" target="_blank" rel="noopener">Terms</a></p>
<label class="check" for="ck"><input type="checkbox" id="ck" required> <span>I consent to being recorded and analysed for this training session, as described above.</span></label>
<button class="btn primary big" id="go">Continue</button><p id="err" role="alert" class="err"></p></form>`;
export async function ping(token) { try { await api('/api/ping', { method: 'POST', token }); } catch { /* shown by status */ } }
