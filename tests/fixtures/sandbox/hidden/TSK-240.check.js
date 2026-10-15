'use strict';
// Acceptance checks for TSK-240, run from the sandbox root after a session finished the task. The
// session never sees this file. One test per requirement point; only the HTTP contract and the
// database's own catalog are used.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { open } = require(path.resolve('src/db.js'));
const { createServer } = require(path.resolve('src/server.js'));

async function setup() {
  const db = open(':memory:');
  db.prepare("INSERT INTO users (id, name, email) VALUES (1, 'Ada', 'ada@example.com'), (2, 'Linus', 'linus@example.com')").run();
  db.prepare("INSERT INTO projects (id, name, owner_id) VALUES (1, 'Website', 1)").run();
  const task = Number(db.prepare("INSERT INTO tasks (project_id, title, status, priority, created_at) VALUES (1, 'T', 'todo', 2, '2026-10-01T00:00:00.000Z')").run().lastInsertRowid);
  const server = createServer(db);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, p, body, user = 1) => {
    const res = await fetch(base + p, { method, headers: { 'content-type': 'application/json', 'x-user-id': String(user) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    return { status: res.status, body: json };
  };
  const add = async (n) => {
    const ids = [];
    for (let i = 1; i <= n; i++) ids.push((await call('POST', `/tasks/${task}/comments`, { body: `comment ${i}` })).body.id);
    return ids;
  };
  return { db, task, call, add, close: () => new Promise((r) => server.close(r)) };
}

test('B1 POST creates a comment by the x-user-id user, trimmed, with the agreed shape', async (t) => {
  const s = await setup();
  t.after(s.close);
  const r = await s.call('POST', `/tasks/${s.task}/comments`, { body: '  Looks good  ' }, 2);
  assert.equal(r.status, 201);
  assert.equal(r.body.task_id, s.task);
  assert.equal(r.body.author_id, 2);
  assert.equal(r.body.body, 'Looks good');
  assert.ok(Number.isInteger(r.body.id));
  assert.ok(!Number.isNaN(Date.parse(r.body.created_at)));
});

test('B2 POST rejects empty and too long text, accepts 2000 characters', async (t) => {
  const s = await setup();
  t.after(s.close);
  assert.equal((await s.call('POST', `/tasks/${s.task}/comments`, { body: '   ' })).status, 400);
  assert.equal((await s.call('POST', `/tasks/${s.task}/comments`, {})).status, 400);
  assert.equal((await s.call('POST', `/tasks/${s.task}/comments`, { body: 'x'.repeat(2001) })).status, 400);
  assert.equal((await s.call('POST', `/tasks/${s.task}/comments`, { body: 'x'.repeat(2000) })).status, 201);
});

test('B3 POST on a missing task is 404', async (t) => {
  const s = await setup();
  t.after(s.close);
  assert.equal((await s.call('POST', '/tasks/999/comments', { body: 'hi' })).status, 404);
});

test('B4 GET lists oldest first with defaults and the total', async (t) => {
  const s = await setup();
  t.after(s.close);
  await s.add(3);
  const r = await s.call('GET', `/tasks/${s.task}/comments`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.items.map((c) => c.body), ['comment 1', 'comment 2', 'comment 3']);
  assert.deepEqual([r.body.page, r.body.per_page, r.body.total], [1, 20, 3]);
});

test('B5 GET pages', async (t) => {
  const s = await setup();
  t.after(s.close);
  await s.add(5);
  const r = await s.call('GET', `/tasks/${s.task}/comments?page=2&per_page=2`);
  assert.deepEqual(r.body.items.map((c) => c.body), ['comment 3', 'comment 4']);
  assert.deepEqual([r.body.page, r.body.per_page, r.body.total], [2, 2, 5]);
});

test('B6 GET rejects bad paging', async (t) => {
  const s = await setup();
  t.after(s.close);
  for (const q of ['per_page=0', 'per_page=101', 'page=0', 'page=abc']) {
    assert.equal((await s.call('GET', `/tasks/${s.task}/comments?${q}`)).status, 400, q);
  }
});

test('B7 GET on a missing task is 404', async (t) => {
  const s = await setup();
  t.after(s.close);
  assert.equal((await s.call('GET', '/tasks/999/comments')).status, 404);
});

test('B8 the author deletes a comment', async (t) => {
  const s = await setup();
  t.after(s.close);
  const [id] = await s.add(1);
  assert.equal((await s.call('DELETE', `/comments/${id}`)).status, 204);
  assert.equal((await s.call('GET', `/tasks/${s.task}/comments`)).body.total, 0);
});

test('B9 someone else cannot delete it', async (t) => {
  const s = await setup();
  t.after(s.close);
  const [id] = await s.add(1);
  assert.equal((await s.call('DELETE', `/comments/${id}`, undefined, 2)).status, 403);
  assert.equal((await s.call('GET', `/tasks/${s.task}/comments`)).body.total, 1);
});

test('B10 deleting a missing comment is 404', async (t) => {
  const s = await setup();
  t.after(s.close);
  assert.equal((await s.call('DELETE', '/comments/999')).status, 404);
});

test('B11 GET /tasks/:id has comments_count', async (t) => {
  const s = await setup();
  t.after(s.close);
  await s.add(2);
  assert.equal((await s.call('GET', `/tasks/${s.task}`)).body.comments_count, 2);
});

test('B12 an index serves listing by task', async (t) => {
  const s = await setup();
  t.after(s.close);
  const tables = s.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
  const table = tables.find((name) => {
    const cols = s.db.prepare(`PRAGMA table_info("${name}")`).all().map((c) => c.name);
    return name !== 'tasks' && cols.includes('task_id') && cols.includes('body');
  });
  assert.ok(table, 'a comments table');
  const leading = s.db.prepare(`PRAGMA index_list("${table}")`).all()
    .map((ix) => s.db.prepare(`PRAGMA index_info("${ix.name}")`).all().sort((a, b) => a.seqno - b.seqno)[0]?.name);
  assert.ok(leading.includes('task_id'), `an index starting with task_id on ${table}`);
});
