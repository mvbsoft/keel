'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { periodKey, spendBetween, findPoints, rateFrom, calibrate, share, forecast } = require(path.join(__dirname, '..', 'plugins', 'keel', 'scripts', 'lib', 'calibrate.js'));

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
const WEEK = '2026-10-15T00:00:00Z';
const snap = (t, seven_day, extra = {}) => ({ t, pc: 'a', src: 'statusline', five_hour: null, five_hour_resets_at: null, seven_day, seven_day_resets_at: WEEK, ...extra });
const req = (t, usd, extra = {}) => ({ t, usd, wallet: 'subscription', model: 'claude-opus-5', ...extra });
const machines = (until = '2026-12-31T00:00:00Z') => [{ pc: 'a', synced_until: until }];
const weekly = (o) => findPoints({ localPc: 'a', machines: machines(), localRequests: [], remoteHours: [], ...o, kind: 'weekly' });

test('weekly point: spend between two snapshots divided by the percent gained; rate is the median', () => {
  const input = {
    localPc: 'a', machines: machines(), remoteHours: [],
    snapshots: [snap('2026-10-10T00:00:00Z', 10), snap('2026-10-10T10:00:00Z', 12), snap('2026-10-10T20:00:00Z', 16)],
    localRequests: [req('2026-10-10T05:00:00Z', 36), req('2026-10-10T15:00:00Z', 72)],
  };
  const pts = findPoints({ ...input, kind: 'weekly' });
  assert.equal(pts.length, 2);
  assert.deepEqual([pts[0].gain, pts[0].usd, pts[0].rate, pts[0].pending], [2, 36, 18, false]);
  assert.deepEqual([pts[1].gain, pts[1].usd, pts[1].rate], [4, 72, 18]);
  assert.deepEqual(pts[1].by_model, { 'claude-opus-5': 72 });
  const c = calibrate(input);
  assert.deepEqual([c.weekly.rate, c.weekly.n, c.five_hour.rate, c.waiting], [18, 2, null, []]);
});

test('points never cross a reset: a new resets_at starts a new group', () => {
  const pts = weekly({
    snapshots: [snap('2026-10-10T00:00:00Z', 90), snap('2026-10-14T00:00:00Z', 99),
      snap('2026-10-15T01:00:00Z', 1, { seven_day_resets_at: '2026-10-22T00:00:00Z' }), snap('2026-10-15T09:00:00Z', 3, { seven_day_resets_at: '2026-10-22T00:00:00Z' })],
    localRequests: [req('2026-10-12T00:00:00Z', 90), req('2026-10-15T05:00:00Z', 20)],
  });
  assert.equal(pts.length, 2);
  assert.deepEqual(pts.map((p) => [p.gain, p.usd]), [[9, 90], [2, 20]]);
  assert.deepEqual(weekly({ snapshots: [snap('2026-10-14T00:00:00Z', 99), snap('2026-10-15T01:00:00Z', 1, { seven_day_resets_at: '2026-10-22T00:00:00Z' })] }), []);
});

test('weekly: a gain below 1.0 makes no point, but accumulates from the same starting snapshot', () => {
  const small = weekly({ snapshots: [snap('2026-10-10T00:00:00Z', 10), snap('2026-10-10T01:00:00Z', 10.4), snap('2026-10-10T02:00:00Z', 10.9)], localRequests: [req('2026-10-10T01:30:00Z', 5)] });
  assert.deepEqual(small, []);
  const acc = weekly({ snapshots: [snap('2026-10-10T00:00:00Z', 10), snap('2026-10-10T01:00:00Z', 10.5), snap('2026-10-10T02:00:00Z', 11)], localRequests: [req('2026-10-10T01:30:00Z', 5)] });
  assert.equal(acc.length, 1);
  assert.deepEqual([acc[0].from, acc[0].gain, acc[0].usd], ['2026-10-10T00:00:00Z', 1, 5]);
});

test('five_hour: threshold 5.0 and its own reset field; snapshots without a value are skipped', () => {
  const FH = '2026-10-10T05:00:00Z';
  const f = (t, v) => snap(t, null, { five_hour: v, five_hour_resets_at: FH });
  const input = {
    localPc: 'a', machines: machines(), remoteHours: [], localRequests: [req('2026-10-10T01:00:00Z', 10), req('2026-10-10T02:00:00Z', 10)],
    snapshots: [f('2026-10-10T00:00:00Z', 10), f('2026-10-10T00:30:00Z', 14), snap('2026-10-10T00:40:00Z', 50), f('2026-10-10T03:00:00Z', 15), f('2026-10-10T04:00:00Z', 16)],
  };
  const pts = findPoints({ ...input, kind: 'five_hour' });
  assert.equal(pts.length, 1);
  assert.deepEqual([pts[0].from, pts[0].to, pts[0].gain, pts[0].usd, pts[0].rate], ['2026-10-10T00:00:00Z', '2026-10-10T03:00:00Z', 5, 20, 4]);
  assert.equal(calibrate(input).five_hour.rate, 4);
});

