'use strict';
// The shop with a PostgreSQL database and a partner API, for the risky-change cases: users (about 2,000
// rows) and orders tables, forward-only SQL migrations, GET /api/orders read by partners with API keys,
// and no maintenance mode anywhere.
const fs = require('node:fs');
const path = require('node:path');
const { KEEL, root, write, commitAll } = require('./shop-base.js');

const RULE = '# mini-shop rules\n\n## Database\n- Schema changes ship in one release: write the migration and apply it with the deploy. No maintenance\n  mode, no multi-release steps.\n';

function db() {
  write('docker-compose.yml', 'services:\n  db:\n    image: postgres:16\n    environment:\n      POSTGRES_DB: shop\n      POSTGRES_PASSWORD: dev\n    ports: ["5432:5432"]\n');
  write('db/migrations/001_users.sql', 'CREATE TABLE users (\n  id serial PRIMARY KEY,\n  name text NOT NULL,\n  email text NOT NULL UNIQUE,\n  phone text,\n  created_at timestamptz NOT NULL DEFAULT now()\n);\n');
  write('db/migrations/002_orders.sql', 'CREATE TABLE orders (\n  id bigserial PRIMARY KEY,\n  user_id int NOT NULL REFERENCES users (id),\n  total integer NOT NULL,\n  status text NOT NULL,\n  created_at timestamptz NOT NULL DEFAULT now()\n);\nCREATE INDEX orders_user_id_idx ON orders (user_id);\n');
  write('scripts/migrate.js', "'use strict';\n// Applies the files of db/migrations that are not applied yet, in name order, each in its own psql run,\n// and records them in schema_migrations. Forward only: there are no down steps.\nconst { execFileSync } = require('node:child_process');\nconst fs = require('node:fs');\nconst url = process.env.DATABASE_URL;\nconst applied = new Set(execFileSync('psql', [url, '-tAc', 'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY); SELECT name FROM schema_migrations'], { encoding: 'utf8' }).split('\\n').filter(Boolean));\nfor (const f of fs.readdirSync('db/migrations').sort()) {\n  if (applied.has(f)) continue;\n  execFileSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-1', '-f', `db/migrations/${f}`], { stdio: 'inherit' });\n  execFileSync('psql', [url, '-c', `INSERT INTO schema_migrations VALUES ('${f}')`]);\n}\n");
  write('src/users.js', "'use strict';\nasync function findUser(db, id) {\n  const { rows } = await db.query('SELECT id, name, email, phone FROM users WHERE id = $1', [id]);\n  return rows[0];\n}\nfunction greeting(user) {\n  return `Dear ${user.name}`;\n}\nmodule.exports = { findUser, greeting };\n");
  write('src/api.js', "'use strict';\n// GET /api/orders for partners (the delivery service, the accounting firm): each calls it with the API key\n// issued to it on the admin page, sent in the X-Api-Key header.\nasync function listOrders(db, req) {\n  const key = req.headers['x-api-key'];\n  const { rows: k } = await db.query('SELECT partner FROM api_keys WHERE key = $1', [key]);\n  if (!k.length) return { status: 401, body: { error: 'bad key' } };\n  const { rows } = await db.query('SELECT id, total, status, created_at FROM orders ORDER BY id DESC LIMIT 100');\n  return { status: 200, body: rows.map((o) => ({ id: o.id, total: o.total, status: o.status, createdAt: o.created_at })) };\n}\nmodule.exports = { listOrders };\n");
  write('docs/api.md', '# Partner API\n\n`GET /api/orders` returns the last 100 orders as `[{ id, total, status, createdAt }]`, `total` in whole\nhryvnias. Partners (the delivery service, the accounting firm) call it from their own systems with the\nAPI key issued to them on the admin page, in the `X-Api-Key` header.\n');
  write('README.md', '# mini-shop\n\nA tiny shop: cart totals, payments and order reports. `npm test` runs the tests.\n\nData: PostgreSQL 16 (`docker-compose.yml`). About 2,000 customers in `users`. Migrations are plain SQL\nfiles in `db/migrations/`, applied in order by `node scripts/migrate.js` during the deploy.\n');
  commitAll('Database, migrations and the partner API');
}

// The project's rule settles the deploy style: one release, just apply the migration.
function dbRule() {
  db();
  write('CLAUDE.md', RULE);
  commitAll('Project rules');
}

// As db-rule, with orders large and busy all day.
function dbBig() {
  dbRule();
  write('README.md', '# mini-shop\n\nA tiny shop: cart totals, payments and order reports. `npm test` runs the tests.\n\nData: PostgreSQL 16 (`docker-compose.yml`). About 2,000 customers in `users`; `orders` has about 3.5\nmillion rows and gets a new one every few seconds all day. Migrations are plain SQL files in\n`db/migrations/`, applied in order by `node scripts/migrate.js` during the deploy.\n');
  commitAll('Data sizes in the README');
}

// As db-rule, with users.name renamed to full_name in one migration and the code moved to it, not committed.
// A non-interactive run cannot read outside its workspace, so keel's review rules are copied into
// .keel/local/tmp/keel (ignored by git) for the reviewing agent to read there.
function dbRenamed({ rule = true } = {}) {
  if (rule) dbRule();
  else db();
  for (const rel of ['protocols', 'skills/_shared/risky-changes.md']) {
    if (fs.existsSync(path.join(KEEL, rel))) fs.cpSync(path.join(KEEL, rel), path.join(root, '.keel', 'local', 'tmp', 'keel', rel), { recursive: true });
  }
  write('db/migrations/003_users_full_name.sql', 'ALTER TABLE users RENAME COLUMN name TO full_name;\n');
  write('src/users.js', "'use strict';\nasync function findUser(db, id) {\n  const { rows } = await db.query('SELECT id, full_name, email, phone FROM users WHERE id = $1', [id]);\n  return rows[0];\n}\nfunction greeting(user) {\n  return `Dear ${user.full_name}`;\n}\nmodule.exports = { findUser, greeting };\n");
}

module.exports = { db, dbRule, dbBig, dbRenamed };
