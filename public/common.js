import { t, tn, trServer, LANG } from '/i18n.js';
export { t, tn };
export const $ = (s, r = document) => r.querySelector(s);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const mmss = (t) => { t = Math.max(0, Math.floor(+t || 0)); return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0'); };
export function announce(msg) { const l = $('#live'); if (!l) return; l.textContent = ''; setTimeout(() => { l.textContent = msg; }, 60); }
// Every request says which interface language is shown, so the server can answer in it (skill profiles, briefings).
export async function api(path, { method = 'GET', body, token, raw, type, headers } = {}) {
  const h = { 'x-lang': LANG, ...(headers || {}) }; if (token) h['x-token'] = token;
  let b = body; if (raw) { h['content-type'] = type; b = raw; } else if (body !== undefined) { h['content-type'] = 'application/json'; b = JSON.stringify(body); }
  let r; try { r = await fetch(path, { method, headers: h, body: b }); } catch { throw new Error(t('Cannot reach the server. Check the connection and retry.')); }
  const d = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(trServer(d.error) || t('Request failed ({n})', { n: r.status })), { status: r.status, code: d.code || null, body: d }); return d;
}
export function stream(url, onmsg, onstate) {
  const es = new EventSource(url); es.onopen = () => onstate?.(true); es.onerror = () => onstate?.(false);
  es.onmessage = (e) => onmsg(JSON.parse(e.data)); return es;
}
// Connection state is shown quietly: a small dot, with words only while reconnecting.
export const connDot = (online) => (online ? `<span class="conn-dot ok" title="${t('Live updates on')}" aria-label="${t('Live updates on')}"></span>` : `<span class="conn-dot off"></span><span class="conn-txt">${t('Reconnecting…')}</span>`);
// mode: GET /api/ai-mode — the consent text says plainly what (if anything) goes to cloud AI.
const aiBullet = (m) => [!m || m.cloud === 'off' ? t('Analysed only by a local AI model if the operator set one up; nothing is sent to cloud AI in this build.')
  : m.cloud === 'vision' ? t('Analysed with help from cloud AI ({p}) for better accuracy: still frames, photos and text are sent to it. Full videos, names and passwords are never sent.', { p: m.provider })
    : t('Analysed by a local AI model, with cloud AI ({p}) helping with text only: descriptions, answers and questions. Photos and videos stay on the operator\'s computer.', { p: m.provider }),
  m?.freeTier ? t('This uses the free tier of {p}, which may use what it receives to improve its products. Please do not record anything confidential.', { p: m.provider }) : '',
  m?.stt ? t('Spoken answers are transcribed by a cloud speech service ({h}).', { h: m.sttHost }) : ''].filter(Boolean).join(' ');
