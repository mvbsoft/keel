'use strict';
// The usage page's Sessions list and the single session view, against a stub page and database.
const test = require('node:test');
const assert = require('node:assert/strict');
const { P, openPage, stubDb, pageFixture, demoDocs, demoPage } = require('./fixtures/usage-page.js');

const demoSession = (id) => P.flatten(demoDocs()).sessions.find((s) => s.id === id);

test('sessions: search, filter chips, group buttons, a sort box; rows with the title, meta line, model dots, check pill, cost and share', async () => {
  const v = (await demoPage('#sessions')).view();
  assert.match(v, /<input type="search" id="ss_search" data-ss="search" aria-label="Search sessions"/);
  assert.doesNotMatch(v, /<select|<option/);
  assert.match(v, /<button type="button" class="menu-btn chip" id="ss_project" value="" data-ss="project" aria-label="Project: all" [^>]*>Project: <b>all<\/b>/);
  for (const id of ['ss_pc', 'ss_level', 'ss_wallet']) assert.match(v, new RegExp(`<button type="button" class="menu-btn chip" id="${id}" value=""`), id);
  assert.match(v, /id="ss_wallet" value="" data-ss="wallet" aria-label="Payment: all" [^>]*>Payment: <b>all<\/b>/);
  assert.match(v, /<span>Sort by<\/span><span class="menu-wrap"><button type="button" class="menu-btn btn sm" id="ss_sort" value="date" data-ss="sort" aria-label="Sort by: Date"/);
  assert.match(v, /<button type="button" id="ssGroup_none" data-group="none" class="on" aria-pressed="true">none<\/button>/);
  const count = P.flatten(demoDocs()).sessions.length;
  assert.match(v, new RegExp(`<h2>Sessions: ${count} · \\$[\\d.,]+</h2>`));
  assert.match(v, /<th scope="col">Session<\/th><th scope="col">Models<\/th><th scope="col">Check<\/th><th scope="col" class="r">Cost<\/th><th scope="col" class="r">Share of the week<\/th>/);
  assert.match(v, /<a class="t" href="#s\.[^"]+">SHOP-15 order filter in admin<\/a><div class="m">shop · office · /, 'the task is the title, the project leads the meta line');
  assert.match(v, /<a class="t" href="#s\.[^"]+">tools<\/a><div class="m">without keel · laptop · /, 'a session without keel shows its project and says so');
  assert.match(v, /<div class="dots" title="Opus 5\.5, Sonnet 5\.5, Haiku 5\.5"><i class="dot opus" aria-hidden="true">/);
  assert.match(v, /<span class="pill level">Standard<\/span>/);
  assert.match(v, /<span class="pill">no check<\/span>/);
  assert.match(v, /<td class="r ss-week"><span class="pill api" title="[^"]+">API<\/span><\/td>/, 'an API session has no share of a plan limit');
  assert.match(v, /<td class="r ss-week">\d+[.,]\d\d %<\/td>/, 'a subscription session shows its share of the week');
  assert.match(v, new RegExp(`Showing 10 of ${count}\\. Only work through keel is here`), 'the first ten, the rest behind "show more"');
  assert.match(v, /id="ssMore">Show 20 more<\/button>/);
  assert.doesNotMatch(v, /class="tbl"|data-label/);
  assert.match(v, new RegExp(`<tfoot><tr><td colspan="3">Total · Sessions: ${count}</td>`));
});

