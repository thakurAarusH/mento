// Practice Lab (experiment): a lightweight, browser-based 3D workbench. Tutorials are built from the master's approved
// lessons and the clips of their demonstration videos; a built-in cooking demo (onigiri) shows the idea without any data.
// Students drag the right tool or ingredient onto the workbench, follow each step, make mistakes and get feedback.
// Read-only: it uses the existing /api/knowledge endpoint and changes nothing on the server.
import { $, esc, api, announce, t } from '/common.js';
import { initLang, onLang, LANG } from '/i18n.js';
initLang();
const app = $('#app');
const ctx = (() => { try { return JSON.parse(sessionStorage.getItem('mento.lab') || 'null'); } catch { return null; } })(); // { token, title, skill }
const calm = matchMedia('(prefers-reduced-motion: reduce)');
const L = (o) => (typeof o === 'string' ? o : o[LANG] || o.en); // bilingual demo text
const shuffle = (a) => { const r = [...a]; for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; } return r; };
const buzz = () => { try { navigator.vibrate?.(60); } catch { /* not supported */ } };

// ---- built-in demo: make an onigiri (cooking-style) ----
const DEMO = () => ({
  id: 'demo', demo: true, title: { en: 'Make an onigiri', ja: 'おにぎりを作る' },
  steps: [
    { title: { en: 'Wet your hands', ja: '手を水でぬらす' }, say: { en: 'Dip your hands in water so the rice does not stick.', ja: 'ご飯がくっつかないように、手を水でぬらします。' },
      item: '💧', items: [['💧', { en: 'Bowl of water', ja: '手水' }], ['🧈', { en: 'Butter', ja: 'バター' }], ['🔪', { en: 'Knife', ja: '包丁' }]],
      wrong: { en: 'Dry or greasy hands make the rice stick or slip. Wet them with water first.', ja: '乾いた手や油のついた手では、ご飯がくっついたり滑ったりします。まず水でぬらしましょう。' } },
    { title: { en: 'Salt your palms', ja: '手のひらに塩をつける' }, say: { en: 'Just a pinch of salt on your palms seasons the outside.', ja: 'ひとつまみの塩を手のひらにつけて、外側に味をつけます。' },
      item: '🧂', items: [['🧂', { en: 'Salt', ja: '塩' }], ['🍬', { en: 'Sugar', ja: '砂糖' }], ['🌶️', { en: 'Chilli', ja: '唐辛子' }]],
      wrong: { en: 'That is not salt. Onigiri are seasoned with a pinch of salt on wet palms.', ja: 'それは塩ではありません。おにぎりは、ぬらした手に塩をひとつまみつけて味をつけます。' },
      action: { type: 'tap', min: 2, max: 3, label: { en: 'Sprinkle a pinch: tap 2–3 times', ja: 'ひとつまみ：2〜3回タップ' }, over: { en: 'Too much salt! A pinch is only 2–3 small shakes.', ja: '塩が多すぎます！ひとつまみは2〜3回だけです。' } } },
    { title: { en: 'Scoop warm rice', ja: '温かいご飯をとる' }, say: { en: 'Use freshly cooked, warm rice — it holds together.', ja: '炊きたての温かいご飯を使うと、よくまとまります。' },
      item: '🍚', items: [['🍚', { en: 'Warm rice', ja: '温かいご飯' }], ['🧊', { en: 'Cold rice from the fridge', ja: '冷蔵庫の冷たいご飯' }], ['🍝', { en: 'Pasta', ja: 'パスタ' }]],
      wrong: { en: 'Cold rice is hard and crumbles. Use warm rice so the grains stick together.', ja: '冷たいご飯は固く、崩れやすくなります。温かいご飯を使いましょう。' } },
    { title: { en: 'Add the filling', ja: '具を入れる' }, say: { en: 'Put a pickled plum in the middle and close the rice around it.', ja: '梅干しを真ん中に置き、ご飯で包みます。' },
      item: '🔴', items: [['🔴', { en: 'Umeboshi (pickled plum)', ja: '梅干し' }], ['🍫', { en: 'Chocolate', ja: 'チョコレート' }], ['🧀', { en: 'Cheese cube', ja: 'チーズ' }]],
      wrong: { en: 'Try the classic filling first: umeboshi, a salty pickled plum.', ja: 'まずは定番の梅干しから試しましょう。' },
      action: { type: 'quiz', q: { en: 'Where does the filling go?', ja: '具はどこに入れますか？' }, ok: { en: 'In the centre, covered by rice', ja: 'ご飯で包むように真ん中に' }, bad: [{ en: 'On the edge, so it shows', ja: '見えるように端に' }, { en: 'On top, uncovered', ja: '上にのせるだけ' }], why: { en: 'Filling at the edge falls out when you shape it.', ja: '端に置くと、形を整えるときにこぼれてしまいます。' } } },
    { title: { en: 'Shape the triangle', ja: '三角に握る' }, say: { en: 'Cup your hands and press gently, turning the rice three times.', ja: '手を丸めて、ご飯を回しながら3回やさしく握ります。' },
      action: { type: 'hold', times: 3, label: { en: 'Hold to press, release in the green zone (gentle)', ja: '長押しで握り、緑の範囲で離す（やさしく）' }, over: { en: 'Too hard! Squeezing makes the rice dense and gluey. Press gently.', ja: '強すぎます！強く握るとご飯が固く、べたべたになります。やさしく握りましょう。' }, under: { en: 'Too soft — it will fall apart. Press a little longer.', ja: '弱すぎて崩れてしまいます。もう少し長く握りましょう。' } } },
    { title: { en: 'Wrap with nori', ja: '海苔を巻く' }, say: { en: 'Wrap a strip of nori around the base.', ja: '海苔を下の部分に巻きます。' },
      item: '🟩', items: [['🟩', { en: 'Nori (seaweed)', ja: '海苔' }], ['📄', { en: 'Paper', ja: '紙' }], ['🥬', { en: 'Lettuce', ja: 'レタス' }]],
      wrong: { en: 'Onigiri are wrapped in nori, the dried seaweed sheet.', ja: 'おにぎりには海苔（乾燥した海藻）を巻きます。' },
      action: { type: 'quiz', q: { en: 'Packing it for lunch later — when do you wrap the nori?', ja: 'お弁当で後から食べるとき、海苔はいつ巻きますか？' }, ok: { en: 'Just before eating', ja: '食べる直前' }, bad: [{ en: 'Right away, in the morning', ja: '朝すぐに' }], why: { en: 'Nori wrapped hours early goes soggy. Keep it separate and wrap just before eating.', ja: '早く巻くと海苔がしけってしまいます。別にしておき、食べる直前に巻きましょう。' } } },
  ],
});

