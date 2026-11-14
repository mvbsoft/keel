'use strict';
// One session: the header and tiles, what each of your messages cost (each opens to what was done after it),
// who cost how much, who worked when, keel's verification with the tools, the participants and the cache.
// Texts: i18n keys `sp.*`, `keel.*`, `cache.*`.
window.KeelViews = window.KeelViews || {};
window.KeelViews.session = (app, route) => {
  const { state: S, t, P, esc, nf, fUsd, fPct, fTok, fDur, fInt, toMs, fHM, fDate, walletChip, cap, modelName, uniq, seriesClass } = app;
  const bind = () => app.on('click', '#spBack', (el, e) => { if (S.lastTab && history.length > 1) { e.preventDefault(); history.back(); } });
  const back = `<a class="small row sp-back" id="spBack" href="#sessions"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"></path></svg>${esc(t('sp.all_sessions'))}</a>`;
  const s = S.flat.sessions.find((x) => x.key === route.key);
  if (!s) return { html: `${back}<div class="empty">${esc(t('sp.not_found'))}</div>`, bind, period: false };

  const sp = P.sessionPage(s);
  const title = (s.keel && s.keel.task) || s.project || t('common.unknown');
  const startMs = toMs(sp.span.start); const endMs = toMs(sp.span.end);
  const fr5 = app.fiveRate();
  const isSub = s.wallet === 'subscription';
  const snaps = S.flat.snapshots.filter((x) => x.session_id === s.id).sort((a, b) => toMs(a.t) - toMs(b.t));
  const acc = (field) => { const v = snaps.filter((x) => typeof x[field] === 'number'); return v.length > 1 ? t('sp.account', { a: nf(v[0][field], 1), b: nf(v[v.length - 1][field], 1) }) : ''; };
  const lines = (...parts) => parts.filter(Boolean).map(esc).join('<br>');

  // ---- header and tiles ----
  const level = s.keel && s.keel.level;
  const checkPill = level ? `<span class="pill level">${esc(t('sp.check', { level: cap(level) }))}</span>` : `<span class="pill">${esc(t('sessions.no_check'))}</span>`;
  const meta = [[t('col.project'), s.project || '—'], [t('sp.branch'), s.branch || '—', 'mono'], [t('sp.pc'), s.pc], [t('sp.user'), s.user || '—'], [t('sp.entrypoint'), s.entrypoint || '—']]
    .map(([k, v, cls]) => `<span>${esc(k)} <b${cls ? ` class="${cls}"` : ''}>${esc(v)}</b></span>`).join('')
    + `<span>${esc(`${fDate(s.start || s.date)}, ${fHM(s.start)} – ${fHM(s.end)}`)}</span><span>${esc(t('sp.wallet'))} ${walletChip(s.wallet)}</span>`;
  const agentRequests = sp.participants.filter((p) => p.kind === 'agent').reduce((a, p) => a + p.requests, 0);
  let weekNote = t('wallet.no_percent');
  const weekPct = app.weekShare(sp.totals.usd, s.wallet);
  if (isSub) weekNote = weekPct != null ? t('sp.of_week', { pct: app.fWeekShare(weekPct) }) : t('tile.no_calibration');
  const tiles = [
    app.tile(t('sp.tile_cost'), fUsd(sp.totals.usd), lines(weekNote, isSub && acc('seven_day'))),
    app.tile(t('sp.tile_time'), fDur(sp.span.minutes), esc(t('sp.active_of', { time: fDur(s.active_min) }))),
    app.tile(t('sp.tile_turns'), fInt(sp.totals.turns), sp.totals.turns ? esc(t('sp.per_message', { usd: fUsd(sp.totals.usd / sp.totals.turns) })) : ''),
    app.tile(t('sp.tile_requests'), fInt(sp.totals.requests), agentRequests ? esc(t('sp.requests_agents', { n: fInt(agentRequests) })) : ''),
    app.tile(t('sp.tile_tokens'), fTok(sp.cache.tokens), sp.cache.cache_share != null ? esc(t('sp.tile_cache', { pct: nf(sp.cache.cache_share * 100, 0) })) : ''),
    isSub && fr5 ? app.tile(t('sp.tile_five_hour'), `≈ ${fPct(sp.totals.usd / fr5, 1)}`, lines(t('sp.five_added'), acc('five_hour'))) : '',
  ].join('');

  // ---- what each of your messages cost ----
  // sp.turns follows s.turns one to one; the per-message details exist only in the raw turn.
  const raw = s.turns || [];
  const plain = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
  const hasDetails = raw.some((x) => plain(x.tok));
  const maxTurn = Math.max(0, ...sp.turns.map((x) => x.usd));
  const pills = (counts) => Object.entries(counts).map(([k, n]) => `<span class="pill">${esc(k === 'other' ? t('sp.d_other') : k)} <b class="num">${esc(fInt(n))}</b></span>`).join('');
  function details(x, d) {
    const toolCounts = plain(d.tools); const agentCounts = plain(d.agent_types); const tok = plain(d.tok);
    const kinds = [['out', t('tok.out'), tok.out], ['cw5', t('sp.kind_cw'), (Number(tok.cw5) || 0) + (Number(tok.cw1h) || 0)], ['cr', t('tok.cr'), tok.cr], ['in', t('tok.in'), tok.in]]
      .map(([k, label, v]) => ({ k, label, v: Number(v) || 0 }));
    const total = kinds.reduce((a, x2) => a + x2.v, 0);
    const spentByAgents = Number(d.usd_agents) > 0 && x.usd > 0 ? t('sp.d_agents_cost', { usd: fUsd(d.usd_agents), pct: fPct((d.usd_agents / x.usd) * 100, 0) }) : '';
    return `<div class="md-body">
      ${toolCounts && Object.keys(toolCounts).length ? `<div class="col"><span class="lbl">${esc(t('sp.d_tools'))}</span><div class="row">${pills(toolCounts)}</div></div>` : ''}
      ${agentCounts && Object.keys(agentCounts).length ? `<div class="col"><span class="lbl">${esc(t('sp.d_agents'))}</span><div class="row">${pills(agentCounts)}</div>${spentByAgents ? `<span class="small muted">${esc(spentByAgents)}</span>` : ''}</div>` : ''}
      <div class="col"><span class="lbl">${esc(t('sp.d_tokens'))}</span>
        ${app.stack(kinds.map((x2) => ({ cls: seriesClass('kind', x2.k), share: total ? (x2.v / total) * 100 : 0 })), kinds.map((x2) => `${x2.label} ${fTok(x2.v)}`).join(', '))}
        <div class="row small">${kinds.map((x2) => `<span class="row md-kind"><i class="dot ${seriesClass('kind', x2.k)}"></i>${esc(x2.label)} <b class="num">${esc(fTok(x2.v))}</b></span>`).join('')}</div></div>
      ${Number(d.ctx_max) > 0 ? `<span class="small muted">${esc(t('sp.d_ctx', { tokens: fTok(d.ctx_max) }))}</span>` : ''}</div>`;
  }
  function turnRow(x, i) {
    const d = raw[i] || {};
    const types = plain(d.agent_types);
    let note = t('sp.main_only');
    if (x.agents) note = types ? t('sp.agents_note', { n: fInt(x.agents), types: Object.keys(types).map((k) => (k === 'other' ? t('sp.d_other') : k)).join(', ') }) : t('sp.agents_count', { n: fInt(x.agents) });
    const text = x.text ? esc(x.text) : `<span class="muted">${esc(x.t ? t('sp.no_preview') : t('sp.lead_turn'))}</span>`;
    const open = plain(d.tok);
    const chev = open ? '<svg class="ic md-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"></path></svg>' : '<span></span>';
    const line = `${chev}<span class="num small muted">${esc(x.t ? fHM(x.t) : '—')}</span><span class="md-text">${text}</span><span class="num md-cost">${esc(fUsd(x.usd))}</span>
      <span class="md-note small muted"><span class="meter thin" aria-hidden="true"><i style="width:${maxTurn ? Math.max(2, (x.usd / maxTurn) * 100).toFixed(1) : 0}%"></i></span><span>${esc(`${t('sp.requests_n', { n: fInt(x.requests) })} · ${note}`)}</span></span>
      <span class="num small muted md-pct">${esc(fPct(x.share * 100, 0))}</span>`;
    return open ? `<details class="md"><summary class="md-row">${line}</summary>${details(x, d)}</details>` : `<div class="md"><div class="md-row">${line}</div></div>`;
  }
  const turns = sp.turns.length
    ? `<div class="md-list">${sp.turns.map(turnRow).join('')}</div>${hasDetails ? '' : `<span class="small muted">${esc(t('sp.no_details'))}</span>`}`
    : '<p class="muted">—</p>';
  const turnsCard = `<section class="card c7"><header><h2>${esc(t('sp.turns'))}</h2><span class="hint">${esc(t('sp.turns_hint'))}</span></header>${turns}</section>`;

  // ---- who cost how much, who worked when ----
  const cnt = {}; const seen = {};
  sp.participants.forEach((p) => { cnt[p.label] = (cnt[p.label] || 0) + 1; });
  const labels = sp.participants.map((p) => { seen[p.label] = (seen[p.label] || 0) + 1; const b = p.kind === 'main' ? t('participant.main') : p.label; return cnt[p.label] > 1 && p.kind !== 'main' ? `${b} #${seen[p.label]}` : b; });
  const maxPart = Math.max(0, ...sp.participants.map((p) => p.usd));
  const mainShare = sp.participants.filter((p) => p.kind === 'main').reduce((a, p) => a + p.share, 0);
  const whoCard = `<section class="card c5"><header><h2>${esc(t('sp.who'))}</h2></header>
    ${app.bars(sp.participants.map((p, i) => ({ name: `${labels[i]} · ${modelName(p.family)}`, cls: seriesClass('model', p.family), value: fUsd(p.usd), pct: fPct(p.share * 100, 0), width: maxPart ? (p.usd / maxPart) * 100 : 0 })))}
    <div class="facts" style="margin-top:auto">
      <div class="col"><span class="lbl">${esc(t('sp.who_main'))}</span><span class="mid">${esc(fPct(mainShare * 100, 0))}</span></div>
      <div class="col"><span class="lbl">${esc(t('sp.who_agents'))}</span><span class="mid">${esc(fPct((1 - mainShare) * 100, 0))}</span></div>
      <div class="col"><span class="lbl">${esc(t('sp.who_launched'))}</span><span class="mid">${esc(fInt(sp.totals.agents))}</span></div>
    </div></section>`;
  const laneRows = sp.lanes.map((ln, i) => `<div class="lane"><span class="k" title="${esc(labels[i])}">${esc(labels[i])}</span><span class="track"><i class="bit ${seriesClass('model', ln.model)}${ln.resumed ? ' resumed' : ''}" style="left:${ln.left_pct}%;width:${Math.max(0.8, ln.width_pct)}%" title="${esc(`${labels[i]} · ${modelName(ln.model)} · ${fHM(ln.start)}–${fHM(ln.end)}`)}"></i></span></div>`).join('');
  const ticks = Number.isFinite(startMs) && Number.isFinite(endMs) ? [0, 0.25, 0.5, 0.75, 1].map((f) => `<span>${esc(fHM(startMs + (endMs - startMs) * f))}</span>`).join('') : '';
  const legend = app.legend(uniq(sp.participants.map((p) => p.family)).map((m) => ({ cls: seriesClass('model', m), label: modelName(m) })));
  const lanesCard = `<section class="card c7"><header><h2>${esc(t('sp.timeline'))}</h2>${Number.isFinite(startMs) ? `<span class="hint">${esc(`${fHM(startMs)} – ${fHM(endMs)}`)}</span>` : ''}</header>
    <div class="lanes">${laneRows}<div class="xaxis" aria-hidden="true">${ticks}</div></div>${legend}</section>`;

  // ---- keel's verification and the tools ----
  const topTools = sp.tools.slice(0, 12);
  const toolPills = topTools.length ? `<div class="row">${topTools.map((x) => `<span class="pill">${esc(x.name)} <b class="num">${esc(fInt(x.n))}</b></span>`).join('')}</div>` : '<p class="muted">—</p>';
  let sideCard;
  if (s.keel) {
    const k = s.keel; const f = k.findings || {};
    const gates = k.gates == null ? '—' : typeof k.gates === 'string' ? k.gates : Object.entries(k.gates).map(([a, b]) => `${a}: ${b}`).join(', ');
    const steps = Array.isArray(k.steps) && k.steps.length ? `${k.steps.length} (${k.steps.map((x) => x.model || '?').join(', ')})` : '—';
    const found = ['must', 'should', 'nice'].map((n) => `<div class="col"><span class="lbl">${esc(cap(t(`keel.${n}`)))}</span><span class="mid">${esc(fInt(f[n]))}</span></div>`).join('');
    const kv = [[t('keel.gates'), gates], [t('keel.lines'), k.lines ? `+${k.lines.add || 0} / −${k.lines.del || 0}` : '—'], [t('keel.files'), k.files != null ? k.files : '—'], [t('keel.steps'), steps]]
      .map(([a, b]) => `<div class="row spread"><span class="muted">${esc(a)}</span><span>${esc(b)}</span></div>`).join('');
    sideCard = `<section class="card c5"><header><h2>${esc(t('sp.keel'))}</h2></header>
      <div class="facts plain">${found}</div>
      <div class="col sp-rows">${kv}</div>
      <div class="col sp-rows"><span class="lbl">${esc(t('sp.tools'))}</span>${toolPills}</div></section>`;
  } else sideCard = `<section class="card c5"><header><h2>${esc(t('sp.tools'))}</h2></header>${toolPills}</section>`;

  // ---- participants and the cache ----
  const PL = { participant: t('col.participant'), model: t('col.model'), time: t('measure_short.time_min'), active: t('col.active'), req: t('col.requests') };
  const TK = ['in', 'cw5', 'cw1h', 'cr', 'out'];
  const pRows = sp.participants.map((p, i) => {
    const min = Number.isFinite(toMs(p.end)) && Number.isFinite(toMs(p.start)) ? (toMs(p.end) - toMs(p.start)) / 60000 : 0;
    return `<tr><td>${esc(labels[i])}${p.resumed ? ` <span class="pill wait">${esc(t('sp.resumed'))}</span>` : ''}${p.output_estimated ? ` <span class="pill">${esc(t('sp.estimated'))}</span>` : ''}</td>
      <td><span class="nowrap"><i class="dot ${seriesClass('model', p.family)}"></i> ${esc(modelName(p.family))}</span></td>
      <td class="r">${esc(fDur(min))}</td><td class="r">${esc(fDur(p.active_min))}</td><td class="r">${esc(fInt(p.requests))}</td>
      ${TK.map((k) => `<td class="r">${esc(fTok(p.tok[k]))}</td>`).join('')}
      <td class="r">${esc(fUsd(p.usd))}</td><td class="r">${esc(fPct(p.share * 100, 0))}</td></tr>`;
  }).join('');
  const pt = sp.participants.reduce((a, p) => { for (const k in p.tok) a[k] = (a[k] || 0) + p.tok[k]; return a; }, {});
  const pTotal = `<tr><td>${esc(t('common.total'))}</td><td></td><td></td><td class="r">${esc(fDur(s.active_min))}</td><td class="r">${esc(fInt(sp.totals.requests))}</td>${TK.map((k) => `<td class="r">${esc(fTok(pt[k] || 0))}</td>`).join('')}<td class="r">${esc(fUsd(sp.totals.usd))}</td><td class="r">100 %</td></tr>`;
  const pHead = [PL.participant, PL.model].map((h) => `<th scope="col">${esc(h)}</th>`).join('')
    + [PL.time, PL.active, PL.req, ...TK.map((k) => t(`measure_short.tok_${k}`)), '$', t('col.share')].map((h) => `<th scope="col" class="r">${esc(h)}</th>`).join('');
  const participantsCard = `<section class="card c12"><header><h2>${esc(t('sp.participants'))}</h2></header><div class="scroll"><table><thead><tr>${pHead}</tr></thead><tbody>${pRows}</tbody><tfoot>${pTotal}</tfoot></table></div></section>`;
  const c = sp.cache;
  const cacheFacts = [[t('cache.share'), c.cache_share != null ? fPct(c.cache_share * 100, 0) : '—'], [t('cache.read'), fTok(c.cr)], [t('cache.write5'), fTok(c.cw5)], [t('cache.write1h'), fTok(c.cw1h)],
    [`${t('tok.in')} / ${t('tok.out')}`, `${fTok(c.in)} / ${fTok(c.out)}`]]
    .map(([k, v]) => `<div class="col"><span class="lbl">${esc(k)}</span><span class="mid">${esc(v)}</span></div>`).join('');
  const cacheCard = `<section class="card c12"><header><h2>${esc(t('sp.cache'))}</h2></header><div class="facts plain wide">${cacheFacts}</div></section>`;

  const html = `<div class="grid">
    <section class="card c12 sp-head">${back}
      <div class="row spread"><h1 class="ft">${esc(title)}</h1>${checkPill}</div>
      <div class="row small muted sp-meta">${meta}</div></section>
    <div class="tiles c12">${tiles}</div>
    ${turnsCard}${whoCard}${lanesCard}${sideCard}${participantsCard}${cacheCard}</div>`;
  return { html, bind, period: false };
};
