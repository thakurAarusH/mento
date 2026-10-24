import { $, api, esc, icon } from '/common.js';
import { initLang, onLang, t } from '/i18n.js';
initLang();

// ---- icons (Lucide, ISC licence) and Japanese motifs, drawn inline so the page needs no icon font ----
const L = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${d}</svg>`;
const IC = {
  arrow: L('<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>'),
  video: L('<path d="m16 13 5.2 3.5a.5.5 0 0 0 .8-.4V7.9a.5.5 0 0 0-.8-.4L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/>'),
  ask: L('<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>'),
  shield: L('<path d="M20 13c0 5-3.5 7.5-7.7 9a1 1 0 0 1-.6 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.2-2.7a1.2 1.2 0 0 1 1.6 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>'),
  camera: L('<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>'),
  book: L('<path d="M12 21V7"/><path d="m16 12 2 2 4-4"/><path d="M22 6V4a1 1 0 0 0-1-1h-5a4 4 0 0 0-4 4 4 4 0 0 0-4-4H3a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h6a3 3 0 0 1 3 3 3 3 0 0 1 3-3h6a1 1 0 0 0 1-1v-1.3"/>'),
  user: L('<circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/>'),
  cpu: L('<rect width="16" height="16" x="4" y="4" rx="2"/><rect width="6" height="6" x="9" y="9" rx="1"/><path d="M15 2v2M15 20v2M2 15h2M2 9h2M20 15h2M20 9h2M9 2v2M9 20v2"/>'),
  lock: L('<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>'),
  check: L('<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>'),
  server: L('<rect width="20" height="8" x="2" y="2" rx="2"/><rect width="20" height="8" x="2" y="14" rx="2"/><path d="M6 6h.01M6 18h.01"/>'),
  database: L('<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>'),
  eye: L('<path d="M2.1 12.3a1 1 0 0 1 0-.7 10.8 10.8 0 0 1 19.8 0 1 1 0 0 1 0 .7 10.8 10.8 0 0 1-19.8 0"/><circle cx="12" cy="12" r="3"/>'),
  radio: L('<path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"/><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"/><path d="M19.1 4.9C23 8.8 23 15.1 19.1 19"/>'),
  monitor: L('<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8M12 17v4"/>'),
  phone: L('<rect width="14" height="20" x="5" y="2" rx="2"/><path d="M12 18h.01"/>'),
  sound: L('<path d="M11 4.7a.7.7 0 0 0-1.2-.5L6.4 7.6A1.4 1.4 0 0 1 5.4 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.4a1.4 1.4 0 0 1 1 .4l3.4 3.4a.7.7 0 0 0 1.2-.5z"/><path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.4 18.4a9 9 0 0 0 0-12.8"/>'),
};
const M = (d) => `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true" focusable="false">${d}</svg>`;
const MOTIF = {
  torii: M('<path d="M8 18 Q32 8 56 18"/><line x1="12" y1="26" x2="52" y2="26"/><line x1="18" y1="20" x2="18" y2="54"/><line x1="46" y1="20" x2="46" y2="54"/><line x1="18" y1="38" x2="46" y2="38" stroke-width="1.5" opacity=".6"/>'),
  drum: M('<ellipse cx="32" cy="18" rx="20" ry="7"/><path d="M12 18 v24 c0 4 9 8 20 8 s20 -4 20 -8 v-24"/><path d="M12 32 c0 4 9 8 20 8 s20 -4 20 -8" stroke-width="1.5" opacity=".6"/><line x1="22" y1="6" x2="28" y2="14" stroke-width="2"/><line x1="42" y1="6" x2="36" y2="14" stroke-width="2"/>'),
  tomoe: M('<circle cx="32" cy="32" r="22"/><path d="M32 10 a22 22 0 0 1 19 33 a11 11 0 1 1 -19 -11 a11 11 0 0 0 0 -22z" fill="currentColor" stroke="none" opacity=".85"/>'),
  chime: M('<path d="M32 8 v6"/><path d="M20 20 a12 12 0 0 1 24 0 l3 14 H17 z"/><line x1="32" y1="34" x2="32" y2="42"/><path d="M28 42 h8 l-2 14 h-4 z" stroke-width="1.5"/>'),
  fan: M('<path d="M32 52 L10 22 A26 26 0 0 1 54 22 Z"/><line x1="32" y1="52" x2="32" y2="14" stroke-width="1.5"/><line x1="32" y1="52" x2="18" y2="18" stroke-width="1.5"/><line x1="32" y1="52" x2="46" y2="18" stroke-width="1.5"/><circle cx="32" cy="52" r="3" fill="currentColor" stroke="none"/>'),
  wave: M('<path d="M8 44 a12 12 0 0 1 24 0"/><path d="M20 44 a12 12 0 0 1 24 0"/><path d="M32 44 a12 12 0 0 1 24 0"/><path d="M14 32 a9 9 0 0 1 18 0" stroke-width="1.5" opacity=".6"/><path d="M32 32 a9 9 0 0 1 18 0" stroke-width="1.5" opacity=".6"/>'),
};
const paintIcons = (root = document) => root.querySelectorAll('[data-icon]').forEach((e) => { if (!e.firstChild) e.innerHTML = IC[e.dataset.icon] || ''; });

