/* Dashboard - same 8 pages, slicers, measures and rules as the Power BI report "UTY Development Dashboard". */
(() => {
  const U = UTY, C = U.C;
  const T = U.todayN();
  const app = U.$('#app');

  const PAGES = [
    ['overview', 'Development Overview', 'UTY Industrial development lines | LR2 > FLC > SMS > CFM > Buy Ready'],
    ['flow', 'Model & Material Flow', 'Stage total = all lines at the stage (active + dropped) | CFM = active SMS lines'],
    ['sankey', 'Model Stage Flow', 'How each model moves LR2 → FLC → SMS → CFM in every season | band width = development lines (Dev codes)'],
    ['milestones', 'Milestone Tracking', 'Plan vs actual for active lines | Overdue = plan date passed and no actual date'],
    ['xfd', 'XFD & Shipment Performance', 'On time = Latest XFD - Latest HQ XFD <= 2 days | dropped lines are left out'],
    ['fit', 'Fit Test (K1 - K4)', 'First-round and re-fit results by K stage'],
    ['readiness', 'Material & Tooling Readiness', 'TP/CAD, material, pattern, tooling and mold milestones for active lines'],
    ['drop', 'Drop & Change Analysis', 'Dropped lines by reason, season, stage and model | reasons grouped from Remarks'],
    ['lines', 'Line Detail', 'Every development line with its latest status | filter with the slicers or search a Dev Code'],
  ];
  const SLICERS = [
    ['season', 'Season'], ['stage', 'Stage'], ['factory', 'Factory'],
    ['model', 'Model'], ['matType', 'Material Type'], ['status', 'Status'],
  ];
  const STAGES = ['LR2', 'FLC', 'SMS'];
  const MAT_COLOR = { TN: C.series[0], NU: C.series[1], CONC: C.series[2], CONM: C.series[3] };
  const STATUS_COLOR = { Active: C.series[0], Dropped: C.series[1] };
  const MS_STATUS = [
    ['Done', C.good, m => m.status === 'Done' || m.status === 'Existing'],
    ['Due (not late)', C.P[6], m => m.status === 'Open' && m.planN >= T],
    ['Overdue', C.bad, m => m.status === 'Open' && m.planN < T],
    ['TBD', C.neutral, m => m.status === 'TBD'],
  ];
  const GAP_BUCKETS = ['On / ahead of plan', '1-2 days late', '3-7 days late', '8-14 days late', 'Over 14 days late'];

  let DATA = null, ALL = [];
  const sel = Object.fromEntries(SLICERS.map(([k]) => [k, new Set(U.store.get(`dash.${k}`, []))]));
  let page = (location.hash.slice(1) && PAGES.some(p => p[0] === location.hash.slice(1))) ? location.hash.slice(1) : U.store.get('dash.page', 'overview');
  let lineSearch = '';

  // ---------------------------------------------------------------- helpers
  const isA = l => l.status === 'Active';
  const lineCols = () => [
    { key: 'devCode', label: 'Dev Code', get: r => (r.line || r).devCode },
    { key: 'season', label: 'Season', get: r => (r.line || r).season, sort: r => (r.line || r).seasonSort },
    { key: 'stage', label: 'Stage', get: r => (r.line || r).stage, sort: r => (r.line || r).stageSort },
    { key: 'factory', label: 'Factory', get: r => (r.line || r).factory },
    { key: 'variant', label: 'Model', get: r => (r.line || r).variant },
    { key: 'colorway', label: 'Colorway', get: r => (r.line || r).colorway },
  ];
  const filtered = () => ALL.filter(l => SLICERS.every(([k]) => sel[k].size === 0 || sel[k].has(l[k])));
  const milestonesOf = ls => ls.flatMap(l => l.milestones);
  const byCount = m => [...m.entries()].sort((a, b) => b[1] - a[1]);
  const distinct = (rows, f) => new Set(rows.map(f).filter(v => v != null)).size;
  const seasonOrder = ls => U.uniq(ls.map(l => l.season), (a, b) => ALL.find(l => l.season === a).seasonSort - ALL.find(l => l.season === b).seasonSort);

  function toggleFilter(key, value) {
    if (value == null) return;
    if (sel[key].size === 1 && sel[key].has(value)) sel[key].clear(); else { sel[key].clear(); sel[key].add(value); }
    saveSel(); renderAll();
  }
  const saveSel = () => SLICERS.forEach(([k]) => U.store.set(`dash.${k}`, [...sel[k]]));

  // shared measures for the current filter
  function measures(ls) {
    const act = ls.filter(isA);
    const msA = milestonesOf(act);
    const evalL = ls.filter(l => l.onTime != null);
    const on = evalL.filter(l => l.onTime === 1).length;
    const overdue = msA.filter(m => m.status === 'Open' && m.planN < T);
    return {
      total: ls.length, active: act.length, dropped: ls.length - act.length,
      dropRate: U.div(ls.length - act.length, ls.length),
      cfmApproved: act.filter(l => l.cfmStatus === 'Approved').length,
      buyReady: act.filter(l => l.buyReady).length,
      xfdEval: evalL.length, xfdOn: on, xfdLate: evalL.length - on, xfdPct: U.div(on, evalL.length),
      avgGap: U.avg(act.filter(l => l.gap != null).map(l => l.gap)),
      shipped: act.filter(l => l.shipped).length,
      msA, overdue,
    };
  }

  // ---------------------------------------------------------------- model stage flow (Sankey)
  const STEPS = ['LR2', 'FLC', 'SMS', 'CFM'];
  const DROP_COL = '#9fb0bd', ADD_COL = C.P[8];
  const filteredExcept = skip => ALL.filter(l => SLICERS.every(([k]) => skip.includes(k) || sel[k].size === 0 || sel[k].has(l[k])));

  /* One season: follow each Dev Code through LR2 -> FLC -> SMS (-> CFM when active at SMS). */
  function seasonFlow(rows) {
    const codes = new Map();
    rows.forEach(l => {
      const c = codes.get(l.devCode) || { model: l.model || '(no model)', st: {} };
      c.st[l.stage] = l.status;
      codes.set(l.devCode, c);
    });
    const list = [...codes.values()];
    const ranked = byCount(U.count(list, c => c.model)).map(x => x[0]);
    const top = ranked.slice(0, ranked.length > 9 ? 8 : 9);
    const grp = m => (top.includes(m) ? m : 'Other models');
    const color = g => (g === 'Other models' ? C.gray : C.series[top.indexOf(g)]);
    const groups = [...top, ...(ranked.length > top.length ? ['Other models'] : [])];

    const nodes = [], links = new Map(), size = new Map();
    const bump = (id, n = 1) => size.set(id, (size.get(id) || 0) + n);
    groups.forEach((g, gi) => STEPS.forEach((s, si) => nodes.push({ id: `${g}|${s}`, col: si, label: g, color: color(g), order: gi, group: g })));
    for (let i = 1; i < STEPS.length; i++) nodes.push({ id: `drop|${i}`, col: i, label: `Dropped at ${STEPS[i - 1]}`, color: DROP_COL, order: 900 });
    for (let i = 0; i < 2; i++) nodes.push({ id: `add|${i}`, col: i, label: `Added at ${STEPS[i + 1]}`, color: ADD_COL, order: 950 });
    const link = (source, target, g, kind) => {
      const k = `${source}>${target}`;
      const l = links.get(k) || { source, target, value: 0, group: g, kind, color: kind === 'drop' ? DROP_COL : color(g) };
      l.value += 1; links.set(k, l);
    };
    const m = { codes: list.length, lr2: 0, flc: 0, sms: 0, cfm: 0, lr2flc: 0, flcsms: 0, addFlc: 0, addSms: 0, dropped: 0, models: ranked.length };
    list.forEach(c => {
      const g = grp(c.model);
      const present = STEPS.slice(0, 3).filter(s => c.st[s]);
      if (!present.length) return;
      present.forEach(s => { m[s.toLowerCase()] += 1; bump(`${g}|${s}`); });
      if (c.st.LR2 && c.st.FLC) m.lr2flc += 1;
      if (c.st.FLC && c.st.SMS) m.flcsms += 1;
      const fi = STEPS.indexOf(present[0]);
      if (fi > 0) { link(`add|${fi - 1}`, `${g}|${present[0]}`, g, 'add'); m[fi === 1 ? 'addFlc' : 'addSms'] += 1; }
      for (let j = 0; j < present.length; j++) {
        const s = present[j], si = STEPS.indexOf(s);
        if (c.st[s] === 'Dropped') { link(`${g}|${s}`, `drop|${si + 1}`, g, 'drop'); m.dropped += 1; break; }
        if (present[j + 1]) link(`${g}|${s}`, `${g}|${present[j + 1]}`, g, 'carry');
        else if (s === 'SMS') { link(`${g}|SMS`, `${g}|CFM`, g, 'carry'); m.cfm += 1; bump(`${g}|CFM`); }
      }
    });
    nodes.forEach(n => {
      n.value = size.get(n.id) || 0;
      if (n.group) {
        const out = [...links.values()].filter(l => l.source === n.id);
        const dropped = U.sum(out.filter(l => l.kind === 'drop'), l => l.value), carried = U.sum(out.filter(l => l.kind === 'carry'), l => l.value);
        const step = STEPS[n.col];
        n.tip = `<b>${U.esc(n.group)} · ${step}</b>${U.int(n.value)} line${n.value === 1 ? '' : 's'}`
          + (step !== 'CFM' ? `<br><span class="muted">→ next stage ${U.int(carried)} · dropped ${U.int(dropped)}${n.value - carried - dropped > 0 ? ` · still at ${step} ${U.int(n.value - carried - dropped)}` : ''}</span>` : '');
      }
    });
    const L = [...links.values()];
    L.forEach(l => {
      const s = nodes.find(n => n.id === l.source), t = nodes.find(n => n.id === l.target);
      l.tip = `<b>${U.esc(l.group)}</b>${U.esc(s.group ? STEPS[s.col] : s.label)} → ${U.esc(t.group ? STEPS[t.col] : t.label)}: ${U.int(l.value)} line${l.value === 1 ? '' : 's'}`;
    });
    const maxCol = Math.max(...STEPS.map((s, i) => nodes.filter(n => n.col === i && n.value + U.sum(L.filter(l => l.target === n.id), l => l.value) > 0).length));
    return { m, top, chart: { columns: STEPS, nodes, links: L, height: Math.max(280, Math.min(560, maxCol * 30 + 60)) } };
  }

  // ---------------------------------------------------------------- page chrome
  function shell() {
    const p = PAGES.find(x => x[0] === page);
    app.innerHTML = `
      <div class="page-head">
        <div><h1>${U.esc(p[1])}</h1><div class="sub">${U.esc(p[2])}</div></div>
        <div class="refresh">Data refreshed <b>${U.esc((DATA.loadedAt || '').replace('T', ' ').slice(0, 16))}</b><br>
          Report week <b>${U.esc(DATA.reportWeek || '–')}</b> · source saved ${U.esc((DATA.fileTime || '').replace('T', ' '))}</div>
      </div>
      ${U.errorBox(DATA.errors)}
      <div class="slicers" id="slicers"></div>
      <div id="body"></div>
      <nav class="pagetabs">${PAGES.map(([k, t]) => `<button data-p="${k}" class="${k === page ? 'active' : ''}">${U.esc(t)}</button>`).join('')}</nav>`;
    app.querySelectorAll('.pagetabs button').forEach(b => b.addEventListener('click', () => {
      page = b.dataset.p; U.store.set('dash.page', page); history.replaceState(null, '', `#${page}`); renderAll();
      window.scrollTo(0, 0);
    }));
    const box = U.$('#slicers');
    const opts = {
      season: seasonOrder(ALL),
      stage: STAGES.filter(s => ALL.some(l => l.stage === s)),
      factory: U.uniq(ALL.map(l => l.factory)),
      model: U.uniq(ALL.map(l => l.model)),
      matType: U.uniq(ALL.map(l => l.matType)),
      status: ['Active', 'Dropped'],
    };
    SLICERS.forEach(([k, label]) => box.appendChild(U.slicer(label, opts[k], sel[k], () => { saveSel(); renderBody(); })));
    const b = document.createElement('button');
    b.className = 'clear-filters'; b.textContent = 'Clear all filters';
    b.onclick = () => { SLICERS.forEach(([k]) => sel[k].clear()); saveSel(); renderAll(); };
    box.appendChild(b);
  }

  const card = (id, title, opts = {}) => `<div class="card ${opts.cls || ''}"><h3>${U.esc(title)}</h3>
    ${opts.table ? `<div id="${id}"></div>` : `<div class="${opts.scroll ? 'scroll-y' : ''}"><div class="chart-box ${opts.tall ? 'tall' : ''}" id="${id}"></div></div>`}
    ${opts.note ? `<div class="note">${U.esc(opts.note)}</div>` : ''}</div>`;

  function renderAll() { shell(); renderBody(); }

  function renderBody() {
    U.destroyCharts();
    const body = U.$('#body');
    const ls = filtered();
    const M = measures(ls);
    RENDER[page](body, ls, M);
    U.$('.clear-filters').style.visibility = SLICERS.some(([k]) => sel[k].size) ? 'visible' : 'hidden';
  }

  // milestone status stacked bar (shared by overview, milestones, readiness)
  function msStatusChart(id, ms, names, showLabels) {
    U.bar(U.$(`#${id}`), {
      labels: names, horizontal: true, stacked: true, showLabels,
      series: MS_STATUS.map(([label, color, f]) => ({ label, color, data: names.map(n => ms.filter(m => m.name === n && f(m)).length) })),
    });
  }
  const MS_NAMES = ['TP/CAD received', 'Material arrival', 'Pattern lock', 'Tooling lock', 'Mold finished', 'XFD', 'CFM sample',
    'BOM upload', 'K1 ship', 'K2 ship', 'K3 ship', 'K4 ship'];

  // ---------------------------------------------------------------- pages
  const RENDER = {
    overview(body, ls, M) {
      body.innerHTML = `<div id="k"></div>
        <div class="grid g3">${card('c1', 'Lines by stage: active vs dropped')}${card('c2', 'Active lines: season x stage', { table: true })}${card('c3', 'Material indicator mix (active lines)')}</div>
        <div class="grid g3">${card('c4', 'Active lines by factory', { scroll: true })}${card('c5', 'Active lines by model', { scroll: true })}${card('c6', 'Milestone status (active lines)', { scroll: true })}</div>`;
      U.kpis(U.$('#k'), [
        { label: 'Total Lines', value: M.total }, { label: 'Active Lines', value: M.active },
        { label: 'Dropped Lines', value: M.dropped }, { label: 'Drop Rate', value: M.dropRate, fmt: 'pct' },
        { label: 'CFM Approved', value: M.cfmApproved }, { label: 'Buy Ready Lines', value: M.buyReady },
        { label: 'XFD On-time %', value: M.xfdPct, fmt: 'pct', help: 'Latest XFD - Latest HQ XFD <= 2 days; dropped lines excluded' },
        { label: 'Milestones Overdue', value: M.overdue.length, cls: M.overdue.length ? 'bad' : '' },
      ]);
      const stages = STAGES.filter(s => ls.some(l => l.stage === s));
      U.bar(U.$('#c1'), {
        labels: stages, stacked: false, onClick: s => toggleFilter('stage', s),
        series: ['Active', 'Dropped'].map(st => ({ label: st, color: STATUS_COLOR[st], data: stages.map(s => ls.filter(l => l.stage === s && l.status === st).length) })),
      });
      const act = ls.filter(isA);
      U.matrix(U.$('#c2'), {
        corner: 'Season', rows: seasonOrder(act), cols: STAGES,
        value: (r, c) => act.filter(l => l.season === r && l.stage === c).length || null,
        total: (r, c) => act.filter(l => (r == null || l.season === r) && (c == null || l.stage === c)).length, heat: true,
      });
      const mats = byCount(U.count(act, l => l.mat));
      U.donut(U.$('#c3'), { labels: mats.map(m => m[0]), data: mats.map(m => m[1]), colors: mats.map(m => MAT_COLOR[m[0]] || C.gray), centerLabel: 'active lines' });
      const fty = byCount(U.count(act, l => l.factory));
      U.bar(U.$('#c4'), { labels: fty.map(f => f[0]), horizontal: true, series: [{ label: 'Active lines', data: fty.map(f => f[1]) }], onClick: f => toggleFilter('factory', f) });
      const mdl = byCount(U.count(act, l => l.model));
      U.bar(U.$('#c5'), { labels: mdl.map(f => f[0]), horizontal: true, series: [{ label: 'Active lines', data: mdl.map(f => f[1]) }], onClick: f => toggleFilter('model', f) });
      msStatusChart('c6', M.msA, MS_NAMES, false);
    },

    flow(body, ls) {
      body.innerHTML = `<div id="k"></div>
        <div class="grid g2">
          ${card('c1', 'Model view: development line count by stage', { table: true, note: 'Stage total = active + dropped lines at the stage. CFM = SMS Total - SMS Dropped (active SMS lines).' })}
          <div>${card('c2', 'Material flow by stage (TN / NU / CONC)')}
            <div class="grid g2" style="margin-top:8px">${card('c3', 'Material flow table', { table: true })}${card('c4', '% of lines by factory', { scroll: true })}</div></div>
        </div>`;
      const st = s => ls.filter(l => l.stage === s);
      const cfm = ls.filter(l => l.stage === 'SMS' && isA(l));
      U.kpis(U.$('#k'), [
        { label: 'LR2 lines', value: st('LR2').length }, { label: 'FLC lines', value: st('FLC').length },
        { label: 'SMS lines', value: st('SMS').length }, { label: 'CFM (SMS active)', value: cfm.length },
        { label: 'Active Models', value: distinct(ls.filter(isA), l => l.model) },
      ]);
      const flow = (step, rows) => (step === 'CFM' ? rows.filter(l => l.stage === 'SMS' && isA(l)) : rows.filter(l => l.stage === step));
      const steps = ['LR2', 'FLC', 'SMS', 'CFM'];
      const models = U.uniq(ls.map(l => l.model));
      const mrows = models.map(m => {
        const r = ls.filter(l => l.model === m);
        return { model: m, LR2: flow('LR2', r).length, FLC: flow('FLC', r).length, SMS: flow('SMS', r).length, CFM: flow('CFM', r).length };
      }).sort((a, b) => b.FLC - a.FLC || a.model.localeCompare(b.model));
      const max = Math.max(0, ...mrows.flatMap(r => steps.map(s => r[s])));
      U.table(U.$('#c1'), {
        rows: mrows, limit: 500, tall: true, csv: 'model_view',
        columns: [{ key: 'model', label: 'Model' }, ...steps.map(s => ({
          key: s, label: s === 'CFM' ? 'CFM' : `${s} Total`, num: true, cls: 'heat',
          html: r => `<span style="display:block;margin:-4px -8px;padding:4px 8px;${U.heat(r[s], max)}">${r[s]}</span>`,
        }))],
        footer: rows => ['Total', ...steps.map(s => U.int(U.sum(rows, r => r[s])))],
      });
      const mats = ['TN', 'NU', 'CONC', 'CONM'].filter(m => ls.some(l => l.mat === m));
      U.bar(U.$('#c2'), {
        labels: steps,
        series: mats.map(m => ({ label: m, color: MAT_COLOR[m], data: steps.map(s => flow(s, ls.filter(l => l.mat === m)).length) })),
      });
      U.matrix(U.$('#c3'), {
        corner: 'Step', rows: steps, cols: mats, heat: true, colTotals: false,
        value: (s, m) => flow(s, ls.filter(l => l.mat === m)).length,
        total: (s, m) => (s == null ? null : flow(s, ls.filter(l => m == null || l.mat === m)).length),
      });
      const fty = byCount(U.count(ls, l => l.factory));
      U.bar(U.$('#c4'), { labels: fty.map(f => f[0]), horizontal: true, fmt: 'pct', series: [{ label: '% of lines', data: fty.map(f => f[1] / ls.length) }], onClick: f => toggleFilter('factory', f) });
    },

    milestones(body, ls, M) {
      body.innerHTML = `<div id="k"></div>
        <div class="grid g2">${card('c1', 'Status by milestone', { scroll: true })}${card('c2', 'Open milestones due in the next 8 weeks')}</div>
        ${card('t1', 'Overdue milestones (active lines), most overdue first', { table: true })}`;
      const ms = M.msA;
      const tracked = ms.filter(m => m.status !== 'N/A' && m.status !== 'Not planned');
      const done = ms.filter(m => m.status === 'Done' || m.status === 'Existing');
      const timed = ms.filter(m => m.onTime != null);
      const open = ms.filter(m => m.status === 'Open');
      U.kpis(U.$('#k'), [
        { label: 'Milestone Completion %', value: U.div(done.length, tracked.length), fmt: 'pct' },
        { label: 'Milestone On-time %', value: U.div(timed.filter(m => m.onTime === 1).length, timed.length), fmt: 'pct' },
        { label: 'Milestones Overdue', value: M.overdue.length, cls: M.overdue.length ? 'bad' : '' },
        { label: 'Lines With Overdue', value: new Set(M.overdue.map(m => m.line.id)).size },
        { label: 'Due Next 14 Days', value: open.filter(m => m.planN >= T && m.planN <= T + 14).length },
        { label: 'Avg Days Late', value: U.avg(ms.filter(m => m.daysLate > 0).map(m => m.daysLate)), fmt: 'dec' },
      ]);
      msStatusChart('c1', ms, MS_NAMES, true);
      const due = open.filter(m => m.planN >= T && m.planN < T + 56);
      const w0 = U.weekStart(T);
      const weeks = Array.from({ length: 9 }, (_, i) => w0 + i * 7).filter(w => w < T + 56);
      U.bar(U.$('#c2'), {
        labels: weeks.map(U.weekLabel),
        series: [{ label: 'Due Next 8 Weeks', data: weeks.map(w => due.filter(m => U.weekStart(m.planN) === w).length) }],
      });
      U.table(U.$('#t1'), {
        rows: M.overdue, sort: { key: 'daysOver', desc: true }, csv: 'overdue_milestones',
        columns: [...lineCols(), { key: 'name', label: 'Milestone', sort: r => r.seq },
          { key: 'plan', label: 'Plan Date', fmt: U.fmtD, sort: r => r.planN },
          { key: 'entered', label: 'Actual (as entered)' },
          { key: 'daysOver', label: 'Days Overdue', num: true, get: r => T - r.planN }],
      });
    },

    xfd(body, ls, M) {
      body.innerHTML = `<div id="k"></div>
        <div class="grid g3">${card('c1', 'On-time % by factory')}${card('c2', 'On-time % by season')}${card('c3', 'Lines by XFD gap (Latest XFD vs HQ)')}</div>
        ${card('t1', 'Late lines (more than 2 days after Latest HQ XFD)', { table: true })}`;
      U.kpis(U.$('#k'), [
        { label: 'XFD On-time %', value: M.xfdPct, fmt: 'pct' }, { label: 'XFD On Time', value: M.xfdOn, cls: 'good' },
        { label: 'XFD Late', value: M.xfdLate, cls: M.xfdLate ? 'bad' : '' }, { label: 'XFD Evaluated', value: M.xfdEval },
        { label: 'Avg XFD Gap (days)', value: M.avgGap, fmt: 'dec' }, { label: 'Lines Shipped', value: M.shipped },
      ]);
      const ev = ls.filter(l => l.onTime != null);
      const rate = rows => U.div(rows.filter(l => l.onTime === 1).length, rows.length);
      const fty = U.uniq(ev.map(l => l.factory)).map(f => [f, rate(ev.filter(l => l.factory === f))]).sort((a, b) => a[1] - b[1]);
      U.bar(U.$('#c1'), { labels: fty.map(f => f[0]), horizontal: true, fmt: 'pct', max: 1, series: [{ label: 'XFD On-time %', data: fty.map(f => f[1]) }], onClick: f => toggleFilter('factory', f) });
      const ss = seasonOrder(ev);
      U.bar(U.$('#c2'), { labels: ss, fmt: 'pct', max: 1, series: [{ label: 'XFD On-time %', data: ss.map(s => rate(ev.filter(l => l.season === s))) }], onClick: s => toggleFilter('season', s) });
      U.bar(U.$('#c3'), { labels: GAP_BUCKETS, series: [{ label: 'XFD Evaluated', data: GAP_BUCKETS.map(b => ev.filter(l => l.gapBucket === b).length) }] });
      U.table(U.$('#t1'), {
        rows: ls.filter(l => l.onTime === 0), sort: { key: 'gap', desc: true }, csv: 'late_xfd_lines',
        columns: [...lineCols(), { key: 'hqXfd', label: 'HQ XFD' },
          { key: 'latestHqXfd', label: 'Latest HQ XFD', fmt: U.fmtD }, { key: 'latestXfd', label: 'Latest XFD', fmt: U.fmtD },
          { key: 'actualXfdText', label: 'Actual XFD' }, { key: 'gap', label: 'Days late', num: true }],
      });
    },

    fit(body, ls) {
      body.innerHTML = `<div id="k"></div>
        <div class="grid g3">${card('c1', 'Fit results by K stage')}${card('c2', 'K1 first-round results by model', { scroll: true })}${card('c3', 'K1 first-pass rate by factory')}</div>
        ${card('t1', 'Fit test log', { table: true })}`;
      const fits = ls.flatMap(l => l.fits);
      const n = (rows, r) => rows.filter(f => f.result === r).length;
      const pass = n(fits, 'Pass'), fail = n(fits, 'Fail');
      const k1 = fits.filter(f => f.k === 'K1' && f.round === 1);
      const k1p = n(k1, 'Pass'), k1f = n(k1, 'Fail');
      const awaiting = fits.filter(f => f.result === 'Awaiting result' || f.result === 'Pending');
      U.kpis(U.$('#k'), [
        { label: 'K1 First-Pass Rate', value: U.div(k1p, k1p + k1f), fmt: 'pct' },
        { label: 'Fit Pass Rate', value: U.div(pass, pass + fail), fmt: 'pct' },
        { label: 'Fit Tests Done', value: pass + fail }, { label: 'Fit Fail', value: fail, cls: fail ? 'bad' : '' },
        { label: 'Re-fit Tests', value: fits.filter(f => f.round > 1).length }, { label: 'Awaiting Fit Result', value: awaiting.length },
      ]);
      const ks = ['K1', 'K2', 'K3', 'K4'];
      U.bar(U.$('#c1'), {
        labels: ks, stacked: true,
        series: [['Pass', C.good, ['Pass']], ['Fail', C.bad, ['Fail']], ['Awaiting result', C.warn, ['Awaiting result', 'Pending']]]
          .map(([label, color, rs]) => ({ label, color, data: ks.map(k => fits.filter(f => f.k === k && rs.includes(f.result)).length) })),
      });
      const models = U.uniq(k1.filter(f => f.result === 'Pass' || f.result === 'Fail').map(f => f.line.model))
        .map(m => [m, n(k1.filter(f => f.line.model === m), 'Pass'), n(k1.filter(f => f.line.model === m), 'Fail')])
        .sort((a, b) => b[2] - a[2] || b[1] - a[1]);
      U.bar(U.$('#c2'), {
        labels: models.map(m => m[0]), horizontal: true, stacked: true, onClick: m => toggleFilter('model', m),
        series: [{ label: 'Pass', color: C.good, data: models.map(m => m[1]) }, { label: 'Fail', color: C.bad, data: models.map(m => m[2]) }],
      });
      const fty = U.uniq(k1.map(f => f.line.factory)).map(f => {
        const r = k1.filter(x => x.line.factory === f), p = n(r, 'Pass'), q = n(r, 'Fail');
        return [f, U.div(p, p + q)];
      }).filter(f => f[1] != null).sort((a, b) => a[1] - b[1]);
      U.bar(U.$('#c3'), { labels: fty.map(f => f[0]), horizontal: true, fmt: 'pct', max: 1, series: [{ label: 'K1 First-Pass Rate', data: fty.map(f => f[1]) }], onClick: f => toggleFilter('factory', f) });
      const color = { Pass: C.good, Fail: C.bad, 'Awaiting result': C.warn, Pending: C.warn };
      U.table(U.$('#t1'), {
        rows: fits, sort: { key: 'ship', desc: true }, csv: 'fit_test_log',
        columns: [...lineCols(), { key: 'lastNo', label: 'Last No', get: r => r.line.lastNo }, { key: 'k', label: 'K Stage' },
          { key: 'roundLabel', label: 'Round', sort: r => r.round }, { key: 'ship', label: 'Ship Date', fmt: U.fmtD },
          { key: 'result', label: 'Result', html: r => U.pill(r.result, color[r.result] || C.gray) }],
      });
    },

    readiness(body, ls, M) {
      body.innerHTML = `<div id="k"></div>
        <div class="grid g3">${card('c1', 'Readiness status by milestone')}${card('c2', 'Tooling type (active models)')}${card('c3', 'New tooling models by factory')}</div>
        ${card('t1', 'Open readiness items (overdue first)', { table: true })}`;
      const ready = M.msA.filter(m => m.phase === 'Readiness');
      const openOf = name => ready.filter(m => m.name === name && m.status === 'Open').length;
      const act = ls.filter(isA);
      const models = t => distinct(act.filter(l => l.tooling === t), l => l.model);
      U.kpis(U.$('#k'), [
        { label: 'Material Pending', value: openOf('Material arrival') }, { label: 'Pattern Lock Open', value: openOf('Pattern lock') },
        { label: 'Tooling Lock Open', value: openOf('Tooling lock') }, { label: 'Mold Open', value: openOf('Mold finished') },
        { label: 'New Tooling Models', value: models('New tooling'), help: 'Distinct models among active lines' },
        { label: 'Existing Tooling Models', value: models('Existing tooling') },
      ]);
      msStatusChart('c1', ready, MS_NAMES.slice(0, 5), true);
      const types = ['New tooling', 'Existing tooling', 'No new tooling needed', 'TBD'].map(t => [t, models(t)]).filter(t => t[1]);
      U.donut(U.$('#c2'), { labels: types.map(t => t[0]), data: types.map(t => t[1]), colors: types.map((t, i) => C.series[i]), centerLabel: 'models' });
      const nt = act.filter(l => l.tooling === 'New tooling');
      const fty = U.uniq(nt.map(l => l.factory)).map(f => [f, distinct(nt.filter(l => l.factory === f), l => l.model)]).sort((a, b) => b[1] - a[1]);
      U.bar(U.$('#c3'), { labels: fty.map(f => f[0]), horizontal: true, series: [{ label: 'New tooling models', data: fty.map(f => f[1]) }], onClick: f => toggleFilter('factory', f) });
      U.table(U.$('#t1'), {
        rows: ready.filter(m => m.status === 'Open'), sort: { key: 'daysOver', desc: true }, csv: 'open_readiness_items',
        columns: [...lineCols(), { key: 'name', label: 'Milestone', sort: r => r.seq },
          { key: 'plan', label: 'Plan Date', fmt: U.fmtD, sort: r => r.planN }, { key: 'etd', label: 'ETD', fmt: U.fmtD },
          { key: 'daysOver', label: 'Days Overdue', num: true, get: r => (r.planN < T ? T - r.planN : null) }],
      });
    },

    sankey(body) {
      // Stage and Status slicers are not applied here: the chart itself shows every stage and every drop.
      const base = filteredExcept(['stage', 'status']);
      const seasons = seasonOrder(base);
      const flows = seasons.map(s => ({ season: s, ...seasonFlow(base.filter(l => l.season === s)) }));
      const tot = k => U.sum(flows, f => f.m[k]);
      body.innerHTML = `<div id="k"></div>
        <div class="card"><h3>Stage conversion by season</h3><div id="t1"></div>
          <div class="note">Lines are Dev codes followed through the season by Dev Code. Carried = present at the next stage. Added = first appears at FLC / SMS (late add or new code).
          CFM = active SMS lines. Stage and Status slicers are not applied on this page.</div></div>
        <div class="legend" id="lg" style="margin:10px 2px 4px"></div>
        <div class="grid" id="sk"></div>`;
      U.kpis(U.$('#k'), [
        { label: 'Dev codes followed', value: tot('codes') },
        { label: 'LR2 → FLC carried', value: U.div(tot('lr2flc'), tot('lr2')), fmt: 'pct', help: 'LR2 lines that reached FLC' },
        { label: 'FLC → SMS carried', value: U.div(tot('flcsms'), tot('flc')), fmt: 'pct', help: 'FLC lines that reached SMS' },
        { label: 'SMS → CFM', value: U.div(tot('cfm'), tot('sms')), fmt: 'pct', help: 'Active SMS lines / all SMS lines' },
        { label: 'Added after LR2', value: tot('addFlc') + tot('addSms'), help: 'Dev codes that first appear at FLC or SMS' },
        { label: 'Dropped', value: tot('dropped') },
      ]);
      U.table(U.$('#t1'), {
        rows: flows.map(f => ({ season: f.season, ...f.m })), csv: 'stage_conversion',
        columns: [{ key: 'season', label: 'Season', sort: r => ALL.find(l => l.season === r.season).seasonSort },
          { key: 'lr2', label: 'LR2', num: true }, { key: 'lr2flc', label: '→ FLC', num: true },
          { key: 'c1', label: 'LR2→FLC %', num: true, get: r => U.div(r.lr2flc, r.lr2), fmt: U.pct },
          { key: 'addFlc', label: 'Added at FLC', num: true }, { key: 'flc', label: 'FLC', num: true },
          { key: 'flcsms', label: '→ SMS', num: true }, { key: 'c2', label: 'FLC→SMS %', num: true, get: r => U.div(r.flcsms, r.flc), fmt: U.pct },
          { key: 'addSms', label: 'Added at SMS', num: true }, { key: 'sms', label: 'SMS', num: true },
          { key: 'cfm', label: 'CFM', num: true }, { key: 'c3', label: 'SMS→CFM %', num: true, get: r => U.div(r.cfm, r.sms), fmt: U.pct },
          { key: 'dropped', label: 'Dropped', num: true }, { key: 'models', label: 'Models', num: true }],
      });
      U.$('#lg').innerHTML = `<span><b>Band colour = model</b> (top 8 per season, rest grouped as “Other models”) · hover a band to follow one model ·</span>
        <span><i style="--c:${DROP_COL}"></i>Dropped</span><span><i style="--c:${ADD_COL}"></i>Added after LR2</span>`;
      const sk = U.$('#sk');
      if (!flows.length) { sk.innerHTML = '<div class="card empty">No lines for the current filters</div>'; return; }
      flows.forEach((f, i) => {
        const d = document.createElement('div');
        d.className = 'card';
        const open = STEPS.slice(0, 3).filter(st => !f.m[st.toLowerCase()]);
        d.innerHTML = `<h3>${U.esc(f.season)} · model flow LR2 → FLC → SMS → CFM</h3>
          <div class="note" style="margin:-2px 0 6px">${U.int(f.m.codes)} Dev codes · ${U.int(f.m.models)} models${open.length ? ` · no lines at ${open.join(' / ')} yet (season in progress)` : ''}</div><div id="sk${i}"></div>`;
        sk.appendChild(d);
      });
      flows.forEach((f, i) => U.sankey(U.$(`#sk${i}`), { ...f.chart, title: `${f.season} model flow` }));
    },

    drop(body, ls, M) {
      body.innerHTML = `<div id="k"></div>
        <div class="grid g3">${card('c1', 'Dropped lines by reason')}${card('c2', 'Drop rate: season x stage', { table: true })}${card('c3', 'Dropped lines by model', { scroll: true })}</div>
        ${card('t1', 'Dropped lines', { table: true })}`;
      const dr = ls.filter(l => l.status === 'Dropped');
      const by = r => dr.filter(l => l.dropReason === r).length;
      U.kpis(U.$('#k'), [
        { label: 'Dropped Lines', value: dr.length }, { label: 'Drop Rate', value: M.dropRate, fmt: 'pct' },
        { label: 'Moved To Later Season', value: by('Moved to later season') }, { label: 'Dropped By HQ', value: by('Dropped by HQ') },
        { label: 'Drop Reason Not Given', value: by('Not specified'), cls: by('Not specified') ? 'warn' : '' },
      ]);
      const reasons = byCount(U.count(dr, l => l.dropReason));
      U.bar(U.$('#c1'), { labels: reasons.map(r => r[0]), horizontal: true, series: [{ label: 'Dropped lines', data: reasons.map(r => r[1]) }] });
      const rate = (s, st) => {
        const r = ls.filter(l => (s == null || l.season === s) && (st == null || l.stage === st));
        return r.length ? r.filter(l => l.status === 'Dropped').length / r.length : null;
      };
      U.matrix(U.$('#c2'), { corner: 'Season', rows: seasonOrder(ls), cols: STAGES, fmt: 'pct', heat: true, value: rate, total: rate });
      const mdl = byCount(U.count(dr, l => l.model));
      U.bar(U.$('#c3'), { labels: mdl.map(m => m[0]), horizontal: true, series: [{ label: 'Dropped lines', data: mdl.map(m => m[1]) }], onClick: m => toggleFilter('model', m) });
      U.table(U.$('#t1'), {
        rows: dr, sort: { key: 'season' }, csv: 'dropped_lines',
        columns: [...lineCols(), { key: 'dropReason', label: 'Drop Reason' }, { key: 'movedTo', label: 'Moved To' },
          { key: 'remarks', label: 'Remarks', cls: 'wrap' }],
      });
    },

    lines(body, ls) {
      body.innerHTML = `<div class="card"><div class="head"><h3>Development lines</h3><div class="tools">
          <input type="search" class="search" id="q" placeholder="Search Dev Code, SAP no., model, colorway" value="${U.esc(lineSearch)}"></div></div>
          <div id="t1"></div></div>`;
      const q = U.$('#q');
      const draw = () => {
        const s = lineSearch.trim().toLowerCase();
        const rows = s ? ls.filter(l => [l.devCode, l.sapNo, l.variant, l.colorway, l.remarks].some(v => v && v.toLowerCase().includes(s))) : ls;
        const xfdColor = { 'On time': C.good, Late: C.bad };
        U.table(U.$('#t1'), {
          rows, sort: { key: 'devCode' }, tall: true, limit: 400, csv: 'development_lines',
          columns: [{ key: 'devCode', label: 'Dev Code' }, { key: 'sapNo', label: 'SAP No' },
            { key: 'season', label: 'Season', sort: r => r.seasonSort }, { key: 'stage', label: 'Stage', sort: r => r.stageSort },
            { key: 'status', label: 'Status', html: r => U.pill(r.status, STATUS_COLOR[r.status]) }, { key: 'factory', label: 'Factory' },
            { key: 'variant', label: 'Model' }, { key: 'colorway', label: 'Colorway' }, { key: 'mat', label: 'Mat.' },
            { key: 'lastNo', label: 'Last No' }, { key: 'tooling', label: 'Tooling Type' },
            { key: 'latestHqXfd', label: 'Latest HQ XFD', fmt: U.fmtD }, { key: 'latestXfd', label: 'Latest XFD', fmt: U.fmtD },
            { key: 'xfdResult', label: 'XFD Result', html: r => (xfdColor[r.xfdResult] ? U.pill(r.xfdResult, xfdColor[r.xfdResult]) : U.esc(r.xfdResult)) },
            { key: 'cfmStatus', label: 'CFM Status' }, { key: 'bomStatus', label: 'BOM Status' },
            { key: 'k1Final', label: 'K1 result' }, { key: 'buyReady', label: 'Buy Ready', get: r => (r.buyReady ? 'Yes' : 'No') },
            { key: 'remarks', label: 'Remarks', cls: 'wrap' }],
        });
      };
      q.addEventListener('input', () => { lineSearch = q.value; draw(); });
      draw();
    },
  };

  let rz;
  window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (page === 'sankey' && ALL.length) renderBody(); }, 200); });

  // ---------------------------------------------------------------- load
  async function init() {
    try {
      DATA = await U.getJSON(U.api('tracking'));
    } catch (e) {
      app.innerHTML = `<div class="msg err">Could not load tracking data: ${U.esc(e.message)}</div>`;
      return;
    }
    ALL = DATA.lines || [];
    ALL.forEach(l => {
      l.milestones.forEach(m => { m.line = l; m.planN = U.dn(m.plan); });
      l.fits.forEach(f => { f.line = l; });
    });
    U.setInfo(`${U.esc(DATA.reportWeek || '')} · ${ALL.length} lines · ${U.esc((DATA.file || '').split(/[\\/]/).pop())}`);
    if (!ALL.length) {
      app.innerHTML = U.errorBox(DATA.errors) || '<div class="msg info">No development lines found.</div>';
      return;
    }
    renderAll();
  }
  init();
})();
