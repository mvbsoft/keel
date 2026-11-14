'use strict';
// The theme of a keel page. A page opens dark, whatever the system or the host asks for; light is a
// manual choice, kept in this browser for this page. Load this file as a plain script at the top of the
// page, before its first element, so the page never paints in the other theme first.
// window.KeelTheme: get() -> 'dark' | 'light'; set(theme); control({ label, dark, light }) -> the switch.
// A page that draws by theme (a diagram) listens for the document's `keel-theme` event.
(function () {
  const KEY = 'keel-theme';
  const root = document.documentElement;
  const ICONS = {
    dark: 'M12 3h.4a7.5 7.5 0 0 0 7.9 12.4A9 9 0 1 1 12 3',
    light: 'M8 12a4 4 0 1 0 8 0 4 4 0 1 0-8 0M3 12h1m8-9v1m8 8h1m-9 8v1M5.6 5.6l.7.7m12.1-.7-.7.7m0 11.4.7.7m-12.1-.7-.7.7',
  };
  const switches = [];

  function get() { return root.dataset.keelTheme === 'light' ? 'light' : 'dark'; }
  function mark() {
    for (const seg of switches) {
      for (const b of seg.querySelectorAll('button')) {
        const on = b.dataset.theme === get();
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', String(on));
      }
    }
  }
  function set(theme) {
    if (theme === 'light') root.dataset.keelTheme = 'light'; else delete root.dataset.keelTheme;
    // Storage can be blocked (a private window, a preview): the choice then lasts for this visit.
    try { localStorage.setItem(KEY, get()); } catch (e) { /* not saved */ }
    mark();
    document.dispatchEvent(new CustomEvent('keel-theme', { detail: get() }));
  }
  function control(texts) {
    const seg = document.createElement('div');
    seg.className = 'seg icons';
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', texts.label);
    for (const theme of ['dark', 'light']) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.theme = theme;
      b.title = texts[theme];
      b.setAttribute('aria-label', texts[theme]);
      b.innerHTML = `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[theme]}"></path></svg>`;
      b.addEventListener('click', () => set(theme));
      seg.append(b);
    }
    switches.push(seg);
    mark();
    return seg;
  }

  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) { /* no storage: dark */ }
  if (saved === 'light') root.dataset.keelTheme = 'light';
  window.KeelTheme = { get, set, control };
})();
