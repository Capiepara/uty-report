/* Development calendar - key dates per Season x Stage (LR2 / FLC / SMS) collected from the GTM calendar files. */
(() => {
  const U = UTY, C = U.C;
  const T = U.todayN();
  const app = U.$('#app');
  const STAGES = ['LR2', 'FLC', 'SMS'];
  // fixed colour per milestone (categorical, never re-assigned by filter)
  const KCOLOR = {
    tpcad: C.series[0], matOrdered: C.series[1], matArrive: C.series[2], xfd: C.series[6], toolingLock: C.series[4], patternLock: C.series[3],
  };

  let DATA = null, KEYS = [], EVENTS = [];
  const sel = {
    season: new Set(U.store.get('cal.season', [])), stage: new Set(U.store.get('cal.stage', [])),
    key: new Set(U.store.get('cal.key', [])),
  };
  let showAll = U.store.get('cal.all', false);
  let month = U.store.get('cal.month', null);
  const save = () => { Object.keys(sel).forEach(k => U.store.set(`cal.${k}`, [...sel[k]])); U.store.set('cal.all', showAll); U.store.set('cal.month', month); };
  const label = k => KEYS.find(x => x.key === k)?.label || k;

  const badge = n => {
    if (n == null) return '';
    const d = n - T;
    const cls = d < 0 ? 'past' : d === 0 ? 'today' : d <= 14 ? 'soon' : 'next';
    return `<span class="badge ${cls}">${U.esc(U.rel(d))}</span>`;
  };

  function buildEvents() {
    EVENTS = [];
    DATA.seasons.forEach(s => s.stages.forEach(row => KEYS.forEach(({ key }) => {
      const d = row.dates[key];
      if (!d || !d.date) return;
      EVENTS.push({ season: s.season, stage: row.stage, key, n: U.dn(d.date), date: d.date, task: d.task, source: d.source, calc: d.source === 'calculated',
        calendarDate: d.calendarDate, calendarTask: d.calendarTask, file: s.file });
    })));
  }
  const visible = e => (sel.season.size === 0 || sel.season.has(e.season)) && (sel.stage.size === 0 || sel.stage.has(e.stage))
    && (sel.key.size === 0 || sel.key.has(e.key));
  const seasonsShown = () => DATA.seasons.filter(s => sel.season.size === 0 || sel.season.has(s.season));
  const stagesShown = () => STAGES.filter(s => sel.stage.size === 0 || sel.stage.has(s));
  const keysShown = () => KEYS.filter(k => sel.key.size === 0 || sel.key.has(k.key));

  const evTip = e => `<b>${U.esc(e.season)} ${U.esc(e.stage)} · ${U.esc(label(e.key))}</b>${U.esc(U.fmtLong(e.n))} <span class="muted">(${U.esc(U.rel(e.n - T))})</span><br>
    <span class="muted">${e.calc ? `Calculated: ${U.esc(e.task)}` : `Calendar task: ${U.esc(e.task)}`}</span>
    ${e.calendarDate ? `<br><span class="muted">Calendar also lists "${U.esc(e.calendarTask)}" on ${U.esc(U.fmtD(e.calendarDate))}</span>` : ''}`;

  // ---------------------------------------------------------------- layout
  function shell() {
    app.innerHTML = `
      <div class="page-head">
        <div><h1>Development Calendar</h1>
          <div class="sub">Key dates per Season x Stage (LR2 · FLC · SMS) from the GTM calendar files | Tooling locked = Samples XFD − ${DATA.toolingDays} days · Pattern locked = Samples XFD − ${DATA.patternDays} days</div></div>
        <div class="refresh">Data refreshed <b>${U.esc((DATA.loadedAt || '').replace('T', ' ').slice(0, 16))}</b><br>${DATA.files.map(f => `${U.esc(f.season)}: ${U.esc(f.file)}`).join(' · ')}</div>
      </div>
      ${U.errorBox(DATA.errors)}
      <div class="toolbar">
        <div class="grp"><span>Season</span><span id="fSeason"></span></div>
        <div class="grp"><span>Stage</span><span id="fStage"></span></div>
      </div>
      <div class="toolbar"><div class="grp"><span>Milestone</span><span id="fKey"></span></div></div>
      <div id="body"></div>`;
    const rerender = () => { save(); renderBody(); };
    U.$('#fSeason').appendChild(U.chips(DATA.seasons.map(s => s.season), sel.season, rerender));
    U.$('#fStage').appendChild(U.chips(STAGES, sel.stage, rerender));
    const keyChips = U.chips(KEYS.map(k => k.label), new Set([...sel.key].map(label)), () => {}, l => KCOLOR[KEYS.find(k => k.label === l).key]);
    // chips work on labels; map back to keys
    keyChips.addEventListener('click', () => {
      sel.key = new Set([...keyChips.querySelectorAll('.chip.on')].map(b => b.dataset.v).filter(Boolean).map(l => KEYS.find(k => k.label === l).key));
      rerender();
    });
    U.$('#fKey').appendChild(keyChips);
  }

  const card = (id, title, tools = '', note = '') => `<div class="card"><div class="head"><h3>${U.esc(title)}</h3>${tools ? `<div class="tools">${tools}</div>` : ''}</div><div id="${id}"></div>${note ? `<div class="note">${note}</div>` : ''}</div>`;

  function renderBody() {
    const ev = EVENTS.filter(visible);
    const upcoming = ev.filter(e => e.n >= T).sort((a, b) => a.n - b.n);
    const missing = seasonsShown().flatMap(s => s.stages.filter(r => stagesShown().includes(r.stage))
      .flatMap(r => keysShown().filter(k => !r.dates[k.key]?.date).map(k => `${s.season} ${r.stage}: ${k.label}`)));
    const next = upcoming[0];
    U.$('#body').innerHTML = `<div id="k"></div>
      ${card('kd', 'Key dates by season & stage', '<button class="btn" id="csvKd">Export CSV</button>',
        'Italic = calculated from Samples XFD. Hover a date for the calendar task it came from. “—” = task not found in that season’s calendar.')}
      <div style="height:8px"></div>
      ${card('tl', 'Timeline', '', '')}
      <div style="height:8px"></div>
      <div class="grid g2-1">
        ${card('mv', 'Month view', `<label class="note" style="margin:0"><input type="checkbox" id="all" ${showAll ? 'checked' : ''}> show all calendar tasks</label>`)}
        ${card('up', 'Coming up')}
      </div>
      <details class="card src"><summary>Where each date comes from</summary><div id="src" style="margin-top:8px"></div></details>`;

    U.kpis(U.$('#k'), [
      { label: next ? `Next: ${next.season} ${next.stage} · ${label(next.key)}` : 'Next key date', value: next ? U.fmtD(next.n) : null, fmt: 'text',
        sub: next ? U.rel(next.n - T) : 'nothing upcoming' },
      { label: 'Key dates in next 14 days', value: ev.filter(e => e.n >= T && e.n <= T + 14).length, cls: ev.some(e => e.n >= T && e.n <= T + 14) ? 'warn' : '' },
      { label: 'Key dates in next 30 days', value: ev.filter(e => e.n >= T && e.n <= T + 30).length },
      { label: 'Key dates passed', value: ev.filter(e => e.n < T).length },
      { label: 'Not found in calendar', value: missing.length, cls: missing.length ? 'warn' : '', help: missing.join('\n') },
    ]);

    renderKeyDates();
    renderTimeline(ev);
    renderMonth(ev);
    renderUpcoming(upcoming);
    renderSources();
    U.$('#all').addEventListener('change', e => { showAll = e.target.checked; save(); renderMonth(EVENTS.filter(visible)); });
  }

  // ---------------------------------------------------------------- key-dates matrix
  function keyDateRows() {
    return seasonsShown().flatMap(s => s.stages.filter(r => stagesShown().includes(r.stage)).map((r, i) => ({ season: s.season, stage: r.stage, dates: r.dates, first: i === 0 })));
  }
  function renderKeyDates() {
    const rows = keyDateRows(), keys = keysShown();
    const cell = (d, key) => {
      if (!d || !d.date) return '<span class="note">—</span>';
      const n = U.dn(d.date);
      const e = { season: '', stage: '', key, n, task: d.task, calc: d.source === 'calculated', calendarDate: d.calendarDate, calendarTask: d.calendarTask };
      return `<span class="d ${e.calc ? 'calc' : ''}" data-tip="${U.esc(JSON.stringify(e))}">${U.esc(U.fmtD(n))}</span>${badge(n)}
        ${d.calendarDate && d.calendarDate !== d.date ? `<span class="rel">calendar: ${U.esc(U.fmtD(d.calendarDate))}</span>` : ''}`;
    };
    U.$('#kd').innerHTML = `<div class="tbl-wrap" style="max-height:none"><table class="tbl kd"><thead><tr><th>Season</th><th>Stage</th>
      ${keys.map(k => `<th><span class="dot" style="background:${KCOLOR[k.key]}"></span>${U.esc(k.label)}</th>`).join('')}</tr></thead><tbody>
      ${rows.map(r => `<tr class="${r.first ? 'season-first' : ''}"><td><b>${U.esc(r.season)}</b></td><td>${U.esc(r.stage)}</td>
        ${keys.map(k => `<td class="cell">${cell(r.dates[k.key], k.key)}</td>`).join('')}</tr>`).join('')
        || `<tr><td colspan="${keys.length + 2}" class="empty">No rows for the current filters</td></tr>`}</tbody></table></div>`;
    U.$('#kd').querySelectorAll('[data-tip]').forEach(el => {
      const e = JSON.parse(el.dataset.tip);
      const tr = el.closest('tr');
      e.season = tr.children[0].textContent; e.stage = tr.children[1].textContent;
      el.addEventListener('mousemove', m => U.tip.show(evTip(e), m));
      el.addEventListener('mouseleave', U.tip.hide);
    });
    U.$('#csvKd').onclick = () => U.csvDownload('calendar_key_dates', [
      { label: 'Season', get: r => r.season }, { label: 'Stage', get: r => r.stage },
      ...keys.map(k => ({ label: k.label, get: r => r.dates[k.key]?.date || '' })),
    ], rows);
  }

  // ---------------------------------------------------------------- timeline (SVG)
  function renderTimeline(ev) {
    const box = U.$('#tl');
    const rows = keyDateRows();
    if (!rows.length || !ev.length) { box.innerHTML = '<div class="empty">No dates for the current filters</div>'; return; }
    const W = Math.max(640, box.clientWidth), LW = 86, RH = 26, TOP = 26, H = TOP + rows.length * RH + 8;
    let lo = Math.min(...ev.map(e => e.n), T), hi = Math.max(...ev.map(e => e.n), T);
    const d0 = U.toDate(lo), d1 = U.toDate(hi);
    lo = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth(), 1) / 864e5;
    hi = Date.UTC(d1.getUTCFullYear(), d1.getUTCMonth() + 1, 1) / 864e5;
    const x = n => LW + ((n - lo) / (hi - lo)) * (W - LW - 12);
    const months = [];
    for (let d = U.toDate(lo); d.getTime() / 864e5 < hi; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) months.push(d.getTime() / 864e5);
    const every = Math.ceil(months.length / Math.max(1, Math.floor((W - LW) / 56)));
    let svg = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="Timeline of key dates">`;
    months.forEach((m, i) => {
      const d = U.toDate(m);
      svg += `<line x1="${x(m)}" x2="${x(m)}" y1="${TOP - 6}" y2="${H - 4}" stroke="${C.grid}"/>`;
      if (i % every === 0) svg += `<text class="axis" x="${x(m) + 3}" y="${TOP - 10}">${U.MON[d.getUTCMonth()]}${d.getUTCMonth() === 0 || i === 0 ? ` ${String(d.getUTCFullYear()).slice(2)}` : ''}</text>`;
    });
    rows.forEach((r, i) => {
      const y = TOP + i * RH + RH / 2;
      if (r.first && i) svg += `<line x1="0" x2="${W}" y1="${y - RH / 2}" y2="${y - RH / 2}" stroke="${C.border}"/>`;
      svg += `<text class="lbl" x="4" y="${y + 4}">${U.esc(r.season)} ${U.esc(r.stage)}</text>`;
      const pts = ev.filter(e => e.season === r.season && e.stage === r.stage);
      if (pts.length > 1) {
        const a = Math.min(...pts.map(e => e.n)), b = Math.max(...pts.map(e => e.n));
        svg += `<rect x="${x(a)}" y="${y - 4}" width="${Math.max(2, x(b) - x(a))}" height="8" rx="4" fill="#e1dfdd" opacity=".7"/>`;
      }
      pts.forEach(e => {
        const cx = x(e.n), col = KCOLOR[e.key];
        const mark = e.calc
          ? `<rect x="${cx - 5}" y="${y - 5}" width="10" height="10" transform="rotate(45 ${cx} ${y})" fill="${col}" stroke="#fff" stroke-width="2"/>`
          : `<circle cx="${cx}" cy="${y}" r="5.5" fill="${col}" stroke="#fff" stroke-width="2"/>`;
        svg += `<g class="pt" data-i="${EVENTS.indexOf(e)}">${mark}<circle cx="${cx}" cy="${y}" r="11" fill="transparent"/></g>`;
      });
    });
    if (T >= lo && T <= hi) {
      svg += `<line x1="${x(T)}" x2="${x(T)}" y1="${TOP - 6}" y2="${H - 4}" stroke="${C.bad}" stroke-width="2" stroke-dasharray="4 3"/>
        <text class="axis" x="${x(T) + 4}" y="${H - 6}" fill="${C.bad}" style="fill:${C.bad}">Today</text>`;
    }
    svg += '</svg>';
    box.innerHTML = `<div class="legend">${keysShown().map(k => `<span><i style="--c:${KCOLOR[k.key]};${k.key === 'toolingLock' || k.key === 'patternLock' ? 'transform:rotate(45deg) scale(.85)' : 'border-radius:50%'}"></i>${U.esc(k.label)}</span>`).join('')}
      <span style="margin-left:auto">● from calendar · ◆ calculated</span></div><div class="timeline">${svg}</div>`;
    box.querySelectorAll('.pt').forEach(g => {
      const e = EVENTS[+g.dataset.i];
      g.addEventListener('mousemove', m => U.tip.show(evTip(e), m));
      g.addEventListener('mouseleave', U.tip.hide);
    });
  }
  let rz;
  window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => DATA && renderTimeline(EVENTS.filter(visible)), 150); });

  // ---------------------------------------------------------------- month view
  function renderMonth(ev) {
    const box = U.$('#mv');
    if (!month) { const t = U.toDate(T); month = [t.getUTCFullYear(), t.getUTCMonth()]; }
    const [y, m] = month;
    const first = Date.UTC(y, m, 1) / 864e5, start = U.weekStart(first);
    const last = Date.UTC(y, m + 1, 0) / 864e5, end = U.weekStart(last) + 6;
    const items = ev.map(e => ({ n: e.n, html: `<span class="ev" style="--c:${KCOLOR[e.key]}" data-i="${EVENTS.indexOf(e)}">${U.esc(e.season)} ${U.esc(e.stage)} · ${U.esc(label(e.key))}</span>` }));
    if (showAll) {
      seasonsShown().forEach(s => s.tasks.forEach(t => {
        const a = U.dn(t.start), b = U.dn(t.finish) ?? a;
        if (a == null) return;
        for (let n = Math.max(a, start); n <= Math.min(b, end); n++) {
          items.push({ n, minor: true, html: `<span class="ev minor" title="${U.esc(`${t.season} · ${t.name}${t.type ? ` (${t.type})` : ''}\n${U.fmtD(a)}${b !== a ? ` – ${U.fmtD(b)}` : ''}${t.owner ? `\nOwner: ${t.owner}` : ''}${t.description ? `\n${t.description}` : ''}${t.comments ? `\nComments: ${t.comments}` : ''}`)}">${U.esc(t.season)} · ${U.esc(t.name)}</span>` });
        }
      }));
    }
    let cells = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => `<div class="dow">${d}</div>`).join('');
    for (let n = start; n <= end; n++) {
      const d = U.toDate(n);
      const its = items.filter(i => i.n === n).sort((a, b) => (a.minor ? 1 : 0) - (b.minor ? 1 : 0));
      const shown = its.slice(0, 4);
      cells += `<div class="day ${d.getUTCMonth() !== m ? 'out' : ''} ${n === T ? 'today' : ''}"><div class="n">${d.getUTCDate()}</div>${shown.map(i => i.html).join('')}
        ${its.length > 4 ? `<span class="note">+${its.length - 4} more</span>` : ''}</div>`;
    }
    box.innerHTML = `<div class="month-head" style="margin-bottom:6px"><button class="btn" data-m="-1">&#8249;</button><h3>${U.MON[m]} ${y}</h3>
      <button class="btn" data-m="1">&#8250;</button><button class="btn" data-m="0">Today</button></div><div class="month">${cells}</div>`;
    box.querySelectorAll('[data-m]').forEach(b => b.addEventListener('click', () => {
      const s = +b.dataset.m;
      if (s === 0) { const t = U.toDate(T); month = [t.getUTCFullYear(), t.getUTCMonth()]; } else {
        const d = new Date(Date.UTC(month[0], month[1] + s, 1)); month = [d.getUTCFullYear(), d.getUTCMonth()];
      }
      save(); renderMonth(EVENTS.filter(visible));
    }));
    box.querySelectorAll('.ev[data-i]').forEach(el => {
      const e = EVENTS[+el.dataset.i];
      el.addEventListener('mousemove', mv => U.tip.show(evTip(e), mv));
      el.addEventListener('mouseleave', U.tip.hide);
    });
  }

  // ---------------------------------------------------------------- upcoming + sources
  function renderUpcoming(up) {
    const rows = up.slice(0, 40);
    U.$('#up').innerHTML = rows.length ? `<div class="tbl-wrap" style="max-height:520px"><table class="tbl"><thead><tr><th>Date</th><th>Season / Stage</th><th>Milestone</th></tr></thead><tbody>
      ${rows.map(e => `<tr><td><b>${U.esc(U.fmtD(e.n))}</b>${badge(e.n)}</td><td>${U.esc(e.season)} ${U.esc(e.stage)}</td>
        <td><span class="dot" style="background:${KCOLOR[e.key]}"></span>${U.esc(label(e.key))}${e.calc ? ' <span class="note">(calc)</span>' : ''}</td></tr>`).join('')}</tbody></table></div>`
      : '<div class="empty">No upcoming key dates for the current filters.</div>';
  }

  function renderSources() {
    const rows = seasonsShown().flatMap(s => s.stages.flatMap(r => KEYS.map(k => ({ season: s.season, file: s.file, stage: r.stage, key: k.key, ...(r.dates[k.key] || {}) }))));
    U.table(U.$('#src'), {
      rows, csv: 'calendar_sources', limit: 500,
      columns: [{ key: 'season', label: 'Season' }, { key: 'stage', label: 'Stage', sort: r => STAGES.indexOf(r.stage) },
        { key: 'key', label: 'Milestone', get: r => label(r.key), sort: r => KEYS.findIndex(k => k.key === r.key) },
        { key: 'date', label: 'Date', fmt: U.fmtD }, { key: 'task', label: 'Calendar task / rule', get: r => r.task || 'not found' },
        { key: 'source', label: 'Source' }, { key: 'file', label: 'File' }],
    });
  }

  async function init() {
    try {
      DATA = await U.getJSON(U.api('calendar'));
    } catch (e) {
      app.innerHTML = `<div class="msg err">Could not load calendar data: ${U.esc(e.message)}</div>`;
      return;
    }
    KEYS = DATA.keyDates;
    const any = DATA.seasons.flatMap(s => s.stages).find(r => r.dates.toolingLock);
    DATA.toolingDays = any?.dates.toolingLock.offsetDays ?? 35;
    DATA.patternDays = any?.dates.patternLock.offsetDays ?? 45;
    U.setInfo(`${DATA.seasons.length} season calendars`);
    if (!DATA.seasons.length) { app.innerHTML = U.errorBox(DATA.errors) || '<div class="msg info">No calendar files found in input/calendars.</div>'; return; }
    buildEvents();
    shell();
    renderBody();
  }
  init();
})();