test('a point without spend is kept in the list as no_spend and excluded from the rate', () => {
  const pts = weekly({ snapshots: [snap('2026-10-10T00:00:00Z', 10), snap('2026-10-10T10:00:00Z', 12)] });
  assert.deepEqual([pts[0].kept, pts[0].reason, pts[0].usd], [false, 'no_spend', 0]);
  const r = rateFrom(pts);
  assert.deepEqual([r.rate, r.n, r.points.length], [null, 0, 1]);
});

test('rateFrom: a low outlier is dropped as other_device and the median recomputed', () => {
  const mk = (i, rate) => ({ from: `2026-10-0${i}T00:00:00Z`, to: `2026-10-0${i}T10:00:00Z`, gain: 1, usd: rate, rate, pending: false, kept: true });
  const r = rateFrom([mk(1, 10), mk(2, 12), mk(3, 3), mk(4, 14)]);
  // median of all four = 11; 3 < 0.7 * 11
  assert.deepEqual(r.points.map((p) => p.reason || null), [null, null, 'other_device', null]);
  assert.deepEqual([r.points[2].kept, r.n, r.rate], [false, 3, 12]);
  // a high outlier is not dropped
  assert.equal(rateFrom([mk(1, 10), mk(2, 10), mk(3, 40)]).n, 3);
});

test('a machine that has not synced to the point end makes it pending and out of the rate', () => {
  const input = {
    localPc: 'a', remoteHours: [], localRequests: [req('2026-10-10T05:00:00Z', 20)],
    machines: [{ pc: 'a', synced_until: '2026-10-11T00:00:00Z' }, { pc: 'b', synced_until: '2026-10-10T09:00:00Z' }],
    snapshots: [snap('2026-10-10T00:00:00Z', 10), snap('2026-10-10T10:00:00Z', 12)],
  };
  const pts = findPoints({ ...input, kind: 'weekly' });
  assert.deepEqual([pts[0].pending, pts[0].waiting], [true, ['b']]);
  const c = calibrate(input);
  assert.deepEqual([c.weekly.rate, c.weekly.n, c.waiting], [null, 0, ['b']]);
  assert.equal(c.weekly.points[0].reason, 'pending');
});

test('API wallet spend is excluded', () => {
  const s = spendBetween('2026-10-10T00:00:00Z', '2026-10-10T10:00:00Z', {
    localPc: 'a',
    localRequests: [req('2026-10-10T01:00:00Z', 5), req('2026-10-10T02:00:00Z', 100, { wallet: 'api' })],
    remoteHours: [{ pc: 'b', h: '2026-10-10T03:00:00Z', wallet: 'api', usd: 50, by_model: { 'claude-opus-5': 50 } }],
  });
  assert.deepEqual(s, { usd: 5, by_model: { 'claude-opus-5': 5 } });
});

test('spendBetween: the interval is (t0, t1] for local requests', () => {
  const s = spendBetween('2026-10-10T01:00:00Z', '2026-10-10T02:00:00Z', {
    localPc: 'a', localRequests: [req('2026-10-10T01:00:00Z', 1), req('2026-10-10T01:30:00Z', 2), req('2026-10-10T02:00:00Z', 4), req('2026-10-10T02:00:01Z', 8)],
  });
  assert.equal(s.usd, 6);
});

test('spendBetween: remote hours are prorated by overlap; a half-hour overlap counts half, per model', () => {
  const remoteHours = [
    { pc: 'b', h: '2026-10-10T00:00:00Z', wallet: 'subscription', usd: 10, by_model: { x: 6, y: 4 } },
    { pc: 'b', h: '2026-10-10T01:00:00Z', wallet: 'subscription', usd: 10, by_model: { x: 10 } },
    { pc: 'b', h: '2026-10-10T02:00:00Z', wallet: 'subscription', usd: 10, by_model: { x: 10 } },
  ];
  // window 00:30 - 02:00 covers half of hour 0 and all of hour 1; hour 2 is outside
  const s = spendBetween('2026-10-10T00:30:00Z', '2026-10-10T02:00:00Z', { localPc: 'a', remoteHours });
  near(s.usd, 15);
  near(s.by_model.x, 13);
  near(s.by_model.y, 2);
  // window inside one hour
  near(spendBetween('2026-10-10T00:00:00Z', '2026-10-10T00:15:00Z', { localPc: 'a', remoteHours }).usd, 2.5);
});

