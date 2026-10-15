'use strict';
// Acceptance checks for TSK-230, run from the sandbox root after a session finished the task. The
// session never sees this file. One test per requirement point; only the HTTP contract is used.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { open } = require(path.resolve('src/db.js'));
const { createServer } = require(path.resolve('src/server.js'));

async function setup(status = 'todo') {
  const db = open(':memory:');
  db.prepare("INSERT INTO users (id, name, email) VALUES (1, 'Ada', 'ada@example.com')").run();
  db.prepare("INSERT INTO projects (id, name, owner_id) VALUES (1, 'Website', 1)").run();
  const id = Number(db.prepare("INSERT INTO tasks (project_id, title, status, priority, created_at) VALUES (1, 'T', ?, 2, '2026-10-01T00:00:00.000Z')").run(status).lastInsertRowid);
  const server = createServer(db);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, p, body) => {
    const res = await fetch(base + p, { method, headers: { 'content-type': 'application/json', 'x-user-id': '1' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    return { status: res.status, body: json };
  };
  return { id, call, close: () => new Promise((r) => server.close(r)) };
}

const move = (from, to, expected) => async (t) => {
  const s = await setup(from);
  t.after(s.close);
  const r = await s.call('PUT', `/tasks/${s.id}/status`, { status: to });
  assert.equal(r.status, expected);
  if (expected === 200) assert.equal(r.body.status, to);
};

test('A1 todo -> doing is 200 with the task', move('todo', 'doing', 200));
test('A2 doing -> done is 200', move('doing', 'done', 200));
test('A3 doing -> todo is 200', move('doing', 'todo', 200));
test('A4 done -> doing (reopen) is 200', move('done', 'doing', 200));
test('A5 todo -> done is 409', move('todo', 'done', 409));
test('A6 done -> todo is 409', move('done', 'todo', 409));
test('A7 the same status is 409', move('todo', 'todo', 409));

test('A8 the 409 message names the allowed statuses', async (t) => {
  const s = await setup('doing');
  t.after(s.close);
  const r = await s.call('PUT', `/tasks/${s.id}/status`, { status: 'doing' });
  assert.equal(r.status, 409);
  const text = JSON.stringify(r.body);
  assert.match(text, /todo/);
  assert.match(text, /done/);
});

test('A9 an unknown status is 400', move('todo', 'later', 400));

test('A10 a missing status is 400', async (t) => {
  const s = await setup();
  t.after(s.close);
  assert.equal((await s.call('PUT', `/tasks/${s.id}/status`, {})).status, 400);
});

test('A11 a missing task is 404', async (t) => {
  const s = await setup();
  t.after(s.close);
  assert.equal((await s.call('PUT', '/tasks/999/status', { status: 'doing' })).status, 404);
});

test('A12 the change is stored', async (t) => {
  const s = await setup();
  t.after(s.close);
  await s.call('PUT', `/tasks/${s.id}/status`, { status: 'doing' });
  assert.equal((await s.call('GET', `/tasks/${s.id}`)).body.status, 'doing');
});

test('A13 PATCH still refuses status', async (t) => {
  const s = await setup();
  t.after(s.close);
  assert.equal((await s.call('PATCH', `/tasks/${s.id}`, { status: 'doing' })).status, 400);
});