test('sessions: the check filter lists keel\'s levels from the lightest to the fullest; a level it does not know comes last', async () => {
  const { d, sess, dbDoc } = pageFixture();
  const withLevel = (level, i) => { const s = sess(`s${i}`, 1, d(1)); if (level) s.keel = { task: `task ${i}`, level }; return s; };
  const list = ['maximum', 'custom', 'gates-only', null, 'standard', 'basic'].map(withLevel);
  const v = (await openPage({ db: stubDb({ days: [dbDoc(1, list, `${d(1)}T23:00:00Z`)] }), hash: '#sessions' })).view();
  const menu = /id="ss_level_list"[\s\S]*?<\/div>/.exec(v)[0];
  assert.deepEqual([...menu.matchAll(/data-value="([^"]*)"/g)].map((m) => m[1]), ['', 'none', 'gates-only', 'basic', 'standard', 'maximum', 'custom']);
  const demoLevels = new Set(P.flatten(demoDocs()).sessions.map((s) => s.keel && s.keel.level).filter(Boolean));
  for (const level of demoLevels) assert.ok(['gates-only', 'basic', 'standard', 'maximum'].includes(level), `the sample data uses keel's own level names: ${level}`);
});

test('sessions: ten rows first, "show more" adds the rest; a stored group, check filter and sort are applied', async () => {
  const { d, sess, dbDoc } = pageFixture();
  const list = Array.from({ length: 12 }, (_, i) => sess(`s${String(i).padStart(2, '0')}`, 1 + i, d(1)));
  const page = await openPage({ db: stubDb({ days: [dbDoc(1, list, `${d(1)}T23:00:00Z`)] }), hash: '#sessions' });
  assert.match(page.view(), /<h2>Sessions: 12 · \$78\.00<\/h2>/, 'the heading counts every session, not the ten shown');
  assert.equal((page.view().match(/<tr class="pick"/g) || []).length, 10);
  assert.match(page.view(), /Showing 10 of 12\./);
  assert.match(page.view(), /id="ssMore">Show 2 more<\/button>/);
  page.press('click', '#ssMore', {});
  assert.equal((page.view().match(/<tr class="pick"/g) || []).length, 12);
  assert.doesNotMatch(page.view(), /id="ssMore"/);

  const grouped = await openPage({ db: stubDb({ days: [dbDoc(1, list, `${d(1)}T23:00:00Z`)] }), hash: '#sessions', stored: { 'keel-usage.ss': { group: 'project' } } });
  assert.match(grouped.view(), /<tr class="ss-grp"><td colspan="3">shop · Sessions: 12<\/td><td class="r" colspan="2">\$78\.00<\/td><\/tr>/);
  assert.equal((grouped.view().match(/<tr class="pick"/g) || []).length, 10, 'the first ten rows, under their group');
  grouped.press('click', 'button[data-group]', { group: 'pc' });
  assert.equal(grouped.saved['keel-usage.ss'].group, 'pc');

  const demo = (stored) => openPage({ search: '?demo=1&lang=en', hash: '#sessions', stored: { 'keel-usage.ss': stored } });
  const checked = (await demo({ level: 'standard' })).view();
  assert.match(checked, /class="menu-btn chip set" id="ss_level" value="standard"[^>]*>Check: <b>Standard<\/b>/);
  const levelOf = (s) => (s.keel && s.keel.level) || 'none';
  const sample = P.flatten(demoDocs()).sessions;
  assert.match(checked, new RegExp(`<h2>Sessions: ${sample.filter((s) => levelOf(s) === 'standard').length} · `), 'the Standard sessions');
  assert.match((await demo({ level: 'none' })).view(), new RegExp(`<h2>Sessions: ${sample.filter((s) => levelOf(s) === 'none').length} · `), 'the sessions without a check');
  const cheapFirst = (await demo({ sort: 'usd', dir: 'asc' })).view();
  assert.match(cheapFirst, /id="ss_sort" value="usd" data-ss="sort" aria-label="Sort by: Cost"/);
  assert.match(cheapFirst, /id="ssDir" aria-label="Sort by: Ascending" title="Ascending"><span aria-hidden="true">↑<\/span>/);
  const costs = [...cheapFirst.matchAll(/<td class="r ss-cost">\$([\d.,]+)<\/td>/g)].map((m) => Number(m[1].replace(',', '')));
  assert.deepEqual(costs, costs.slice().sort((a, b) => a - b), 'cheapest first');
  const page2 = await demo({ sort: 'usd', dir: 'asc' });
  page2.press('click', '#ssDir', {});
  assert.equal(page2.saved['keel-usage.ss'].dir, 'desc');
  const nothing = (await demo({ search: 'no such session anywhere' })).view();
  assert.match(nothing, /Nothing matches these filters\./);
  assert.match(nothing, /id="ss_search"/, 'the controls stay');
  const drilled = (await demo({ drill: { dim: 'Project', value: 'shop', keys: [] } })).view();
  assert.match(drilled, /From analysis: Project = shop<button type="button" class="link" id="ssDrillClear">Show all sessions<\/button>/);
});

test('sessions: choosing in the sort menu sorts and starts again from the first rows; a filter chip filters; the focus stays on the trigger', async () => {
  const page = await demoPage('#sessions');
  page.choose('ss_sort', 'usd');
  assert.deepEqual([page.saved['keel-usage.ss'].sort, page.saved['keel-usage.ss'].dir], ['usd', 'desc'], 'the biggest first');
  assert.match(page.view(), /id="ss_sort" value="usd"[^>]*>Cost<svg/);
  assert.equal(page.focused.pop(), 'ss_sort');
  page.choose('ss_sort', 'project');
  assert.deepEqual([page.saved['keel-usage.ss'].sort, page.saved['keel-usage.ss'].dir], ['project', 'asc'], 'a name from A to Z');
  const costs = [...page.view().matchAll(/<td class="r ss-cost">\$([\d.,]+)<\/td>/g)];
  assert.ok(costs.length > 0);

  page.choose('ss_project', 'shop');
  assert.equal(page.saved['keel-usage.ss'].project, 'shop');
  assert.match(page.view(), /class="menu-btn chip set" id="ss_project" value="shop"[^>]*>Project: <b>shop<\/b>/);
  const shop = P.flatten(demoDocs()).sessions.filter((s) => s.project === 'shop').length;
  assert.match(page.view(), new RegExp(`<h2>Sessions: ${shop} · `));
  page.choose('ss_project', '');
  assert.match(page.view(), /class="menu-btn chip" id="ss_project" value=""/);
});

test('session: a session with details opens each message to its tools, agents, tokens and largest context', async () => {
  const key = demoSession('d1').key;
  const v = (await demoPage(`#s.${key}`)).view();
  assert.match(v, /<a class="small row sp-back" id="spBack" href="#sessions">[\s\S]*All sessions<\/a>/);
  assert.match(v, /<h1 class="ft">SHOP-15 order filter in admin<\/h1><span class="pill level">Check: Standard<\/span>/);
  assert.match(v, /<span>Branch <b class="mono">keel-trial\/shop-15<\/b><\/span>/);
  assert.equal((v.match(/<div class="tile">/g) || []).length, 6, 'six tiles');
  assert.match(v, /<span class="mid">≈ [\d.]+ %<\/span>/, 'the 5-hour tile has a space after the sign, as every other estimate');
  assert.match(v, /≈ [\d.]+ % of the weekly limit/);
  assert.doesNotMatch(v, /≈\d/, 'one form of the sign everywhere');
  assert.match(v, /<h2>What each of your messages cost<\/h2>/);
  assert.equal((v.match(/<details class="md"><summary class="md-row">/g) || []).length, 7, 'every message can be opened');
  assert.doesNotMatch(v, /are not on the page for this session/);
  // the third message: its tools, two agent types, what the agents spent, its tokens and its largest context
  const third = v.split('<details class="md">')[3];
  assert.match(third, /hand out the steps/);
  assert.match(third, /<span class="pill">Agent <b class="num">3<\/b><\/span><span class="pill">Read <b class="num">4<\/b><\/span>/);
  assert.match(third, /<span class="pill">implementer <b class="num">2<\/b><\/span><span class="pill">context <b class="num">1<\/b><\/span>/);
  assert.match(third, /The agents spent \$1\.10, 68 % of this message\./);
  assert.match(third, /class="stack" role="img" aria-label="Output 17k, Cache write 61k, Cache read 520k, Input 2k"/);
  assert.match(third, /<span class="row md-kind"><i class="dot kind1"><\/i>Output <b class="num">17k<\/b><\/span>/);
  assert.match(third, /The largest context one request read: 78k tokens/);
  assert.match(third, /Agents: 3 \(implementer, context\)/);
  assert.match(v.split('<details class="md">')[5], /<span class="pill">other <b class="num">2<\/b><\/span>/, 'tools past the six most used are summed under other');
  const uk = (await demoPage(`#s.${key}`, 'uk')).view();
  assert.match(uk, /Агенти витратили \$1[.,]10, 68 % цього повідомлення\./);
});

test('session: without details the rows stay and one muted line says they are not on the page; the other blocks stay', async () => {
  const key = demoSession('d2').key;
  const v = (await demoPage(`#s.${key}`)).view();
  assert.doesNotMatch(v, /<details/);
  assert.equal((v.match(/<div class="md-row">/g) || []).length, 2);
  assert.equal((v.match(/The details of the messages \(tools, agents, tokens\) are not on the page for this session/g) || []).length, 1);
  assert.match(v, /<span class="pill">no check<\/span>/);
  assert.match(v, /<span class="pill api" title="[^"]+">API<\/span>/);
  assert.match(v, /<h2>Tools the model used<\/h2>[\s\S]*<span class="pill">Read <b class="num">12<\/b>/, 'without keel the tools get a card of their own');
  assert.match(v, /<h2>Who worked when<\/h2>[\s\S]*class="lane"/);
  assert.match(v, /<h2>Participants<\/h2>[\s\S]*<tfoot>/);
  assert.match(v, /<h2>Cache<\/h2>/);
  assert.doesNotMatch(v, /class="tbl"|data-label/);
  const withKeel = (await demoPage(`#s.${demoSession('d5').key}`)).view();
  assert.match(withKeel, /<h2>What keel&#39;s verification showed<\/h2>[\s\S]*<span class="lbl">Must<\/span><span class="mid">0<\/span>[\s\S]*<span class="lbl">Tools the model used<\/span>/);
  assert.match((await demoPage('#s.no-such')).view(), /Session not found/);
});

test('session: tool and agent names from the data are escaped, and a damaged detail does not break the page', async () => {
  const docs = demoDocs();
  const turn = docs.flatMap((doc) => doc.sessions).find((s) => s.id === 'd1').turns[2];
  turn.tools = { '<img src=x onerror=1>': 2 };
  turn.agent_types = '<b>x</b>';
  turn.tok = { out: 'abc' };
  const key = demoSession('d1').key;
  const page = await openPage({ db: stubDb({ days: docs }), hash: `#s.${key}` });
  assert.doesNotMatch(page.view(), /<img/);
  assert.match(page.view(), /&lt;img src=x onerror=1&gt;/);
  assert.match(page.view(), /class="stack" role="img" aria-label="Output 0, Cache write 0, Cache read 0, Input 0"/);
});
