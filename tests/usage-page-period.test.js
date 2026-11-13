'use strict';
// The page's days are UTC days: its default period must contain the last UTC day with data in any time zone.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const dir = path.join(__dirname, '..', 'plugins', 'keel', 'templates', 'usage');

const CHILD = `
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const dir = process.argv[1];
const P = require(path.join(dir, 'pivot.js'));
const FIXED = Date.parse(process.argv[2]);
class FakeDate extends Date {
  constructor(...a) { if (a.length) super(...a); else super(FIXED); }
  static now() { return FIXED; }
}
const window = {};
vm.runInNewContext(fs.readFileSync(path.join(dir, 'format.js'), 'utf8'), { window, Date: FakeDate });
const F = window.KeelFormat(P, (k) => k, () => 'en');
const to = F.today();
const from = F.addDays(to, -29);
process.stdout.write(JSON.stringify({ to, from }));
`;

function periodIn(tz, instant) {
  const r = spawnSync(process.execPath, ['-e', CHILD, dir, instant], { env: { ...process.env, TZ: tz }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

for (const tz of ['America/Los_Angeles', 'Europe/Kyiv', 'UTC']) {
  for (const instant of ['2026-11-12T05:30:00Z', '2026-11-11T23:30:00Z', '2026-11-12T12:00:00Z']) {
    test(`format.js today(): the period ends on the UTC day of the moment, in ${tz} at ${instant}`, () => {
      const utcDay = instant.slice(0, 10);
      const p = periodIn(tz, instant);
      assert.equal(p.to, utcDay, 'the last day of the default period is the current UTC day');
      assert.ok(p.from <= utcDay && utcDay <= p.to);
    });
  }
}
