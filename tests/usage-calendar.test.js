'use strict';
// calendar.js on its own, against the small fake DOM: the markup it makes, the weeks, opening and closing by mouse and
// keyboard, the day the keyboard is on, what a choice tells the view, where the open panel goes and the UTC dates.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const { parse } = require('./fixtures/mini-dom.js');

const dir = path.join(__dirname, '..', 'plugins', 'keel', 'templates', 'usage');
const read = (name) => fs.readFileSync(path.join(dir, name), 'utf8');
const source = read('calendar.js');
const I18N = require(path.join(dir, 'i18n.js'));
I18N.add('uk', require(path.join(dir, 'i18n.uk.js')));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
class Event { constructor(type, init = {}) { this.type = type; Object.assign(this, init); } }

// A Date that refuses to answer in local time: a calendar that reads a local day fails whatever zone the test runs in.
const UTC_ONLY = `(class UtcOnly extends Date {
  ${['getDate', 'getDay', 'getFullYear', 'getMonth', 'getHours', 'getTimezoneOffset', 'toDateString', 'toLocaleDateString'].map((n) => `${n}() { throw new Error('local time: ${n}'); }`).join('\n  ')}
})`;
const UtcOnly = vm.runInNewContext(UTC_ONLY);

const TODAY = '2026-11-14'; // a Saturday
const cal = (id, value, extra = {}) => ({ id, label: 'From', value, data: { range: 'from' }, ...extra });

// Draws the calendars and connects the markup to calendar.js's listeners; `changes` collects what a view would hear.
// `lang` is the page's language, read on each call as the page does.
function mount(calendars, { width = 1000, height = 800, lang = 'en', place } = {}) {
  const listeners = [];
  const docListeners = [];
  const root = { addEventListener: (type, fn) => listeners.push([type, fn]) };
  const window = { innerHeight: height };
  const document = { documentElement: { clientWidth: width }, addEventListener: (type, fn) => docListeners.push([type, fn]) };
  const pageLang = { now: lang };
  vm.runInNewContext(read('format.js'), { window });
  const F = window.KeelFormat(null, (k) => k, () => pageLang.now);
  vm.runInNewContext(read('menu.js'), { window, document, Event });
  const placed = [];
  const sharedPlace = window.KeelMenu({ esc, root: { addEventListener() {} } }).place;
  vm.runInNewContext(source, { window, document, Event, Intl, Date: UtcOnly });
  const K = window.KeelCalendar({
    esc, t: (key) => I18N.t(pageLang.now, key), root, locale: F.loc, today: () => TODAY, addDays: F.addDays,
    place: place === 'spy' ? (wrap, panel) => { placed.push([wrap, panel, panel.hidden]); sharedPlace(wrap, panel); } : sharedPlace,
  });
  const dom = parse(calendars.map((c) => K.html(c)).join(''), (type, event) => {
    for (const [t, fn] of listeners) if (t === type) fn(event);
    if (type === 'click') for (const [t, fn] of docListeners) if (t === 'click') fn(event);
  });
  const changes = [];
  const bubbled = [];
  listeners.push(['change', (e) => { changes.push([e.target.id, e.target.value]); bubbled.push(e.bubbles); }]);
  const { byId, fire } = dom;
  const isOpen = (id) => byId(id).getAttribute('aria-expanded') === 'true' && !byId(`${id}_cal`).hidden;
  const at = (id) => { const d = byId(`${id}_cal`).querySelectorAll('.cal-day').filter((c) => c.classList.contains('at')); return d.length === 1 ? d[0].dataset.date : d.map((c) => c.dataset.date); };
  const title = (id) => byId(`${id}_title`).textContent;
  const days = (id) => byId(`${id}_cal`).querySelectorAll('.cal-day');
  const key = (id, k, props) => fire('keydown', byId(id), { key: k, ...props });
  const press = (id, keys) => keys.forEach((k) => key(id, k));
  return { ...dom, changes, bubbled, isOpen, at, title, days, key, press, placed, setLang: (l) => { pageLang.now = l; }, html: (c) => K.html(c), K };
}

