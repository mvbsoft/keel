'use strict';
// The usage page's frame (app.js) and its Overview and Plan limit views, against a stub page and database.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { dir, P, load, openPage, stubDb, totalRow, pageFixture, demoDocs, demoPage } = require('./fixtures/usage-page.js');

test('app.js: shows the database days of the period; a day synced twice counts once, with the newer copy', async () => {
  const { d, sess, dbDoc } = pageFixture();
  const db = stubDb({ days: [dbDoc(2, [sess('a', 0.13, d(2))], `${d(2)}T23:00:00Z`), dbDoc(1, [sess('b', 0.29, d(1))], `${d(1)}T12:00:00Z`), dbDoc(1, [sess('b', 0.31, d(1))], `${d(1)}T23:00:00Z`)] });
  const page = await openPage({ db });
  const [, n, usd] = totalRow.exec(page.view());
  assert.deepEqual([n, usd], ['2', '0.44'], '0.31 + 0.13');
  assert.deepEqual(page.fetched, [], 'the page reads only its database');
});

test('app.js: a database that does not load shows the error', async () => {
  const broken = { collection: () => { const q = { where: () => q, orderBy: () => q, limit: () => q, get: async () => { throw Object.assign(new Error('down'), { code: 'internal' }); } }; return q; }, doc: () => ({ get: async () => { throw new Error('down'); } }) };
  const page = await openPage({ db: broken });
  assert.doesNotMatch(page.view(), /Total · Sessions/);
  assert.match(page.view(), /down/);
  assert.doesNotMatch(page.top(), /data-preset/, 'no period control without data');
});

test('app.js: a database with no data shows the empty state; without a database the page says so', async () => {
  for (const hash of ['#overview', '#analysis', '#sessions', '#dash']) {
    assert.match((await openPage({ db: stubDb({}), hash })).view(), /No data yet/, hash);
  }
  const none = await openPage({ hash: '#overview' });
  assert.match(none.view(), /No data connection/);
});