// ---- sakura petals drifting down the page (hidden when the reader prefers reduced motion) ----
$('#petals').innerHTML = Array.from({ length: 18 }, (_, i) => `<span class="petal" style="left:${(i * 37) % 100}%;animation-delay:${(i * 1.7) % 14}s;animation-duration:${12 + ((i * 3) % 10)}s;--drift:${((i % 5) - 2) * 60}px;scale:${0.6 + ((i * 7) % 6) / 10}"></span>`).join('');

// ---- the two flow diagrams, drawn as SVG in the interface language (a readable list on phones) ----
const CAPTURE = () => [
  [t('Phone recording'), t('Upload from the phone'), '録画'], [t('Frame sampling'), 'ffmpeg', '抽出'], [t('Key moments'), t('Local vision AI or by hand'), '瞬間'],
  [t('Ask why'), t('Questions beyond the manual'), '問い'], [t('Master explains'), t('Typed or spoken answer'), '説明'], [t('Knowledge draft'), t('Cues · warnings · clip'), '草案'],
  [t('Expert approval'), t('Explicit sign-off'), '承認', 'primary'], [t('Approved knowledge'), 'SQLite (node:sqlite)', '知識', 'ink'],
];
const COACH = () => [
  [t('Student camera'), t('Still frames'), '練習'], [t('Grounded coach'), t('Cites approved records'), '指導', 'primary'], [t('Guidance + clip'), t('Timestamp · read aloud'), '助言'],
  [t('Cannot assess'), t('Evidence unclear'), '不明'], [t('Ask the master'), t('Live update'), '相談'], [t('New draft'), t('Never auto-approved'), '草案', 'ink'],
];
// SVG text does not wrap: estimate widths (CJK ≈ 1 em, Latin ≈ 0.55 em) and break into lines that fit.
const CJK = /[　-ヿ㐀-鿿＀-￯]/;
const width = (s, fs) => [...s].reduce((w, c) => w + (CJK.test(c) ? 1 : /[A-Z]/.test(c) ? 0.66 : 0.54), 0) * fs;
function lines(s, fs, max) {
  if (width(s, fs) <= max) return [s];
  if (s.includes(' ')) {
    const out = ['']; for (const w of s.split(' ')) { const next = out.at(-1) ? out.at(-1) + ' ' + w : w; if (out.at(-1) && width(next, fs) > max) out.push(w); else out[out.length - 1] = next; }
    return out;
  }
  // Japanese has no spaces: split into balanced lines, preferring a break after 、 and never inside a Latin word such as "AI".
  const k = Math.ceil(width(s, fs) / max), chars = [...s], out = []; let rest = chars;
  for (let n = k; n > 1; n--) {
    let cut = Math.ceil(rest.length / n);
    // a natural break near the middle: after 、 or a particle (から, の, を, で, に, と, が, は)
    let best = null;
    for (let c = Math.max(1, cut - 4); c <= Math.min(rest.length - 1, cut + 4); c++) {
      const prev = rest.slice(0, c).join(''); if (width(prev, fs) > max) break;
      if (width(rest.slice(c).join(''), fs) > max * (n - 1)) continue; // what is left must still fit
      const score = (/、$/.test(prev) ? 0 : /から$/.test(prev) ? 0.5 : /[のをでにとがは]$/.test(prev) ? 1 : 9) + Math.abs(c - cut) * 0.3;
      if (score < 9 && (!best || score < best.score)) best = { c, score };
    }
    if (best) cut = best.c;
    while (cut > 1 && /[A-Za-z0-9]/.test(rest[cut - 1]) && /[A-Za-z0-9]/.test(rest[cut] || '')) cut--;
    out.push(rest.slice(0, cut).join('')); rest = rest.slice(cut);
  }
  return [...out, rest.join('')];
}
// Fit a title into at most two lines, shrinking the font if needed.
function fit(s, fs, max) {
  for (let f = fs; f >= fs - 3; f--) if (width(s, f) <= max) return { ls: [s], f }; // one line if a slightly smaller size fits
  for (let f = fs; f >= 13; f--) { const ls = lines(s, f, max); if (ls.length <= 2) return { ls, f }; }
  return { ls: lines(s, 13, max).slice(0, 2), f: 13 };
}
const txt = (x, y, ls, f, attrs, lh = f * 1.18) => ls.map((l, k) => `<text x="${x}" y="${(y + k * lh).toFixed(1)}" font-size="${f}" ${attrs}>${esc(l)}</text>`).join('');
const fillOf = (tone) => (tone === 'primary' ? 'var(--primary)' : tone === 'ink' ? 'var(--sumi)' : 'var(--paper)');
function radial(nodes) {
  // Nodes sit 22.5° off the axes so every caption has open space beside it; captions are aligned away from the circle.
  const W = 1560, H = 1340, CX = W / 2, CY = H / 2, R = 400, NR = 96, n = nodes.length, D = R + NR + 60, step = 360 / n, a0 = -90 + step / 2;
  const at = (deg, r) => ({ x: CX + r * Math.cos((deg * Math.PI) / 180), y: CY + r * Math.sin((deg * Math.PI) / 180) });
  const arc = (i) => {
    const gap = (Math.asin((NR + 18) / R) * 180) / Math.PI, p1 = at(a0 + i * step + gap, R), p2 = at(a0 + (i + 1) * step - gap, R);
    return `M ${p1.x.toFixed(1)} ${p1.y.toFixed(1)} A ${R} ${R} 0 0 1 ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  };
  const node = ([title, sub, jp, tone], i) => {
    const deg = a0 + i * step, { x, y } = at(deg, R), fg = tone ? 'var(--sumi-fg)' : 'var(--ink)', { ls, f } = fit(title, 24, 2 * NR - 30);
    const ty = y - 4 - ((ls.length - 1) * f * 1.18) / 2 - 10;
    const lp = at(deg, D), right = lp.x > CX + 1, sl = lines(sub, 20, 230), sy = lp.y + 7 - ((sl.length - 1) * 24) / 2;
    return `<g class="flow-node" style="--fx:${(CX - x).toFixed(0)}px;--fy:${(CY - y).toFixed(0)}px;transition-delay:${i * 110}ms">
      <circle cx="${x}" cy="${y}" r="${NR}" fill="${fillOf(tone)}" stroke="var(--primary)" stroke-width="${tone ? 0 : 2}"/>
      <circle cx="${x}" cy="${y}" r="${NR - 9}" fill="none" stroke="${tone ? 'var(--sumi-fg)' : 'var(--primary)'}" stroke-width="1" stroke-dasharray="3 5" opacity=".5"/>
      ${txt(x, ty, ls, f, `text-anchor="middle" font-weight="700" fill="${fg}" class="svg-serif"`)}
      <text x="${x}" y="${(ty + (ls.length - 1) * f * 1.18 + 30).toFixed(1)}" text-anchor="middle" font-size="20" fill="${tone ? fg : 'var(--primary)'}" class="svg-serif">${jp}</text></g>
      <g class="flow-label" style="transition-delay:${900 + i * 110}ms">${txt(lp.x, sy, sl, 20, `text-anchor="${right ? 'start' : 'end'}" fill="var(--ink2)"`, 24)}</g>`;
  };
  return `<svg viewBox="0 0 ${W} ${H}" class="flow-svg radial" role="img" aria-label="${esc(t('Knowledge capture pipeline'))}"><defs><marker id="ar1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0 L10 5 L0 10z" fill="var(--primary)"/></marker></defs>
    <g class="flow-spin" style="transform-origin:${CX}px ${CY}px">
      <g class="flow-ring-rev"><circle cx="${CX}" cy="${CY}" r="${R - 170}" fill="none" stroke="var(--primary)" stroke-dasharray="12 9" opacity=".35" class="flow-drift"/></g>
      ${nodes.map((_, i) => `<path d="${arc(i)}" pathLength="1" class="flow-edge" fill="none" stroke="var(--primary)" stroke-width="3" marker-end="url(#ar1)" style="transition-delay:${700 + i * 120}ms"/>`).join('')}
      <g class="flow-hub"><circle cx="${CX}" cy="${CY}" r="120" fill="var(--primary)"/><circle cx="${CX}" cy="${CY}" r="108" fill="none" stroke="#fff" stroke-dasharray="4 6" opacity=".6"/>
        <text x="${CX}" y="${CY + 6}" text-anchor="middle" font-size="50" font-weight="700" fill="#fff" class="svg-serif">記録</text>
        <text x="${CX}" y="${CY + 40}" text-anchor="middle" font-size="17" fill="#fff" opacity=".9" letter-spacing="3">${esc(t('CAPTURE'))}</text></g>
      ${nodes.map(node).join('')}
    </g></svg>`;
}
function river(steps) {
  const W = 1320, H = 740, X0 = 140, X1 = 1180, n = steps.length, NR = 58, bx = (i) => X0 + (i * (X1 - X0)) / (n - 1), by = (i) => 370 + Math.sin(i * 1.05) * 100;
  let d = `M ${bx(0) - 100} ${by(0)}`;
  for (let i = 0; i < n - 1; i++) { const mx = (bx(i) + bx(i + 1)) / 2; d += ` C ${mx} ${by(i)}, ${mx} ${by(i + 1)}, ${bx(i + 1)} ${by(i + 1)}`; }
  d += ` L ${bx(n - 1) + 100} ${by(n - 1)}`;
  const node = ([title, sub, jp, tone], i) => {
    const x = bx(i), y = by(i), up = i % 2 === 0, cy = up ? y - 80 : y + 80, fg = tone ? 'var(--sumi-fg)' : 'var(--ink)';
    const { ls, f } = fit(title, 24, 205), sl = lines(sub, 19, 205), blockH = ls.length * f * 1.18 + sl.length * 23 + 6;
    const top = up ? cy - NR - 18 - blockH : cy + NR + 18, ty = top + f, sy = top + ls.length * f * 1.18 + 6 + 18;
    return `<g class="flow-node" style="transition-delay:${300 + i * 170}ms"><line x1="${x}" y1="${y}" x2="${x}" y2="${cy}" stroke="var(--primary)" stroke-width="2" opacity=".6"/><circle cx="${x}" cy="${y}" r="6" fill="var(--primary)"/>
      <circle cx="${x}" cy="${cy}" r="${NR}" fill="${fillOf(tone)}" stroke="var(--primary)" stroke-width="${tone ? 0 : 2}"/><circle cx="${x}" cy="${cy}" r="${NR - 8}" fill="none" stroke="${tone ? 'var(--sumi-fg)' : 'var(--primary)'}" stroke-width="1" stroke-dasharray="3 4" opacity=".5"/>
      <text x="${x}" y="${cy + 10}" text-anchor="middle" font-size="28" font-weight="700" fill="${fg}" class="svg-serif">${jp}</text>
      ${txt(x, ty, ls, f, `text-anchor="middle" font-weight="700" fill="var(--ink)" class="svg-serif"`)}${txt(x, sy, sl, 19, 'text-anchor="middle" fill="var(--ink2)"', 23)}</g>`;
  };
  return `<svg viewBox="0 0 ${W} ${H}" class="flow-svg river" role="img" aria-label="${esc(t('Student coaching loop'))}"><defs><marker id="ar2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L10 5 L0 10z" fill="var(--primary)"/></marker></defs>
    <path d="${d}" pathLength="1" class="flow-edge" fill="none" stroke="var(--primary)" stroke-width="3.5" marker-end="url(#ar2)" style="transition-delay:200ms;transition-duration:1.8s"/>
    <path d="${d}" fill="none" stroke="var(--primary)" stroke-width="1.4" stroke-dasharray="2 14" opacity=".4" class="flow-drift"/>
    <circle r="7" fill="var(--primary)" class="koi"><animateMotion dur="10s" repeatCount="indefinite" path="${d}"/></circle><circle r="4" fill="var(--primary)" opacity=".55" class="koi"><animateMotion dur="10s" begin="-5s" repeatCount="indefinite" path="${d}"/></circle>
    ${steps.map(node).join('')}</svg>`;
}
// Phones: the same steps as a vertical path, large enough to read.
const flowList = (steps, label) => `<ol class="flow-list" aria-label="${esc(label)}">${steps.map(([title, sub, jp, tone], i) =>
  `<li class="flow-li${tone ? ' ' + tone : ''}" style="transition-delay:${i * 90}ms"><span class="fl-seal">${jp}</span><span class="fl-txt"><b>${esc(title)}</b><span>${esc(sub)}</span></span></li>`).join('')}</ol>`;
const STACK = () => [
  ['server', 'torii', t('Express server'), t('Node.js routes, accounts, sessions and role-based access'), 'app.js', '門'],
  ['database', 'drum', 'SQLite', t('Built-in node:sqlite with repeatable migrations; data stays in the local data/ folder'), t('storage'), '太鼓'],
  ['eye', 'tomoe', t('Local vision AI'), t('Ollama model finds key moments and checks practice photos; moments can also be added by hand'), 'AI', '巴'],
  ['radio', 'chime', t('Server-sent events'), t('Live updates between the laptop and every phone'), t('realtime'), '風鈴'],
  ['phone', 'fan', t('Plain web client'), t('HTML, CSS and JavaScript; phone camera and microphone via the browser'), t('client'), '扇'],
  ['sound', 'wave', t('Local speech'), t('whisper.cpp turns spoken answers into text; Open JTalk reads lessons aloud in Japanese'), t('speech'), '波'],
];
const narrow = matchMedia('(max-width: 720px)');
function drawTech() {
  const small = narrow.matches;
  $('#flows').innerHTML = `<div class="flow l-flow-radial"><div class="flow-head"><h3>${esc(t('Knowledge capture pipeline'))}</h3><span class="tag">flow-01</span></div>${small ? flowList(CAPTURE(), t('Knowledge capture pipeline')) : `<div class="flow-scroll">${radial(CAPTURE())}</div>`}</div>
    <div class="flow l-flow-river"><div class="flow-head"><h3>${esc(t('Student coaching loop'))}</h3><span class="tag">flow-02</span></div>${small ? flowList(COACH(), t('Student coaching loop')) : `<div class="flow-scroll">${river(COACH())}</div>`}</div>`;
  $('#l-stack').innerHTML = STACK().map(([ic, mo, title, desc, tag, jp], i) => `<div class="reveal stack-card l-box" style="transition-delay:${i * 80}ms">
    <span class="motif-bg">${MOTIF[mo]}</span><div class="row sp"><span class="badge-ring"><span class="motif">${MOTIF[mo]}</span>${IC[ic]}</span><span class="chip">${esc(tag)}</span></div>
    <h3>${esc(title)} <span class="jp">${jp}</span></h3><p>${esc(desc)}</p></div>`).join('');
  watch(); tilt();
}
narrow.addEventListener?.('change', drawTech);

// ---- skills: the real profiles on this server, in the interface language; every card the same size ----
const KANJI = { soldering: '鏝', bonsai: '盆栽', kintsugi: '金継', katana: '刀' }, ORDER = ['soldering', 'bonsai', 'kintsugi', 'katana'];
async function drawSkills() {
  const box = $('#l-skills');
  try {
    const { skills } = await api('/api/skills');
    skills.sort((a, b) => (ORDER.indexOf(a.id) + 1 || 99) - (ORDER.indexOf(b.id) + 1 || 99));
    const IMG = new Set(['soldering', 'bonsai', 'kintsugi', 'katana']);
    const card = (kanji, ico, tag, name, desc, foot, id) => `<div class="skill-card l-box reveal"><span class="skill-img"><img src="/img/${IMG.has(id) ? id : 'custom'}.jpg" alt="${esc(name)}" loading="lazy" width="900" height="600"></span><span class="kanji" aria-hidden="true">${kanji}</span>
      <div class="skill-head"><span class="skill-ico">${ico}</span><span class="tag">${esc(tag)}</span></div><h3>${esc(name)}</h3><p>${esc(desc)}</p><div class="skill-foot">${foot}</div></div>`;
    box.innerHTML = skills.map((s) => card(KANJI[s.id] || '技', icon(s.id), s.category || '', s.name, s.description || '', `${IC.check}<span>${esc(t('{a} tasks · {b} tools', { a: s.taskCount, b: s.toolCount }))}</span>`, s.id)).join('')
      + card('技', icon('custom'), t('Any craft'), t('Your own skill'), t('Name the craft, list its tools and safety notes, describe the task: the AI works from that.'), `${IC.check}<span>${esc(t('Create a session'))}</span>`, 'custom');
    watch(); tilt();
  } catch { box.innerHTML = ''; }
}

// ---- scroll animations, both ways: play when an element comes into view, reset once it has left, so they play again ----
let io = null; const watched = new WeakSet();
const SEL = '.reveal,.flow,.feat,.hero-art,.l-steps li,.hl';
function watch() {
  const els = [...document.querySelectorAll(SEL)];
  if (!('IntersectionObserver' in window)) { els.forEach((e) => e.classList.add('is-visible')); return; }
  io ||= new IntersectionObserver((es) => es.forEach((e) => {
    if (e.isIntersecting && e.intersectionRatio >= 0.12) e.target.classList.add('is-visible');
    else if (!e.isIntersecting) e.target.classList.remove('is-visible'); // fully out of view: rewind
  }), { threshold: [0, 0.12, 0.3] });
  for (const e of els) if (!watched.has(e)) { watched.add(e); io.observe(e); }
}

// ---- interactions ----
const calm = matchMedia('(prefers-reduced-motion: reduce)');
// 3D tilt: a card leans toward the pointer, its shadow falls away from it and a sheen follows. Touch gets a gentle press instead (CSS :active).
function tilt() {
  for (const el of document.querySelectorAll('.l-box, .door, .hl, .l-ink')) {
    if (el.dataset.tilt) continue; el.dataset.tilt = '1'; el.classList.add('tilt');
    const max = el.classList.contains('l-ink') ? 2.5 : 6;
    el.addEventListener('pointermove', (e) => {
      if (calm.matches || e.pointerType !== 'mouse') return;
      const r = el.getBoundingClientRect(), px = (e.clientX - r.left) / r.width - 0.5, py = (e.clientY - r.top) / r.height - 0.5;
      const ang = Math.hypot(px, py) * 2 * max;
      el.classList.add('tilting');
      el.style.setProperty('--tx', (-py).toFixed(3)); el.style.setProperty('--ty', px.toFixed(3)); el.style.setProperty('--ta', ang.toFixed(2) + 'deg');
      el.style.setProperty('--mx', ((px + 0.5) * 100).toFixed(1) + '%'); el.style.setProperty('--my', ((py + 0.5) * 100).toFixed(1) + '%');
      el.style.setProperty('--sxy', `${(-px * 22).toFixed(1)}px ${(26 - py * 18).toFixed(1)}px`);
    });
    el.addEventListener('pointerleave', () => { el.classList.remove('tilting'); el.style.setProperty('--ta', '0deg'); });
  }
}
// Stickers: drag anywhere in the hero (mouse or finger). They lift, bend toward the pull, peel at the corner and settle with a little spring.
function stickers() {
  const hero = $('#hero');
  for (const st of document.querySelectorAll('.sticker')) {
    let sx = 0, sy = 0, ox = 0, oy = 0, lastX = 0, drag = false;
    st.addEventListener('pointerdown', (e) => {
      drag = true; st.setPointerCapture(e.pointerId); st.classList.add('lifted');
      sx = e.clientX; sy = e.clientY; lastX = e.clientX;
      ox = parseFloat(st.style.getPropertyValue('--dx')) || 0; oy = parseFloat(st.style.getPropertyValue('--dy')) || 0;
    });
    st.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const h = hero.getBoundingClientRect(), r = st.getBoundingClientRect();
      let dx = ox + e.clientX - sx, dy = oy + e.clientY - sy;
      // keep the sticker inside the hero
      const baseL = r.left - ((parseFloat(st.style.getPropertyValue('--dx')) || 0)), baseT = r.top - ((parseFloat(st.style.getPropertyValue('--dy')) || 0));
      dx = Math.max(h.left - baseL + 4, Math.min(h.right - baseL - r.width - 4, dx)); dy = Math.max(h.top - baseT + 4, Math.min(h.bottom - baseT - r.height - 4, dy));
      st.style.setProperty('--dx', dx + 'px'); st.style.setProperty('--dy', dy + 'px');
      if (!calm.matches) st.style.setProperty('--bend', Math.max(-14, Math.min(14, (e.clientX - lastX) * 1.5)).toFixed(1) + 'deg');
      lastX = e.clientX;
    });
    const drop = () => { if (!drag) return; drag = false; st.classList.remove('lifted'); st.style.setProperty('--bend', '0deg'); };
    st.addEventListener('pointerup', drop); st.addEventListener('pointercancel', drop);
    st.addEventListener('dblclick', () => { st.style.setProperty('--dx', '0px'); st.style.setProperty('--dy', '0px'); }); // double-click: back home
  }
}
// The ensō drifts with the pointer; the kanji moves a little more, for depth.
function parallax() {
  const art = $('.hero-art'), kanji = $('.enso-kanji'), hero = $('#hero');
  hero.addEventListener('pointermove', (e) => {
    if (calm.matches || e.pointerType !== 'mouse') return;
    const r = hero.getBoundingClientRect(), px = (e.clientX - r.left) / r.width - 0.5, py = (e.clientY - r.top) / r.height - 0.5;
    art.style.translate = `${(px * 14).toFixed(1)}px ${(py * 10).toFixed(1)}px`; kanji.style.translate = `${(px * 12).toFixed(1)}px ${(py * 9).toFixed(1)}px`;
  });
  hero.addEventListener('pointerleave', () => { art.style.translate = ''; kanji.style.translate = ''; });
}

// QR codes point phones at the public (tunnel) address, so a laptop visitor can hand off to a phone.
api('/api/entry').then((e) => {
  for (const [id, x] of [['#qr-m', e.masterPhone], ['#qr-a', e.student]]) { const b = $(id); b.querySelector('img').src = x.qr; b.hidden = false; }
  $('#lan').hidden = !e.localhost;
}, () => {});
// With hybrid AI switched on, the privacy promise on this page changes to say so.
api('/api/ai-mode').then((m) => {
  if (m.cloud === 'off' && !m.stt) return;
  const li = $('#priv-ai'), k = 'Video, audio and knowledge are stored on the master\'s computer. The operator uses hybrid AI: a cloud AI service helps write better questions and natural Japanese, and the local AI takes over whenever it is unavailable.';
  li.dataset.i18n = k; li.textContent = t(k);
}, () => {});
$('#jf').onsubmit = (e) => {
  e.preventDefault();
  const code = $('#code').value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  location.href = '/a.html#code=' + encodeURIComponent(code);
};
paintIcons(); drawTech(); drawSkills(); watch(); tilt(); stickers(); parallax();
onLang(() => { drawTech(); drawSkills(); });
