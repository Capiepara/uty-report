/* Shared helpers: dates, formatting, slicers, Chart.js wrappers, tables, tooltip. */
const UTY = (() => {
  // Power BI theme "UTY Development" - categorical order is fixed, never cycled.
  const C = {
    series: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'],
    good: '#0ca30c', warn: '#eda100', neutral: '#fab219', bad: '#d03b3b', gray: '#a19f9d',
    ink: '#252423', ink2: '#52514e', muted: '#8a8886', grid: '#edebe9', border: '#e1dfdd',
  };

  // ---------------------------------------------------------------- dates (day numbers, UTC)
  const DAY = 864e5;
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pad = n => String(n).padStart(2, '0');
  const dn = iso => {
    if (!iso) return null;
    const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
    return Date.UTC(y, m - 1, d) / DAY;
  };
  const todayN = () => { const t = new Date(); return Date.UTC(t.getFullYear(), t.getMonth(), t.getDate()) / DAY; };
  const toDate = n => new Date(n * DAY);
  const fmtD = x => {
    if (x == null || x === '') return '';
    const d = toDate(typeof x === 'number' ? x : dn(x));
    return `${pad(d.getUTCDate())}-${MON[d.getUTCMonth()]}-${String(d.getUTCFullYear()).slice(2)}`;
  };
  const fmtLong = x => {
    if (x == null) return '';
    const d = toDate(typeof x === 'number' ? x : dn(x));
    return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  };
  // Week starting Sunday; week 1 holds 1 Jan (same as Power Query Date.WeekOfYear(_, Day.Sunday))
  const weekStart = n => n - toDate(n).getUTCDay();
  const weekLabel = n => {
    const y = toDate(n).getUTCFullYear();
    const jan1 = Date.UTC(y, 0, 1) / DAY;
    return `WK ${pad(Math.floor((n - jan1 + toDate(jan1).getUTCDay()) / 7) + 1)}_${y}`;
  };
  const rel = days => {
    if (days === 0) return 'today';
    if (days > 0) return `in ${days} day${days === 1 ? '' : 's'}`;
    return `${-days} day${days === -1 ? '' : 's'} ago`;
  };

  // ---------------------------------------------------------------- formatting
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const int = v => (v == null || Number.isNaN(v) ? '–' : Math.round(v).toLocaleString('en-US'));
  const pct = v => (v == null || !Number.isFinite(v) ? '–' : `${(v * 100).toFixed(1)}%`);
  const dec = v => (v == null || !Number.isFinite(v) ? '–' : v.toFixed(1));
  const FMT = { int, pct, dec, text: v => (v == null || v === '' ? '–' : String(v)) };
  const div = (a, b) => (b ? a / b : null);
  const uniq = (arr, cmp) => [...new Set(arr.filter(v => v != null && v !== ''))].sort(cmp);
  const count = (rows, keyFn) => {
    const m = new Map();
    rows.forEach(r => { const k = keyFn(r); if (k != null) m.set(k, (m.get(k) || 0) + 1); });
    return m;
  };
  const sum = (rows, f) => rows.reduce((a, r) => a + (f(r) || 0), 0);
  const avg = arr => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
  const median = arr => {
    if (!arr.length) return null;
    const s = [...arr].sort((a, b) => a - b), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };

  // ---------------------------------------------------------------- storage (per-viewer convenience only)
  const store = {
    get(k, d) { try { const v = sessionStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
  };

  // ---------------------------------------------------------------- fetch / page chrome
  // Static build (GitHub Pages): <body data-static="<published at>"> and data in data/*.json.
  const STATIC = document.body.dataset.static || '';
  const api = name => (STATIC ? `data/${name}.json` : `/api/${name}`);
  async function getJSON(url) {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    return r.json();
  }
  const $ = (sel, root = document) => root.querySelector(sel);
  const setInfo = html => { $('#dataInfo').innerHTML = html + (STATIC ? ` · snapshot ${esc(STATIC)}` : ''); };
  const errorBox = errs => (errs && errs.length
    ? `<div class="msg err"><b>Some files could not be read:</b><br>${errs.map(esc).join('<br>')}</div>` : '');

  document.addEventListener('DOMContentLoaded', () => {
    const b = $('#btnReload');
    if (b && STATIC) b.remove();
    else if (b) b.addEventListener('click', async () => {
      b.disabled = true; b.textContent = 'Reloading…';
      try { await fetch('/api/reload', { method: 'POST' }); } catch (e) { /* page reload still re-reads */ }
      location.reload();
    });
  });

  // ---------------------------------------------------------------- tooltip (custom SVG visuals)
  const tip = {
    show(html, e) {
      const t = $('#tip'); t.innerHTML = html; t.style.display = 'block';
      const w = t.offsetWidth, h = t.offsetHeight;
      let x = e.clientX + 14, y = e.clientY + 14;
      if (x + w > innerWidth - 8) x = e.clientX - w - 14;
      if (y + h > innerHeight - 8) y = e.clientY - h - 14;
      t.style.left = `${Math.max(4, x)}px`; t.style.top = `${Math.max(4, y)}px`;
    },
    hide() { $('#tip').style.display = 'none'; },
  };

  // ---------------------------------------------------------------- slicer (multi-select dropdown, empty = All)
  document.addEventListener('click', e => {
    document.querySelectorAll('.slicer.open').forEach(s => { if (!s.contains(e.target)) s.classList.remove('open'); });
  });

  function slicer(label, values, selected, onChange, fmtVal = v => v) {
    const el = document.createElement('div');
    el.className = 'slicer';
    el.innerHTML = `<label>${esc(label)}</label><button type="button" class="sbtn"></button><div class="menu"></div>`;
    const btn = el.querySelector('.sbtn'), menu = el.querySelector('.menu');
    const valid = new Set(values);
    [...selected].forEach(v => { if (!valid.has(v)) selected.delete(v); });
    const paint = () => {
      btn.textContent = selected.size === 0 ? 'All' : selected.size === 1 ? fmtVal([...selected][0]) : `${selected.size} selected`;
      btn.title = selected.size ? [...selected].map(fmtVal).join(', ') : 'All';
      el.classList.toggle('on', selected.size > 0);
    };
    const build = (q = '') => {
      const vs = values.filter(v => String(fmtVal(v)).toLowerCase().includes(q.toLowerCase()));
      menu.innerHTML = (values.length > 8 ? `<input type="search" placeholder="Search" value="${esc(q)}">` : '')
        + `<label class="all"><input type="checkbox" data-all ${selected.size === 0 ? 'checked' : ''}> All</label>`
        + vs.map(v => `<label><input type="checkbox" value="${esc(v)}" ${selected.has(v) ? 'checked' : ''}> ${esc(fmtVal(v))}</label>`).join('');
      const s = menu.querySelector('input[type=search]');
      if (s) {
        s.addEventListener('input', () => { build(s.value); const n = menu.querySelector('input[type=search]'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); });
      }
    };
    menu.addEventListener('change', e => {
      const cb = e.target;
      if (cb.dataset.all !== undefined) selected.clear();
      else {
        const v = values.find(x => String(x) === cb.value);
        if (cb.checked) selected.add(v); else selected.delete(v);
        if (selected.size === values.length) selected.clear();
      }
      build(menu.querySelector('input[type=search]')?.value || '');
      paint(); onChange();
    });
    btn.addEventListener('click', () => {
      document.querySelectorAll('.slicer.open').forEach(s => { if (s !== el) s.classList.remove('open'); });
      el.classList.toggle('open'); if (el.classList.contains('open')) build();
    });
    paint();
    return el;
  }

  // chips: single row of toggle buttons, empty = All
  function chips(values, selected, onChange, colorOf) {
    const el = document.createElement('div');
    el.className = 'chips';
    const paint = () => {
      el.innerHTML = `<button class="chip ${selected.size === 0 ? 'on' : ''}" data-v="">All</button>`
        + values.map(v => `<button class="chip ${selected.has(v) ? 'on' : ''}" data-v="${esc(v)}">${colorOf ? `<span class="dot" style="background:${colorOf(v)}"></span>` : ''}${esc(v)}</button>`).join('');
    };
    el.addEventListener('click', e => {
      const b = e.target.closest('.chip'); if (!b) return;
      const v = b.dataset.v;
      if (!v) selected.clear();
      else if (selected.has(v)) selected.delete(v);
      else selected.add(v);
      if (selected.size === values.length) selected.clear();
      paint(); onChange();
    });
    paint();
    return el;
  }

  // ---------------------------------------------------------------- charts
  let charts = [];
  if (window.Chart) {
    if (window.ChartDataLabels) Chart.register(ChartDataLabels);
    Object.assign(Chart.defaults, { maintainAspectRatio: false, responsive: true, color: C.ink2 });
    Chart.defaults.font.family = 'Tahoma, "Segoe UI", Verdana, sans-serif';
    Chart.defaults.font.size = 11;
    Chart.defaults.animation.duration = 250;
    Chart.defaults.plugins.legend.labels.boxWidth = 10;
    Chart.defaults.plugins.legend.labels.boxHeight = 10;
    Chart.defaults.plugins.tooltip.backgroundColor = '#fff';
    Chart.defaults.plugins.tooltip.titleColor = C.ink;
    Chart.defaults.plugins.tooltip.bodyColor = C.ink;
    Chart.defaults.plugins.tooltip.borderColor = C.border;
    Chart.defaults.plugins.tooltip.borderWidth = 1;
    Chart.defaults.plugins.tooltip.padding = 8;
    Chart.defaults.plugins.tooltip.boxPadding = 4;
    if (Chart.defaults.plugins.datalabels) Chart.defaults.plugins.datalabels.display = false;
  }
  const destroyCharts = () => { charts.forEach(c => c.destroy()); charts = []; };

  function mount(box, config) {
    box.innerHTML = '<canvas></canvas>';
    const c = new Chart(box.firstChild, config);
    charts.push(c);
    return c;
  }

  /* bar({labels, series:[{label,data,color}], horizontal, stacked, fmt:'int'|'pct', labels:true, onClick(label)}) */
  function bar(box, o) {
    const f = FMT[o.fmt || 'int'];
    const horiz = !!o.horizontal;
    if (horiz && o.autoHeight !== false) box.style.height = `${Math.max(150, o.labels.length * (o.stacked ? 22 : 20) + 60)}px`;
    const multi = o.series.length > 1;
    const datasets = o.series.map((s, i) => ({
      label: s.label, data: s.data, backgroundColor: s.color || C.series[i],
      borderColor: '#fff', borderWidth: o.stacked ? (horiz ? { left: 0, right: 2, top: 0, bottom: 0 } : { top: 2, bottom: 0, left: 0, right: 0 }) : 0,
      borderRadius: o.stacked ? 0 : 4, borderSkipped: 'start', maxBarThickness: 28,
      categoryPercentage: 0.8, barPercentage: multi && !o.stacked ? 0.9 : 0.75,
    }));
    const valueAxis = {
      beginAtZero: true, stacked: !!o.stacked, grid: { color: C.grid }, border: { display: false },
      ticks: { color: C.ink2, font: { size: 10 }, callback: v => (o.fmt === 'pct' ? `${Math.round(v * 100)}%` : int(v)), precision: 0 },
      max: o.max, grace: !horiz && !o.stacked && o.max == null ? '12%' : 0,
    };
    const catAxis = { stacked: !!o.stacked, grid: { display: false }, border: { color: C.border },
      ticks: { color: C.ink2, font: { size: 10 }, autoSkip: !horiz, maxRotation: 45 } };
    return mount(box, {
      type: 'bar',
      data: { labels: o.labels, datasets },
      options: {
        indexAxis: horiz ? 'y' : 'x',
        layout: { padding: { right: horiz && o.showLabels !== false ? 34 : 4, top: !horiz && o.showLabels !== false && !o.stacked ? 16 : 0 } },
        scales: horiz ? { x: valueAxis, y: catAxis } : { x: catAxis, y: valueAxis },
        interaction: o.stacked ? { mode: 'index', axis: horiz ? 'y' : 'x', intersect: false } : { mode: 'nearest', intersect: true },
        plugins: {
          legend: { display: multi, position: 'top', align: 'start' },
          tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${f(ctx.parsed[horiz ? 'x' : 'y'])}` } },
          datalabels: o.showLabels === false ? { display: false } : o.stacked ? {
            display: ctx => {
              const v = ctx.dataset.data[ctx.dataIndex];
              const tot = ctx.chart.data.datasets.reduce((a, d, i) => a + (ctx.chart.isDatasetVisible(i) ? (d.data[ctx.dataIndex] || 0) : 0), 0);
              return v > 0 && v / (tot || 1) > 0.09;
            },
            color: '#fff', font: { size: 10, weight: 'bold' }, formatter: v => f(v),
          } : {
            display: ctx => ctx.dataset.data[ctx.dataIndex] != null && (ctx.dataset.data[ctx.dataIndex] !== 0 || o.fmt === 'pct'),
            anchor: 'end', align: 'end', offset: 2, clamp: true, color: C.ink, font: { size: 10 }, formatter: v => f(v),
          },
        },
        onClick: o.onClick ? (e, els) => { if (els.length) o.onClick(o.labels[els[0].index]); } : undefined,
        onHover: o.onClick ? (e, els) => { e.native.target.style.cursor = els.length ? 'pointer' : 'default'; } : undefined,
      },
    });
  }

  function donut(box, o) {
    const total = o.data.reduce((a, b) => a + b, 0);
    return mount(box, {
      type: 'doughnut',
      data: { labels: o.labels, datasets: [{ data: o.data, backgroundColor: o.colors, borderColor: '#fff', borderWidth: 2 }] },
      options: {
        cutout: '58%',
        plugins: {
          legend: {
            position: 'right',
            labels: {
              generateLabels: ch => ch.data.labels.map((l, i) => ({
                text: `${l} — ${total ? Math.round((o.data[i] / total) * 100) : 0}%`, fillStyle: o.colors[i], strokeStyle: o.colors[i],
                hidden: !ch.getDataVisibility(i), index: i,
              })),
            },
            onClick: (e, item, legend) => { legend.chart.toggleDataVisibility(item.index); legend.chart.update(); },
          },
          tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${int(ctx.parsed)} (${pct(ctx.parsed / total)})` } },
          datalabels: { display: ctx => total && ctx.dataset.data[ctx.dataIndex] / total > 0.06, color: '#fff', font: { size: 10, weight: 'bold' },
            formatter: v => int(v) },
        },
      },
    });
  }

  // ---------------------------------------------------------------- heat colour (sequential, one hue light -> dark)
  const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const HMIN = hex('#cde2fb'), HMAX = hex('#2a78d6');
  function heat(v, max) {
    if (!v || !max) return 'background:#fff;color:#a19f9d';
    const t = Math.min(1, v / max);
    const c = HMIN.map((a, i) => Math.round(a + (HMAX[i] - a) * t));
    return `background:rgb(${c.join(',')});color:${t > 0.55 ? '#fff' : C.ink}`;
  }

  // ---------------------------------------------------------------- KPI cards
  function kpis(el, items) {
    el.className = 'kpis';
    el.innerHTML = items.map(k => `<div class="kpi ${k.cls || ''}" title="${esc(k.help || '')}">
      <div class="v">${esc((FMT[k.fmt || 'int'])(k.value))}</div><div class="l">${esc(k.label)}</div>${k.sub ? `<div class="s">${esc(k.sub)}</div>` : ''}</div>`).join('');
  }

  // ---------------------------------------------------------------- table with sort, CSV and "show all"
  function csvDownload(name, columns, rows) {
    const val = (c, r) => {
      let v = c.csv ? c.csv(r) : c.get ? c.get(r) : r[c.key];
      if (v == null) return '';
      v = String(v);
      return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    };
    const lines = [columns.map(c => val({ csv: () => c.label }, {})).join(',')].concat(rows.map(r => columns.map(c => val(c, r)).join(',')));
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `${name}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /* columns: [{key,label,num,get(row),html(row),sort(row),csv(row),cls}] */
  function table(box, o) {
    let sortKey = o.sort?.key, desc = !!o.sort?.desc, limit = o.limit || 300;
    const cols = o.columns;
    const getv = (c, r) => (c.sort ? c.sort(r) : c.get ? c.get(r) : r[c.key]);
    const render = () => {
      let rows = [...o.rows];
      const sc = cols.find(c => c.key === sortKey);
      if (sc) {
        rows.sort((a, b) => {
          const x = getv(sc, a), y = getv(sc, b);
          if (x == null && y == null) return 0;
          if (x == null) return 1;
          if (y == null) return -1;
          const r = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'en', { numeric: true });
          return desc ? -r : r;
        });
      }
      const shown = rows.slice(0, limit);
      const cell = (c, r) => {
        if (c.html) return c.html(r);
        const v = c.get ? c.get(r) : r[c.key];
        return esc(c.fmt ? c.fmt(v, r) : v);
      };
      box.innerHTML = `<div class="tbl-meta no-print-meta"><span>${int(rows.length)} row${rows.length === 1 ? '' : 's'}${rows.length > limit ? ` · showing ${int(limit)}` : ''}</span>
        ${rows.length > limit ? '<button class="more">Show all</button>' : ''}<span style="flex:1"></span>
        ${o.csv ? '<button class="btn no-print csv">Export CSV</button>' : ''}</div>
        <div class="tbl-wrap ${o.tall ? 'tall' : ''}"><table class="tbl"><thead><tr>${cols.map(c => `<th data-k="${esc(c.key)}" class="${c.num ? 'num' : ''} ${c.key === sortKey ? `sorted ${desc ? '' : 'asc'}` : ''}" title="${esc(c.help || '')}">${esc(c.label)}</th>`).join('')}</tr></thead>
        <tbody>${shown.length ? shown.map(r => `<tr>${cols.map(c => `<td class="${c.num ? 'num' : ''} ${c.cls || ''}">${cell(c, r)}</td>`).join('')}</tr>`).join('')
          : `<tr><td colspan="${cols.length}" class="empty">No rows for the current filters</td></tr>`}</tbody>
        ${o.footer ? `<tfoot><tr>${o.footer(rows).map((v, i) => `<td class="${cols[i]?.num ? 'num' : ''}">${v ?? ''}</td>`).join('')}</tr></tfoot>` : ''}</table></div>`;
      box.querySelectorAll('th').forEach(th => th.addEventListener('click', () => {
        const k = th.dataset.k;
        if (k === sortKey) desc = !desc; else { sortKey = k; desc = !!cols.find(c => c.key === k)?.num; }
        render();
      }));
      box.querySelector('.more')?.addEventListener('click', () => { limit = Infinity; render(); });
      box.querySelector('.csv')?.addEventListener('click', () => csvDownload(o.csv, cols, rows));
    };
    render();
  }

  /* pivot with totals: rows x cols, value(rowKey, colKey) */
  function matrix(box, o) {
    const f = FMT[o.fmt || 'int'];
    const vals = o.rows.map(r => o.cols.map(c => o.value(r, c)));
    const max = Math.max(0, ...vals.flat().filter(Number.isFinite));
    const rowTot = o.rows.map(r => o.total ? o.total(r, null) : null);
    const colTot = o.cols.map(c => o.total ? o.total(null, c) : null);
    const grand = o.total ? o.total(null, null) : null;
    box.innerHTML = `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>${esc(o.corner || '')}</th>${o.cols.map(c => `<th class="num">${esc(c)}</th>`).join('')}${o.total ? '<th class="num">Total</th>' : ''}</tr></thead>
      <tbody>${o.rows.map((r, i) => `<tr><td>${esc(r)}</td>${vals[i].map(v => `<td class="num heat" style="${o.heat ? heat(o.fmt === 'pct' ? v : v, max) : ''}">${v == null ? '' : f(v)}</td>`).join('')}${o.total ? `<td class="num"><b>${rowTot[i] == null ? '' : f(rowTot[i])}</b></td>` : ''}</tr>`).join('')
        || `<tr><td colspan="${o.cols.length + 2}" class="empty">No data</td></tr>`}</tbody>
      ${o.total && o.colTotals !== false ? `<tfoot><tr><td>Total</td>${colTot.map(v => `<td class="num">${v == null ? '' : f(v)}</td>`).join('')}<td class="num">${grand == null ? '' : f(grand)}</td></tr></tfoot>` : ''}
      </table></div>`;
  }

  const pill = (text, color) => `<span class="pill" style="--c:${color}">${esc(text)}</span>`;

  return {
    C, dn, todayN, fmtD, fmtLong, weekStart, weekLabel, rel, toDate, MON, pad,
    esc, int, pct, dec, FMT, div, uniq, count, sum, avg, median, store,
    STATIC, api, getJSON, $, setInfo, errorBox, tip, slicer, chips,
    destroyCharts, bar, donut, heat, kpis, table, matrix, csvDownload, pill,
  };
})();