test('app.js: ?demo=1 without a database shows the sample data in every view', async () => {
  const page = await openPage({ search: '?demo=1&lang=en', hash: '#sessions' });
  assert.deepEqual(totalRow.exec(page.view()).slice(1, 2), [String(P.flatten(demoDocs()).sessions.length)], 'every sample session is in the 30 days');
  assert.match(page.banner(), /Sample data for a layout check/);
  assert.deepEqual(page.fetched, [], 'the demo does not touch the network');
  const key = P.flatten(load('demo.js').KeelUsageDemo((v) => Date.parse(v)).docs).sessions[0].key;
  for (const lang of ['en', 'uk']) {
    for (const hash of ['#overview', '#analysis', '#sessions', '#limit', `#s.${key}`]) {
      const shown = await openPage({ search: `?demo=1&lang=${lang}`, hash });
      assert.ok(shown.view().length > 400, `${hash} (${lang}) shows something`);
      assert.doesNotMatch(shown.view(), /undefined|NaN|\[object|\bnull\b/, `${hash} (${lang}) has no broken value`);
      assert.doesNotMatch(shown.view(), /class="loading"/, hash);
      assert.doesNotMatch(shown.view(), /<select/, `${hash} (${lang}) has no browser select`);
    }
  }
});

test('app.js: the header has the sections, the sync state and the period; the old addresses still open their view', async () => {
  const page = await openPage({ search: '?demo=1&lang=en', hash: '#overview' });
  const top = page.top();
  assert.match(top, /<a class="brand" href="#overview">keel <span>Usage<\/span><\/a>/);
  assert.deepEqual([...top.matchAll(/<a href="#(\w+)"[^>]*>([^<]+)<\/a>/g)].map((m) => [m[1], m[2]]),
    [['overview', 'Overview'], ['analysis', 'Analysis'], ['sessions', 'Sessions'], ['limit', 'Plan limit']]);
  assert.match(top, /<a href="#overview" class="on" aria-current="page">Overview<\/a>/);
  assert.match(top, /class="pill good st">PCs: 2, synced until /, 'the oldest sync of the two machines');
  assert.deepEqual([...top.matchAll(/data-preset="(\w+)"( class="on")?/g)].map((m) => [m[1], !!m[2]]), [['7', false], ['30', true], ['90', false], ['custom', false]]);
  assert.doesNotMatch(top, /type="date"/, 'the date fields only for an own range');
  assert.match((await openPage({ search: '?demo=1&lang=en', hash: '#sessions' })).top(), /<a href="#sessions" class="on" aria-current="page">/);
  assert.match((await openPage({ search: '?demo=1&lang=en', hash: '#analysis' })).top(), /<a href="#analysis" class="on"/);
  assert.match((await openPage({ search: '?demo=1&lang=en', hash: '#analysis' })).top(), /data-preset="30" class="on"/, 'Analysis uses the period of the header, not date fields of its own');
  assert.match((await openPage({ search: '?demo=1&lang=en', hash: '#calib' })).top(), /<a href="#limit" class="on"/, 'the old address of the limit view');
  const key = P.flatten(load('demo.js').KeelUsageDemo((v) => Date.parse(v)).docs).sessions[0].key;
  assert.match((await openPage({ search: '?demo=1&lang=en', hash: `#s.${key}` })).top(), /<a href="#sessions" class="on" aria-current="page">/, 'a session is under Sessions');
  const own = await openPage({ search: '?demo=1&lang=en', hash: '#overview', stored: { 'keel-usage.range': { preset: 'custom', from: '2026-01-01', to: '2026-02-01' } } });
  assert.match(own.top(), /data-preset="custom" class="on"/);
  assert.match(own.top(), /class="field cal-btn" id="rgFrom" value="2026-01-01" data-range="from" aria-label="From: 1 Jan 2026"[^>]*>.*<\/button>.*class="field cal-btn" id="rgTo" value="2026-02-01" data-range="to" aria-label="To: 1 Feb 2026"/, 'the own period: two calendar buttons, from and to');
  assert.doesNotMatch(own.top(), /type="date"|<input/, 'the browser\'s own date field is not used');
  const bare = await openPage({ db: stubDb({ days: [pageFixture().dbDoc(1, [pageFixture().sess('a', 1, pageFixture().d(1))], '2026-11-01T00:00:00Z')] }), hash: '#overview' });
  assert.doesNotMatch(bare.top(), /class="pill good st"/, 'no machines in the data: no sync state');
});

test('app.js: a day chosen in the calendar of the own period changes the period; a "from" after the "to" swaps them', async () => {
  const stored = { 'keel-usage.range': { preset: 'custom', from: '2026-01-01', to: '2026-02-01' } };
  const page = await openPage({ search: '?demo=1&lang=en', hash: '#overview', stored });
  const pick = (id, date, months = 0) => {
    const h = page.header();
    h.fire('click', h.byId(id));
    for (let i = 0; i < months; i++) h.fire('click', h.byId(`${id}_cal`).querySelectorAll('.cal-nav')[1]);
    h.fire('click', h.byId(`${id}_d${date}`));
    return h;
  };
  assert.equal(page.header().byId('rgFrom_cal').hidden, true, 'closed');
  assert.equal(pick('rgFrom', '2026-01-15').env.active.id, 'rgFrom', 'the focus is on the button when the day is chosen, so the page puts it back there after drawing the header again');
  assert.deepEqual(page.saved['keel-usage.range'], { preset: 'custom', from: '2026-01-15', to: '2026-02-01' }, 'the same as the date field did');
  assert.match(page.top(), /id="rgFrom" value="2026-01-15" data-range="from" aria-label="From: 15 Jan 2026"/, 'the header is drawn again with the new day');
  assert.match(page.top(), /data-preset="custom" class="on"/);
  pick('rgTo', '2026-02-20');
  assert.equal(page.saved['keel-usage.range'].to, '2026-02-20', 'the calendar of "to" opened on its own month, February');
  pick('rgFrom', '2026-03-05', 2);
  assert.deepEqual(page.saved['keel-usage.range'], { preset: 'custom', from: '2026-02-20', to: '2026-03-05' }, 'a "from" after the "to": the two swap');
  assert.match(page.top(), /id="rgFrom" value="2026-02-20"[^>]*aria-label="From: 20 Feb 2026"/);
  assert.match(page.top(), /id="rgTo" value="2026-03-05"[^>]*aria-label="To: 5 Mar 2026"/);
  const keys = page.header();
  keys.fire('keydown', keys.byId('rgTo'), { key: 'ArrowDown' });
  keys.fire('keydown', keys.byId('rgTo'), { key: 'ArrowLeft' });
  keys.fire('keydown', keys.byId('rgTo'), { key: 'Enter' });
  assert.equal(page.saved['keel-usage.range'].to, '2026-03-04', 'by keyboard too');
});

test('overview: the plan limit, the spend of the period, one column per day, where the money went, the sessions and the tokens', async () => {
  const { d, sess, dbDoc } = pageFixture();
  const reset = new Date(Date.now() + 3 * 864e5 + 6 * 3600000).toISOString();
  const five = new Date(Date.now() + 3 * 3600000).toISOString();
  const snapshots = [{ t: new Date(Date.now() - 3600000).toISOString(), seven_day: 34.2, seven_day_resets_at: reset, five_hour: 23, five_hour_resets_at: five, session_id: 'a' }];
  const days = [dbDoc(2, [sess('a', 0.13, d(2))], `${d(2)}T23:00:00Z`, { snapshots }), dbDoc(1, [sess('b', 0.31, d(1))], `${d(1)}T23:00:00Z`)];
  const calib = [['office', { computed_at: new Date().toISOString(), weekly: { rate: 12.1, n: 4, points: [] }, five_hour: { rate: null, n: 0, points: [] } }]];
  const page = await openPage({ db: stubDb({ days, calib, machines: [['office', { synced_until: `${d(1)}T23:00:00Z` }]] }), hash: '#overview' });
  const v = page.view();
  assert.match(v, /<div class="big">34\.2 %<\/div><div class="muted">used · 65\.8 % left<\/div>/);
  assert.match(v, /class="meter" role="img" aria-label="Used 34\.2 % of the weekly limit"><i style="width:34\.2%">/);
  assert.match(v, /Resets .* · <span class="muted">in 3 d 6 h<\/span>/, 'the reset moment and the time left');
  assert.match(v, /<span class="mid">23 %<\/span><div class="meter thin"/, 'the 5-hour window');
  assert.match(v, /<span class="mid">≈ \$413\.82<\/span>/, '34.2 % at $12.10 for 1 %');
  assert.match(v, /<span class="mid">≈ \$12\.10<\/span>/);
  assert.match(v, /<h2>Spent in the period<\/h2>[\s\S]*<div class="big">\$0\.44<\/div>/);
  assert.equal((v.match(/class="colm"/g) || []).length, 30, 'one column for each day of the 30 days');
  assert.equal((v.match(/<button type="button" class="colm"/g) || []).length, 2, 'only the days with spend can be pressed');
  assert.match(v, new RegExp(`class="colm" data-pick="${d(1)}" title="[^"]*\\$0\\.31"`));
  assert.match(v, /role="group" aria-label="Bars of spend per day, split by model\. The most expensive day is .*: \$0\.31\."/);
  assert.match(v, /<i class="dot sonnet"><\/i>Sonnet 5\.5/, 'the legend names the model');
  assert.match(v, /<details class="fallback"><summary>Show as a table<\/summary>/, 'the numbers as a table too');
  assert.match(v, /aria-pressed="true">Projects<\/button>/);
  assert.match(v, /<button type="button" class="name" data-pick="shop" title="shop">shop<\/button><span class="num">\$0\.44<\/span><span class="pct num">100 %<\/span>/);
  assert.doesNotMatch(v, /id="ovDim_user"/, 'one user: no users switch');
  assert.match(v, /<a class="small" href="#sessions">All sessions: 2<\/a>/);
  assert.match(v, /<a class="t" href="#s\.[^"]+">shop<\/a>/);
  assert.match(v, /<h2>Tokens by kind<\/h2>[\s\S]*class="stack" role="img"/);

  // A column leads to that day's sessions, a project name to that project's.
  page.press('click', 'button.colm[data-pick]', { pick: d(1) });
  assert.equal(page.location.hash, '#sessions');
  assert.deepEqual([page.saved['keel-usage.ss'].drill.dim, page.saved['keel-usage.ss'].drill.keys.length], ['Day', 1]);
  page.press('click', 'button.name[data-pick]', { pick: 'shop' });
  assert.deepEqual([page.saved['keel-usage.ss'].drill.dim, page.saved['keel-usage.ss'].drill.value, page.saved['keel-usage.ss'].drill.keys.length], ['Project', 'shop', 2]);
  page.press('click', 'button[data-dim]', { dim: 'who' });
  assert.equal(page.saved['keel-usage.ov'].dim, 'who');
});

test('share of the week: the same digits on Overview, in the Sessions list and on the session page', async () => {
  const { d, sess, dbDoc } = pageFixture();
  const calib = [['office', { computed_at: new Date().toISOString(), weekly: { rate: 12.1, n: 4, points: [] }, five_hour: { rate: null, n: 0, points: [] } }]];
  const open = async (hash) => (await openPage({ db: stubDb({ days: [dbDoc(1, [sess('a', 30.25, d(1))], `${d(1)}T23:00:00Z`)], calib }), hash })).view();
  const overview = await open('#overview');
  assert.match(overview, /<td class="r">\$30\.25<\/td><td class="r">2\.50 %<\/td>/, '$30.25 at $12.10 for 1 %');
  assert.match(await open('#sessions'), /<td class="r ss-week">2\.50 %<\/td>/);
  assert.match(await open(`#s.${/href="#s\.([^"]+)"/.exec(overview)[1]}`), /≈ 2\.50 % of the weekly limit/);
});

const withKinds = (s, kinds) => {
  const by = s.participants[0].by_model;
  by[Object.keys(by)[0]].usd_kind = { in: 0, cw5: 0, cw1h: 0, cr: 0, out: 0, ...kinds };
  return s;
};
const kindsCard = (view) => /<h2>[^<]*<\/h2><\/header>\s*<div class="stack"[\s\S]*?<\/section>/.exec(view)[0];

test('overview: the kinds card shows the dollars by token kind when the sessions have them, and the tokens when none does', async () => {
  const { d, sess, dbDoc } = pageFixture();
  const open = async (sessions) => (await openPage({ db: stubDb({ days: [dbDoc(1, sessions, `${d(1)}T23:00:00Z`)] }), hash: '#overview' })).view();

  const all = kindsCard(await open([withKinds(sess('a', 10, d(1)), { in: 1, cw5: 1, cw1h: 1, cr: 1, out: 6 })]));
  assert.match(all, /<h2>Spend by token kind<\/h2>/);
  assert.match(all, /aria-label="Output 60 %, Cache write 20 %, Cache read 10 %, Input, no cache 10 %"/);
  assert.match(all, /<span class="name" title="Output"><i class="dot [^"]*"><\/i>Output<\/span><span class="num">\$6\.00<\/span><span class="pct num">60 %<\/span>/);
  assert.match(all, /title="Cache write"[^>]*><i class="dot [^"]*"><\/i>Cache write<\/span><span class="num">\$2\.00<\/span><span class="pct num">20 %<\/span>/, 'both cache write kinds in one line');
  assert.match(all, /class="num">\$1\.00<\/span><span class="pct num">10 %<\/span>[\s\S]*class="num">\$1\.00<\/span><span class="pct num">10 %<\/span>/);
  assert.match(all, /the conversation read again, the cheapest per token/, 'the notes stay');
  assert.doesNotMatch(all, /not in this card/);

  const some = kindsCard(await open([withKinds(sess('a', 10, d(1)), { cr: 10 }), sess('b', 5, d(1))]));
  assert.match(some, /<h2>Spend by token kind<\/h2>/);
  assert.match(some, /<div class="small muted">Sessions sent before keel kept this detail are not in this card: \$5\.00 of \$15\.00\.<\/div>/, 'the line names the dollars the card lacks, not the ones it shows');
  assert.match(some, /Cache read<\/span><span class="num">\$10\.00<\/span><span class="pct num">100 %<\/span>/, 'the percent is of the dollars that have the detail');

  const rounding = kindsCard(await open([withKinds(sess('a', 10, d(1)), { cr: 10 }), sess('b', 0.01, d(1))]));
  assert.doesNotMatch(rounding, /not in this card/, 'a cent apart is not missing detail');

  const none = kindsCard(await open([sess('a', 10, d(1))]));
  assert.match(none, /<h2>Tokens by kind<\/h2>/);
  assert.doesNotMatch(none, /not in this card|\$\d/);
});

test('overview: the demo shows the dollars card; its texts exist in both languages', async () => {
  const en = kindsCard((await demoPage('#overview')).view());
  assert.match(en, /<h2>Spend by token kind<\/h2>/);
  assert.match(en, /class="num">\$[\d,.]+<\/span><span class="pct num">\d+ %<\/span>/);
  assert.doesNotMatch(en, /not in this card/, 'every demo session has the detail');
  let entries = 0;
  for (const doc of demoDocs()) for (const s of doc.sessions) for (const p of s.participants) for (const v of Object.values(p.by_model)) {
    const k = v.usd_kind;
    assert.ok(Math.abs(Object.values(k).reduce((a, b) => a + b, 0) - v.usd) < 1e-4, `${s.id}: the kinds add up to the entry's dollars`);
    const perToken = (kind) => k[kind] / v.tok[kind];
    assert.ok(perToken('cr') < perToken('in') && perToken('in') < perToken('cw5') && perToken('cw5') < perToken('out'), `${s.id}: a token of output costs the most, one read from the cache the least`);
    entries++;
  }
  assert.ok(entries > 20);
  const uk = kindsCard((await demoPage('#overview', 'uk')).view());
  assert.match(uk, /<h2>Гроші за видами токенів<\/h2>/);
  const I18N = require(path.join(dir, 'i18n.js'));
  I18N.add('uk', require(path.join(dir, 'i18n.uk.js')));
  for (const key of ['overview.kinds_usd_title', 'overview.kinds_partial']) {
    assert.notEqual(I18N.t('en', key), key, `${key} in English`);
    assert.notEqual(I18N.t('uk', key), I18N.t('en', key), `${key} in Ukrainian`);
  }
  assert.equal(I18N.t('uk', 'overview.kinds_partial', { missing: '$1', total: '$2' }), 'Сесії, надіслані до появи цієї деталізації, сюди не входять: $1 з $2.');
});

test('overview: spend through an API key shows no plan limit card, and no data in the period says so', async () => {
  const { d, sess, dbDoc } = pageFixture();
  const api = sess('x', 2.5, d(1)); api.wallet = 'api';
  const shown = await openPage({ db: stubDb({ days: [dbDoc(1, [api], `${d(1)}T23:00:00Z`)] }), hash: '#overview' });
  assert.doesNotMatch(shown.view(), /Plan limit this week/);
  assert.match(shown.view(), /No plan limit for this payment method/);
  assert.match(shown.view(), /id="ovDim_user"/, 'with an API key the spend is shown by user too');
  const old = await openPage({ db: stubDb({ days: [dbDoc(60, [sess('o', 1, d(60))], `${d(60)}T23:00:00Z`)] }), hash: '#overview' });
  assert.match(old.view(), /Plan limit this week/);
  assert.match(old.view(), /Nothing matches these filters\./);
});

test('app.js: the page language sets the texts and the html lang; a page without one keeps the browser\'s', async () => {
  const { d, sess, dbDoc } = pageFixture();
  const days = [dbDoc(1, [sess('a', 0.17, d(1))], `${d(1)}T23:00:00Z`)];
  assert.equal((await openPage({ db: stubDb({ days, settings: { language: 'uk' } }), nav: 'en-US' })).htmlLang(), 'uk');
  const page = await openPage({ db: stubDb({ days }), nav: 'uk-UA' });
  assert.equal(page.htmlLang(), 'uk');
  assert.doesNotMatch(page.view(), /Total · Sessions/, 'Ukrainian texts, not English');
  assert.equal((await openPage({ db: stubDb({ days }), nav: 'en-US' })).htmlLang(), 'en');
});

test('limit: the price of 1 %, the three steps, this week as a line, the PCs and the first five measurements', async () => {
  const page = await openPage({ search: '?demo=1&lang=en', hash: '#limit' });
  const v = page.view();
  // The measurements of the sample month are counted from the sample itself.
  const calib = load('demo.js').KeelUsageDemo((x) => Date.parse(x)).calibs[0];
  const points = [...calib.weekly.points, ...calib.five_hour.points];
  const keptWeekly = calib.weekly.points.filter((p) => p.kept).length;
  const keptFive = calib.five_hour.points.filter((p) => p.kept).length;
  const dropped = points.filter((p) => !p.pending && !p.kept).length;
  assert.ok(dropped > 0 && keptWeekly > 0 && keptFive > 0);
  assert.match(v, /<h1 class="ft">What 1 % of your plan costs<\/h1>/);
  assert.match(v, new RegExp(`<span class="big">≈ \\$\\d+\\.\\d\\d</span><span class="small muted">median of ${keptWeekly} measurements</span>`), '1 % of the weekly limit');
  assert.match(v, new RegExp(`<span class="big">≈ \\$\\d+\\.\\d\\d</span><span class="small muted">median of ${keptFive} measurements</span>`), '1 % of the 5-hour window');
  assert.match(v, /<span class="big">≈ \$1,\d{3}<\/span>/, 'the whole week is 100 times the weekly rate');
  assert.equal((v.match(/<section class="card c4"><span class="mid step-n">/g) || []).length, 3, 'three steps');
  assert.match(v, /<svg class="lc" viewBox="0 0 700 220" role="img" aria-label="The weekly limit this week as a line: the last measurement shows [\d.]+ % used\.">/);
  assert.match(v, /<text class="end"[^>]*>[\d.]+ % now<\/text>/);
  assert.match(v, /Resets .* · <span class="muted">in 3 d \d+ h<\/span>/);
  assert.match(v, /Of these [\d.]+ %, [\d.]+ % went through keel/);
  assert.match(v, /<b>office<\/b><span class="pill good st">synced<\/span>/);
  assert.match(v, /<b>laptop<\/b><span class="pill wait st">waiting for laptop<\/span>/, 'a PC a measurement waits for');
  assert.match(v, /<span class="mono">\/keel:usage off<\/span>/);
  assert.match(v, new RegExp(`<h2>Measurements</h2><span class="hint">5 of ${points.length} · kept ${keptWeekly} weekly and ${keptFive} 5-hour · dropped ${dropped}</span>`));
  assert.equal((v.match(/<td class="r">/g) || []).length, 15, 'five rows of three number cells');
  assert.match(v, new RegExp(`<button type="button" class="btn" id="limAll" data-all="1">Show all ${points.length}</button>`));
  assert.doesNotMatch(v, /class="tbl"/, 'the design system\'s plain table');
  page.press('click', 'button[data-all]', { all: '1' });
  assert.deepEqual(page.saved['keel-usage.limit'], { all: true }, 'the choice is remembered for the session');

  const all = await openPage({ search: '?demo=1&lang=en', hash: '#limit', stored: { 'keel-usage.limit': { all: true } } });
  assert.equal((all.view().match(/<td class="r">/g) || []).length, 3 * points.length, 'every measurement is a row');
  assert.match(all.view(), new RegExp(`<h2>Measurements</h2><span class="hint">${points.length} of ${points.length} `));
  assert.match(all.view(), /<span class="pill risk st">dropped<\/span><span class="small muted">no spend in the window<\/span>/);
  assert.match(all.view(), />Show fewer<\/button>/);
  const uk = await openPage({ search: '?demo=1&lang=uk', hash: '#limit' });
  assert.match(uk.view(), /Скільки коштує 1 % вашого плану/);
  assert.match(uk.view(), new RegExp(`5 із ${points.length} · враховано ${keptWeekly} тижневих і ${keptFive} п’ятигодинних · відкинуто ${dropped}`));
});

test('limit: no calibration, a week that has reset and an API-only wallet each say so', async () => {
  const { d, sess, dbDoc } = pageFixture();
  const bare = await openPage({ db: stubDb({ days: [dbDoc(1, [sess('a', 1, d(1))], `${d(1)}T23:00:00Z`)] }), hash: '#limit' });
  assert.match(bare.view(), /<span class="big">—<\/span><span class="small muted">no calibration yet<\/span>/);
  assert.match(bare.view(), /<h2>No calibration yet<\/h2>/);
  assert.match(bare.view(), /no limit data yet/, 'no readings, no line');
  assert.doesNotMatch(bare.view(), /<svg class="lc"|undefined|NaN|\[object|\bnull\b/);

  const past = new Date(Date.now() - 3600000).toISOString();
  const snapshots = [{ t: new Date(Date.now() - 2 * 864e5).toISOString(), seven_day: 20, seven_day_resets_at: past, five_hour: 5, five_hour_resets_at: past, session_id: 'a' }];
  const stale = await openPage({ db: stubDb({ days: [dbDoc(2, [sess('a', 1, d(2))], `${d(2)}T23:00:00Z`, { snapshots })] }), hash: '#limit' });
  assert.match(stale.view(), /the period has reset; waiting for a new reading/);
  assert.doesNotMatch(stale.view(), /<svg class="lc"/);

  const hours = [{ h: `${d(1)}T10:00:00Z`, wallet: 'api', usd: 1, req: 1, tok: { in: 1, cw5: 0, cw1h: 0, cr: 0, out: 0 }, by_model: {} }];
  const api = await openPage({ db: stubDb({ days: [dbDoc(1, [], `${d(1)}T23:00:00Z`, { hours })] }), hash: '#limit' });
  assert.match(api.view(), /No plan limit for this payment method/);
});
