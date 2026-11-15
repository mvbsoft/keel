'use strict';
// menu.js on its own, against the small fake DOM: the markup it makes, opening and closing by mouse and keyboard,
// the row the keyboard is on, what a choice tells the view, and where the open list goes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parse } = require('./fixtures/mini-dom.js');

const source = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'keel', 'templates', 'usage', 'menu.js'), 'utf8');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
class Event { constructor(type, init = {}) { this.type = type; Object.assign(this, init); } }

const OPTIONS = [{ value: '', label: 'all' }, { value: 'shop', label: 'shop' }, { value: 'tools', label: 'tools' }, { value: 'keel', label: 'keel' }, { value: '<i>x</i>', label: '<i>x</i>' }];
const menu = (id, value, extra = {}) => ({ id, label: 'Project', prefix: 'Project', value, options: OPTIONS, ...extra });

// Draws the menus and connects the markup to menu.js's listeners; `changes` collects what a view would hear.
function mount(menus, { width = 1000, height = 800 } = {}) {
  const listeners = [];
  const docListeners = [];
  const root = { addEventListener: (type, fn) => listeners.push([type, fn]) };
  const window = { innerHeight: height };
  const document = { documentElement: { clientWidth: width }, addEventListener: (type, fn) => docListeners.push([type, fn]) };
  vm.runInNewContext(source, { window, document, Event });
  const M = window.KeelMenu({ esc, root });
  const dom = parse(menus.map((m) => M.html(m)).join(''), (type, event) => {
    for (const [t, fn] of listeners) if (t === type) fn(event);
    if (type === 'click') for (const [t, fn] of docListeners) if (t === 'click') fn(event);
  });
  const changes = [];
  listeners.push(['change', (e) => changes.push([e.target.id, e.target.value])]);
  const { byId, fire } = dom;
  const rows = (id) => byId(`${id}_list`).querySelectorAll('.menu-item');
  const at = (id) => rows(id).findIndex((r) => r.classList.contains('at'));
  const isOpen = (id) => byId(id).getAttribute('aria-expanded') === 'true' && !byId(`${id}_list`).hidden;
  const key = (id, k, props) => fire('keydown', byId(id), { key: k, ...props });
  return { ...dom, changes, rows, at, isOpen, key, html: (m) => M.html(m) };
}

test('menu: a closed trigger shows the chosen label and a chevron; the list has a row with a check for every option, the chosen one marked', () => {
  const m = mount([menu('an_project', 'shop')]);
  const btn = m.byId('an_project');
  assert.equal(btn.textContent, 'Project: shop');
  assert.equal(btn.querySelectorAll('.ic').length, 1, 'the chevron');
  assert.deepEqual([btn.getAttribute('aria-haspopup'), btn.getAttribute('aria-expanded'), btn.getAttribute('aria-controls'), btn.getAttribute('aria-label'), btn.value],
    ['listbox', 'false', 'an_project_list', 'Project: shop', 'shop']);
  assert.ok(btn.classList.contains('chip') && btn.classList.contains('menu-btn'));
  const list = m.byId('an_project_list');
  assert.equal(list.getAttribute('role'), 'listbox');
  assert.equal(list.getAttribute('aria-label'), 'Project');
  assert.equal(list.hidden, true, 'closed');
  const rows = m.rows('an_project');
  assert.deepEqual(rows.map((r) => r.textContent), ['all', 'shop', 'tools', 'keel', '<i>x</i>'], 'the labels are text, not markup');
  assert.deepEqual(rows.map((r) => r.getAttribute('aria-selected')), ['false', 'true', 'false', 'false', 'false']);
  assert.ok(rows.every((r) => r.getAttribute('role') === 'option' && r.querySelectorAll('.ic').length === 1), 'every row has its check');
  assert.deepEqual(rows.map((r) => r.dataset.value), ['', 'shop', 'tools', 'keel', '<i>x</i>']);
});

test('menu: a value that is not in the list shows the first option; without a prefix the trigger is the label alone', () => {
  const m = mount([menu('a', 'gone'), menu('b', 'tools', { prefix: '', cls: 'inline' })]);
  assert.equal(m.byId('a').textContent, 'Project: all');
  assert.equal(m.byId('b').textContent, 'tools');
  assert.ok(m.byId('b').classList.contains('inline'));
});

