'use strict';
// Overview: the plan limit card, what the period cost, daily columns by model, where the money went,
// the most expensive sessions and the spend by token kind (the tokens when no session has the dollars). Texts: i18n keys `overview.*`.
window.KeelViews = window.KeelViews || {};
window.KeelViews.overview = (app) => {
  const {
    state: S, t, P, esc, fUsd, fPct, fPctAuto, fTok, fDur, fHrs, fInt, fDay, fDT, fHM, fWhen, fSpan, walletChip, cap,
    dimLabel, modelName, addDays, seriesClass,
  } = app;
  if (!app.hasAnyData()) return { html: app.emptyAll() };

  const rows = S.rows;
  const L = app.limitInfo();
  const rate = app.weeklyRate();
  const allApi = rows.length > 0 && rows.every((r) => r.wallet !== 'subscription');
  const dims = ['project', 'model', 'who', 'pc'].concat(allApi || new Set(rows.map((r) => r.user)).size > 1 ? ['user'] : []);
  const dim = dims.includes(S.ov.dim) ? S.ov.dim : 'project';
  const total = rows.reduce((a, r) => a + r.usd, 0);
  const meter = (pct, label, thin) => `<div class="meter${thin ? ' thin' : ''}" role="img" aria-label="${esc(label)}"><i style="width:${Math.max(0, Math.min(100, pct))}%"></i></div>`;

  function limitCard() {
    const live = L.w && !L.wStale;
    const pct = live ? L.w.seven_day : null;
    let reset = '';
    if (!L.w) reset = esc(t('tile.no_limits'));
    else if (L.wStale) reset = esc(t('tile.stale'));
    else if (Number.isFinite(L.wReset)) {
      reset = `${esc(t('overview.resets', { when: fWhen(L.wReset) }))} · <span class="muted">${esc(t('overview.in', { span: fSpan(L.wReset - Date.now()) }))}</span>`;
    }
    const fiveLive = L.f && !L.fStale;
    const apiUsd = live && rate ? pct * rate : null;
    let apiNote = rate ? t('tile.no_limits') : t('tile.no_calibration');
    if (apiUsd != null) apiNote = t('overview.api_usd_note', { pct: fPctAuto(pct) });
    const fiveNote = !L.f ? t('tile.no_limits') : L.fStale ? t('tile.stale') : t('overview.resets_at', { when: fHM(L.fReset) });
    return `<section class="card c7">
      <header><h2>${esc(t('overview.limit_title'))}</h2></header>
      <div class="row" style="align-items:baseline;gap:6px 16px"><div class="big">${esc(live ? fPctAuto(pct) : '—')}</div>${live ? `<div class="muted">${esc(t('overview.used_left', { left: fPctAuto(Math.max(0, 100 - pct)) }))}</div>` : ''}</div>
      ${live ? meter(pct, t('overview.meter', { pct: fPctAuto(pct) })) : ''}
      <div class="row spread small"><span>${reset}</span><span class="muted">${esc(t('overview.all_devices'))}</span></div>
      ${L.forecast != null ? `<div class="small muted">${esc(t('tile.forecast'))}: ≈ ${esc(fPctAuto(L.forecast))} · ${esc(t('tile.forecast_note'))}</div>` : ''}
      <div class="facts">
        <div class="col"><span class="lbl">${esc(t('overview.five_hour'))}</span><span class="mid">${esc(fiveLive ? fPctAuto(L.f.five_hour) : '—')}</span>${fiveLive ? meter(L.f.five_hour, t('overview.meter_five', { pct: fPctAuto(L.f.five_hour) }), true) : ''}<span class="small muted">${esc(fiveNote)}</span></div>
        <div class="col"><span class="lbl">${esc(t('overview.api_usd'))}</span><span class="mid">${esc(apiUsd != null ? `≈ ${fUsd(apiUsd)}` : '—')}</span><span class="small muted">${esc(apiNote)}</span>${live ? `<span class="small muted">${esc(t('overview.via_keel', { usd: fUsd(L.weekUsd) }))}</span>` : ''}</div>
        <div class="col"><span class="lbl">${esc(t('overview.per_pct'))}</span><span class="mid">${esc(rate ? `≈ ${fUsd(rate)}` : '—')}</span>${rate ? `<span class="small muted">${esc(t('tile.rate_n', { n: app.state.calib.weekly.n || 0 }))}</span>` : ''}<a class="small" href="#limit">${esc(t('overview.how_counted'))}</a></div>
      </div></section>`;
  }

  function spentCard() {
    const keys = new Set(rows.map((r) => r.session));
    const st = P.stats(rows, S.flat.sessions);
    const active = S.flat.sessions.filter((s) => keys.has(s.key)).reduce((a, s) => a + (Number(s.active_min) || 0), 0);
    const turns = rows.reduce((a, r) => a + r.turns, 0);
    const per = (key, usd) => (usd == null ? '' : `<span class="small muted">${esc(t(key, { usd: fUsd(usd) }))}</span>`);
    return `<section class="card ${allApi ? 'c12' : 'c5'}">
      <header><h2>${esc(t('overview.spent_title'))}</h2><span class="row">${allApi ? walletChip(rows[0].wallet) : ''}<span class="hint">${esc(fDay(S.range.from))} – ${esc(fDay(S.range.to))}</span></span></header>
      <div class="big">${esc(fUsd(total))}</div>
      <div class="small muted">${esc(allApi ? t('wallet.no_percent') : t('overview.spent_note'))}</div>
      <div class="facts" style="margin-top:auto">
        <div class="col"><span class="lbl">${esc(t('overview.sessions'))}</span><span class="mid">${esc(fInt(keys.size))}</span>${per('overview.per_session', st.avg_session_usd)}</div>
        <div class="col"><span class="lbl">${esc(t('overview.hours'))}</span><span class="mid">${esc(fHrs(active))}</span>${per('overview.per_hour', st.usd_per_hour)}</div>
        <div class="col"><span class="lbl">${esc(t('overview.messages'))}</span><span class="mid">${esc(fInt(turns))}</span>${per('overview.per_message', st.usd_per_turn)}</div>
      </div></section>`;
  }

  const dm = P.dailyByModel(rows);
  const dayTotals = dm.days.map((_, i) => dm.models.reduce((a, m) => a + dm.usd[m][i], 0));
  function dailyCard() {
    // shortcut: a custom range over 400 days shows only the days that have spend, to keep the columns readable; redo with grouping by week if people ask.
    const span = Math.round((Date.parse(S.range.to) - Date.parse(S.range.from)) / 864e5) + 1;
    const days = [];
    if (span <= 400) for (let d = S.range.from; d <= S.range.to; d = addDays(d, 1)) days.push(d);
    else days.push(...dm.days);
    const at = new Map(dm.days.map((d, i) => [d, i]));
    const bottomUp = dm.models.slice().reverse();
    const cols = days.map((d) => {
      const i = at.get(d);
      const parts = bottomUp.map((m) => ({ cls: seriesClass('model', m), value: i == null ? 0 : dm.usd[m][i] }));
      const day = i == null ? 0 : dayTotals[i];
      return { label: fDay(d), tip: `${fDay(d)} · ${fUsd(day)}`, parts, pick: day > 0 ? d : null };
    });
    let top = 0;
    dayTotals.forEach((v, i) => { if (v > dayTotals[top]) top = i; });
    const summary = t('overview.chart_summary', { day: fDay(dm.days[top]), usd: fUsd(dayTotals[top]) });
    const fmt = (v) => `$${app.nf(v, Number.isInteger(v) ? 0 : v < 1 ? 2 : 1)}`;
    const table = app.tableDetails([t('chart.day'), ...dm.models.map(modelName), t('common.total')],
      dm.days.map((d, i) => [fDay(d), ...dm.models.map((m) => fUsd(dm.usd[m][i])), fUsd(dayTotals[i])]));
    return `<section class="card c8">
      <header><h2>${esc(t('chart.daily_by_model'))}</h2>${app.legend(dm.models.map((m) => ({ cls: seriesClass('model', m), label: modelName(m) })))}</header>
      ${app.columns({ cols, fmt, summary })}
      <div class="row spread small"><span class="muted">${esc(t('overview.top_day', { day: fDay(dm.days[top]), usd: fUsd(dayTotals[top]) }))} ${esc(t('overview.pick_day'))}</span><a href="#analysis">${esc(t('overview.open_analysis'))}</a></div>
      ${table}</section>`;
  }

  function whereItems() {
    const share = (v) => (total ? fPct((v / total) * 100, 0) : '—');
    if (dim === 'who') {
      const mva = P.mainVsAgents(rows);
      const peak = Math.max(mva.main.usd, mva.agents.usd);
      const item = (name, usd, sub) => ({ name, sub, value: fUsd(usd), pct: share(usd), width: peak ? (usd / peak) * 100 : 0 });
      return [item(t('overview.who_main'), mva.main.usd), item(t('overview.who_agents'), mva.agents.usd)]
        .concat(mva.by_type.slice(0, 6).map((g) => item(g.key, g.total.usd, true)));
    }
    const groups = P.group(rows, dim);
    const peak = groups.length ? groups[0].total.usd : 0;
    const items = groups.slice(0, 6).map((g) => ({
      name: dimLabel(dim, g.key), value: fUsd(g.total.usd), pct: share(g.total.usd), width: peak ? (g.total.usd / peak) * 100 : 0,
      cls: dim === 'model' ? seriesClass('model', g.key) : null, pick: g.key,
    }));
    const rest = groups.slice(6).reduce((a, g) => a + g.total.usd, 0);
    // 0.005 is half a cent: less than that would show as $0.00
    if (rest > 0.005) items.push({ name: t('chart.others'), value: fUsd(rest), pct: share(rest), width: peak ? (rest / peak) * 100 : 0 });
    return items;
  }
  function whereCard() {
    return `<section class="card c4">
      <header><h2>${esc(t('overview.where_title'))}</h2></header>
      ${app.seg({ label: t('overview.where_by'), idPrefix: 'ovDim_', name: 'dim', value: dim, options: dims.map((d) => ({ value: d, label: t(`overview.dim_${d}`) })) })}
      ${app.bars(whereItems())}
      <div class="small muted" style="margin-top:auto">${esc(t(`overview.note_${dim}`))}</div></section>`;
  }

  function sessionsCard() {
    const res = P.sessionsTable(S.sessions, { sort: 'usd', dir: 'desc' });
    const body = res.rows.slice(0, 5).map((r) => {
      const pct = app.weekShare(r.usd, r.wallet);
      const share = pct != null ? app.fWeekShare(pct) : r.wallet === 'subscription' ? '—' : walletChip(r.wallet);
      const meta = [r.task ? r.project : t('common.no_keel'), r.pc, r.start ? fDT(r.start) : fDay(r.date), fDur(r.active_min)].filter(Boolean).join(' · ');
      return `<tr class="pick" data-key="${esc(r.key)}"><td><a class="t" href="#s.${esc(r.key)}">${esc(r.task || r.project || t('common.unknown'))}</a><div class="m">${esc(meta)}</div></td>
        <td><div class="dots">${r.models.map((m) => `<i class="dot ${seriesClass('model', m)}" title="${esc(modelName(m))}"></i>`).join('')}</div></td>
        <td>${r.level ? `<span class="pill level">${esc(cap(r.level))}</span>` : '—'}</td>
        <td class="r">${esc(fUsd(r.usd))}</td><td class="r">${r.wallet === 'subscription' ? esc(share) : share}</td></tr>`;
    }).join('');
    return `<section class="card c8">
      <header><h2>${esc(t('overview.sessions_title'))}</h2><a class="small" href="#sessions">${esc(t('overview.all_sessions', { n: res.total.count }))}</a></header>
      <div class="scroll"><table><thead><tr><th>${esc(t('overview.col_session'))}</th><th>${esc(t('overview.col_models'))}</th><th>${esc(t('overview.col_check'))}</th><th class="r">${esc(t('overview.col_cost'))}</th><th class="r">${esc(t('overview.col_week'))}</th></tr></thead><tbody>${body}</tbody></table></div></section>`;
  }

  function kindsCard() {
    const tk = P.tokenKinds(rows);
    const st = P.stats(rows, S.flat.sessions);
    const dollars = tk.usd_known > 0;
    const amount = dollars ? { out: tk.usd_kind.out, cw5: tk.usd_kind.cw5 + tk.usd_kind.cw1h, cr: tk.usd_kind.cr, in: tk.usd_kind.in } : { out: tk.out, cw5: tk.cw5 + tk.cw1h, cr: tk.cr, in: tk.in };
    const whole = dollars ? tk.usd_known : tk.total;
    const kinds = ['out', 'cw5', 'cr', 'in'].map((k) => ({ k, v: amount[k], share: whole ? (amount[k] / whole) * 100 : 0 }));
    const summary = kinds.map((x) => `${t(`overview.kind_${x.k}`)} ${fPct(x.share, 0)}`).join(', ');
    const items = kinds.map((x) => ({ name: t(`overview.kind_${x.k}`), cls: seriesClass('kind', x.k), value: dollars ? fUsd(x.v) : fTok(x.v), pct: fPct(x.share, 0), note: t(`overview.kind_note_${x.k}`) }));
    // A cent of difference is rounding, not missing detail.
    const partial = dollars && total - tk.usd_known > 0.01
      ? `<div class="small muted">${esc(t('overview.kinds_partial', { missing: fUsd(total - tk.usd_known), total: fUsd(total) }))}</div>` : '';
    return `<section class="card c4">
      <header><h2>${esc(t(dollars ? 'overview.kinds_usd_title' : 'overview.kinds_title'))}</h2></header>
      ${app.stack(kinds.map((x) => ({ cls: seriesClass('kind', x.k), share: x.share })), summary)}
      ${app.bars(items)}
      ${partial}
      ${st.cache_share != null ? `<div class="small muted" style="margin-top:auto">${esc(t('overview.cache_note', { pct: fPct(st.cache_share * 100, 0) }))}</div>` : ''}</section>`;
  }

  const html = rows.length
    ? `<div class="grid">${allApi ? '' : limitCard()}${spentCard()}${dailyCard()}${whereCard()}${sessionsCard()}${kindsCard()}</div>`
    : `<div class="grid">${allApi ? '' : limitCard()}<div class="empty c12">${esc(t('empty.filtered'))}</div></div>`;

  return {
    html,
    bind() {
      app.on('click', 'button.colm[data-pick]', (el) => {
        const day = el.dataset.pick;
        app.drill(t('dim.day'), fDay(day), [...new Set(rows.filter((r) => r.date === day).map((r) => r.session))]);
      });
      app.on('click', 'button[data-dim]', (el) => {
        S.ov.dim = el.dataset.dim;
        app.store.set('ov', S.ov);
        app.rerender();
        app.restoreFocus(`ovDim_${S.ov.dim}`);
      });
      app.on('click', 'button.name[data-pick]', (el) => {
        const key = el.dataset.pick;
        app.drill(t(`dim.${dim}`), dimLabel(dim, key), [...new Set(rows.filter((r) => P.group([r], dim)[0].key === key).map((r) => r.session))]);
      });
      app.on('click', 'tr[data-key]', (el, e) => { if (!e.target.closest('a')) app.navigate('session', el.dataset.key); });
    },
  };
};
