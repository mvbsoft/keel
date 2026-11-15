'use strict';
// Plan limit: what 1 % of the plan costs in dollars, how it is counted, this week's limit, the PCs that
// have synced and the measurements behind the figure. Texts: i18n keys `cal.*`.
window.KeelViews = window.KeelViews || {};
window.KeelViews.limit = (app) => {
  const { state: S, t, P, esc, fin, fUsd, fPct, fPctAuto, toMs, fDT, fHM, fWhen, fSpan, cap, line } = app;
  const FIRST = 5;
  const DAY = 864e5;
  const c = S.calib;
  const pts = c ? [].concat(((c.weekly && c.weekly.points) || []).map((p) => Object.assign({}, p, { kind: 'weekly' })), ((c.five_hour && c.five_hour.points) || []).map((p) => Object.assign({}, p, { kind: 'five_hour' }))) : [];
  const v = P.calibrationView(pts, S.machines.map((m) => ({ pc: m.name || m.pc, synced_until: m.synced_until, last_seen: m.last_seen })), Date.now());
  const waiting = new Set([].concat(v.waiting, (c && c.waiting) || []));
  const wRate = c && c.weekly && fin(c.weekly.rate) ? c.weekly.rate : v.medians.weekly;
  const fRate = c && c.five_hour && fin(c.five_hour.rate) ? c.five_hour.rate : v.medians.five_hour;
  const kept = (kind) => v.rows.filter((r) => r.kind === kind && r.status === 'kept').length;
  const dropped = v.rows.filter((r) => r.status === 'dropped').length;
  const showAll = !!(app.store.get('limit') || {}).all;

  function headCard() {
    const per = (label, value, sub) => `<div class="col"><span class="lbl">${esc(label)}</span><span class="big">${esc(value ? `≈ ${fUsd(value)}` : '—')}</span><span class="small muted">${esc(sub)}</span></div>`;
    const wN = (c && c.weekly && c.weekly.n) || kept('weekly');
    const fN = (c && c.five_hour && c.five_hour.n) || kept('five_hour');
    const apiOnly = S.flat.hours.length > 0 && S.flat.hours.every((h) => h.wallet !== 'subscription');
    return `<section class="card c12 limit-head">
      <div class="col">
        <h1 class="ft">${esc(t('cal.title'))}</h1>
        <p class="muted">${esc(t('cal.intro'))}</p>
        ${c ? `<span class="small muted">${esc(t('cal.computed_by', { pc: c.pc, when: fDT(c.computed_at) }))}</span>` : ''}
      </div>
      ${apiOnly ? `<div class="sub small">${esc(t('wallet.no_percent'))}</div>` : ''}
      <div class="facts">
        ${per(t('cal.per_pct_weekly'), wRate, wRate ? t('cal.median_n', { n: wN }) : t('cal.none'))}
        ${per(t('cal.per_pct_five'), fRate, fRate ? t('cal.median_n', { n: fN }) : t('cal.none'))}
        ${per(t('cal.whole_week'), wRate ? wRate * 100 : null, wRate ? t('cal.whole_note') : t('cal.none'))}
      </div></section>`;
  }

  const steps = [1, 2, 3].map((n) => `<section class="card c4"><span class="mid step-n">${n}</span><h2>${esc(t(`cal.step${n}_title`))}</h2><p class="muted">${esc(t(`cal.step${n}_text`))}</p></section>`).join('');

  function weekCard() {
    const L = app.limitInfo();
    const end = Number.isFinite(L.wReset) ? L.wReset : Date.now();
    const snaps = L.w && !L.wStale
      ? S.flat.snapshots.filter((s) => typeof s.seven_day === 'number' && toMs(s.t) >= L.weekStart && toMs(s.t) <= end).sort((a, b) => toMs(a.t) - toMs(b.t))
      : [];
    const head = (hint) => `<header><h2>${esc(t('cal.week_title'))}</h2>${hint ? `<span class="hint">${esc(hint)}</span>` : ''}</header>`;
    if (!snaps.length) return `<section class="card c8">${head('')}<p class="muted">${esc(L.w ? t('tile.stale') : t('tile.no_limits'))}</p></section>`;
    const last = snaps[snaps.length - 1].seven_day;
    const loc = app.lang() === 'uk' ? 'uk-UA' : 'en-GB';
    const dayLabel = (ms) => new Intl.DateTimeFormat(loc, { weekday: 'short', day: '2-digit', month: '2-digit' }).format(new Date(ms));
    const chart = line({
      series: [{ pts: snaps.map((s) => ({ x: toMs(s.t), y: s.seven_day })), area: true, dot: true, label: t('cal.now', { pct: fPctAuto(last) }) }],
      xMin: L.weekStart, xMax: end, yMax: Math.max(...snaps.map((s) => s.seven_day)), fmtY: fPctAuto,
      xTicks: [0, 2, 4, 6].map((k) => ({ x: L.weekStart + k * DAY, label: dayLabel(L.weekStart + k * DAY) })),
      summary: t('cal.chart_summary', { pct: fPctAuto(last) }),
    });
    const resets = Number.isFinite(L.wReset)
      ? `${esc(t('cal.resets', { when: fWhen(L.wReset) }))} · <span class="muted">${esc(t('cal.in', { span: fSpan(L.wReset - Date.now()) }))}</span>`
      : '';
    const via = L.rate ? `<span class="muted">${esc(t('cal.via_keel', { pct: fPctAuto(last), via: fPctAuto(L.weekUsd / L.rate) }))}</span>` : '';
    return `<section class="card c8">${head(`${fDT(L.weekStart)} – ${fDT(end)}`)}${chart}<div class="row spread small"><span>${resets}</span>${via}</div></section>`;
  }

  function machinesCard() {
    const cards = v.machines.map((m) => {
      const state = waiting.has(m.pc)
        ? `<span class="pill wait st">${esc(t('cal.waiting_for', { pc: m.pc }))}</span>`
        : `<span class="pill good st">${esc(t('cal.synced'))}</span>`;
      const meta = [t('cal.sent', { when: fDT(m.synced_until) })].concat(m.last_seen ? [t('cal.seen', { when: fDT(m.last_seen) })] : []).join(' · ');
      return `<div class="sub"><div class="row spread"><b>${esc(m.pc)}</b>${state}</div><span class="small muted">${esc(meta)}</span></div>`;
    }).join('');
    const mono = (s) => `<span class="mono">${s}</span>`;
    // The texts are the page's own and the commands constants, so the markup goes in unescaped.
    const note = t('cal.sync_note', { task: mono('/keel:end-task'), session: mono('/keel:end-session'), off: mono('/keel:usage off') });
    return `<section class="card c4"><header><h2>${esc(t('cal.machines'))}</h2></header>
      ${cards ? `<div class="machines">${cards}</div>` : '<p class="muted">—</p>'}
      <p class="small muted limit-note">${note}</p></section>`;
  }

  function pointsCard() {
    if (v.empty) return `<section class="card c12"><header><h2>${esc(t('cal.points'))}</h2></header><div class="empty"><h2>${esc(cap(t('cal.none')))}</h2><p>${esc(t('cal.none_hint'))}</p></div></section>`;
    const STATUS = { kept: 'good', dropped: 'risk', pending: 'wait' };
    const win = (r) => { const a = toMs(r.from); const b = toMs(r.to); return new Date(a).toDateString() === new Date(b).toDateString() ? `${fDT(a)} – ${fHM(b)}` : `${fDT(a)} – ${fDT(b)}`; };
    const shown = showAll ? v.rows : v.rows.slice(0, FIRST);
    const head = [t('cal.col_window'), t('cal.kind'), t('cal.col_gain'), t('cal.col_usd'), t('cal.col_rate'), t('cal.col_status')];
    const body = shown.map((r) => `<tr><td>${esc(win(r))}</td><td>${esc(t(`cal.kind_${r.kind}`))}</td>
      <td class="r">${esc(fPct(Number(r.gain) || 0, 1))}</td><td class="r">${esc(fUsd(r.usd))}</td><td class="r">${esc(r.rate > 0 ? fUsd(r.rate) : '—')}</td>
      <td><div class="row"><span class="pill ${STATUS[r.status]} st">${esc(t(`cal.${r.status}`))}</span>${r.reason && r.status !== 'kept' ? `<span class="small muted">${esc(t(`cal.reason.${r.reason}`))}</span>` : ''}</div></td></tr>`).join('');
    const hint = [t('cal.hint', { shown: shown.length, total: v.rows.length, weekly: kept('weekly'), five: kept('five_hour') })].concat(dropped ? [t('cal.hint_dropped', { n: dropped })] : []).join(' · ');
    const toggle = v.rows.length > FIRST
      ? `<button type="button" class="btn" id="limAll" data-all="1">${esc(showAll ? t('cal.show_less') : t('cal.show_all', { n: v.rows.length }))}</button>`
      : '';
    return `<section class="card c12"><header><h2>${esc(t('cal.points'))}</h2><span class="hint">${esc(hint)}</span></header>
      <div class="scroll"><table><thead><tr>${head.map((h, i) => `<th scope="col"${i > 1 && i < 5 ? ' class="r"' : ''}>${esc(h)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>
      <div class="row spread small"><span class="muted">${esc(t('cal.dropped_note'))}</span>${toggle}</div></section>`;
  }

  return {
    html: `<div class="grid">${headCard()}${steps}${weekCard()}${machinesCard()}${pointsCard()}</div>`,
    period: false,
    bind() {
      app.on('click', 'button[data-all]', () => {
        app.store.set('limit', { all: !showAll });
        app.rerender();
        app.restoreFocus('limAll');
      });
    },
  };
};