test('spendBetween: hourly rows of the local machine are ignored', () => {
  const s = spendBetween('2026-10-10T00:00:00Z', '2026-10-10T03:00:00Z', {
    localPc: 'a', localRequests: [req('2026-10-10T01:00:00Z', 3)],
    remoteHours: [{ pc: 'a', h: '2026-10-10T01:00:00Z', wallet: 'subscription', usd: 99, by_model: { x: 99 } },
      { pc: 'b', h: '2026-10-10T01:00:00Z', wallet: 'subscription', usd: 7, by_model: { x: 7 } }],
  });
  assert.equal(s.usd, 10);
});

test('rateFrom: only the last 20 complete points by time count', () => {
  const pts = Array.from({ length: 25 }, (_, i) => {
    const rate = i < 5 ? 100 : 10;
    return { from: new Date(Date.UTC(2026, 9, 1, i)).toISOString(), to: new Date(Date.UTC(2026, 9, 1, i, 30)).toISOString(), gain: 1, usd: rate, rate, pending: false, kept: true };
  });
  const r = rateFrom([...pts].reverse());
  assert.deepEqual([r.rate, r.n], [10, 20]);
  assert.equal(r.points.filter((p) => p.reason === 'older').length, 5);
  assert.equal(rateFrom(pts, { last: 25 }).rate, 10);
  assert.equal(rateFrom(pts, { last: 25 }).n, 25);
});

test('no points: rate is null', () => {
  assert.deepEqual(rateFrom([]), { rate: null, n: 0, points: [] });
  const c = calibrate({ snapshots: [], machines: [], localPc: 'a', localRequests: [], remoteHours: [] });
  assert.deepEqual([c.weekly.rate, c.five_hour.rate, c.waiting], [null, null, []]);
});

test('share and forecast: null when the rate is null', () => {
  assert.equal(share(36, 18), 2);
  assert.equal(share(36, null), null);
  assert.equal(forecast({ current: 40, usdLast48h: 144, rate: 18, hoursToReset: 60 }), 40 + 10);
  assert.equal(forecast({ current: 40, usdLast48h: 96, rate: null, hoursToReset: 60 }), null);
  assert.equal(forecast({ current: null, usdLast48h: 96, rate: 18, hoursToReset: 60 }), null);
  assert.equal(forecast({ current: 40.04, usdLast48h: 0, rate: 18, hoursToReset: 60 }), 40);
});

test('reset times in epoch seconds and ISO with milliseconds fall into one period', () => {
  const sec = Date.parse(WEEK) / 1000;
  const iso = new Date(Date.parse(WEEK) - 477).toISOString();
  assert.equal(periodKey(sec), periodKey(iso));
  const pts = findPoints({
    snapshots: [snap('2026-10-12T10:00:00Z', 50, { seven_day_resets_at: sec }), snap('2026-10-12T12:00:00Z', 51, { seven_day_resets_at: iso })],
    machines: [], localPc: 'a', localRequests: [{ t: '2026-10-12T11:00:00Z', usd: 18, wallet: 'subscription', model: 'm' }], kind: 'weekly',
  });
  assert.equal(pts.length, 1);
  assert.equal(pts[0].rate, 18);
});

test('a machine not seen for 14 days no longer holds calibration back; a recent one still does', () => {
  const input = (m) => ({
    localPc: 'a', machines: m, remoteHours: [],
    snapshots: [snap('2026-10-10T00:00:00Z', 10), snap('2026-10-10T10:00:00Z', 12)],
    localRequests: [req('2026-10-10T05:00:00Z', 36)],
  });
  const stale = { pc: 'old', synced_until: '2026-09-20T00:00:00Z', last_seen: '2026-09-20T00:00:00Z' };
  const fresh = { pc: 'fresh', synced_until: '2026-10-05T00:00:00Z', last_seen: '2026-10-09T00:00:00Z' };
  const c = calibrate(input([stale, fresh]));
  assert.deepEqual(c.waiting, ['fresh']);
  assert.equal(c.weekly.rate, null, 'the fresh machine still blocks');
  const only = calibrate(input([stale]));
  assert.deepEqual([only.waiting, only.weekly.rate, only.weekly.n], [[], 18, 1]);
  // without last_seen the last sync date decides; with no date at all the machine keeps waiting
  assert.deepEqual(calibrate(input([{ pc: 'old', synced_until: '2026-09-20T00:00:00Z' }])).waiting, []);
  assert.deepEqual(calibrate(input([{ pc: 'nodate' }])).waiting, ['nodate']);
  // last_seen recent but never synced since: that is a real wait
  assert.deepEqual(calibrate(input([{ pc: 'busy', synced_until: '2026-09-01T00:00:00Z', last_seen: '2026-10-10T00:00:00Z' }])).waiting, ['busy']);
});
