'use strict';
// keel usage page: the calendar. A date is a button that opens a month to pick a day from, never the browser's date field.
//
//   const K = window.KeelCalendar({ esc, t, root, place, locale, today, addDays });   // root: the element the header draws into; listeners are set up once
//   K.html({ id, label, value, data })
//
// place is KeelMenu's place(wrap, panel), which keeps an open panel inside the window. locale() is the page's locale for the
// month and weekday names; today() is the current day and addDays(day, n) the day n days later (format.js).
// html() returns the markup: id is the trigger's id (a view puts focus back on it after drawing again), label names the date
// for a screen reader, value is a day as 'YYYY-MM-DD', data is { name: value } written as data-name attributes on the trigger.
// A choice sets the trigger's `value` and fires a bubbling `change` event on it, as a menu does.
// A day is always a 'YYYY-MM-DD' string and the arithmetic on it is done in UTC: a Date in local time moves a day near midnight.
window.KeelCalendar = ({ esc, t, root, place, locale, today, addDays }) => {
  const ICON = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5"></rect><path d="M3.5 10h17M8 3v4M16 3v4"></path></svg>';
  const PREV = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"></path></svg>';
  const NEXT = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"></path></svg>';
  const DAY = /^\d{4}-\d{2}-\d{2}$/;
  let open = null;
  let at = ''; // the day the keyboard is on in the open panel

  const pad = (n) => String(n).padStart(2, '0');
  const split = (day) => day.split('-').map(Number);
  // JavaScript months count from 0: Date.UTC(y, m - 1, d) is day d of month m (1 to 12), and day 0 is the last day of the month before.
  const utc = (day) => { const [y, m, d] = split(day); return new Date(Date.UTC(y, m - 1, d)); };
  const monthLength = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  // getUTCDay() counts from Sunday (0): this counts from Monday (0), as the weeks are shown.
  const weekdayIndex = (day) => (utc(day).getUTCDay() + 6) % 7;
  // The same day of another month, or the month's last day when it is shorter (31 January + 1 month = 28 or 29 February).
  function addMonths(day, n) {
    const [y, m, d] = split(day);
    const first = new Date(Date.UTC(y, m - 1 + n, 1));
    const [ty, tm] = [first.getUTCFullYear(), first.getUTCMonth() + 1];
    return `${ty}-${pad(tm)}-${pad(Math.min(d, monthLength(ty, tm)))}`;
  }
  const format = (options) => new Intl.DateTimeFormat(locale(), { timeZone: 'UTC', ...options });
  // The day after a key, or null for a key that does not move.
  function moved(key, day) {
    switch (key) {
      case 'ArrowLeft': return addDays(day, -1);
      case 'ArrowRight': return addDays(day, 1);
      case 'ArrowUp': return addDays(day, -7);
      case 'ArrowDown': return addDays(day, 7);
      case 'PageUp': return addMonths(day, -1);
      case 'PageDown': return addMonths(day, 1);
      case 'Home': return addDays(day, -weekdayIndex(day));
      case 'End': return addDays(day, 6 - weekdayIndex(day));
      default: return null;
    }
  }

  // The weeks of the month `day` is in, as rows of seven cells; `marked` is the day the keyboard is on ('' when closed).
  function daysHtml(id, day, chosen, marked) {
    const [y, m] = split(day);
    const full = format({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const now = today();
    const blank = '<span role="gridcell"></span>';
    const cells = Array(weekdayIndex(`${day.slice(0, 8)}01`)).fill(blank);
    for (let n = 1; n <= monthLength(y, m); n++) {
      const date = `${day.slice(0, 8)}${pad(n)}`;
      cells.push(`<button type="button" role="gridcell" tabindex="-1" class="cal-day${date === marked ? ' at' : ''}" id="${esc(id)}_d${date}" data-date="${date}" aria-label="${esc(full.format(utc(date)))}" aria-selected="${date === chosen}"${date === now ? ' aria-current="date"' : ''}>${n}</button>`);
    }
    while (cells.length % 7) cells.push(blank);
    let rows = '';
    for (let i = 0; i < cells.length; i += 7) rows += `<div class="cal-row" role="row">${cells.slice(i, i + 7).join('')}</div>`;
    return rows;
  }
  const titleOf = (day) => format({ month: 'long', year: 'numeric' }).format(utc(day));

  function html({ id, label, value, data = {} }) {
    const chosen = DAY.test(value) ? value : today();
    const shown = format({ day: 'numeric', month: 'short', year: 'numeric' }).format(utc(chosen));
    const attrs = Object.entries(data).map(([k, v]) => ` data-${k}="${esc(v)}"`).join('');
    // 1 January 2024 is a Monday: seven days from it are the weekdays in the order the weeks are shown.
    const names = (options) => Array.from({ length: 7 }, (_, i) => format(options).format(new Date(Date.UTC(2024, 0, 1 + i))));
    const long = names({ weekday: 'long' });
    const weekdays = names({ weekday: 'short' }).map((name, i) => `<span role="columnheader" aria-label="${esc(long[i])}">${esc(name)}</span>`).join('');
    const nav = (step, name, icon) => `<button type="button" class="xbtn cal-nav" tabindex="-1" data-step="${step}" aria-label="${esc(t(name))}">${icon}</button>`;
    return `<span class="cal-wrap"><button type="button" class="field cal-btn" id="${esc(id)}" value="${esc(chosen)}"${attrs} aria-label="${esc(`${label}: ${shown}`)}" aria-haspopup="dialog" aria-expanded="false" aria-controls="${esc(id)}_cal">${ICON}<span>${esc(shown)}</span></button>`
      + `<div class="cal" id="${esc(id)}_cal" role="dialog" aria-label="${esc(label)}" hidden>`
      + `<div class="cal-head">${nav(-1, 'range.prev_month', PREV)}<b class="cal-title" id="${esc(id)}_title" aria-live="polite">${esc(titleOf(chosen))}</b>${nav(1, 'range.next_month', NEXT)}</div>`
      + `<div class="cal-grid" role="grid" aria-labelledby="${esc(id)}_title"><div class="cal-row cal-week" role="row">${weekdays}</div><div class="cal-days" role="rowgroup">${daysHtml(id, chosen, chosen, '')}</div></div></div></span>`;
  }

  const parts = (wrap) => ({ btn: wrap.querySelector('.cal-btn'), panel: wrap.querySelector('.cal'), title: wrap.querySelector('.cal-title'), days: wrap.querySelector('.cal-days') });

  // Draws the month of `day` with the keyboard on it. The panel is placed again: a month of six weeks is taller than one of five.
  function moveTo(wrap, day) {
    const { btn, panel, title, days } = parts(wrap);
    at = day;
    // A live region speaks when its content is replaced, so the title is replaced only when the month is another one.
    if (title.textContent !== titleOf(day)) title.innerHTML = esc(titleOf(day));
    days.innerHTML = daysHtml(btn.id, day, btn.value, day);
    btn.setAttribute('aria-activedescendant', `${btn.id}_d${day}`);
    place(wrap, panel);
  }

  function close() {
    if (!open) return;
    const { btn, panel } = parts(open);
    btn.setAttribute('aria-expanded', 'false');
    btn.removeAttribute('aria-activedescendant');
    panel.hidden = true;
    open = null;
  }

  function show(wrap) {
    close();
    open = wrap;
    const { btn, panel } = parts(wrap);
    btn.setAttribute('aria-expanded', 'true');
    panel.hidden = false;
    moveTo(wrap, btn.value);
    btn.focus();
  }

  function choose(wrap, day) {
    const { btn } = parts(wrap);
    close();
    btn.focus();
    if (day === btn.value) return;
    btn.value = day;
    btn.dispatchEvent(new Event('change', { bubbles: true }));
  }

  root.addEventListener('click', (e) => {
    const from = e.target && e.target.closest ? e.target : null;
    if (!from) return;
    const day = from.closest('.cal-day');
    if (day) { choose(day.closest('.cal-wrap'), day.dataset.date); return; }
    const nav = from.closest('.cal-nav');
    if (nav) {
      const wrap = nav.closest('.cal-wrap');
      moveTo(wrap, addMonths(at, Number(nav.dataset.step)));
      parts(wrap).btn.focus();
      return;
    }
    const btn = from.closest('.cal-btn');
    if (!btn) return;
    if (btn.getAttribute('aria-expanded') === 'true') close(); else show(btn.parentNode);
  });
  // A click anywhere else closes the panel; a click on a trigger is handled above, which runs first.
  document.addEventListener('click', (e) => { if (open && !open.contains(e.target)) close(); });

  // Focus stays on the trigger while the panel is open; the day the keyboard is on is `.at` and named by aria-activedescendant.
  root.addEventListener('keydown', (e) => {
    const btn = e.target && e.target.closest ? e.target.closest('.cal-btn') : null;
    if (!btn) return;
    const wrap = btn.parentNode;
    if (btn.getAttribute('aria-expanded') !== 'true') {
      if (['Enter', ' ', 'ArrowDown'].includes(e.key)) { e.preventDefault(); show(wrap); }
      return;
    }
    const next = moved(e.key, at);
    if (next) { e.preventDefault(); moveTo(wrap, next); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(wrap, at); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); btn.focus(); }
    else if (e.key === 'Tab') close();
  });
  // Firefox clicks a button when Space is released; the key is already handled on keydown.
  root.addEventListener('keyup', (e) => {
    if (e.key === ' ' && e.target && e.target.closest && e.target.closest('.cal-btn')) e.preventDefault();
  });

  return { html };
};