test('menu: a click opens the list with the keyboard on the chosen row; a second click, or a click elsewhere, closes it', () => {
  const m = mount([menu('one', 'tools'), menu('two', 'shop')]);
  m.fire('click', m.byId('one'));
  assert.equal(m.isOpen('one'), true);
  assert.equal(m.at('one'), 2, 'on the chosen row');
  assert.equal(m.byId('one').getAttribute('aria-activedescendant'), 'one_o2');
  assert.equal(m.env.active, m.byId('one'), 'the focus is on the trigger');
  m.fire('click', m.byId('two'));
  assert.deepEqual([m.isOpen('one'), m.isOpen('two')], [false, true], 'one list at a time');
  m.fire('click', m.byId('two'));
  assert.equal(m.isOpen('two'), false, 'the trigger closes it');
  assert.equal(m.byId('two').getAttribute('aria-activedescendant'), null);
  m.fire('click', m.byId('one'));
  m.fire('click', m.root);
  assert.equal(m.isOpen('one'), false, 'a click outside the menu');
  m.fire('click', m.byId('one'));
  m.fire('click', m.byId('one_list'));
  assert.equal(m.isOpen('one'), true, 'a click on the list but not on a row keeps it open');
  assert.deepEqual(m.changes, []);
});

test('menu: a click on a row chooses it, closes the list and tells the view through a change event on the trigger', () => {
  const m = mount([menu('an_project', 'shop')]);
  m.fire('click', m.byId('an_project'));
  m.fire('click', m.rows('an_project')[3]);
  assert.deepEqual(m.changes, [['an_project', 'keel']], 'the view reads the trigger\'s id and value, as it read a select');
  assert.equal(m.isOpen('an_project'), false);
  assert.equal(m.env.active, m.byId('an_project'));
  m.fire('click', m.byId('an_project'));
  m.fire('click', m.rows('an_project')[0]);
  assert.deepEqual(m.changes[1], ['an_project', ''], 'the empty value is a choice too');
  m.fire('click', m.byId('an_project'));
  m.fire('click', m.rows('an_project')[0]);
  assert.equal(m.changes.length, 2, 'the same value again is no change');
});

test('menu: ArrowDown, ArrowUp, Enter or Space on the trigger open the list on the chosen row', () => {
  for (const k of ['ArrowDown', 'ArrowUp', 'Enter', ' ']) {
    const m = mount([menu('x', 'tools')]);
    const e = m.key('x', k);
    assert.equal(m.isOpen('x'), true, k);
    assert.equal(m.at('x'), 2, k);
    assert.equal(e.defaultPrevented, true, `${k}: no native click on top of it`);
  }
  const m = mount([menu('x', '')]);
  assert.equal(m.key('x', 'a').defaultPrevented, false, 'a letter on a closed trigger is left alone');
  assert.equal(m.isOpen('x'), false);
});

test('menu: the arrow keys, Home and End move the row, Enter chooses it, Space does too', () => {
  const m = mount([menu('x', 'shop')]);
  m.key('x', 'ArrowDown');
  assert.equal(m.at('x'), 1);
  m.key('x', 'ArrowDown'); m.key('x', 'ArrowDown');
  assert.equal(m.at('x'), 3);
  assert.equal(m.byId('x').getAttribute('aria-activedescendant'), 'x_o3');
  m.key('x', 'ArrowUp');
  assert.equal(m.at('x'), 2);
  m.key('x', 'End');
  assert.equal(m.at('x'), 4);
  m.key('x', 'ArrowDown');
  assert.equal(m.at('x'), 4, 'stops at the end');
  m.key('x', 'Home');
  assert.equal(m.at('x'), 0);
  m.key('x', 'ArrowUp');
  assert.equal(m.at('x'), 0, 'stops at the start');
  assert.equal(m.rows('x').filter((r) => r.classList.contains('at')).length, 1, 'one row at a time');
  m.key('x', 'ArrowDown'); m.key('x', 'ArrowDown');
  m.key('x', 'Enter');
  assert.deepEqual(m.changes, [['x', 'tools']]);
  assert.equal(m.isOpen('x'), false);
  m.key('x', 'ArrowDown');
  m.key('x', 'End');
  m.key('x', ' ');
  assert.deepEqual(m.changes[1], ['x', '<i>x</i>']);
});

