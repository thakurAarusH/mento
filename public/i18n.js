// Interface language (English / 日本語) for every page. Text is written in English in the code and looked up in the
// Japanese dictionary (i18n-ja.js). The choice is remembered on the device and sent to the server (x-lang header and
// the mz_lang cookie), so skill profiles, phone briefings and legal pages come back in the same language.
import { JA, JA_SERVER } from '/i18n-ja.js';

const saved = (() => { try { return localStorage.getItem('mento.ui'); } catch { return null; } })();
export let LANG = saved === 'ja' || saved === 'en' ? saved : /^ja\b/i.test(navigator.language || '') ? 'ja' : 'en';
const listeners = new Set();
// Keys without a translation are collected here (the browser tests read it), never shown as errors to users.
window.__i18nMissing = new Set();

const fill = (s, v) => (v ? s.replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m)) : s);
/** Translate an English interface string; {name} placeholders are filled from vars (pass values already escaped for HTML). */
export function t(en, vars) {
  if (LANG === 'ja') { const ja = JA[en]; if (ja != null) return fill(ja, vars); window.__i18nMissing.add(en); }
  return fill(en, vars);
}
/** English needs singular/plural; Japanese uses one form (the "many" key is the one translated). */
export const tn = (n, one, many, vars) => t(n === 1 && LANG === 'en' ? one : many, { n, ...vars });
/** Messages that come from the server (errors, labels) are in English; translate the known ones. */
export function trServer(msg) {
  if (LANG !== 'ja' || !msg) return msg;
  if (JA_SERVER[msg]) return JA_SERVER[msg];
  for (const [re, f] of JA_SERVER.patterns) { const m = String(msg).match(re); if (m) return f(...m.slice(1)); }
  return msg;
}
/** Dates and times in the reader's language and time zone. */
export const when = (iso, withDate = false) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString(LANG === 'ja' ? 'ja-JP' : 'en-GB', withDate ? { dateStyle: 'medium', timeStyle: 'short' } : { timeStyle: 'short' }); };

export function onLang(f) { listeners.add(f); }
export function setLang(l) {
  LANG = l === 'ja' ? 'ja' : 'en';
  try { localStorage.setItem('mento.ui', LANG); } catch { /* private mode */ }
  document.cookie = `mz_lang=${LANG}; Path=/; Max-Age=31536000; SameSite=Lax`;
  document.documentElement.lang = LANG;
  applyStatic(); drawToggle(); drawTheme();
  for (const f of listeners) f();
}
/** Static HTML: data-i18n (text), data-i18n-html (trusted markup from the dictionary), data-i18n-attr="placeholder:Key;aria-label:Key". */
export function applyStatic(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((e) => { e.textContent = t(e.dataset.i18n); });
  root.querySelectorAll('[data-i18n-html]').forEach((e) => { e.innerHTML = t(e.dataset.i18nHtml); });
  root.querySelectorAll('[data-i18n-attr]').forEach((e) => { for (const pair of e.dataset.i18nAttr.split(';')) { const [a, k] = pair.split(':'); if (a && k) e.setAttribute(a.trim(), t(k.trim())); } });
  const ti = document.querySelector('title[data-i18n-title]'); if (ti) document.title = t(ti.dataset.i18nTitle);
}
// The switch shows both languages; the active one is bold. It lives in every page's header.
function drawToggle() {
  const b = document.getElementById('lang-toggle'); if (!b) return;
  b.innerHTML = `<span${LANG === 'en' ? ' class="on"' : ''}>English</span> / <span${LANG === 'ja' ? ' class="on"' : ''}>日本語</span>`;
  b.setAttribute('aria-label', LANG === 'ja' ? 'Switch to English' : '日本語に切り替える');
}
export function initLang() {
  document.documentElement.lang = LANG;
  document.cookie = `mz_lang=${LANG}; Path=/; Max-Age=31536000; SameSite=Lax`;
  const top = document.querySelector('header.top');
  if (top && !document.getElementById('theme-toggle')) { const b = document.createElement('button'); b.id = 'theme-toggle'; b.type = 'button'; b.className = 'theme-toggle'; top.append(b); }
  initTheme();
  if (top && !document.getElementById('lang-toggle')) {
    const b = document.createElement('button'); b.id = 'lang-toggle'; b.type = 'button'; b.className = 'lang-toggle';
    b.onclick = () => setLang(LANG === 'ja' ? 'en' : 'ja');
    top.append(b);
  }
  drawToggle(); applyStatic();
}

// ---- dark / light theme (the choice is applied before drawing by theme.js) ----
const SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a7 7 0 0 0 11 11z"/></svg>';
export const theme = () => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
function drawTheme() {
  const b = document.getElementById('theme-toggle'); if (!b) return;
  const dark = theme() === 'dark'; b.innerHTML = dark ? SUN : MOON;
  const label = dark ? t('Switch to light mode') : t('Switch to dark mode'); b.setAttribute('aria-label', label); b.title = label;
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#14110e' : '#f9f6f1');
}
function initTheme() {
  const b = document.getElementById('theme-toggle'); if (!b || b.dataset.ready) return drawTheme(); b.dataset.ready = '1';
  b.onclick = () => { const next = theme() === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = next; try { localStorage.setItem('mento.theme', next); } catch { /* private mode */ } drawTheme(); };
  // Follow the device setting until the visitor chooses.
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', (e) => { let saved = null; try { saved = localStorage.getItem('mento.theme'); } catch { /* */ } if (!saved) { document.documentElement.dataset.theme = e.matches ? 'dark' : 'light'; drawTheme(); } });
  drawTheme();
}
