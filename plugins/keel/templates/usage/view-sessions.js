'use strict';
// Sessions: the list of sessions with search, filters, grouping, sorting and a CSV export. Texts: i18n keys
// `sessions.*`, `sgroup.*`, `col.*`, `drill.*`, `export.*`.
(function () {
const FIRST = 10;
const MORE = 20;
const SORTS = [['date', 'col.date'], ['usd', 'col.cost'], ['active_min', 'col.active'], ['week_pct', 'col.share_week'], ['project', 'col.project'],
  ['pc', 'col.pc'], ['task', 'col.task'], ['models', 'col.models'], ['level', 'col.check']];
const BIGGEST_FIRST = ['date', 'usd', 'active_min', 'week_pct'];
const GROUPS = ['none', 'project', 'day', 'pc'];
const ICON_SEARCH = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="M20 20l-3.5-3.5"></path></svg>';
const ICON_SAVE = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 11l5 5 5-5M5 20h14"></path></svg>';
let searchTimer = null;
let shown = FIRST;
window.KeelViews = window.KeelViews || {};
window.KeelViews.sessions = (app) => {
  const { state: S, t, P, esc, fUsd, fDay, fDT, fDur, walletName, walletChip, cap, modelName, uniq, choices, seriesClass } = app;
  const levelOf = (s) => (s.keel && s.keel.level) || 'none';
  // keel's verification levels, the lightest first; a level this list does not know goes last.
  const LEVELS = ['none', 'gates-only', 'basic', 'standard', 'maximum'];
  const levelRank = (v) => (LEVELS.includes(v) ? LEVELS.indexOf(v) : LEVELS.length);

  function sessionsData() {
    const ss = S.ss; const one = (v) => (v ? [v] : []);
    let list = S.sessions;
    if (ss.drill && ss.drill.keys) { const k = new Set(ss.drill.keys); list = S.flat.sessions.filter((s) => k.has(s.key)); }
    if (ss.level) list = list.filter((s) => levelOf(s) === ss.level);
    const sortKey = ss.sort === 'week_pct' ? 'usd' : ss.sort;
    const res = P.sessionsTable(list, { sort: sortKey, dir: ss.dir, filters: { pc: one(ss.pc), project: one(ss.project), wallet: one(ss.wallet) }, search: ss.search, groupBy: ss.group });
    const fill = (r) => { r.week_pct = app.weekShare(r.usd, r.wallet); };
    res.rows.forEach(fill);
    if (ss.sort === 'week_pct') {
      const fix = (rows) => { const a = rows.filter((r) => r.week_pct != null); const b = rows.filter((r) => r.week_pct == null); rows.splice(0, rows.length, ...a, ...b); };
      fix(res.rows); if (res.groups) res.groups.forEach((g) => fix(g.rows));
    }
    return res;
  }
  function weekCell(r) {
    if (r.week_pct != null) return esc(app.fWeekShare(r.week_pct));
    if (r.wallet !== 'subscription') return walletChip(r.wallet);
    return '—';
  }
  function rowHtml(r) {
    const meta = [r.task ? r.project : t('common.no_keel'), r.pc, r.start ? fDT(r.start) : fDay(r.date), fDur(r.active_min)].filter(Boolean).join(' · ');
    const names = r.models.map(modelName).join(', ');
    return `<tr class="pick" data-key="${esc(r.key)}">
      <td class="ss-title"><a class="t" href="#s.${esc(r.key)}">${esc(r.task || r.project || t('common.unknown'))}</a><div class="m">${esc(meta)}</div></td>
      <td class="ss-models"><div class="dots" title="${esc(names)}">${r.models.map((m) => `<i class="dot ${seriesClass('model', m)}" aria-hidden="true"></i>`).join('')}<span class="sr">${esc(names)}</span></div></td>
      <td class="ss-check">${r.level ? `<span class="pill level">${esc(cap(r.level))}</span>` : `<span class="pill">${esc(t('sessions.no_check'))}</span>`}</td>
      <td class="r ss-cost">${esc(fUsd(r.usd))}</td><td class="r ss-week">${weekCell(r)}</td></tr>`;
  }

  function exportCsv(rows) {
    const cols = [
      { key: 'date', label: t('col.date') }, { key: 'start', label: t('sp.started') }, { key: 'pc', label: t('col.pc') }, { key: 'user', label: t('sp.user') },
      { key: 'project', label: t('col.project') }, { key: 'branch', label: t('sp.branch') }, { key: 'task', label: t('col.task'), format: (v) => v || t('common.no_keel') },
      { key: 'models', label: t('col.models') }, { key: 'wallet', label: t('sp.wallet') }, { key: 'usd', label: 'USD', format: (v) => (Number(v) || 0).toFixed(2) },
      { key: 'week_pct', label: t('col.week_pct'), format: (v) => (v == null ? '' : v.toFixed(3)) }, { key: 'active_min', label: t('col.active'), format: (v) => Math.round(v || 0) }, { key: 'level', label: t('col.level') },
    ];
    return app.saveFile(`keel-sessions_${S.range.from}_${S.range.to}.csv`, P.toCSV(rows, cols, { bom: true }), 'ssMsg');
  }

  const ss = S.ss;
  const save = () => app.store.set('ss', S.ss);
  const bind = () => {
    app.on('change', '[data-ss]', (el) => {
      const key = el.dataset.ss;
      if (key === 'search') return;
      S.ss[key] = el.value;
      if (key === 'sort') S.ss.dir = BIGGEST_FIRST.includes(el.value) ? 'desc' : 'asc';
      shown = FIRST; save(); app.rerender(); app.restoreFocus(el.id);
    });
    app.on('input', '[data-ss="search"]', (el) => {
      S.ss.search = el.value; shown = FIRST; save();
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        const pos = el.selectionStart; app.rerender();
        const n = app.$('ss_search'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (x) { /* ignore */ } }
      }, 250);
    });
    app.on('click', '#ssExport', () => exportCsv(sessionsData().rows));
    app.on('click', '#ssDrillClear', () => { S.ss.drill = null; shown = FIRST; save(); app.rerender(); });
    app.on('click', 'button[data-group]', (el) => { S.ss.group = el.dataset.group; shown = FIRST; save(); app.rerender(); app.restoreFocus(`ssGroup_${S.ss.group}`); });
    app.on('click', '#ssDir', () => { S.ss.dir = S.ss.dir === 'asc' ? 'desc' : 'asc'; save(); app.rerender(); app.restoreFocus('ssDir'); });
    app.on('click', '#ssMore', () => { shown += MORE; app.rerender(); app.restoreFocus('ssMore'); });
    app.on('click', 'tr[data-key]', (el, e) => { if (!e.target.closest('a')) app.navigate('session', el.dataset.key); });
  };
  if (!app.hasAnyData()) return { html: app.emptyAll(), bind };

  const base = ss.drill ? S.flat.sessions : S.sessions;
  const levelName = (v) => (v === 'none' ? t('sessions.no_check') : cap(v));
  const chip = (name, label, list, labelFn) => app.menu({ id: `ss_${name}`, label, prefix: label, value: ss[name], options: choices(list, labelFn, ss[name]), cls: ss[name] ? 'chip set' : 'chip', data: { ss: name } });
  const toolbar = `<section class="card ss-tools">
    <div class="row">
      <label class="ss-search">${ICON_SEARCH}<input type="search" id="ss_search" data-ss="search" aria-label="${esc(t('sessions.search_label'))}" value="${esc(ss.search)}" placeholder="${esc(t('sessions.search_placeholder'))}"></label>
      ${(S.downloads || S.demo) ? `<button type="button" class="btn" id="ssExport">${ICON_SAVE}${esc(t('common.export_csv'))}</button>` : ''}
      <span id="ssMsg" class="ss-msg small muted" role="status"></span>
    </div>
    <div class="row spread">
      <div class="row">
        ${chip('project', t('filter.project'), uniq(base.map((s) => s.project)))}
        ${chip('pc', t('filter.pc'), uniq(base.map((s) => s.pc)))}
        ${chip('level', t('col.check'), uniq(base.map(levelOf)).sort((a, b) => levelRank(a) - levelRank(b)), levelName)}
        ${chip('wallet', t('filter.wallet'), uniq(base.map((s) => s.wallet)), walletName)}
      </div>
      <div class="row">
        <span class="lbl" id="ssGroupLbl">${esc(t('sessions.group_by'))}:</span>
        ${app.seg({ labelledBy: 'ssGroupLbl', idPrefix: 'ssGroup_', name: 'group', value: ss.group, options: GROUPS.map((g) => ({ value: g, label: t(`sgroup.${g}`) })) })}
      </div>
    </div>
    ${ss.drill ? `<div class="drill">${esc(t('drill.label', { dim: ss.drill.dim, value: ss.drill.value }))}<button type="button" class="link" id="ssDrillClear">${esc(t('drill.clear'))}</button></div>` : ''}
  </section>`;

  const res = sessionsData();
  const dirName = ss.dir === 'asc' ? t('sessions.dir_asc') : t('sessions.dir_desc');
  const sortMenu = app.menu({ id: 'ss_sort', label: t('sessions.sort'), value: ss.sort, options: SORTS.map(([id, key]) => ({ value: id, label: t(key) })), cls: 'btn sm', data: { ss: 'sort' } });
  const sortBox = `<div class="row small muted"><span>${esc(t('sessions.sort'))}</span>${sortMenu}
    <button type="button" class="btn sm" id="ssDir" aria-label="${esc(`${t('sessions.sort')}: ${dirName}`)}" title="${esc(dirName)}"><span aria-hidden="true">${ss.dir === 'asc' ? '↑' : '↓'}</span></button></div>`;
  let budget = shown;
  const take = (rows) => { const out = rows.slice(0, budget); budget -= out.length; return out; };
  let body = '';
  if (res.groups) {
    for (const g of res.groups) {
      const rows = take(g.rows);
      if (!rows.length) continue;
      const gl = ss.group === 'day' ? fDay(g.key) : g.key === 'unknown' ? t('common.unknown') : g.key;
      body += `<tr class="ss-grp"><td colspan="3">${esc(gl)} · ${esc(t('sessions.count', { n: g.subtotal.count }))}</td><td class="r" colspan="2">${esc(fUsd(g.subtotal.usd))}</td></tr>${rows.map(rowHtml).join('')}`;
    }
  } else body = take(res.rows).map(rowHtml).join('');
  const shownN = Math.min(shown, res.rows.length);
  const left = res.rows.length - shownN;
  const head = ['col.session', 'col.models', 'col.check'].map((k) => `<th scope="col">${esc(t(k))}</th>`).join('') + ['col.cost', 'col.share_week'].map((k) => `<th scope="col" class="r">${esc(t(k))}</th>`).join('');
  const table = res.rows.length
    ? `<section class="card ss-list"><header><h2>${esc(t('sessions.count', { n: res.total.count }))} · ${esc(fUsd(res.total.usd))}</h2>${sortBox}</header>
      <div class="scroll"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody>
      <tfoot><tr><td colspan="3">${esc(t('common.total'))} · ${esc(t('sessions.count', { n: res.total.count }))}</td><td class="r">${esc(fUsd(res.total.usd))}</td><td></td></tr></tfoot></table></div>
      <div class="row spread small"><span class="muted">${esc(t('sessions.shown', { n: shownN, total: res.rows.length }))} ${esc(t('sessions.keel_only'))}</span>${left > 0 ? `<button type="button" class="btn" id="ssMore">${esc(t('sessions.more', { n: Math.min(MORE, left) }))}</button>` : ''}</div></section>`
    : `<div class="empty">${esc(t('empty.filtered'))}</div>`;
  return { html: toolbar + table, bind };
};
})();