export const consentHtml = (who, mode) => `<form id="cf" class="card narrow"><h1>${t('MENTO · Before we start')}</h1><p class="hint">${t('Experience becomes expertise.')}</p>
<p>${who === 'master' ? t('This master page will use your <strong>camera and microphone</strong> once you press the button below.') : t('This student page will use your <strong>camera</strong> once you press the button below.')} ${t('Recording and analysis only start when you tell it to, and a red “Recording” indicator is always visible while it runs.')}</p>
<ul><li>${t('Stored privately on the operator\'s computer; shown only to people in this session.')}</li><li>${aiBullet(mode)}</li><li>${t('Deleted automatically after the retention period, or earlier by the master.')}</li><li>${t('Not used to train any model.')}</li></ul>
<p><a href="/privacy" target="_blank" rel="noopener">${t('Privacy Policy')}</a> · <a href="/terms" target="_blank" rel="noopener">${t('Terms')}</a></p>
<label class="check" for="ck"><input type="checkbox" id="ck" required> <span>${t('I consent to being recorded and analysed for this training session, as described above.')}</span></label>
<button class="btn primary big" id="go">${t('Continue')}</button><p id="err" role="alert" class="err"></p></form>`;
export async function ping(token, headers) { try { await api('/api/ping', { method: 'POST', token, headers }); } catch { /* shown by status */ } }
// ---- shared skill presentation (dashboard, master phone, student phone) ----
const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${d}</svg>`;
export const ICON = {
  soldering: svg('<path d="M3 21l5-5"/><path d="M7.5 14.5l8-8 2 2-8 8z"/><path d="M15.5 6.5l3-3 2 2-3 3"/><path d="M4 11c1.2-.9 2.6-.9 3.5 0M5 8c1.2-.9 2.6-.9 3.5 0"/>'),
  bonsai: svg('<path d="M12 19v-5c0-2-2-3-4-3.5"/><path d="M12 14c2-.5 3.5-1.5 4.5-3"/><ellipse cx="7.5" cy="8.5" rx="3.8" ry="2.2"/><ellipse cx="16.5" cy="9.5" rx="3.3" ry="2"/><ellipse cx="12" cy="5" rx="3.4" ry="1.9"/><path d="M6 19h12l-1.5 2.5h-9z"/>'),
  // A bowl with a golden seam.
  kintsugi: svg('<path d="M3 10h18c0 5-4 9-9 9s-9-4-9-9z"/><path d="M8 10l2 3-1 2 2 3" stroke-width="2.2"/><path d="M15 10l-1 2.5 2 2"/>'),
  // A curved blade with a guard.
  katana: svg('<path d="M4 20c6-3 11-8 15-16"/><path d="M19 4l1.5-1.5"/><path d="M6.5 16.5l2 2"/><path d="M3 21l2-2"/>'),
  custom: svg('<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-.5-.5-2.5z"/>'),
  other: svg('<circle cx="12" cy="12" r="8"/><path d="M8.5 12h7M12 8.5v7"/>'),
};
export const icon = (id) => ICON[id] || ICON.other;
// Bundled, licensed photos (public/img, see CREDITS.txt); other skills just show their icon.
// Every skill has a picture (public/img, sources and licences in CREDITS.txt).
export const PHOTO = new Map([['soldering', '“Soldering workbench” by Windell Oskay (CC BY 2.0), via Wikimedia Commons'], ['bonsai', '“Bonsai Tree” by Rennett Stowe (CC BY 2.0), via Wikimedia Commons'],
  ['kintsugi', '“Kintsugi on broken Kyūsu lid” by D-Kuru (CC BY-SA 4.0), via Wikimedia Commons'], ['katana', '“Des briques d’acier au katana” by MathieuMD (CC BY-SA 4.0), via Wikimedia Commons'],
  ['custom', 'Illustration from the MENTO design pack']]);
export const skillBadge = (id, name) => `<span class="skill-badge ${ICON[id] ? 's-' + id : ''}"><span class="ico">${icon(id)}</span><span>${esc(name || id)}</span></span>`;
export const procHtml = (p) => {
  const ls = String(p || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (!ls.length) return `<p class="empty">${t('No procedure was provided for this session.')}</p>`;
  return ls.length > 1 || /^\d+[.)]\s/.test(ls[0]) ? `<ol class="procedure">${ls.map((l) => `<li>${esc(l.replace(/^\d+[.)]\s*/, ''))}</li>`).join('')}</ol>` : `<p class="pre">${esc(ls[0])}</p>`;
};
export const safetyItem = (s) => { const m = String(s).match(/^(.{1,40}?)([:：])\s*(.*)$/); return m ? `<b>${esc(m[1] + m[2])}</b> ${esc(m[3])}` : esc(s); };
// Per-device convenience only (remembered invite, learner id); everything that matters lives on the server.
export const store = {
  get(k) { try { return JSON.parse(localStorage.getItem('mento.' + k)); } catch { return null; } },
  set(k, v) { try { if (v == null) localStorage.removeItem('mento.' + k); else localStorage.setItem('mento.' + k, JSON.stringify(v)); } catch { /* private mode */ } },
};
// ---- master sign-in / create account (dashboard and master phone share it) ----
// Real username/password fields, so the browser or phone can offer to remember them; the login itself lasts 30 days.
export function authForm(box, opts) {
  let mode = 'in', err = '';
  const draw = () => {
    const { eyebrow, title, intro } = opts.text();
    box.innerHTML = `<form id="af" class="card narrow auth" autocomplete="on"><span class="eyebrow">${eyebrow}</span><h1>${title}</h1>${intro ? `<p>${intro}</p>` : ''}
    <div class="seg" role="tablist" aria-label="${t('Account')}"><button type="button" role="tab" aria-selected="${mode === 'in'}" data-mode="in">${t('Sign in')}</button><button type="button" role="tab" aria-selected="${mode === 'up'}" data-mode="up">${t('Create account')}</button></div>
    ${mode === 'pp' ? `<label for="a-pp">${t('Setup passphrase')}</label><input id="a-pp" type="password" autocomplete="off" required>`
      : `${mode === 'up' ? `<label for="a-name">${t('Your name')}</label><input id="a-name" autocomplete="name" maxlength="60" required placeholder="${t('Shown to you on the dashboard')}">` : ''}
    <label for="a-user">${t('Username')}</label><input id="a-user" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="32" required${mode === 'up' ? ` pattern="[A-Za-z0-9_.\\-]{3,32}" title="${t('3–32 letters, numbers, dot, dash or underscore')}"` : ''}>
    <label for="a-pw">${t('Password')}${mode === 'up' ? ` <span class="hint">${t('(at least 6 characters)')}</span>` : ''}</label><input id="a-pw" name="password" type="password" autocomplete="${mode === 'up' ? 'new-password' : 'current-password'}" minlength="${mode === 'up' ? 6 : 1}" required>`}
    <button class="btn primary big">${mode === 'up' ? t('Create account and sign in') : t('Sign in')}</button><p id="a-err" role="alert" class="err">${esc(err)}</p>
    <p class="hint">${mode === 'pp' ? `<button type="button" class="linkbtn" data-mode="in">${t('← Back to username sign-in')}</button>` : `${t('You stay signed in on this device for 30 days. Each master sees only their own sessions.')} <button type="button" class="linkbtn" data-mode="pp">${t('Administrator sign-in')}</button>`}</p></form>`;
    box.querySelectorAll('[data-mode]').forEach((b) => (b.onclick = () => { mode = b.dataset.mode; err = ''; draw(); $(mode === 'up' ? '#a-name' : mode === 'pp' ? '#a-pp' : '#a-user', box)?.focus(); }));
    $('#af', box).onsubmit = async (e) => {
      e.preventDefault(); const btn = $('#af button.primary', box); btn.disabled = true;
      try {
        if (mode === 'pp') await api('/api/login', { method: 'POST', body: { passphrase: $('#a-pp', box).value } });
        else if (mode === 'up') { const r = await api('/api/signup', { method: 'POST', body: { name: $('#a-name', box).value, username: $('#a-user', box).value, password: $('#a-pw', box).value } }); if (r.claimed) announce(tn(r.claimed, '{n} existing session was added to your account.', '{n} existing sessions were added to your account.')); }
        else await api('/api/login', { method: 'POST', body: { username: $('#a-user', box).value, password: $('#a-pw', box).value } });
        opts.onDone();
      } catch (x) { err = x.message; draw(); }
    };
  };
  draw();
  return draw; // re-draw on language change
}
export async function signOut() { try { await api('/api/logout', { method: 'POST' }); } catch {} location.reload(); }
export const whoHtml = (me) => `<span class="who">${t('Signed in as')} <b>${esc(me.user?.admin ? t('Administrator') : me.user?.name || t('master'))}</b>${me.user?.username ? ` <span class="hint">@${esc(me.user.username)}</span>` : ''} · <button type="button" class="linkbtn" data-signout="1">${t('Sign out')}</button></span>`;
