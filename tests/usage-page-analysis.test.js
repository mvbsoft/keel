'use strict';
// The usage page's Analysis view and the CSV downloads, against a stub page and database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { dir, VIEW_FILES, openPage, stubDb, pageFixture, demoPage } = require('./fixtures/usage-page.js');

// Ten days of one session each: day n costs $n, so the sums are easy to read.
function analysisFixture() {
  const { d, sess, dbDoc } = pageFixture();
  const odd = sess('odd', 1, d(11)); odd.project = '<i>x</i>';
  const days = [dbDoc(11, [odd], `${d(11)}T23:00:00Z`)];
  for (let n = 1; n <= 10; n++) days.push(dbDoc(n, [sess(`s${n}`, n, d(n))], `${d(n)}T23:00:00Z`));
  return { d, db: stubDb({ days }) };
}
const tick = () => new Promise((r) => setTimeout(r, 5));

test('analysis: the sentence, the filter chips, six tiles, the chart and the table; a column or a row leads to its sessions', async () => {
  const { d, db } = analysisFixture();
  const page = await openPage({ db, hash: '#analysis' });
  const v = page.view();
  // The three words of the sentence are menu triggers (they were selects); a non-breaking space keeps a word and its trigger
  // together when the sentence wraps on a phone.
  assert.doesNotMatch(v, /<select|<option/);
  assert.match(v, /Show&nbsp;<span class="menu-wrap"><button type="button" class="menu-btn inline" id="an_measure" value="usd" data-an="measure" aria-label="Measure: dollars"[^>]*>dollars<svg/);
  assert.match(v, /by&nbsp;<span class="menu-wrap"><button type="button" class="menu-btn inline" id="an_by" value="day" data-an="by" aria-label="Group by: days"[^>]*>days<svg/);
  assert.match(v, /<\/span>, colored by&nbsp;<span class="menu-wrap"><button type="button" class="menu-btn inline" id="an_split" value="model" data-an="split" aria-label="Color by: models"/);
  assert.match(v, /<div class="menu" id="an_by_list" role="listbox" aria-label="Group by" hidden><button type="button" role="option" tabindex="-1" class="menu-item" id="an_by_o0" data-value="day" aria-selected="true"><span>days<\/span>/);
  assert.deepEqual([...v.matchAll(/class="menu-btn chip" id="an_\w+" value="" data-an="\w+" aria-label="[^"]*" [^>]*>([^<]+): <b>all<\/b>/g)].map((m) => m[1]), ['Project', 'PC', 'Model', 'Who', 'User', 'Payment']);
  assert.doesNotMatch(v, /chip set|id="anReset"|data-clear/, 'no filter set: nothing to clear or reset');
  assert.doesNotMatch(v, /<i>x<\/i>/, 'a project name is escaped');
  assert.match(v, /data-value="&lt;i&gt;x&lt;\/i&gt;" aria-selected="false"><span>&lt;i&gt;x&lt;\/i&gt;<\/span>/);
  assert.doesNotMatch(v, /type="date"/, 'the period is the header\'s');
  for (const [label, value] of [['Spent', '\\$56\\.00'], ['Sessions', '11'], ['Hours of work', '[\\d.]+ h'], ['Tokens', '[\\d.]+[kM]?'], ['Model requests', '11'], ['Your messages', '0']]) {
    assert.match(v, new RegExp(`<div class="tile"><span class="lbl">${label}</span><span class="mid">${value}</span>`), label);
  }
  assert.match(v, /<span class="small muted">\$5\.09 on average<\/span>/);
  assert.match(v, /<h2>Dollars by days<\/h2><div class="legend"><span><i class="dot sonnet"><\/i>Sonnet 5\.5<\/span><\/div>/);
  assert.equal((v.match(/class="colm"/g) || []).length, 30, 'one column for each of the 30 days: a quiet day is a gap');
  assert.equal((v.match(/<div class="colm"/g) || []).length, 19, '11 days with work, the rest are not pressable');
  assert.equal((v.match(/<button type="button" class="colm"/g) || []).length, 11);
  assert.match(v, /<h2>The same numbers as a table<\/h2>/);
  assert.doesNotMatch(v, /class="tbl"/);
  assert.match(v, /<th scope="col">Day<\/th><th scope="col" class="r">Cost<\/th><th scope="col" class="r">Share<\/th><th scope="col" class="r">Sessions<\/th>/);
  assert.equal((v.match(/<tr class="pick"/g) || []).length, 8, 'eight rows, newest day first');
  assert.match(v, new RegExp(`<tr class="pick" data-drill="${d(1)}"><td><button type="button" class="link t" data-drill="${d(1)}">`));
  assert.match(v, /<tfoot><tr><td>Total, [\d/]+ – [\d/]+<\/td><td class="r hit">\$56\.00<\/td><td class="r">100 %<\/td>/);
  assert.match(v, /Showing the latest 8 of 11\.[\s\S]*id="anAll" aria-pressed="false">Show all 11<\/button>/);

  page.press('click', 'button.colm[data-pick]', { pick: d(3) });
  assert.equal(page.location.hash, '#sessions');
  assert.deepEqual([page.saved['keel-usage.ss'].drill.dim, page.saved['keel-usage.ss'].drill.keys.length], ['Day', 1]);
  page.press('click', '[data-drill]', { drill: d(2) });
  assert.equal(page.saved['keel-usage.ss'].drill.value, v.match(new RegExp(`data-drill="${d(2)}">([^<]+)<`))[1]);
});

test('analysis: the table shows every row on request, and the token columns replace the main ones; both choices are remembered', async () => {
  const { db } = analysisFixture();
  const page = await openPage({ db, hash: '#analysis' });
  page.press('click', '#anAll', {});
  assert.equal(page.saved['keel-usage.an'].all, true);
  page.press('click', 'button[data-cols]', { cols: 'tokens' });
  assert.equal(page.saved['keel-usage.an'].cols, 'tokens');
  const more = await openPage({ db, hash: '#analysis', stored: { 'keel-usage.an': { all: true, cols: 'tokens' } } });
  const v = more.view();
  assert.equal((v.match(/<tr class="pick"/g) || []).length, 11);
  assert.match(v, /id="anAll" aria-pressed="true">Show fewer<\/button>/);
  assert.match(v, /id="anCols_tokens" data-cols="tokens" class="on" aria-pressed="true">Tokens in detail<\/button>/);
  assert.match(v, /<th scope="col" class="r">Input<\/th><th scope="col" class="r">Write 5m<\/th><th scope="col" class="r">Write 1h<\/th><th scope="col" class="r">Read<\/th><th scope="col" class="r">Output<\/th>/);
  assert.doesNotMatch(v, /<th scope="col" class="r">Share<\/th>/);
});

test('analysis: a set filter is a chip with a clear cross, the title names it, Reset clears all; nothing matching keeps the controls', async () => {
  const { db } = analysisFixture();
  const set = await openPage({ db, hash: '#analysis', stored: { 'keel-usage.an': { project: 'shop' } } });
  const v = set.view();
  // The clear cross is a button of its own beside the trigger, not inside it.
  assert.match(v, /<span class="chip-group"><span class="menu-wrap"><button type="button" class="menu-btn chip set" id="an_project" value="shop"[^>]*>Project: <b>shop<\/b><svg[^>]*><path[^>]*><\/path><\/svg><\/button><div class="menu" id="an_project_list"[\s\S]*?data-value="shop" aria-selected="true"[\s\S]*?<\/div><\/span><button type="button" class="clr" data-clear="project" aria-label="Clear the filter: Project">/);
  assert.match(v, /<h2>Dollars by days, Project: shop<\/h2>/);
  assert.match(v, /<div class="tile"><span class="lbl">Spent<\/span><span class="mid">\$55\.00<\/span><span class="small muted">98 % of all spend<\/span>/);
  assert.match(v, /id="anReset">Reset<\/button>/);
  set.press('click', '[data-clear]', { clear: 'project' });
  assert.equal(set.saved['keel-usage.an'].project, '');
  set.press('click', '#anReset', {});
  assert.deepEqual(['pc', 'user', 'project', 'wallet', 'participant', 'model'].map((f) => set.saved['keel-usage.an'][f]), ['', '', '', '', '', '']);

  const none = await openPage({ db, hash: '#analysis', stored: { 'keel-usage.an': { participant: 'agents' } } });
  assert.match(none.view(), /Nothing matches these filters\./);
  assert.match(none.view(), /Who: <b>all agents<\/b>/, 'the chips stay so the filter can be cleared');
  assert.doesNotMatch(none.view(), /class="tile"/);
});

test('analysis: choosing in a menu of the sentence or on a chip draws the page again with the choice; the cross clears; the focus stays on the trigger', async () => {
  const { db } = analysisFixture();
  const page = await openPage({ db, hash: '#analysis' });
  assert.match(page.view(), /<h2>Dollars by days<\/h2>/);
  page.choose('an_by', 'project');
  assert.match(page.view(), /id="an_by" value="project"[^>]*>projects<svg/, 'the trigger shows the choice');
  assert.match(page.view(), /<h2>Dollars by projects<\/h2>/, 'the page was drawn again with it');
  assert.equal(page.saved['keel-usage.an'].by, 'project');
  assert.equal(page.saved['keel-usage.an'].touched, true);
  assert.equal(page.focused.pop(), 'an_by', 'the focus is back on the trigger of the drawn page');
  page.choose('an_measure', 'requests');
  assert.equal(page.saved['keel-usage.an'].measure, 'requests');
  assert.match(page.view(), /id="an_measure" value="requests"/);

  page.choose('an_project', 'shop');
  assert.equal(page.saved['keel-usage.an'].project, 'shop');
  assert.match(page.view(), /class="menu-btn chip set" id="an_project" value="shop"[^>]*>Project: <b>shop<\/b>/);
  assert.match(page.view(), /<h2>[^<]*, Project: shop<\/h2>/, 'the title names the filter');
  const d = page.dom();
  const cross = d.byId('an_project').parentNode.parentNode.querySelector('.clr');
  assert.equal(cross.closest('.menu-btn'), null, 'the cross is not inside the trigger');
  d.fire('click', cross);
  assert.equal(page.saved['keel-usage.an'].project, '', 'the cross clears it');
  assert.match(page.view(), /class="menu-btn chip" id="an_project" value=""[^>]*>Project: <b>all<\/b>/);
  assert.equal(page.focused.pop(), 'an_project');

  page.choose('an_project', 'shop');
  page.choose('an_project', '');
  assert.equal(page.saved['keel-usage.an'].project, '', 'the "all" row clears it too');
  const stale = await openPage({ db, hash: '#analysis', stored: { 'keel-usage.an': { project: 'gone' } } });
  assert.match(stale.view(), /id="an_project" value="gone"[^>]*>Project: <b>gone<\/b>/, 'a filter that is no longer in the list still shows, and can be cleared');
});

test('analysis: Save CSV writes every group, time in hours, through the downloads capability', async () => {
  const { db } = analysisFixture();
  const saved = [];
  const page = await openPage({ db, downloads: { save: async (file) => { saved.push(file); return { status: 'saved' }; } }, hash: '#analysis' });
  page.press('click', '#anExport', {});
  await tick();
  assert.equal(saved.length, 1);
  assert.match(saved[0].filename, /^keel-analysis_\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv$/);
  const lines = saved[0].data.replace(/^﻿/, '').split('\r\n');
  assert.match(lines[0], /^Day,"Share, dollars",dollars,tokens,tokens: input,.*,participant time,active participant time,model requests,your messages,sessions$/);
  assert.equal(lines.length, 1 + 11, 'a row for every day with work, not only the eight shown');
  assert.match(lines[1], /^\d\d\/\d\d,\d+\.\d,1\.00,/);
});

test('analysis: the CSV button comes with the downloads capability; its arrival draws again only a view that has such a button', async () => {
  const { db } = analysisFixture();
  const without = await openPage({ db, hash: '#analysis' });
  assert.doesNotMatch(without.view(), /id="anExport"/, 'no capability, no button: the published page cannot save through a plain link');
  let arrive;
  const late = new Promise((resolve) => { arrive = resolve; });
  const page = await openPage({ db, downloads: late, hash: '#analysis' });
  assert.doesNotMatch(page.view(), /id="anExport"/);
  const overview = await openPage({ db, downloads: late, hash: '#overview' });
  overview.el('view').innerHTML = 'as the reader left it';
  arrive({ save: async () => ({ status: 'saved' }) });
  await tick();
  assert.match(page.view(), /id="anExport"/, 'the open view is drawn again when the capability arrives');
  assert.equal(overview.view(), 'as the reader left it', 'a view without a CSV button stays as it is: an open menu does not close');
});

test('analysis: the hours-of-work tile is Overview\'s figure; the sum over participants is named participant time', async () => {
  const hours = (v) => (new RegExp('<span class="lbl">Hours of work</span><span class="mid">([\\d.,]+ h)</span>(?:<span class="small muted">([^<]*)</span>)?').exec(v) || []).slice(1);
  const [overview] = hours((await demoPage('#overview')).view());
  const [tile, sub] = hours((await demoPage('#analysis')).view());
  assert.ok(overview, 'the Overview tile is there');
  assert.equal(tile, overview, 'one label, one number for the same rows');
  assert.match(sub, /^participants together: [\d.,]+ h$/);
  assert.notEqual(sub.replace('participants together: ', ''), tile, 'agents side by side make the participants\' sum larger');
  const v = (await demoPage('#analysis')).view();
  assert.match(v, /<span class="hint">Participant time adds the main conversation and every agent, so work done in parallel counts for each\.<\/span>/);
  assert.match(v, /data-value="time_min" aria-selected="false"><span>participant time<\/span>/);
  assert.match(v, /data-value="active_min" aria-selected="false"><span>active participant time<\/span>/);
  assert.match(v, />Participant time<\/th>/);
  const uk = (await demoPage('#analysis', 'uk')).view();
  assert.match(uk, /data-value="time_min" aria-selected="false"><span>час учасників<\/span>/);
  assert.match(uk, />Активний час учасників<\/th>/);
  assert.match(uk, /учасники разом: [\d.,]+ год/);
  assert.match(uk, /Час учасників додає основну розмову і кожного агента/);
});

test('analysis: spend through an API key opens grouped by user; the ukrainian sentence reads as one', async () => {
  const { d, sess, dbDoc } = pageFixture();
  const api = sess('x', 2.5, d(1)); api.wallet = 'api';
  const shown = await openPage({ db: stubDb({ days: [dbDoc(1, [api], `${d(1)}T23:00:00Z`)] }), hash: '#analysis' });
  assert.match(shown.view(), /id="an_by" value="user"[^>]*>users<svg/);
  const uk = await openPage({ search: '?demo=1&lang=uk', hash: '#analysis' });
  assert.match(uk.view(), /Показати&nbsp;<span class="menu-wrap"><button [^>]*id="an_measure" value="usd"[^>]*>долари<svg[\s\S]*за&nbsp;<span class="menu-wrap"><button [^>]*id="an_by"[\s\S]*<\/span>, кольором за&nbsp;<span class="menu-wrap">/);
  assert.match(uk.view(), /<span class="lbl">Лише:<\/span>/);
  assert.match(uk.view(), /<h2>Долари за днями<\/h2>/);
  assert.match(uk.view(), />Зберегти CSV<\/button>/);
});

test('sessions: the CSV button comes with the downloads capability and saves through the one function the frame gives', async () => {
  const { db } = analysisFixture();
  const saved = [];
  const page = await openPage({ db, downloads: { save: async (file) => { saved.push(file); return { status: 'saved' }; } }, hash: '#sessions' });
  await tick();
  assert.match(page.view(), /id="ssExport"/, 'the open view is drawn again when the capability arrives');
  page.press('click', '#ssExport', {});
  await tick();
  assert.equal(saved.length, 1);
  assert.match(saved[0].filename, /^keel-sessions_\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv$/);
  assert.equal(saved[0].data[0], '﻿', 'a byte order mark for spreadsheets');
  for (const f of VIEW_FILES) assert.doesNotMatch(fs.readFileSync(path.join(dir, f), 'utf8'), /downloads\.save|createObjectURL/, `${f} saves through app.saveFile`);
});
