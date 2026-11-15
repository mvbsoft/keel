'use strict';
// Analysis: one measure grouped by one dimension as a sentence, filters as chips, six tiles, a chart, the
// same numbers as a table and a CSV file. Texts: i18n keys `analysis.*`, `filter.*`, `group.*`, `split.*`,
// `dim.*`, `measure.*`, `measure_short.*`, `stats.*`.
window.KeelViews = window.KeelViews || {};
window.KeelViews.analysis = (app) => {
  const {
    state: S, t, P, esc, nf, fUsd, fPct, fTok, fDur, fHrs, fInt, fMeasure, chartVal, unitOf, walletName, dimLabel, modelName, cap, addDays,
    uniq, choices, seriesClass,
  } = app;
  const GROUPS = ['day', 'week', 'project', 'pc', 'user', 'participant', 'model', 'hour'];
  const SPLITS = ['none', 'model', 'pc', 'project', 'participant'];
  const COLUMNS = {
    main: ['usd', 'share', 'sessions', 'time_min', 'active_min', 'tokens', 'requests', 'turns'],
    tokens: ['usd', 'tokens', 'tok_in', 'tok_cw5', 'tok_cw1h', 'tok_cr', 'tok_out'],
  };
  const ROWS_SHOWN = 8;
  const ICON_CLEAR = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg>';
  const ICON_SAVE = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 11l5 5 5-5M5 20h14"></path></svg>';

  const a = S.an;
  const base = S.rows;
  if (!app.hasAnyData()) return { html: app.emptyAll() };
  if (!a.touched && base.length && base.every((r) => r.wallet !== 'subscription') && a.by === 'day') a.by = 'user';

  const one = (v) => (v ? [v] : []);
  const filters = { pc: one(a.pc), user: one(a.user), project: one(a.project), wallet: one(a.wallet), participant: a.participant || null, model: one(a.model) };
  const agentTypes = uniq(base.filter((r) => r.kind !== 'main').map((r) => r.participant));
  const partLabel = (v) => (v === 'agents' ? t('participant.agents') : dimLabel('participant', v));
  const CHIPS = [
    ['project', t('filter.project'), uniq(base.map((r) => r.project))],
    ['pc', t('filter.pc'), uniq(base.map((r) => r.pc))],
    ['model', t('filter.model'), uniq(base.map((r) => P.family(r.model))), modelName],
    ['participant', t('analysis.chip_participant'), ['main', 'agents', ...agentTypes], partLabel],
    ['user', t('filter.user'), uniq(base.map((r) => r.user))],
    ['wallet', t('analysis.chip_wallet'), uniq(base.map((r) => r.wallet)), walletName],
  ];
  const chipText = (field, labelFn) => (a[field] ? (labelFn ? labelFn(a[field]) : a[field]) : t('common.all'));
  const anySet = CHIPS.some(([field]) => a[field]);

  // A set filter is a highlighted chip with its clear cross beside it, not inside the trigger.
  const chip = ([field, label, list, labelFn]) => {
    const clear = a[field]
      ? `<button type="button" class="clr" data-clear="${field}" aria-label="${esc(t('analysis.clear', { name: label }))}">${ICON_CLEAR}</button>` : '';
    return `<span class="chip-group">${app.menu({ id: `an_${field}`, label, prefix: label, value: a[field], options: choices(list, labelFn, a[field]), cls: a[field] ? 'chip set' : 'chip', data: { an: field } })}${clear}</span>`;
  };
  const word = (id, label, list, cur, labelFn) => app.menu({ id: `an_${id}`, label, value: cur, options: list.map((v) => ({ value: v, label: labelFn(v) })), cls: 'inline', data: { an: id } });
  const controls = `<section class="card c12">
      <div class="an-sentence">${esc(t('analysis.show'))}&nbsp;${word('measure', t('measure.by'), P.measures.map((m) => m.id), a.measure, (m) => t(`measure.${m}`))}
        ${esc(t('analysis.by'))}&nbsp;${word('by', t('group.by'), GROUPS, a.by, (g) => t(`group.${g}`))}, ${esc(t('analysis.color_by'))}&nbsp;${word('split', t('split.by'), SPLITS, a.split, (g) => t(`split.${g}`))}</div>
      <div class="row"><span class="lbl">${esc(t('analysis.only'))}</span>${CHIPS.map(chip).join('')}${anySet ? `<button type="button" class="link small" id="anReset">${esc(t('analysis.reset'))}</button>` : ''}</div>
    </section>`;

  function bindControls() {
    app.on('change', '[data-an]', (el) => {
      S.an[el.dataset.an] = el.value; S.an.touched = true; app.store.set('an', S.an);
      app.rerender(); app.restoreFocus(el.id);
    });
    app.on('click', '[data-clear]', (el) => {
      S.an[el.dataset.clear] = ''; app.store.set('an', S.an);
      app.rerender(); app.restoreFocus(`an_${el.dataset.clear}`);
    });
    app.on('click', '#anReset', () => {
      for (const [field] of CHIPS) S.an[field] = '';
      app.store.set('an', S.an);
      app.rerender(); app.restoreFocus(`an_${CHIPS[0][0]}`);
    });
  }

  const fr = P.filter(base, filters);
  if (!fr.length) return { html: `<div class="grid">${controls}<div class="empty c12">${esc(t('empty.filtered'))}</div></div>`, bind: bindControls };

  const ms = a.measure; const by = a.by; const split = a.split === 'none' ? null : a.split;
  const groups = P.share(P.group(fr, by, split), ms);
  const tot = {}; for (const m of P.measures) tot[m.id] = groups.reduce((x, g) => x + g.total[m.id], 0);
  const pctTotal = groups.reduce((x, g) => x + g.pct, 0);
  const sessKeys = new Set(fr.map((r) => r.session));
  const st = P.stats(fr, S.flat.sessions);

  // ---- tiles ---------------------------------------------------------------------------------------
  const allUsd = base.reduce((x, r) => x + r.usd, 0);
  const agentRequests = fr.filter((r) => r.kind !== 'main').reduce((x, r) => x + r.requests, 0);
  const sub = (key, vars) => esc(t(key, vars));
  // The same hours as Overview: the active time of the sessions, which does not add up agents that run side by side.
  const sessionActiveMin = S.flat.sessions.filter((s) => sessKeys.has(s.key)).reduce((a, s) => a + (Number(s.active_min) || 0), 0);
  // 0.005 is half a cent: a smaller difference shows as the same dollars
  const tiles = [
    [t('tile.spent'), fUsd(tot.usd), allUsd > 0 && tot.usd < allUsd - 0.005 ? sub('analysis.of_all', { pct: fPct((tot.usd / allUsd) * 100, 0) }) : ''],
    [t('overview.sessions'), fInt(sessKeys.size), st.avg_session_usd != null ? sub('analysis.per_session', { usd: fUsd(st.avg_session_usd) }) : ''],
    [t('overview.hours'), fHrs(sessionActiveMin), sub('analysis.participants_together', { hrs: fHrs(tot.time_min) })],
    [t('measure_short.tokens'), fTok(tot.tokens), st.cache_share != null ? sub('analysis.from_cache', { pct: fPct(st.cache_share * 100, 0) }) : ''],
    [t('analysis.tile_requests'), fInt(tot.requests), sub('analysis.of_agents', { n: fInt(agentRequests) })],
    [t('overview.messages'), fInt(tot.turns), st.usd_per_turn != null ? sub('analysis.per_message', { usd: fUsd(st.usd_per_turn) }) : ''],
  ].map(([l, v, s]) => app.tile(l, v, s)).join('');
  const stats = [['stats.usd_per_hour', fUsd(st.usd_per_hour)], ['stats.avg_session_active', st.avg_session_active_min != null ? fDur(st.avg_session_active_min) : '—'],
    ['stats.agents_launched', fInt(st.agents_launched)], ['stats.tool_calls', fInt(st.tool_calls)]].map(([k, v]) => app.tile(t(k), v)).join('');

  // ---- chart ---------------------------------------------------------------------------------------
  const partKeys = split ? (() => { const sums = {}; for (const g of groups) for (const [k, v] of Object.entries(g.parts)) sums[k] = (sums[k] || 0) + v[ms]; return Object.keys(sums).sort((x, y) => sums[y] - sums[x]); })() : [];
  // Minutes are drawn in hours, so the ticks read in hours too.
  const fmtAxis = (v) => (unitOf(ms) === 'min' ? `${nf(v, 1)} ${t('common.hours_short')}` : fMeasure(v, ms));
  // By day every day of the period is a column, so a quiet day shows as a gap; shortcut: over 400 days only the days with
  // work are columns, as in the overview; redo with grouping by week if people ask.
  const span = Math.round((Date.parse(S.range.to) - Date.parse(S.range.from)) / 864e5) + 1;
  const keys = [];
  if (by === 'day' && span <= 400) for (let d = S.range.from; d <= S.range.to; d = addDays(d, 1)) keys.push(d);
  else keys.push(...groups.map((g) => g.key));
  const byKey = new Map(groups.map((g) => [g.key, g]));
  const cols = keys.map((key) => {
    const g = byKey.get(key);
    const parts = split
      ? partKeys.map((k) => ({ cls: seriesClass(split, k), value: g && g.parts[k] ? chartVal(g.parts[k][ms], ms) : 0 }))
      : [{ cls: by === 'model' ? seriesClass('model', key) : 'one', value: g ? chartVal(g.total[ms], ms) : 0 }];
    return { label: dimLabel(by, key), tip: `${dimLabel(by, key)} · ${fMeasure(g ? g.total[ms] : 0, ms)}`, parts, pick: g ? key : null };
  });
  const summary = `${t(`measure.${ms}`)} — ${groups.slice(0, 8).map((g) => `${dimLabel(by, g.key)}: ${fMeasure(g.total[ms], ms)}`).join(', ')}`;
  const setFilters = CHIPS.filter(([field]) => a[field]).map(([field, label, , labelFn]) => `${label}: ${chipText(field, labelFn)}`).join(', ');
  const title = cap(t('analysis.title', { measure: t(`measure.${ms}`), group: t(`group.${by}`) })) + (setFilters ? `, ${setFilters}` : '');
  const legend = split ? app.legend(partKeys.map((k) => ({ cls: seriesClass(split, k), label: dimLabel(split, k) }))) : '';
  const chart = `<section class="card c12"><header><h2>${esc(title)}</h2>${legend}</header>${app.columns({ cols, fmt: fmtAxis, summary })}
      <span class="small muted">${esc(t('stats.click_hint'))}</span></section>`;

  // ---- table ---------------------------------------------------------------------------------------
  const colSet = a.cols === 'tokens' ? 'tokens' : 'main';
  const head = (id) => (id === 'share' ? t('common.share') : id === 'time_min' ? t('analysis.col_time') : t(`measure_short.${id}`));
  const cell = (id, g) => (id === 'share'
    ? `<td class="r">${esc(fPct(g.pct, 0))}</td>`
    : `<td class="r${id === ms ? ' hit' : ''}">${esc(fMeasure(g.total[id], id))}</td>`);
  // Days and weeks read newest first; the rest is ordered by cost. The hours of the day are all shown (at most 24).
  const latestFirst = by === 'day' || by === 'week';
  const ordered = latestFirst ? groups.slice().reverse() : groups;
  const capped = by !== 'hour' && ordered.length > ROWS_SHOWN;
  const shown = capped && !a.all ? ordered.slice(0, ROWS_SHOWN) : ordered;
  const body = shown.map((g) => `<tr class="pick" data-drill="${esc(g.key)}"><td><button type="button" class="link t" data-drill="${esc(g.key)}">${esc(dimLabel(by, g.key))}</button></td>${COLUMNS[colSet].map((id) => cell(id, g)).join('')}</tr>`).join('');
  const foot = `<tr><td>${esc(t('analysis.total_range', { from: app.fDay(S.range.from), to: app.fDay(S.range.to) }))}</td>${COLUMNS[colSet].map((id) => cell(id, { total: tot, pct: pctTotal })).join('')}</tr>`;
  const more = capped
    ? `<div class="row spread small"><span class="muted">${esc(a.all ? '' : t(latestFirst ? 'analysis.shown_latest' : 'analysis.shown_top', { n: ROWS_SHOWN, total: ordered.length }))}</span>`
      + `<button type="button" class="btn" id="anAll" aria-pressed="${!!a.all}">${esc(a.all ? t('analysis.show_fewer') : t('analysis.show_all', { total: ordered.length }))}</button></div>` : '';
  const table = `<section class="card c12"><header><h2>${esc(t('analysis.table_title'))}</h2>
      <div class="row">${app.seg({ label: t('analysis.cols_label'), idPrefix: 'anCols_', name: 'cols', value: colSet, options: ['main', 'tokens'].map((c) => ({ value: c, label: t(`analysis.cols_${c}`) })) })}
        ${(S.downloads || S.demo) ? `<button type="button" class="btn" id="anExport">${ICON_SAVE}${esc(t('analysis.save_csv'))}</button>` : ''}
        <span class="small muted" id="anMsg" role="status"></span></div></header>
      <div class="scroll"><table><thead><tr><th scope="col">${esc(t(`dim.${by}`))}</th>${COLUMNS[colSet].map((id) => `<th scope="col" class="r">${esc(head(id))}</th>`).join('')}</tr></thead>
        <tbody>${body}</tbody><tfoot>${foot}</tfoot></table></div>
      <span class="hint">${esc(t('analysis.time_hint'))}</span>${more}</section>`;

  const more2 = `<section class="card c12"><header><h2>${esc(t('stats.title'))}</h2></header><div class="tiles">${stats}</div></section>`;

  // ---- CSV -----------------------------------------------------------------------------------------
  // Every group goes to the file, not only the rows shown. Time is written in hours, as its label says.
  function exportCsv() {
    const num = (id) => (v) => (unitOf(id) === 'usd' ? Number(v).toFixed(2) : unitOf(id) === 'min' ? (Number(v) / 60).toFixed(2) : Math.round(v));
    const columns = [{ key: 'label', label: t(`dim.${by}`) }, { key: 'pct', label: `${t('common.share')}, ${t(`measure.${ms}`)}`, format: (v) => v.toFixed(1) }]
      .concat(P.measures.map((m) => ({ key: m.id, label: t(`measure.${m.id}`), format: num(m.id) })));
    const csv = P.toCSV(groups.map((g) => ({ label: dimLabel(by, g.key), pct: g.pct, ...g.total })), columns, { bom: true });
    return app.saveFile(`keel-analysis_${S.range.from}_${S.range.to}.csv`, csv, 'anMsg');
  }

  return {
    html: `<div class="grid">${controls}<div class="tiles c12">${tiles}</div>${chart}${table}${more2}</div>`,
    bind() {
      bindControls();
      const drill = (key) => {
        const g = byKey.get(key); if (!g) return;
        app.drill(t(`dim.${by}`), dimLabel(by, g.key), [...new Set(fr.filter((r) => P.group([r], by)[0].key === g.key).map((r) => r.session))]);
      };
      app.on('click', '[data-drill]', (el) => drill(el.dataset.drill));
      app.on('click', 'button.colm[data-pick]', (el) => drill(el.dataset.pick));
      app.on('click', 'button[data-cols]', (el) => {
        S.an.cols = el.dataset.cols; app.store.set('an', S.an);
        app.rerender(); app.restoreFocus(`anCols_${S.an.cols}`);
      });
      app.on('click', '#anAll', () => {
        S.an.all = !S.an.all; app.store.set('an', S.an);
        app.rerender(); app.restoreFocus('anAll');
      });
      app.on('click', '#anExport', () => exportCsv());
    },
  };
};