test('calendar: the trigger shows the chosen date with a calendar icon; the panel is hidden and has the month, the weekdays and the days', () => {
  const m = mount([cal('rgFrom', '2026-11-20')]);
  const btn = m.byId('rgFrom');
  assert.equal(btn.textContent, '20 Nov 2026');
  assert.equal(btn.querySelectorAll('.ic').length, 1, 'the calendar icon');
  assert.deepEqual([btn.getAttribute('aria-haspopup'), btn.getAttribute('aria-expanded'), btn.getAttribute('aria-controls'), btn.getAttribute('aria-label'), btn.value, btn.dataset.range],
    ['dialog', 'false', 'rgFrom_cal', 'From: 20 Nov 2026', '2026-11-20', 'from']);
  assert.ok(btn.classList.contains('cal-btn') && btn.classList.contains('field'));
  assert.equal(btn.tag, 'button');
  assert.equal(btn.getAttribute('type'), 'button');
  const panel = m.byId('rgFrom_cal');
  assert.deepEqual([panel.getAttribute('role'), panel.getAttribute('aria-label'), panel.hidden], ['dialog', 'From', true]);
  assert.equal(m.title('rgFrom'), 'November 2026');
  assert.equal(m.byId('rgFrom_title').getAttribute('aria-live'), 'polite', 'a new month is announced');
  const nav = panel.querySelectorAll('.cal-nav');
  assert.deepEqual(nav.map((n) => [n.dataset.step, n.getAttribute('aria-label')]), [['-1', 'Previous month'], ['1', 'Next month']]);
  assert.ok(nav.every((n) => n.getAttribute('type') === 'button' && n.getAttribute('tabindex') === '-1' && n.querySelectorAll('.ic').length === 1));
  assert.deepEqual(panel.querySelectorAll('[role="columnheader"]').map((c) => c.textContent), ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  assert.deepEqual(panel.querySelectorAll('[role="columnheader"]').map((c) => c.getAttribute('aria-label')).slice(0, 2), ['Monday', 'Tuesday']);
  const d = m.days('rgFrom');
  assert.equal(d.length, 30);
  assert.deepEqual(d.map((c) => c.textContent), Array.from({ length: 30 }, (_, i) => String(i + 1)));
  assert.equal(d[0].id, 'rgFrom_d2026-11-01');
  assert.equal(d[19].getAttribute('aria-label'), 'Friday, 20 November 2026', 'a day is named in full');
  assert.deepEqual(d.filter((c) => c.getAttribute('aria-selected') === 'true').map((c) => c.dataset.date), ['2026-11-20'], 'the chosen day');
  assert.deepEqual(d.filter((c) => c.getAttribute('aria-current')).map((c) => [c.dataset.date, c.getAttribute('aria-current')]), [['2026-11-14', 'date']], 'today');
  assert.ok(d.every((c) => c.getAttribute('role') === 'gridcell' && c.getAttribute('tabindex') === '-1' && c.getAttribute('type') === 'button'));
  assert.equal(m.at('rgFrom').length, 0, 'the keyboard is on no day while it is closed');
});

test('calendar: the month shown is the chosen date\'s; a value that is no date shows today; texts are escaped', () => {
  const m = mount([cal('a', '2027-02-03'), cal('b', 'soon'), cal('c', '2026-11-20', { label: '"><i>x</i>', data: { range: '"><b>' } })]);
  assert.equal(m.title('a'), 'February 2027');
  assert.equal(m.byId('b').value, TODAY);
  assert.equal(m.title('b'), 'November 2026');
  const c = m.byId('c');
  assert.equal(c.getAttribute('aria-label'), '"><i>x</i>: 20 Nov 2026', 'the attribute holds the text');
  assert.equal(c.dataset.range, '"><b>');
  assert.equal(m.root.querySelectorAll('i').length + m.root.querySelectorAll('b').filter((n) => !n.classList.contains('cal-title')).length, 0, 'no markup came from a value');
});

test('calendar: weeks start on Monday: 1 November 2026 (a Sunday) is the last column of the first row, 1 June 2026 (a Monday) the first', () => {
  const m = mount([cal('nov', '2026-11-20'), cal('jun', '2026-06-10')]);
  const firstRow = (id) => m.byId(`${id}_cal`).querySelector('.cal-days').children[0].children;
  const column = (id) => firstRow(id).findIndex((c) => c.classList.contains('cal-day'));
  assert.equal(column('nov'), 6);
  assert.equal(column('jun'), 0);
  assert.equal(firstRow('nov').length, 7);
  assert.deepEqual(m.byId('nov_cal').querySelector('.cal-days').children.map((r) => r.children.length), [7, 7, 7, 7, 7, 7], 'six rows of seven: six blanks and 30 days, the last row filled up');
  assert.equal(m.byId('jun_cal').querySelector('.cal-days').children.length, 5);
});

test('calendar: a click opens the panel on the chosen day; a second click, or a click elsewhere, closes it; one panel at a time', () => {
  const m = mount([cal('one', '2026-11-20'), cal('two', '2026-05-05')]);
  m.fire('click', m.byId('one'));
  assert.equal(m.isOpen('one'), true);
  assert.equal(m.at('one'), '2026-11-20');
  assert.equal(m.byId('one').getAttribute('aria-activedescendant'), 'one_d2026-11-20');
  assert.equal(m.env.active, m.byId('one'), 'the focus stays on the trigger');
  m.fire('click', m.byId('two'));
  assert.deepEqual([m.isOpen('one'), m.isOpen('two')], [false, true]);
  m.fire('click', m.byId('two'));
  assert.equal(m.isOpen('two'), false, 'the trigger closes it');
  assert.equal(m.byId('two').getAttribute('aria-activedescendant'), null);
  m.fire('click', m.byId('one'));
  m.fire('click', m.root);
  assert.equal(m.isOpen('one'), false, 'a click outside');
  m.fire('click', m.byId('one'));
  m.fire('click', m.byId('one_cal'));
  m.fire('click', m.byId('one_title'));
  assert.equal(m.isOpen('one'), true, 'a click on the panel but not on a day keeps it open');
  assert.deepEqual(m.changes, []);
});

test('calendar: the month buttons show the next and the previous month, keep the panel open and the focus on the trigger', () => {
  const m = mount([cal('x', '2026-12-31')]);
  m.fire('click', m.byId('x'));
  const nav = (step) => m.byId('x_cal').querySelectorAll('.cal-nav').find((n) => n.dataset.step === String(step));
  m.env.active = null;
  m.fire('click', nav(1));
  assert.deepEqual([m.title('x'), m.days('x').length, m.isOpen('x')], ['January 2027', 31, true]);
  assert.equal(m.env.active, m.byId('x'), 'the focus is back on the trigger');
  assert.equal(m.at('x'), '2027-01-31', 'the keyboard keeps its day in the new month');
  m.fire('click', nav(1));
  assert.deepEqual([m.title('x'), m.days('x').length], ['February 2027', 28]);
  assert.equal(m.at('x'), '2027-02-28', 'the day is cut to the month\'s length');
  m.fire('click', nav(-1)); m.fire('click', nav(-1));
  assert.deepEqual([m.title('x'), m.isOpen('x')], ['December 2026', true]);
  assert.deepEqual(m.days('x').filter((c) => c.getAttribute('aria-selected') === 'true').map((c) => c.dataset.date), ['2026-12-31'], 'the chosen day is marked when its month is back');
  assert.deepEqual(m.changes, [], 'a month button chooses nothing');
});

test('calendar: a click on a day sets the value, closes the panel and fires one bubbling change on the trigger; the same day fires none', () => {
  const m = mount([cal('rgFrom', '2026-11-20')]);
  const day = (date) => m.byId(`rgFrom_d${date}`);
  m.fire('click', m.byId('rgFrom'));
  m.fire('click', day('2026-11-03'));
  assert.deepEqual(m.changes, [['rgFrom', '2026-11-03']], 'the view reads the trigger\'s id and value');
  assert.equal(m.isOpen('rgFrom'), false);
  assert.equal(m.env.active, m.byId('rgFrom'));
  m.fire('click', m.byId('rgFrom'));
  m.fire('click', day('2026-11-03'));
  assert.equal(m.changes.length, 1, 'the same day again is no change');
  assert.equal(m.isOpen('rgFrom'), false, 'but it closes');
  m.fire('click', m.byId('rgFrom'));
  m.fire('click', m.byId('rgFrom_cal').querySelectorAll('.cal-nav')[1]);
  m.fire('click', day('2026-12-05'));
  assert.deepEqual(m.changes[1], ['rgFrom', '2026-12-05'], 'a day of another month');
  assert.deepEqual(m.bubbled, [true, true], 'the event bubbles, so a listener on the header hears it');
});

test('calendar: Enter, Space or ArrowDown on the closed trigger open the panel on the chosen day; other keys are left alone', () => {
  for (const k of ['Enter', ' ', 'ArrowDown']) {
    const m = mount([cal('x', '2026-11-20')]);
    const e = m.key('x', k);
    assert.equal(m.isOpen('x'), true, k);
    assert.equal(m.at('x'), '2026-11-20', k);
    assert.equal(e.defaultPrevented, true, `${k}: no native click on top of it`);
    assert.equal(m.env.active, m.byId('x'));
  }
  const m = mount([cal('x', '2026-11-20')]);
  for (const k of ['a', 'ArrowUp', 'ArrowLeft', 'Escape', 'Tab']) assert.equal(m.key('x', k).defaultPrevented, false, k);
  assert.equal(m.isOpen('x'), false);
});

test('calendar: the arrow keys move the day by one or by a week; the day follows into the next and the previous month and year', () => {
  const m = mount([cal('x', '2026-11-14')]);
  m.key('x', 'Enter');
  m.key('x', 'ArrowRight');
  assert.equal(m.at('x'), '2026-11-15');
  assert.equal(m.byId('x').getAttribute('aria-activedescendant'), 'x_d2026-11-15');
  m.key('x', 'ArrowLeft'); m.key('x', 'ArrowLeft');
  assert.equal(m.at('x'), '2026-11-13');
  m.key('x', 'ArrowDown');
  assert.equal(m.at('x'), '2026-11-20', 'a week down');
  m.key('x', 'ArrowUp'); m.key('x', 'ArrowUp');
  assert.equal(m.at('x'), '2026-11-06', 'two weeks up');
  assert.equal(m.days('x').filter((c) => c.classList.contains('at')).length, 1, 'one day at a time');
  assert.equal(m.env.active, m.byId('x'), 'the focus never leaves the trigger');
  const e = m.key('x', 'ArrowRight');
  assert.equal(e.defaultPrevented, true, 'the page does not scroll');

  const y = mount([cal('y', '2026-12-31')]);
  y.key('y', 'Enter');
  y.key('y', 'ArrowRight');
  assert.deepEqual([y.at('y'), y.title('y'), y.days('y').length], ['2027-01-01', 'January 2027', 31], '31 December to 1 January');
  assert.equal(y.byId('y').getAttribute('aria-activedescendant'), 'y_d2027-01-01');
  y.key('y', 'ArrowLeft');
  assert.deepEqual([y.at('y'), y.title('y')], ['2026-12-31', 'December 2026']);
  y.key('y', 'ArrowDown');
  assert.deepEqual([y.at('y'), y.title('y')], ['2027-01-07', 'January 2027'], 'a week down over the year\'s end');
  y.key('y', 'ArrowUp'); y.key('y', 'ArrowUp');
  assert.deepEqual([y.at('y'), y.title('y')], ['2026-12-24', 'December 2026'], 'and back up');
  assert.deepEqual(y.changes, [], 'moving chooses nothing');
});

test('calendar: PageUp and PageDown move a month, to the same day or the last day of a shorter month; the leap day 29 February 2028 exists', () => {
  const m = mount([cal('x', '2028-01-31')]);
  m.key('x', 'Enter');
  m.key('x', 'PageDown');
  assert.deepEqual([m.at('x'), m.title('x'), m.days('x').length], ['2028-02-29', 'February 2028', 29], 'the leap year\'s February has 29 days');
  m.key('x', 'ArrowRight');
  assert.deepEqual([m.at('x'), m.title('x')], ['2028-03-01', 'March 2028'], 'the leap day is followed by 1 March');
  m.key('x', 'ArrowLeft');
  assert.equal(m.at('x'), '2028-02-29');
  m.key('x', 'PageUp');
  assert.deepEqual([m.at('x'), m.title('x')], ['2028-01-29', 'January 2028']);
  m.key('x', 'PageUp'); m.key('x', 'PageUp');
  assert.deepEqual([m.at('x'), m.title('x')], ['2027-11-29', 'November 2027'], 'over the year\'s start');
  m.key('x', 'PageDown'); m.key('x', 'PageDown');
  assert.equal(m.at('x'), '2028-01-29');

  const plain = mount([cal('p', '2027-02-28')]);
  plain.key('p', 'Enter');
  assert.equal(plain.days('p').length, 28);
  plain.key('p', 'ArrowRight');
  assert.equal(plain.at('p'), '2027-03-01', 'no leap day in 2027');
  const leap = mount([cal('l', '2028-02-29')]);
  assert.equal(leap.title('l'), 'February 2028');
  assert.deepEqual(leap.days('l').filter((c) => c.getAttribute('aria-selected') === 'true').map((c) => c.dataset.date), ['2028-02-29']);
  leap.key('l', 'Enter');
  assert.equal(leap.at('l'), '2028-02-29');
});

test('calendar: Home and End go to the Monday and the Sunday of the week', () => {
  const m = mount([cal('x', '2026-11-18')]); // a Wednesday
  m.key('x', 'Enter');
  m.key('x', 'Home');
  assert.equal(m.at('x'), '2026-11-16');
  m.key('x', 'Home');
  assert.equal(m.at('x'), '2026-11-16', 'a Monday stays');
  m.key('x', 'End');
  assert.equal(m.at('x'), '2026-11-22');
  m.key('x', 'End');
  assert.equal(m.at('x'), '2026-11-22', 'a Sunday stays');
  m.key('x', 'Home');
  m.key('x', 'ArrowLeft'); // the Sunday before
  m.key('x', 'Home');
  assert.equal(m.at('x'), '2026-11-09');
  const s = mount([cal('s', '2026-11-01')]); // a Sunday: its week began in October
  s.key('s', 'Enter');
  s.key('s', 'Home');
  assert.deepEqual([s.at('s'), s.title('s')], ['2026-10-26', 'October 2026'], 'the week of 1 November starts in October');
  s.key('s', 'End');
  assert.deepEqual([s.at('s'), s.title('s')], ['2026-11-01', 'November 2026']);
});

test('calendar: Enter or Space choose the day the keyboard is on; Escape closes without a choice, the focus on the trigger; Tab closes and lets the focus go on', () => {
  const m = mount([cal('x', '2026-11-14')]);
  m.key('x', 'Enter');
  m.press('x', ['ArrowRight', 'ArrowRight']);
  const enter = m.key('x', 'Enter');
  assert.equal(enter.defaultPrevented, true);
  assert.deepEqual(m.changes, [['x', '2026-11-16']]);
  assert.equal(m.isOpen('x'), false);
  assert.equal(m.env.active, m.byId('x'));
  m.key('x', 'ArrowDown');
  m.press('x', ['ArrowDown', 'PageDown']);
  m.key('x', ' ');
  assert.deepEqual(m.changes[1], ['x', '2026-12-23']);

  const n = mount([cal('x', '2026-11-14')]);
  n.key('x', 'ArrowDown');
  n.key('x', 'PageDown');
  const escape = n.key('x', 'Escape');
  assert.equal(escape.defaultPrevented, true);
  assert.equal(n.isOpen('x'), false);
  assert.deepEqual(n.changes, []);
  assert.equal(n.env.active, n.byId('x'));
  assert.equal(n.byId('x').getAttribute('aria-activedescendant'), null);
  n.key('x', 'ArrowDown');
  assert.equal(n.at('x'), '2026-11-14', 'it opens on the chosen day again, not where the keyboard was');
  const tab = n.key('x', 'Tab');
  assert.equal(tab.defaultPrevented, false, 'Tab still moves on');
  assert.equal(n.isOpen('x'), false);
  assert.deepEqual(n.changes, []);
});

test('calendar: Space is not left to the browser on the key release, so it cannot click the trigger again', () => {
  const m = mount([cal('x', '2026-11-14')]);
  m.key('x', ' ');
  assert.equal(m.fire('keyup', m.byId('x'), { key: ' ' }).defaultPrevented, true);
  assert.equal(m.fire('keyup', m.byId('x'), { key: 'a' }).defaultPrevented, false);
});

test('calendar: the panel is placed by the function it is given, once shown, and again when the month changes', () => {
  const m = mount([cal('x', '2026-11-14')], { place: 'spy' });
  assert.equal(m.placed.length, 0);
  m.fire('click', m.byId('x'));
  assert.equal(m.placed.length, 1);
  assert.deepEqual([m.placed[0][0] === m.byId('x').parentNode, m.placed[0][1] === m.byId('x_cal'), m.placed[0][2]], [true, true, false], 'the wrap and the panel, already shown');
  m.key('x', 'PageDown');
  assert.equal(m.placed.length, 2);
});

test('calendar: with the menu\'s own placement the panel opens under the trigger, from its right edge when it would leave the window', () => {
  const rect = (left, top, w, h) => ({ left, top, right: left + w, bottom: top + h, width: w, height: h });
  const place = (width, wrap, box) => {
    const m = mount([cal('x', '2026-11-14')], { width });
    m.byId('x').parentNode.rect = wrap;
    m.byId('x_cal').rect = box;
    m.fire('click', m.byId('x'));
    const panel = m.byId('x_cal');
    return { end: panel.classList.contains('end'), up: panel.classList.contains('up'), left: panel.style.left };
  };
  assert.deepEqual(place(1000, rect(100, 20, 140, 36), rect(100, 62, 266, 300)), { end: false, up: false, left: '' });
  assert.equal(place(375, rect(215, 20, 140, 36), rect(215, 62, 266, 300)).end, true, 'a trigger at the right edge of a phone');
  assert.deepEqual(place(375, rect(20, 20, 140, 36), rect(20, 62, 266, 300)), { end: false, up: false, left: '' }, 'at the left edge it fits');
});

test('calendar: the names of the months and weekdays follow the page language, read at each drawing', () => {
  const m = mount([cal('x', '2026-11-20')], { lang: 'uk' });
  assert.match(m.title('x'), /^листопад 2026/);
  assert.equal(m.byId('x_cal').querySelectorAll('[role="columnheader"]')[0].textContent.toLowerCase(), 'пн');
  assert.match(m.byId('x').textContent, /^20 .* 2026/);
  assert.deepEqual(m.byId('x_cal').querySelectorAll('.cal-nav').map((n) => n.getAttribute('aria-label')), ['Попередній місяць', 'Наступний місяць']);
  m.setLang('en');
  assert.equal(mount([cal('y', '2026-11-20')]).title('y'), 'November 2026');
  assert.equal(m.html(cal('z', '2026-11-20')).includes('20 Nov 2026'), true, 'the next drawing has the new language');
});

test('calendar: the new texts are in both languages', () => {
  for (const key of ['range.prev_month', 'range.next_month']) {
    assert.notEqual(I18N.t('en', key), key, `${key} in English`);
    assert.notEqual(I18N.t('uk', key), I18N.t('en', key), `${key} in Ukrainian`);
  }
});

// A local-time Date moves a day near midnight; the calendar works with UTC days in any time zone.
const CHILD = `
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const dir = process.argv[1];
const read = (n) => fs.readFileSync(path.join(dir, n), 'utf8');
const esc = (s) => String(s);
const UtcOnly = vm.runInNewContext(${JSON.stringify(UTC_ONLY)});
const window = {};
vm.runInNewContext(read('format.js'), { window });
const F = window.KeelFormat(null, (k) => k, () => 'en');
vm.runInNewContext(read('calendar.js'), { window, document: { addEventListener() {} }, Event, Intl, Date: UtcOnly });
const K = window.KeelCalendar({ esc, t: (k) => k, root: { addEventListener() {} }, place() {}, locale: F.loc, today: () => '2026-03-08', addDays: F.addDays });
const out = { offset: new Date(2026, 2, 8).getTimezoneOffset() };
for (const v of ['2026-03-08', '2026-03-01', '2026-10-25', '2026-01-01']) {
  const h = K.html({ id: 'x', label: 'L', value: v, data: {} });
  out[v] = { face: /<span>([^<]*)<\\/span><\\/button>/.exec(h)[1], chosen: /id="x_d([\\d-]+)"[^>]*aria-selected="true"/.exec(h)[1], days: (h.match(/class="cal-day[ "]/g) || []).length, today: (/id="x_d([\\d-]+)"[^>]*aria-current/.exec(h) || [])[1] || null };
}
process.stdout.write(JSON.stringify(out));
`;
for (const tz of ['America/Los_Angeles', 'Pacific/Kiritimati', 'UTC']) {
  test(`calendar: the days are UTC days in any time zone (${tz})`, () => {
    const r = spawnSync(process.execPath, ['-e', CHILD, dir], { env: { ...process.env, TZ: tz }, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.deepEqual(out['2026-03-08'], { face: '8 Mar 2026', chosen: '2026-03-08', days: 31, today: '2026-03-08' });
    assert.deepEqual(out['2026-03-01'], { face: '1 Mar 2026', chosen: '2026-03-01', days: 31, today: '2026-03-08' });
    assert.deepEqual(out['2026-10-25'], { face: '25 Oct 2026', chosen: '2026-10-25', days: 31, today: null });
    assert.deepEqual(out['2026-01-01'], { face: '1 Jan 2026', chosen: '2026-01-01', days: 31, today: null });
    if (tz !== 'UTC' && process.platform !== 'win32') assert.notEqual(out.offset, 0, 'the child really runs in that zone');
  });
}