test('menu: Escape closes without a choice and keeps the focus on the trigger; Tab closes and lets the focus go on', () => {
  const m = mount([menu('x', 'shop')]);
  m.key('x', 'ArrowDown');
  m.key('x', 'ArrowDown');
  const escape = m.key('x', 'Escape');
  assert.equal(escape.defaultPrevented, true);
  assert.equal(m.isOpen('x'), false);
  assert.deepEqual(m.changes, []);
  assert.equal(m.env.active, m.byId('x'));
  m.key('x', 'ArrowDown');
  const tab = m.key('x', 'Tab');
  assert.equal(tab.defaultPrevented, false, 'Tab still moves on');
  assert.equal(m.isOpen('x'), false);
  assert.deepEqual(m.changes, []);
});

test('menu: typing a letter moves to the next row starting with it, round the list; modified keys do not', () => {
  const m = mount([menu('x', '')]);
  m.key('x', 'ArrowDown');
  m.key('x', 't');
  assert.equal(m.at('x'), 2, 'tools');
  m.key('x', 'k');
  assert.equal(m.at('x'), 3, 'keel');
  m.key('x', 'A');
  assert.equal(m.at('x'), 0, 'round the end, any case');
  m.key('x', 's');
  m.key('x', 's');
  assert.equal(m.at('x'), 1, 'shop is the only one: it stays');
  m.key('x', 'z');
  assert.equal(m.at('x'), 1, 'no row starts with it');
  m.key('x', 't', { ctrlKey: true });
  assert.equal(m.at('x'), 1, 'Ctrl+T is not a letter');
});

test('menu: Space is not left to the browser on the key release, so it cannot click the trigger again', () => {
  const m = mount([menu('x', '')]);
  m.key('x', ' ');
  assert.equal(m.fire('keyup', m.byId('x'), { key: ' ' }).defaultPrevented, true);
  assert.equal(m.fire('keyup', m.byId('x'), { key: 'a' }).defaultPrevented, false);
});

test('menu: the list opens from the left edge, from the right edge when it would leave the window, upwards when there is no room below', () => {
  const place = (width, height, wrap, box) => {
    const m = mount([menu('x', '')], { width, height });
    m.byId('x').parentNode.rect = wrap;
    m.byId('x_list').rect = box;
    m.fire('click', m.byId('x'));
    const list = m.byId('x_list');
    return { end: list.classList.contains('end'), up: list.classList.contains('up'), left: list.style.left };
  };
  const rect = (left, top, w, h) => ({ left, top, right: left + w, bottom: top + h, width: w, height: h });
  assert.deepEqual(place(1000, 800, rect(100, 100, 80, 36), rect(100, 142, 200, 300)), { end: false, up: false, left: '' }, 'fits');
  assert.equal(place(400, 800, rect(250, 100, 100, 36), rect(250, 142, 200, 300)).end, true, 'would pass the right edge: from the right edge');
  assert.deepEqual(place(375, 800, rect(100, 100, 100, 36), rect(100, 142, 300, 300)), { end: false, up: false, left: '-33px' }, 'fits neither edge: against the right edge of the window (375 - 8 - 300 = 67 from the left, the button is at 100)');
  assert.equal(place(1000, 400, rect(100, 300, 80, 36), rect(100, 342, 200, 300)).up, true, 'no room below, more above');
  assert.equal(place(1000, 400, rect(100, 50, 80, 36), rect(100, 92, 200, 400)).up, false, 'no room below, and less above: stays below');
});

test('menu: the list scrolls so that the row the keyboard is on is in view', () => {
  const m = mount([menu('x', '')]);
  const list = m.byId('x_list');
  m.rows('x').forEach((r, i) => { r.offsetTop = 6 + i * 38; r.offsetHeight = 36; });
  list.clientHeight = 120;
  m.key('x', 'ArrowDown');
  assert.equal(list.scrollTop, 0);
  m.key('x', 'End');
  assert.equal(list.scrollTop, 6 + 4 * 38 + 36 + 6 - 120, 'the last row at the bottom, the list\'s padding under it');
  m.key('x', 'Home');
  assert.equal(list.scrollTop, 0, 'the first row at the top, the list\'s padding above it');
});
