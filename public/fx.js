// Small, tasteful interactions shared by the dashboard and both phones (the landing page has its own in landing.js):
// cards lean toward the mouse, stickers can be dragged and peel at the corner. Pages re-render often, so new elements
// are picked up automatically. Nothing here is needed to use the app, and it all stops for reduced motion.
const calm = matchMedia('(prefers-reduced-motion: reduce)');
const TILT = '.skill-opt, .sess-item, .join, .stat, .kchip, .lesson';

function tiltOne(el) {
  if (el.dataset.tilt) return; el.dataset.tilt = '1'; el.classList.add('tilt');
  el.addEventListener('pointermove', (e) => {
    if (calm.matches || e.pointerType !== 'mouse') return;
    const r = el.getBoundingClientRect(), px = (e.clientX - r.left) / r.width - 0.5, py = (e.clientY - r.top) / r.height - 0.5, max = r.width > 500 ? 2 : 5;
    el.classList.add('tilting');
    el.style.setProperty('--tx', (-py).toFixed(3)); el.style.setProperty('--ty', px.toFixed(3)); el.style.setProperty('--ta', (Math.hypot(px, py) * 2 * max).toFixed(2) + 'deg');
    el.style.setProperty('--mx', ((px + 0.5) * 100).toFixed(1) + '%'); el.style.setProperty('--my', ((py + 0.5) * 100).toFixed(1) + '%');
    el.style.setProperty('--sxy', `${(-px * 18).toFixed(1)}px ${(20 - py * 14).toFixed(1)}px`);
  });
  el.addEventListener('pointerleave', () => { el.classList.remove('tilting'); el.style.setProperty('--ta', '0deg'); });
}

// Drag a sticker anywhere inside its box (mouse or finger): it lifts, bends toward the pull, peels and springs into place.
function stickerOne(st) {
  if (st.dataset.drag) return; st.dataset.drag = '1';
  const box = () => st.closest('[data-sticker-box]') || st.parentElement;
  let sx = 0, sy = 0, ox = 0, oy = 0, lastX = 0, drag = false;
  const cur = (k) => parseFloat(st.style.getPropertyValue(k)) || 0;
  st.addEventListener('pointerdown', (e) => { drag = true; st.setPointerCapture(e.pointerId); st.classList.add('lifted'); sx = e.clientX; sy = e.clientY; lastX = e.clientX; ox = cur('--dx'); oy = cur('--dy'); });
  st.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const h = box().getBoundingClientRect(), r = st.getBoundingClientRect(), bl = r.left - cur('--dx'), bt = r.top - cur('--dy');
    const dx = Math.max(h.left - bl + 4, Math.min(h.right - bl - r.width - 4, ox + e.clientX - sx)), dy = Math.max(h.top - bt + 4, Math.min(h.bottom - bt - r.height - 4, oy + e.clientY - sy));
    st.style.setProperty('--dx', dx + 'px'); st.style.setProperty('--dy', dy + 'px');
    if (!calm.matches) st.style.setProperty('--bend', Math.max(-14, Math.min(14, (e.clientX - lastX) * 1.5)).toFixed(1) + 'deg');
    lastX = e.clientX;
  });
  const drop = () => { if (!drag) return; drag = false; st.classList.remove('lifted'); st.style.setProperty('--bend', '0deg'); };
  st.addEventListener('pointerup', drop); st.addEventListener('pointercancel', drop);
  st.addEventListener('dblclick', () => { st.style.setProperty('--dx', '0px'); st.style.setProperty('--dy', '0px'); });
}

let queued = false;
const apply = () => { queued = false; document.querySelectorAll(TILT).forEach(tiltOne); document.querySelectorAll('.sticker').forEach(stickerOne); };
export function initFx() {
  apply();
  new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(apply); } }).observe(document.body, { childList: true, subtree: true });
}
