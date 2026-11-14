'use strict';
// keel usage page: the menu. A choice from a list is a button that opens a list of rows, never the browser's select.
//
//   const M = window.KeelMenu({ esc, root });   // root: the element the views draw into; listeners are set up once
//   M.html({ id, label, value, options: [{ value, label }], cls, prefix, data })
//
// html() returns the markup: id is the trigger's id (a view puts focus back on it after drawing again), label names
// the list for a screen reader, cls is the trigger's look ('chip', 'chip set', 'inline', 'btn sm'), prefix shows
// "prefix: value" in a chip, data is { name: value } written as data-name attributes on the trigger.
// A choice sets the trigger's `value` and fires a bubbling `change` event on it, which is what a browser select gave a view.
// M.place(wrap, panel) keeps an open panel inside the window; the calendar (calendar.js) uses it for its own panel.
window.KeelMenu = ({ esc, root }) => {
  const CHEVRON = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"></path></svg>';
  const CHECK = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"></path></svg>';
  const EDGE = 8; // px kept free between an open list and the window's edge
  let open = null;

  function html({ id, label, value, options, cls = 'chip', prefix = '', data = {} }) {
    const chosen = options.find((o) => o.value === value) || options[0];
    const face = prefix ? `${esc(prefix)}: <b>${esc(chosen.label)}</b>` : esc(chosen.label);
    const attrs = Object.entries(data).map(([k, v]) => ` data-${k}="${esc(v)}"`).join('');
    const rows = options.map((o, i) => `<button type="button" role="option" tabindex="-1" class="menu-item" id="${esc(id)}_o${i}" data-value="${esc(o.value)}" aria-selected="${o === chosen}"><span>${esc(o.label)}</span>${CHECK}</button>`).join('');
    return `<span class="menu-wrap"><button type="button" class="menu-btn ${cls}" id="${esc(id)}" value="${esc(chosen.value)}"${attrs} aria-label="${esc(`${label}: ${chosen.label}`)}" aria-haspopup="listbox" aria-expanded="false" aria-controls="${esc(id)}_list">${face}${CHEVRON}</button>`
      + `<div class="menu" id="${esc(id)}_list" role="listbox" aria-label="${esc(label)}" hidden>${rows}</div></span>`;
  }

  const parts = (wrap) => ({ btn: wrap.querySelector('.menu-btn'), menu: wrap.querySelector('.menu'), rows: [...wrap.querySelectorAll('.menu-item')] });

  // Under the button from its left edge; from the right edge when that leaves the window; upwards when there is no
  // room below and more above. A list that fits neither edge is pushed to the window's right edge.
  function place(wrap, menu) {
    menu.classList.remove('end', 'up');
    menu.style.left = '';
    const view = { w: document.documentElement.clientWidth, h: window.innerHeight };
    const at = wrap.getBoundingClientRect();
    const box = menu.getBoundingClientRect();
    if (box.right > view.w - EDGE) {
      if (at.right - box.width >= EDGE) menu.classList.add('end');
      else menu.style.left = `${view.w - EDGE - box.width - at.left}px`;
    }
    if (box.bottom > view.h - EDGE && at.top > view.h - at.bottom) menu.classList.add('up');
  }

  function setAt(wrap, index) {
    const { btn, menu, rows } = parts(wrap);
    rows.forEach((row, i) => row.classList.toggle('at', i === index));
    const row = rows[index];
    btn.setAttribute('aria-activedescendant', row.id);
    // The first row's offsetTop is the list's own padding: keep that much free above and under the row.
    const pad = rows[0].offsetTop;
    if (row.offsetTop - pad < menu.scrollTop) menu.scrollTop = row.offsetTop - pad;
    else if (row.offsetTop + row.offsetHeight + pad > menu.scrollTop + menu.clientHeight) menu.scrollTop = row.offsetTop + row.offsetHeight + pad - menu.clientHeight;
  }

  function close() {
    if (!open) return;
    const { btn, menu } = parts(open);
    btn.setAttribute('aria-expanded', 'false');
    btn.removeAttribute('aria-activedescendant');
    menu.hidden = true;
    open = null;
  }

  function show(wrap) {
    close();
    open = wrap;
    const { btn, menu, rows } = parts(wrap);
    btn.setAttribute('aria-expanded', 'true');
    menu.hidden = false;
    place(wrap, menu);
    btn.focus();
    setAt(wrap, Math.max(0, rows.findIndex((row) => row.getAttribute('aria-selected') === 'true')));
  }

  function choose(wrap, row) {
    const { btn } = parts(wrap);
    close();
    btn.focus();
    if (row.dataset.value === btn.value) return;
    btn.value = row.dataset.value;
    btn.dispatchEvent(new Event('change', { bubbles: true }));
  }

  root.addEventListener('click', (e) => {
    const from = e.target && e.target.closest ? e.target : null;
    if (!from) return;
    const row = from.closest('.menu-item');
    if (row) { choose(row.closest('.menu-wrap'), row); return; }
    const btn = from.closest('.menu-btn');
    if (!btn) return;
    if (btn.getAttribute('aria-expanded') === 'true') close(); else show(btn.parentNode);
  });
  // A click anywhere else closes the list; a click on a trigger is handled above, which runs first.
  document.addEventListener('click', (e) => { if (open && !open.contains(e.target)) close(); });

  // Focus stays on the trigger while the list is open; the row the keyboard is on is `.at` and named by aria-activedescendant.
  root.addEventListener('keydown', (e) => {
    const btn = e.target && e.target.closest ? e.target.closest('.menu-btn') : null;
    if (!btn) return;
    const wrap = btn.parentNode;
    if (btn.getAttribute('aria-expanded') !== 'true') {
      if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(e.key)) { e.preventDefault(); show(wrap); }
      return;
    }
    const { rows } = parts(wrap);
    const at = rows.findIndex((row) => row.classList.contains('at'));
    const go = (index) => { e.preventDefault(); setAt(wrap, Math.min(rows.length - 1, Math.max(0, index))); };
    if (e.key === 'ArrowDown') go(at + 1);
    else if (e.key === 'ArrowUp') go(at - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(rows.length - 1);
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(wrap, rows[at]); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); btn.focus(); }
    else if (e.key === 'Tab') close();
    else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const key = e.key.toLowerCase();
      for (let step = 1; step <= rows.length; step++) {
        const i = (at + step) % rows.length;
        if (rows[i].textContent.trim().toLowerCase().startsWith(key)) { go(i); break; }
      }
    }
  });
  // Firefox clicks a button when Space is released; the key is already handled on keydown.
  root.addEventListener('keyup', (e) => {
    if (e.key === ' ' && e.target && e.target.closest && e.target.closest('.menu-btn')) e.preventDefault();
  });

  return { html, place };
};
