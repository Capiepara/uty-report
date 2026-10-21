/* Shipping information - sample shipment tracking (on time / late / overdue / pending / cancelled). */
(() => {
  const U = UTY, C = U.C;
  const app = U.$('#app');
  const STAGES = ['LR2', 'FLC', 'SMS'];
  const STATUS_COLOR = {
    'On time': C.good, Late: C.warn, 'Shipped (no plan)': C.series[6], Overdue: C.bad, Pending: C.series[0], Cancelled: C.gray,
  };
  const STATUS_HELP = {
    'On time': 'Shipped on or before the planned date + grace days',
    Late: 'Shipped after the planned date + grace days',
    'Shipped (no plan)': 'Shipped, but no planned date was found',
    Overdue: 'Not shipped and the planned date has passed',
    Pending: 'Not shipped yet, planned date today or later',
    Cancelled: 'Not shipped; a note says drop / cancel / no need to ship',
  };
  const BUCKETS = [
    ['More than 3 days early', d => d < -3], ['1-3 days early', d => d >= -3 && d < 0], ['On plan date', d => d === 0],
    ['1-2 days late', d => d >= 1 && d <= 2], ['3-7 days late', d => d >= 3 && d <= 7], ['8-14 days late', d => d >= 8 && d <= 14],
    ['Over 14 days late', d => d > 14],
  ];

  const T = U.todayN();
  let DATA = null, RAW = [], ROWS = [], STATUSES = [];
  const sel = {
    season: new Set(U.store.get('ship.season', [])), stage: new Set(U.store.get('ship.stage', [])),
    factory: new Set(U.store.get('ship.factory', [])), shipTo: new Set(U.store.get('ship.shipTo', [])),
    status: new Set(U.store.get('ship.status', [])),
  };
  let tol = U.store.get('ship.tol', null);
  let search = '';
  const save = () => Object.keys(sel).forEach(k => U.store.set(`ship.${k}`, [...sel[k]]));
  const seasonSort = s => parseInt(s.slice(-2), 10) * 2 + (s.startsWith('FW') ? 1 : 0);
  const ssKey = r => `${r.season} ${r.stage}`;
  const ssList = rows => U.uniq(rows.map(ssKey), (a, b) => {
    const [sa, ta] = a.split(' '), [sb, tb] = b.split(' ');
    return seasonSort(sa) - seasonSort(sb) || STAGES.indexOf(ta) - STAGES.indexOf(tb);
  });

  function trackLink(t) {
    if (!t) return '';
    const digits = t.replace(/\s+/g, '');
    if (DATA.trackingUrl && /^\d{10}$/.test(digits)) {
      return `<a href="${U.esc(DATA.trackingUrl.replace('{}', digits))}" target="_blank" rel="noopener" title="Open carrier tracking (DHL Express assumed for 10-digit AWB)">${U.esc(t)}</a>`;
    }
    return U.esc(t);
  }

  const filtered = (skip) => ROWS.filter(r => Object.keys(sel).every(k => k === skip || sel[k].size === 0 || sel[k].has(r[k])));

  function stats(rows) {
    const n = s => rows.filter(r => r.status === s).length;
    const on = n('On time'), late = n('Late');
    const live = rows.filter(r => r.status !== 'Cancelled');
    const ordered = U.sum(live, r => r.orderQty), shipped = U.sum(live, r => r.shippedQty);
    return {
      lines: rows.length, on, late, overdue: n('Overdue'), pending: n('Pending'), cancelled: n('Cancelled'), noPlan: n('Shipped (no plan)'),
      onPct: U.div(on, on + late), ordered, shipped, fill: U.div(shipped, ordered),
      awb: new Set(rows.map(r => r.tracking).filter(Boolean)).size,
      partial: rows.filter(r => r.partial).length,
    };
  }

  // ---------------------------------------------------------------- layout
  function shell() {
    app.innerHTML = `
      <div class="page-head">
        <div><h1>Shipping Information</h1>
          <div class="sub">Sample shipments by Season x Stage | On time = ship date &le; planned date + <b id="tolTxt"></b> grace days | Planned date = requested date in the file, else Overview plan date, else calendar Samples XFD</div></div>
        <div class="refresh">Data refreshed <b>${U.esc((DATA.loadedAt || '').replace('T', ' ').slice(0, 16))}</b><br>${DATA.files.length} tracker files · ${U.int(ROWS.length)} shipment lines</div>
      </div>
      ${U.errorBox(DATA.errors)}
      <div class="toolbar">
        <div class="grp"><span>Season</span><span id="fSeason"></span></div>
        <div class="grp"><span>Stage</span><span id="fStage"></span></div>
        <div class="grp"><span>Grace days</span><select id="fTol" class="btn">${[0, 1, 2, 3, 5, 7].map(v => `<option ${v === tol ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      </div>
      <div class="slicers" id="slicers"></div>
      <div id="body"></div>`;
    U.$('#tolTxt').textContent = tol;
    const seasons = U.uniq(ROWS.map(r => r.season), (a, b) => seasonSort(a) - seasonSort(b));
    U.$('#fSeason').appendChild(U.chips(seasons, sel.season, () => { save(); renderBody(); }));
    U.$('#fStage').appendChild(U.chips(STAGES.filter(s => ROWS.some(r => r.stage === s)), sel.stage, () => { save(); renderBody(); }));
    U.$('#fTol').addEventListener('change', e => { tol = +e.target.value; U.store.set('ship.tol', tol); classifyAll(); shell(); renderBody(); });
    const sl = U.$('#slicers');
    sl.appendChild(U.slicer('Factory', U.uniq(ROWS.map(r => r.factory)), sel.factory, () => { save(); renderBody(); }));
    sl.appendChild(U.slicer('Ship To', U.uniq(ROWS.map(r => r.shipTo)), sel.shipTo, () => { save(); renderBody(); }));
    sl.appendChild(U.slicer('Status', STATUSES, sel.status, () => { save(); renderBody(); }));
  }

  const card = (id, title, o = {}) => `<div class="card"><div class="head"><h3>${U.esc(title)}</h3>${o.tools || ''}</div>
    ${o.table ? `<div id="${id}"></div>` : `<div class="${o.scroll ? 'scroll-y' : ''}"><div class="chart-box ${o.tall ? 'tall' : ''}" id="${id}"></div></div>`}
    ${o.note ? `<div class="note">${o.note}</div>` : ''}</div>`;

  function renderBody() {
    U.destroyCharts();
    const rows = filtered();
    const S = stats(rows);
    const body = U.$('#body');
    body.innerHTML = `<div id="k"></div>
      <div class="grid g2-1">${card('c1', 'Shipment status by season & stage', { scroll: true })}${card('c2', 'Status mix')}</div>
      <div class="grid g3">${card('c3', 'Ship date vs planned date (shipped lines)')}${card('c4', 'Status by factory', { scroll: true })}${card('c5', 'Ordered vs shipped qty by Ship To', { scroll: true })}</div>
      ${card('t1', 'Summary by season & stage', { table: true })}
      <div class="grid g2" style="margin-top:8px">${card('t2', 'Shipments by tracking # (AWB)', { table: true })}${card('t4', 'Overdue lines (not shipped, plan date passed)', { table: true })}</div>
      ${card('t3', 'Shipment lines', { table: true, tools: `<div class="tools"><input type="search" class="search" id="q" placeholder="Search Dev #, model, colorway, AWB, notes" value="${U.esc(search)}"></div>` })}`;

    U.kpis(U.$('#k'), [
      { label: 'Shipment lines', value: S.lines },
      { label: 'On-time %', value: S.onPct, fmt: 'pct', help: 'On time / (On time + Late)', cls: S.onPct == null ? '' : S.onPct >= 0.9 ? 'good' : S.onPct < 0.7 ? 'bad' : 'warn' },
      { label: 'On time', value: S.on, help: STATUS_HELP['On time'] },
      { label: 'Late', value: S.late, help: STATUS_HELP.Late },
      { label: 'Overdue (not shipped)', value: S.overdue, cls: S.overdue ? 'bad' : '', help: STATUS_HELP.Overdue },
      { label: 'Pending', value: S.pending, help: STATUS_HELP.Pending },
      { label: 'Cancelled', value: S.cancelled, help: STATUS_HELP.Cancelled },
      { label: 'Qty shipped / ordered', value: S.fill, fmt: 'pct', sub: `${U.int(S.shipped)} / ${U.int(S.ordered)} pairs`, help: 'Cancelled lines excluded' },
      { label: 'Tracking # (AWB)', value: S.awb },
    ]);

    const present = STATUSES.filter(s => rows.some(r => r.status === s));
    const ss = ssList(rows);
    U.bar(U.$('#c1'), {
      labels: ss, horizontal: true, stacked: true,
      onClick: k => { const [s, t] = k.split(' '); sel.season = new Set([s]); sel.stage = new Set([t]); save(); shell(); renderBody(); },
      series: present.map(s => ({ label: s, color: STATUS_COLOR[s], data: ss.map(k => rows.filter(r => ssKey(r) === k && r.status === s).length) })),
    });
    U.donut(U.$('#c2'), { labels: present, data: present.map(s => rows.filter(r => r.status === s).length), colors: present.map(s => STATUS_COLOR[s]) });

    const shippedRows = rows.filter(r => r.daysLate != null);
    U.bar(U.$('#c3'), {
      labels: BUCKETS.map(b => b[0]), stacked: true,
      series: ['On time', 'Late'].map(s => ({ label: s, color: STATUS_COLOR[s], data: BUCKETS.map(([, f]) => shippedRows.filter(r => r.status === s && f(r.daysLate)).length) })),
    });
    const ftys = U.uniq(rows.map(r => r.factory)).sort((a, b) => rows.filter(r => r.factory === b).length - rows.filter(r => r.factory === a).length);
    U.bar(U.$('#c4'), {
      labels: ftys, horizontal: true, stacked: true,
      onClick: f => { sel.factory = new Set([f]); save(); shell(); renderBody(); },
      series: present.map(s => ({ label: s, color: STATUS_COLOR[s], data: ftys.map(f => rows.filter(r => r.factory === f && r.status === s).length) })),
    });
    const live = rows.filter(r => r.status !== 'Cancelled');
    const tos = U.uniq(live.map(r => r.shipTo)).sort((a, b) => U.sum(live.filter(r => r.shipTo === b), r => r.orderQty) - U.sum(live.filter(r => r.shipTo === a), r => r.orderQty));
    U.bar(U.$('#c5'), {
      labels: tos, horizontal: true, showLabels: false,
      series: [{ label: 'Ordered qty', color: C.series[0], data: tos.map(t => U.sum(live.filter(r => r.shipTo === t), r => r.orderQty)) },
        { label: 'Shipped qty', color: C.series[1], data: tos.map(t => U.sum(live.filter(r => r.shipTo === t), r => r.shippedQty)) }],
    });

    // summary by season & stage
    const files = Object.fromEntries(DATA.files.map(f => [`${f.season} ${f.stage}`, f]));
    const sum = ss.map(k => {
      const r = rows.filter(x => ssKey(x) === k), s = stats(r), f = files[k] || {};
      const ships = r.map(x => U.dn(x.shipDate)).filter(v => v != null);
      return { key: k, season: k.split(' ')[0], stage: k.split(' ')[1], file: f.file, plan: f.planDate, planSource: f.planSource,
        reqDates: U.uniq(r.map(x => (x.planSource === 'Requested date in file' ? x.plan : null))), first: ships.length ? Math.min(...ships) : null,
        last: ships.length ? Math.max(...ships) : null, ...s };
    });
    U.table(U.$('#t1'), {
      rows: sum, csv: 'shipping_summary',
      columns: [
        { key: 'season', label: 'Season', sort: r => seasonSort(r.season) }, { key: 'stage', label: 'Stage', sort: r => STAGES.indexOf(r.stage) },
        { key: 'plan', label: 'Planned date', sort: r => U.dn(r.reqDates[0] || r.plan),
          html: r => (r.reqDates.length ? `${U.esc(U.fmtD(r.reqDates[0]))}${r.reqDates.length > 1 ? ` – ${U.esc(U.fmtD(r.reqDates[r.reqDates.length - 1]))}` : ''} <span class="note">requested in file</span>`
            : `${U.esc(U.fmtD(r.plan))} <span class="note">${U.esc(r.planSource || '')}</span>`),
          csv: r => (r.reqDates.length ? r.reqDates.join(' / ') : r.plan) },
        { key: 'first', label: 'First ship', fmt: U.fmtD }, { key: 'last', label: 'Last ship', fmt: U.fmtD },
        { key: 'lines', label: 'Lines', num: true, fmt: U.int }, { key: 'ordered', label: 'Ordered', num: true, fmt: U.int },
        { key: 'shipped', label: 'Shipped', num: true, fmt: U.int }, { key: 'fill', label: 'Qty %', num: true, fmt: U.pct },
        ...['on', 'late', 'overdue', 'pending', 'cancelled'].map((k, i) => ({
          key: k, label: ['On time', 'Late', 'Overdue', 'Pending', 'Cancelled'][i], num: true, fmt: U.int,
        })),
        { key: 'onPct', label: 'On-time %', num: true, fmt: U.pct }, { key: 'file', label: 'Source file' },
      ],
      footer: rs => { const t = stats(rows); return ['Total', '', '', '', '', U.int(t.lines), U.int(t.ordered), U.int(t.shipped), U.pct(t.fill), U.int(t.on), U.int(t.late), U.int(t.overdue), U.int(t.pending), U.int(t.cancelled), U.pct(t.onPct), '']; },
    });

    // by tracking number
    const awb = new Map();
    rows.filter(r => r.tracking).forEach(r => {
      if (!awb.has(r.tracking)) awb.set(r.tracking, []);
      awb.get(r.tracking).push(r);
    });
    const awbRows = [...awb.entries()].map(([t, rs]) => ({
      tracking: t, ss: ssList(rs).join(', '), factory: U.uniq(rs.map(r => r.factory)).join(', '),
      ship: Math.min(...rs.map(r => U.dn(r.shipDate)).filter(v => v != null)), lines: rs.length,
      qty: U.sum(rs, r => r.shippedQty), shipTo: U.uniq(rs.map(r => r.shipTo)).length,
      received: rs.some(r => r.received), statuses: U.count(rs, r => r.status),
    }));
    U.table(U.$('#t2'), {
      rows: awbRows, sort: { key: 'ship', desc: true }, csv: 'shipments_by_awb', limit: 100,
      columns: [{ key: 'tracking', label: 'Tracking #', html: r => trackLink(r.tracking) }, { key: 'ss', label: 'Season / Stage' },
        { key: 'factory', label: 'Factory' }, { key: 'ship', label: 'Ship date', fmt: v => (Number.isFinite(v) ? U.fmtD(v) : '') },
        { key: 'lines', label: 'Lines', num: true }, { key: 'qty', label: 'Qty', num: true, fmt: U.int },
        { key: 'status', label: 'Status', sort: r => r.statuses.get('Late') || 0,
          html: r => [...r.statuses.entries()].map(([s, n]) => U.pill(`${s} ${n}`, STATUS_COLOR[s])).join(' '),
          csv: r => [...r.statuses.entries()].map(([s, n]) => `${s} ${n}`).join('; ') }],
    });

    U.table(U.$('#t4'), {
      rows: rows.filter(r => r.status === 'Overdue'), sort: { key: 'daysOverdue', desc: true }, csv: 'overdue_shipments', limit: 100,
      columns: [{ key: 'ss', label: 'Season / Stage', get: ssKey }, { key: 'dev', label: 'Dev #' }, { key: 'model', label: 'Model' },
        { key: 'factory', label: 'Factory' }, { key: 'shipTo', label: 'Ship To' }, { key: 'plan', label: 'Planned', fmt: U.fmtD },
        { key: 'daysOverdue', label: 'Days overdue', num: true }],
    });

    const q = U.$('#q');
    const drawDetail = () => {
      const s = search.trim().toLowerCase();
      const rs = s ? rows.filter(r => [r.dev, r.model, r.colorway, r.tracking, r.notes, r.shipTo].some(v => v && String(v).toLowerCase().includes(s))) : rows;
      U.table(U.$('#t3'), {
        rows: rs, sort: { key: 'ship', desc: true }, csv: 'shipment_lines', limit: 300, tall: true,
        columns: [{ key: 'season', label: 'Season', sort: r => seasonSort(r.season) }, { key: 'stage', label: 'Stage', sort: r => STAGES.indexOf(r.stage) },
          { key: 'dev', label: 'Dev #' }, { key: 'model', label: 'Model' }, { key: 'colorway', label: 'Colorway' }, { key: 'mat', label: 'Mat.' },
          { key: 'factory', label: 'Factory' }, { key: 'shipTo', label: 'Ship To' }, { key: 'side', label: 'L/R' }, { key: 'intent', label: 'Sample intent' },
          { key: 'orderQty', label: 'Order', num: true }, { key: 'shippedQty', label: 'Shipped', num: true },
          { key: 'plan', label: 'Planned', fmt: U.fmtD, help: 'Requested date in file, else Overview plan date, else calendar Samples XFD' },
          { key: 'ship', label: 'Ship date', get: r => r.shipDate, fmt: U.fmtD },
          { key: 'daysLate', label: 'Days vs plan', num: true, fmt: v => (v == null ? '' : v > 0 ? `+${v}` : String(v)) },
          { key: 'status', label: 'Status', html: r => U.pill(r.status, STATUS_COLOR[r.status]) + (r.partial ? ' <span class="note">partial</span>' : ''), sort: r => STATUSES.indexOf(r.status) },
          { key: 'tracking', label: 'Tracking #', html: r => trackLink(r.tracking) }, { key: 'received', label: 'Received', fmt: U.fmtD },
          { key: 'notes', label: 'Notes', cls: 'wrap' }],
      });
    };
    q.addEventListener('input', () => { search = q.value; drawDetail(); });
    drawDetail();
  }

  /* Status rules - see app/shipping.py docstring. Set here so they follow today's date. */
  function classify(r) {
    const plan = U.dn(r.plan), ship = U.dn(r.shipDate);
    const days = ship != null && plan != null ? ship - plan : null;
    let status;
    if (ship != null) status = plan == null ? 'Shipped (no plan)' : days <= tol ? 'On time' : 'Late';
    else if (r.cancelSignal) status = 'Cancelled';
    else if (plan != null && plan < T) status = 'Overdue';
    else status = 'Pending';
    return { ...r, status, daysLate: days, partial: !!(ship != null && r.orderQty && (r.shippedQty || 0) < r.orderQty),
      daysOverdue: status === 'Overdue' ? T - plan : null };
  }
  const classifyAll = () => { ROWS = RAW.map(classify); };

  async function load() {
    try {
      DATA = await U.getJSON(U.api('shipping'));
    } catch (e) {
      app.innerHTML = `<div class="msg err">Could not load shipping data: ${U.esc(e.message)}</div>`;
      return;
    }
    RAW = DATA.rows || [];
    if (tol == null) tol = DATA.toleranceDays;
    classifyAll();
    STATUSES = DATA.statuses;
    U.setInfo(`${DATA.files.length} tracker files · ${U.int(ROWS.length)} lines`);
    if (!ROWS.length) { app.innerHTML = U.errorBox(DATA.errors) || '<div class="msg info">No shipping files found in input/shipping.</div>'; return; }
    shell();
    renderBody();
  }
  load();
})();
