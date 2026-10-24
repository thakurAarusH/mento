// Runs before the page is drawn, so there is no flash: the saved theme, or the device setting.
(function () {
  var t = null; try { t = localStorage.getItem('mento.theme'); } catch (e) { /* private mode */ }
  var dark = t ? t === 'dark' : window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
})();
