'use strict';
// A small fake DOM for the tests of the page scripts. parse() turns the markup a script wrote into nodes that have the
// parts of the DOM those scripts use, and routes events fired on a node to `dispatch(type, event)`, which the test
// connects to the listeners of the script's root element (and, for a click, of the document).

const VOID = new Set(['input', 'br', 'img', 'meta', 'link', 'hr']);
const ENTITIES = { '&quot;': '"', '&#39;': "'", '&nbsp;': ' ', '&lt;': '<', '&gt;': '>', '&amp;': '&' };
const decode = (s) => s.replace(/&(?:quot|#39|nbsp|lt|gt|amp);/g, (m) => ENTITIES[m]);
const ZERO = { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 };

// tag, then any number of .class / #id, then any number of [attr] / [attr="value"]
const SELECTOR = /^([a-z0-9]+)?((?:[.#][\w-]+)*)((?:\[[^\]]+\])*)$/;

class Node {
  constructor(tag, attrs, env) {
    Object.assign(this, { tag, attrs, env, children: [], parentNode: null, text: null, scrollTop: 0, offsetTop: 0, offsetHeight: 0, clientHeight: 0, style: {} });
  }
  get id() { return this.attrs.id || ''; }
  get value() { return this.attrs.value === undefined ? '' : this.attrs.value; }
  set value(v) { this.attrs.value = String(v); }
  get hidden() { return 'hidden' in this.attrs; }
  set hidden(on) { if (on) this.attrs.hidden = ''; else delete this.attrs.hidden; }
  get dataset() {
    const out = {};
    for (const [k, v] of Object.entries(this.attrs)) if (k.startsWith('data-')) out[k.slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = v;
    return out;
  }
  get textContent() { return this.text !== null ? this.text : this.children.map((c) => c.textContent).join(''); }
  set innerHTML(markup) { this.children = []; fill(this, markup); }
  get classList() {
    const names = () => (this.attrs.class || '').split(/\s+/).filter(Boolean);
    const write = (list) => { this.attrs.class = list.join(' '); };
    return {
      contains: (n) => names().includes(n),
      add: (...ns) => write([...new Set([...names(), ...ns])]),
      remove: (...ns) => write(names().filter((n) => !ns.includes(n))),
      toggle: (n, force) => { const on = force === undefined ? !names().includes(n) : force; write(on ? [...new Set([...names(), n])] : names().filter((x) => x !== n)); return on; },
    };
  }
  getAttribute(n) { return n in this.attrs ? this.attrs[n] : null; }
  setAttribute(n, v) { this.attrs[n] = String(v); }
  removeAttribute(n) { delete this.attrs[n]; }
  matches(selector) {
    const m = SELECTOR.exec(selector);
    if (!m || this.text !== null) return false;
    const [, tag, ids, attrs] = m;
    if (tag && tag !== this.tag) return false;
    for (const part of ids.match(/[.#][\w-]+/g) || []) {
      if (part[0] === '.' ? !this.classList.contains(part.slice(1)) : this.id !== part.slice(1)) return false;
    }
    for (const part of attrs.match(/\[[^\]]+\]/g) || []) {
      const [, name, value] = /^\[([\w-]+)(?:="(.*)")?\]$/.exec(part);
      if (!(name in this.attrs) || (value !== undefined && this.attrs[name] !== value)) return false;
    }
    return true;
  }
  closest(selector) {
    for (let n = this; n && n.tag; n = n.parentNode) if (n.matches(selector)) return n;
    return null;
  }
  querySelectorAll(selector) {
    const out = [];
    const walk = (n) => { for (const c of n.children) { if (c.matches(selector)) out.push(c); walk(c); } };
    walk(this);
    return out;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  contains(other) {
    for (let n = other; n; n = n.parentNode) if (n === this) return true;
    return false;
  }
  focus() { this.env.active = this; }
  getBoundingClientRect() { return this.rect || ZERO; }
  dispatchEvent(event) { this.env.dispatch(event.type, { ...event, target: this, preventDefault() {} }); return true; }
}

// Parses `markup` into the children of `parent`.
function fill(parent, markup) {
  const env = parent.env;
  let at = parent;
  for (const m of markup.matchAll(/<(\/?)([a-z0-9]+)((?:\s+[\w:-]+(?:="[^"]*")?)*)\s*\/?>|([^<]+)/gi)) {
    if (m[4] !== undefined) {
      const text = new Node('', {}, env);
      text.text = decode(m[4]); text.parentNode = at; at.children.push(text);
    } else if (m[1]) {
      at = at === parent ? parent : at.parentNode;
    } else {
      const attrs = {};
      for (const a of m[3].matchAll(/([\w:-]+)(?:="([^"]*)")?/g)) attrs[a[1]] = a[2] === undefined ? '' : decode(a[2]);
      const node = new Node(m[2].toLowerCase(), attrs, env);
      node.parentNode = at; at.children.push(node);
      if (!VOID.has(node.tag)) at = node;
    }
  }
}

// Returns { root, byId, fire, env }. fire(type, node, props) delivers a DOM event on `node` (key, ctrlKey, ...) and
// returns it, so a test can read `defaultPrevented`. Setting `innerHTML` on a node parses the markup into its children.
function parse(markup, dispatch) {
  const env = { dispatch, active: null };
  const root = new Node('#root', {}, env);
  const byId = (id) => { const n = root.querySelector(`#${id}`); if (!n) throw new Error(`no element #${id}`); return n; };
  fill(root, markup);
  const fire = (type, node, props = {}) => {
    const event = { type, target: node, preventDefault() { event.defaultPrevented = true; }, defaultPrevented: false, ...props };
    dispatch(type, event);
    return event;
  };
  return { root, byId, fire, env };
}

module.exports = { parse };