// ---- tutorials from the master's approved lessons and demonstration clips ----
const ICONS = [[/clean|sponge|brass|クリーナ/i, '🧽'], [/iron|はんだごて|^こて/i, '🔥'], [/solder|はんだ/i, '🧵'], [/cutter|nipper|ニッパ/i, '✂️'], [/clamp|holder|hands|ホルダ/i, '🗜️'],
  [/flux|フラックス/i, '💧'], [/wire|針金/i, '🧶'], [/brush|筆/i, '🖌️'], [/lacquer|urushi|漆/i, '🫙'], [/gold|金/i, '✨'], [/spatula|へら/i, '🥄'], [/hammer|槌/i, '🔨'],
  [/steel|鋼/i, '⚙️'], [/charcoal|炭/i, '⚫'], [/clay|土/i, '🟫'], [/water|水/i, '💧'], [/stone|砥/i, '🪨'], [/paste|剤/i, '🧴'], [/scissor|shear|切/i, '✂️']];
const iconFor = (name) => (ICONS.find(([re]) => re.test(name)) || [0, '🧰'])[1];
const splitList = (s) => String(s || '').split(/[;；\n]|、(?=\S)/).map((x) => x.trim()).filter((x) => x.length > 2);
function fromLessons(lessons, skill) {
  const tools = (skill?.tools || []).map((x) => x.name), ordered = [...lessons].sort((a, b) => (a.clip ? a.clip.t : 1e9) - (b.clip ? b.clip.t : 1e9));
  const allCues = ordered.flatMap((k) => splitList(k.cues).map((c) => [k.id, c]));
  return {
    id: 'session', title: ctx?.title || t('Your master\'s lessons'),
    steps: ordered.slice(0, 8).map((k, i) => {
      const s = { id: k.id, title: k.step || t('Step {n}', { n: i + 1 }), say: k.summary || k.verbatim, clip: k.clip, wrong: splitList(k.warnings)[0] || '' };
      // The tool the master named in this lesson, matched to the skill's tool list; two other tools as distractors.
      const named = splitList(k.tool)[0], match = named && (tools.find((x) => named.toLowerCase().includes(x.toLowerCase().split(/[ (（]/)[0]) || x.toLowerCase().includes(named.toLowerCase())) || named);
      if (match) s.items = shuffle([[iconFor(match), match], ...shuffle(tools.filter((x) => x !== match)).slice(0, 2).map((x) => [iconFor(x), x])]), s.item = match;
      // "How do you know it is right?" — the master's own cue against cues from other steps.
      const cue = splitList(k.cues)[0], others = shuffle(allCues.filter(([id]) => id !== k.id).map(([, c]) => c)).slice(0, 2);
      if (cue && others.length) s.action = { type: 'quiz', q: t('How does your master know this step is done right?'), ok: cue, bad: others, why: s.wrong || t('Watch the master\'s clip again and look for the sign they use.') };
      return s;
    }),
  };
}

// ---- state ----
let tut = null, si = 0, phase = 'menu', mistakes = [], stars = [], lessons = null, loadErr = '', act = {};
async function load() {
  if (!ctx?.token) return;
  try { lessons = (await api('/api/knowledge', { token: ctx.token })).filter((k) => k.status === 'approved' || !k.status); } catch (e) { loadErr = e.message; lessons = []; }
}
const back = () => (ctx?.token ? `/a.html#${encodeURIComponent(ctx.token)}` : '/a.html');

// ---- screens ----
function menu() {
  phase = 'menu';
  const n = lessons?.length || 0;
  app.innerHTML = `<p><a href="${back()}" class="linkbtn">${t('← Back to the student page')}</a></p>
  <section class="card lab-intro"><span class="eyebrow">${t('Experiment · 実験')}</span><h1>${t('Practice Lab')}</h1>
  <p>${t('A small 3D workbench in your browser — no headset needed. Pick up the right tool, follow each step and learn from your mistakes. Tilt your phone or move the mouse to look around.')}</p></section>
  <section class="card"><h2>${t('Choose a tutorial')}</h2><div class="lab-choices">
    <button class="lab-choice" data-go="session"${n ? '' : ' disabled'}><span class="lab-ico">師</span><span><b>${t('From your master')}</b><small>${ctx ? esc(ctx.title) : t('Open the lab from your student page to use your master\'s lessons.')}</small>
      <small>${!ctx ? '' : n ? t('{n} approved lessons with clips from the demonstration', { n }) : loadErr ? esc(loadErr) : t('No approved lessons yet — ask your master, or try the demo.')}</small></span></button>
    <button class="lab-choice" data-go="demo"><span class="lab-ico">🍙</span><span><b>${t('Demo: make an onigiri')}</b><small>${t('A cooking-style warm-up: 6 steps, a few traps.')}</small></span></button>
  </div></section>`;
}
function start(which) {
  tut = which === 'demo' ? DEMO() : fromLessons(lessons, ctx?.skill); si = 0; mistakes = []; stars = tut.steps.map(() => 3);
  step();
}
const progress = () => `<ol class="lab-prog" aria-label="${t('Steps')}">${tut.steps.map((s, i) => `<li class="${i < si ? 'done' : i === si ? 'now' : ''}" title="${esc(L(s.title))}"></li>`).join('')}</ol>`;
function step() {
  const s = tut.steps[si]; phase = s.items ? 'pick' : s.action ? 'act' : 'confirm'; act = {};
  app.innerHTML = `<div class="lab-top"><button class="linkbtn" data-a="menu">${t('← Tutorials')}</button><span class="hint">${esc(L(tut.title))} · ${t('Step {a} of {b}', { a: si + 1, b: tut.steps.length })}</span></div>${progress()}
  <section class="card lab-step"><span class="eyebrow">${t('Step {n}', { n: si + 1 })}</span><h2>${esc(L(s.title))}</h2><p class="lab-say">${esc(L(s.say))}</p>
    ${s.clip ? `<details class="lab-clip"><summary>▶ ${t('Watch the master do it')}</summary><video controls playsinline preload="none" src="${esc(s.clip.url)}#t=${Math.max(0, s.clip.t - 3)},${s.clip.t + 6}"></video></details>` : ''}</section>
  ${scene(s)}<div id="lab-panel"></div><p id="lab-fb" class="lab-fb" role="status" aria-live="assertive"></p>`;
  panel(); bindScene();
}
// The 3D workbench: a counter, a cutting board (the drop zone) and a shelf of tools that tilt with the phone or mouse.
function scene(s) {
  const done = phase !== 'pick';
  return `<div class="lab-scene" id="scene"><div class="lab-room">
    <div class="lab-wall"><span class="lab-noren">${s.items ? esc(L(tut.demo ? { en: '台所', ja: '台所' } : { en: '工房', ja: '工房' })) : '稽古'}</span></div>
    <div class="lab-counter"><div class="lab-board${done && s.item ? ' has-item' : ''}" id="board" aria-label="${t('Workbench')}">${done && s.item ? `<span class="lab-placed">${esc(s.items.find(([, n]) => n === s.item || n.en === s.item?.en)?.[0] || iconFor(L(s.item)))}</span>` : `<span class="hint">${s.items ? t('Drop it here') : ''}</span>`}</div></div>
    ${s.items && !done ? `<div class="lab-shelf">${s.items.map(([ico, name], i) => `<button class="lab-item" data-i="${i}" style="--d:${i * 70}ms"><span class="lab-emoji">${esc(ico)}</span><span class="lab-name">${esc(L(name))}</span></button>`).join('')}</div>` : ''}
  </div></div>`;
}
function panel() {
  const s = tut.steps[si], p = $('#lab-panel'); if (!p) return;
  if (phase === 'pick') p.innerHTML = `<p class="lab-task">👆 ${t('Drag the right tool or ingredient onto the workbench (or tap it).')}</p>`;
  else if (phase === 'act' && s.action?.type === 'quiz') { const opts = shuffle([s.action.ok, ...s.action.bad]); p.innerHTML = `<div class="card lab-quiz"><h3>${esc(L(s.action.q))}</h3>${opts.map((o) => `<button class="btn lab-opt" data-ok="${o === s.action.ok ? 1 : 0}">${esc(L(o))}</button>`).join('')}</div>`; }
  else if (phase === 'act' && s.action?.type === 'tap') p.innerHTML = `<div class="card lab-quiz"><h3>${esc(L(s.action.label))}</h3><button class="btn big lab-tap" id="tapb">🧂 <span id="tapn">0</span></button><button class="btn primary" id="tapdone">${t('Done')}</button></div>`;
  else if (phase === 'act' && s.action?.type === 'hold') p.innerHTML = `<div class="card lab-quiz"><h3>${esc(L(s.action.label))}</h3><div class="lab-gauge"><span class="lab-zone"></span><span class="lab-fill" id="fill"></span></div><p class="hint" id="holdn">${t('Press {a} of {b}', { a: 1, b: s.action.times })}</p><button class="btn big primary lab-hold" id="holdb">✊ ${t('Hold to press')}</button></div>`;
  else p.innerHTML = `<div class="card lab-quiz"><button class="btn big primary" data-a="next">${si + 1 < tut.steps.length ? t('I did this step → next') : t('Finish')}</button></div>`;
}
const fb = (msg, good) => { const e = $('#lab-fb'); if (!e) return; e.textContent = msg; e.className = 'lab-fb ' + (good ? 'good' : 'bad'); announce(msg); };
function mistake(why) {
  stars[si] = Math.max(1, stars[si] - 1); mistakes.push({ step: si, why }); buzz();
  $('#scene')?.classList.remove('shake'); void $('#scene')?.offsetWidth; $('#scene')?.classList.add('shake');
  fb('✗ ' + (why || t('Not quite. Watch the master\'s clip and try again.')), false);
}
function advance() { const s = tut.steps[si]; phase = s.action ? 'act' : 'confirm'; panel(); } // after the item is on the board: its action, if any
function pick(i) {
  const s = tut.steps[si], [ico, name] = s.items[i], ok = ico === s.item || name === s.item || L(name) === L(s.item);
  if (!ok) return mistake(L(s.wrong) || t('That is not what your master uses here.'));
  const btn = document.querySelector(`.lab-item[data-i="${i}"]`), board = $('#board');
  board.classList.add('has-item'); board.innerHTML = `<span class="lab-placed pop">${esc(s.items[i][0])}</span>`; btn?.remove();
  document.querySelector('.lab-shelf')?.classList.add('fade');
  fb('✓ ' + t('Right — {name}.', { name: L(name) }), true); phase = 'placed'; setTimeout(advance, 650);
}
function next() { if (si + 1 < tut.steps.length) { si++; step(); } else if (tut.steps.length >= 3) order(); else summary(); }
// Final challenge: put the steps in order.
function order() {
  phase = 'order'; act.picked = [];
  const cards = shuffle(tut.steps.map((s, i) => [i, L(s.title)]));
  app.innerHTML = `<div class="lab-top"><button class="linkbtn" data-a="menu">${t('← Tutorials')}</button></div>${progress()}<section class="card"><span class="eyebrow">${t('Final challenge')}</span><h2>${t('Put the steps in order')}</h2><p class="hint">${t('Tap the steps from first to last.')}</p>
  <div class="lab-order">${cards.map(([i, n]) => `<button class="btn lab-card" data-o="${i}">${esc(n)}</button>`).join('')}</div><ol class="lab-seq" id="seq"></ol></section><p id="lab-fb" class="lab-fb" role="status" aria-live="assertive"></p>`;
}
function orderPick(b) {
  const i = +b.dataset.o, want = act.picked.length;
  if (i !== want) { mistakes.push({ step: i, why: t('Order: “{a}” is not next.', { a: L(tut.steps[i].title) }) }); buzz(); b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake'); return fb('✗ ' + t('Not next. Which step comes before it?'), false); }
  act.picked.push(i); b.disabled = true; b.classList.add('used'); $('#seq').insertAdjacentHTML('beforeend', `<li>${esc(L(tut.steps[i].title))}</li>`); fb('✓', true);
  if (act.picked.length === tut.steps.length) setTimeout(summary, 600);
}
function summary() {
  phase = 'done'; const got = stars.reduce((a, b) => a + b, 0), max = stars.length * 3;
  const key = 'mento.lab.best.' + (tut.demo ? 'demo' : ctx?.token?.slice(0, 12)); let best = 0; try { best = +localStorage.getItem(key) || 0; if (got > best) localStorage.setItem(key, got); } catch { /* private mode */ }
  const steps = [...new Set(mistakes.map((m) => m.step))];
  app.innerHTML = `<section class="card lab-done"><span class="eyebrow">${t('Tutorial complete')}</span><h1>${esc(L(tut.title))}</h1>
  <p class="lab-stars" aria-label="${t('{a} of {b} stars', { a: got, b: max })}">${'★'.repeat(Math.round((got / max) * 5))}${'☆'.repeat(5 - Math.round((got / max) * 5))}</p>
  <p>${t('{a} of {b} stars · {m} mistakes', { a: got, b: max, m: mistakes.length })}${best && got <= best ? ' · ' + t('best {n}', { n: best }) : got > best && best ? ' · ' + t('new best!') : ''}</p>
  ${steps.length ? `<h2>${t('Worth another look')}</h2><ul class="plain">${steps.map((i) => `<li><b>${esc(L(tut.steps[i].title))}</b><br><span class="hint">${esc(mistakes.find((m) => m.step === i).why)}</span></li>`).join('')}</ul>` : `<p class="notice ok">${t('No mistakes — well done!')}</p>`}
  <div class="row"><button class="btn primary" data-a="again">${t('Try again')}</button><button class="btn" data-a="menu">${t('Other tutorials')}</button><a class="btn" href="${back()}">${t('Back to the student page')}</a></div>
  <p class="hint">${tut.demo ? t('The onigiri demo is a built-in example.') : t('This practice is a simulation from your master\'s lessons — it does not replace practising with real tools under supervision.')}</p></section>`;
  if (!calm.matches) confetti();
}
function confetti() { const c = document.createElement('div'); c.className = 'lab-confetti'; c.innerHTML = Array.from({ length: 24 }, (_, i) => `<span style="left:${(i * 41) % 100}%;--d:${(i % 6) * 0.15}s;--h:${(i * 47) % 360}"></span>`).join(''); document.body.append(c); setTimeout(() => c.remove(), 2600); }

// ---- interactions: drag (mouse or finger) or tap; tilt with the phone or mouse ----
function bindScene() {
  for (const it of document.querySelectorAll('.lab-item')) {
    let sx = 0, sy = 0, drag = false, moved = false;
    it.addEventListener('pointerdown', (e) => { drag = true; moved = false; sx = e.clientX; sy = e.clientY; it.setPointerCapture(e.pointerId); it.classList.add('lifted'); });
    it.addEventListener('pointermove', (e) => { if (!drag) return; const dx = e.clientX - sx, dy = e.clientY - sy; if (Math.hypot(dx, dy) > 6) moved = true; it.style.translate = `${dx}px ${dy}px`; $('#board')?.classList.toggle('over', over(e)); });
    it.addEventListener('pointerup', (e) => { if (!drag) return; drag = false; it.classList.remove('lifted'); it.style.translate = ''; const hit = over(e); $('#board')?.classList.remove('over'); if (!moved || hit) pick(+it.dataset.i); });
    it.addEventListener('pointercancel', () => { drag = false; it.classList.remove('lifted'); it.style.translate = ''; });
  }
}
const over = (e) => { const b = $('#board')?.getBoundingClientRect(); return !!b && e.clientX > b.left - 20 && e.clientX < b.right + 20 && e.clientY > b.top - 20 && e.clientY < b.bottom + 20; };
function tilt(x, y) { const r = document.querySelector('.lab-room'); if (!r || calm.matches) return; r.style.setProperty('--ry', (x * 14).toFixed(2) + 'deg'); r.style.setProperty('--rx', (-y * 9).toFixed(2) + 'deg'); }
document.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' && document.querySelector('.lab-scene')) tilt(e.clientX / innerWidth - 0.5, e.clientY / innerHeight - 0.5); });
window.addEventListener('deviceorientation', (e) => { if (e.gamma == null) return; tilt(Math.max(-1, Math.min(1, e.gamma / 35)) / 2, Math.max(-1, Math.min(1, (e.beta - 45) / 35)) / 2); });
// iPhones ask before sharing motion: the first tap on the scene asks once.
document.addEventListener('click', () => { if (typeof DeviceOrientationEvent?.requestPermission === 'function' && !window.__motionAsked) { window.__motionAsked = true; DeviceOrientationEvent.requestPermission().catch(() => {}); } }, { once: true });

// hold-to-press gauge: release inside the green zone (45–75 %)
let holdT = null, holdV = 0;
function holdStart() { holdV = 0; const f = $('#fill'); clearInterval(holdT); holdT = setInterval(() => { holdV = Math.min(100, holdV + 2.2); if (f) f.style.width = holdV + '%'; }, 30); }
function holdEnd() {
  if (holdT == null) return; clearInterval(holdT); holdT = null; const s = tut.steps[si], a = s.action;
  if (holdV > 75) return mistake(L(a.over)); if (holdV < 45) return mistake(L(a.under));
  act.n = (act.n || 0) + 1; fb('✓ ' + t('Gentle — good.'), true); $('#scene')?.classList.add('press'); setTimeout(() => $('#scene')?.classList.remove('press'), 250);
  if (act.n >= a.times) setTimeout(() => { phase = 'confirm'; panel(); fb('✓ ' + t('Nicely shaped.'), true); }, 400); else { const h = $('#holdn'); if (h) h.textContent = t('Press {a} of {b}', { a: act.n + 1, b: a.times }); }
}
app.addEventListener('pointerdown', (e) => { if (e.target.closest('#holdb')) { e.preventDefault(); holdStart(); } });
document.addEventListener('pointerup', () => holdEnd()); document.addEventListener('pointercancel', () => holdEnd());
app.addEventListener('keydown', (e) => { if (e.target.id === 'holdb' && (e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); holdStart(); } });
app.addEventListener('keyup', (e) => { if (e.target.id === 'holdb' && (e.key === ' ' || e.key === 'Enter')) holdEnd(); });

app.addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.go) return start(b.dataset.go);
  if (b.dataset.a === 'menu') return menu();
  if (b.dataset.a === 'again') return start(tut.demo ? 'demo' : 'session');
  if (b.dataset.a === 'next') return next();
  if (b.classList.contains('lab-item') && e.detail === 0) return pick(+b.dataset.i); // keyboard: Enter/Space
  if (b.dataset.o != null) return orderPick(b);
  if (b.classList.contains('lab-opt')) { const s = tut.steps[si]; if (b.dataset.ok === '1') { fb('✓ ' + t('Correct.'), true); b.classList.add('right'); document.querySelectorAll('.lab-opt').forEach((x) => (x.disabled = true)); setTimeout(() => { phase = 'confirm'; panel(); }, 700); } else { b.disabled = true; mistake(L(s.action.why)); } return; }
  if (b.id === 'tapb') { act.n = (act.n || 0) + 1; $('#tapn').textContent = act.n; b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop'); return; }
  if (b.id === 'tapdone') { const a = tut.steps[si].action, n = act.n || 0; if (n > a.max) { act.n = 0; $('#tapn').textContent = 0; return mistake(L(a.over)); } if (n < a.min) return mistake(t('A little more — tap at least {n} times.', { n: a.min })); fb('✓ ' + t('Just right.'), true); phase = 'confirm'; panel(); }
});
onLang(() => { if (phase === 'menu') menu(); else if (phase === 'done') summary(); else if (phase === 'order') order(); else if (tut) step(); });

await load(); menu();
