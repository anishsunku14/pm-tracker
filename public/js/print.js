/* ==========================================================================
   P.M. Offset Printers — printable A4 job cards (front + back per job)
   PM.printJobCards(po, jobs) opens a new tab with the cards and a Print button.
   ========================================================================== */
(function () {
  'use strict';
  const PM = (window.PM = window.PM || {});
  const esc = (v) => PM.esc(v == null ? '' : v);

  const ALL_COLOURS = ['C', 'M', 'Y', 'K', 'Aqua', 'White', 'UV', 'Drip'];
  const PRINTING_ROWS = 7, PUNCH_ROWS = 5, PASTE_ROWS = 5, DELIVERY_ROWS = 12;

  function d(v) { return v ? PM.fmtDate(v) : ''; }
  function dt(date, time) { return [d(date), time ? PM.fmtTime(time) : ''].filter(Boolean).join(' · '); }
  function box(on) { return '<span class="cb' + (on ? ' on' : '') + '">' + (on ? '✓' : '') + '</span>'; }
  function has(list, v) { return (list || []).some((x) => String(x).toLowerCase() === v.toLowerCase()); }

  function field(label, value, cls) {
    return '<div class="f ' + (cls || '') + '"><span class="l">' + label + '</span><span class="v">' + esc(value) + '</span></div>';
  }

  function prodTable(rows, min) {
    const filled = rows.map((r, i) =>
      '<tr><td class="c">' + (i + 1) + '</td><td>' + esc(r.job_name) + '</td><td>' + esc(dt(r.start_date, r.start_time)) + '</td><td>' + esc(dt(r.end_date, r.end_time)) +
      '</td><td>' + esc(r.total_qty) + '</td><td>' + esc(r.bal_qty) + '</td><td>' + esc(r.operator) + '</td></tr>'
    );
    for (let i = rows.length; i < min; i++) filled.push('<tr><td class="c">' + (i + 1) + '</td><td></td><td></td><td></td><td></td><td></td><td></td></tr>');
    return '<table class="grid prod"><colgroup><col style="width:8%"><col style="width:24%"><col style="width:15%"><col style="width:15%"><col style="width:12%"><col style="width:12%"><col style="width:14%"></colgroup>' +
      '<thead><tr><th>Sl. No.</th><th>Job Name</th><th>Start Date / Time</th><th>End Date / Time</th><th>Total Qty</th><th>Bal. Qty</th><th>Sign Ope.</th></tr></thead>' +
      '<tbody>' + filled.join('') + '</tbody></table>';
  }

  function deliveryTable(rows) {
    const n = Math.max(DELIVERY_ROWS, rows.length + (rows.length % 2));
    const half = n / 2;
    const cell = (i) => {
      const r = rows[i];
      return '<td class="c">' + (i + 1) + '</td><td>' + (r ? esc(d(r.del_date)) : '') + '</td><td>' + (r ? esc(r.invoice) : '') + '</td><td>' + (r ? esc(r.quantity) : '') + '</td>';
    };
    let body = '';
    for (let i = 0; i < half; i++) body += '<tr>' + cell(i) + cell(i + half) + '</tr>';
    const h = '<th>Sl.</th><th>Date</th><th>Invoice</th><th>Quantity</th>';
    return '<table class="grid del"><colgroup>' + '<col style="width:6%"><col style="width:15%"><col style="width:15%"><col style="width:14%">'.repeat(2) + '</colgroup>' +
      '<thead><tr>' + h + h + '</tr></thead><tbody>' + body + '</tbody></table>';
  }

  function lines(text, n) {
    return '<div class="lines" style="min-height:' + (n * 6.2) + 'mm">' + esc(text) + '</div>';
  }

  function cardHTML(po, job) {
    const c = job.card || {};
    const legacyQty = job.quantity_specs || '';
    const e = job.entries || {};
    const colours = c.colours || {};
    const p4only = ['White', 'UV', 'Drip'];
    const colHead = ALL_COLOURS.map((n) => '<th class="' + (c.machine === 'P3' && p4only.indexOf(n) > -1 ? 'off' : '') + '">' + n + '</th>').join('');
    const plateRow = ALL_COLOURS.map((n) => '<td class="c' + (c.machine === 'P3' && p4only.indexOf(n) > -1 ? ' off' : '') + '">' + ((colours[n] || {}).plate ? '✓' : '') + '</td>').join('');
    const inkRow = ALL_COLOURS.map((n) => '<td class="c' + (c.machine === 'P3' && p4only.indexOf(n) > -1 ? ' off' : '') + '">' + esc((colours[n] || {}).ink || '') + '</td>').join('');

    const head =
      '<header class="hd"><div class="brand"><img src="' + location.origin + '/img/logo.svg" alt=""><div><div class="nm">P.M. OFFSET PRINTERS</div><div class="sub">Communication is the key. Printing is its media.</div></div></div>' +
      '<div class="ttl">JOB CARD</div><div class="jc"><span>J.C. No.</span><strong>' + esc(job.jc_no || '') + '</strong></div></header>';

    const front =
      '<section class="page">' + head +
      '<div class="fields">' +
      field('Client', po.customer || (po.codes || []).join(', '), 'w2') + field('P.O. No.', po.number) + field('P.O. Date', d(po.date)) +
      field('Product Name', job.name, 'w4') +
      field('Bill No.', c.bill_no) + field('Bill Date', d(c.bill_date)) + field('Job Card No.', job.jc_no) + field('Material Rate', c.material_rate) +
      field('New Plate No.', c.new_plate_no, 'w2') + field('Old Plate No.', c.old_plate_no, 'w2') +
      field('Job Details', c.job_details, 'w4 tall') +
      field('Job Size', c.job_size, 'w2') + field('Quantity', c.quantity || legacyQty, 'w2') +
      field('Material', c.material, 'w4') +
      field('Processing Details', c.processing_details, 'w4 tall') +
      '</div>' +
      '<div class="sec"><div class="sec-t">Printing Machine <span class="mc">' + box(c.machine === 'P3') + ' P3</span><span class="mc">' + box(c.machine === 'P4') + ' P4</span></div>' +
      '<table class="grid inks"><colgroup><col style="width:20%"></colgroup><thead><tr><th></th>' + colHead + '</tr></thead><tbody>' +
      '<tr><th class="rh">Plate Details</th>' + plateRow + '</tr><tr><th class="rh">Inks Consumption</th>' + inkRow + '</tr></tbody></table></div>' +
      '<div class="sec"><div class="sec-t">Printing Instructions</div>' + lines(c.printing_instructions, 4) + '</div>' +
      '<div class="sec tallrows"><div class="sec-t">Printing</div>' + prodTable(e.printing || [], PRINTING_ROWS) + '</div>' +
      '<footer class="pf">' + esc(PM.poLabel(po.number)) + ' · ' + esc(job.jc_no || '') + ' · Front</footer>' +
      '</section>';

    const back =
      '<section class="page">' +
      '<div class="two">' +
      '<div class="sec"><div class="sec-t">Lamination</div><div class="checks">' +
      PM.JC.LAMINATION.map((o) => '<div>' + box(has(c.lamination, o)) + ' ' + esc(o) + '</div>').join('') + '</div></div>' +
      '<div class="sec"><div class="sec-t">Foiling</div><div class="checks">' +
      PM.JC.FOILING.map((o) => '<div>' + box(has(c.foiling, o)) + ' ' + esc(o) + '</div>').join('') + '</div></div>' +
      '</div>' +
      '<div class="sec"><div class="sec-t">Foiling Instructions</div>' + lines(c.foiling_instructions, 2) + '</div>' +
      '<div class="sec"><div class="sec-t">Punching / Binding <span class="mc">Die No.: <u>' + esc(c.die_no || ' '.repeat(14)) + '</u></span>' +
      PM.JC.PUNCHING.map((o) => '<span class="mc">' + box(has(c.punching, o)) + ' ' + esc(o) + '</span>').join('') + '</div>' +
      prodTable(e.punching || [], PUNCH_ROWS) + '</div>' +
      '<div class="sec"><div class="sec-t">Pasting</div>' + prodTable(e.pasting || [], PASTE_ROWS) + '</div>' +
      '<div class="sec"><div class="sec-t">Packing Instructions</div>' + lines(c.packing_instructions, 2) + '</div>' +
      '<div class="sec"><div class="sec-t">Delivery</div>' + deliveryTable(e.delivery || []) + '</div>' +
      '<div class="totals"><div><span>No. Quantity Mfd.</span><b></b></div><div><span>No. Quantity Dispatch</span><b></b></div><div><span>Wastage</span><b></b></div></div>' +
      '<footer class="pf">' + esc(PM.poLabel(po.number)) + ' · ' + esc(job.jc_no || '') + ' · Back</footer>' +
      '</section>';
    return front + back;
  }

  const CSS = `
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: 'Jost', 'Helvetica Neue', Arial, sans-serif; color: #1a1a1a; background: #e9e9ed; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  :root { --ink: #8B0000; }
  .bar { position: sticky; top: 0; z-index: 2; display: flex; gap: 10px; align-items: center; justify-content: center; padding: 12px; background: rgba(255,255,255,.92); backdrop-filter: blur(10px); border-bottom: 1px solid #ddd; font-size: 14px; }
  .bar button { font: inherit; font-weight: 500; border: 0; border-radius: 999px; padding: 9px 20px; cursor: pointer; background: #f0f0f3; color: #1a1a1a; }
  .bar button.primary { background: var(--ink); color: #fff; }
  .bar .info { color: #666; margin-right: 8px; }
  .page { width: 210mm; height: 297mm; padding: 10mm 11mm 9mm; margin: 8mm auto; background: #fff; position: relative; overflow: hidden; box-shadow: 0 2px 14px rgba(0,0,0,.12); page-break-after: always; break-after: page; font-size: 8.6pt; }
  .hd { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; border-bottom: 1.4pt solid var(--ink); padding-bottom: 2.5mm; margin-bottom: 3mm; }
  .brand { display: flex; align-items: center; gap: 2.5mm; }
  .brand img { height: 11mm; }
  .brand .nm { font-weight: 600; letter-spacing: .08em; color: var(--ink); font-size: 10.5pt; }
  .brand .sub { font-size: 6.6pt; color: #777; font-style: italic; }
  .ttl { font-size: 17pt; font-weight: 600; letter-spacing: .22em; color: var(--ink); }
  .jc { justify-self: end; border: 1pt solid var(--ink); border-radius: 1.5mm; padding: 1.5mm 3mm; text-align: center; min-width: 30mm; }
  .jc span { display: block; font-size: 6.6pt; color: var(--ink); text-transform: uppercase; letter-spacing: .08em; }
  .jc strong { font-size: 13pt; letter-spacing: .04em; }
  .fields { display: grid; grid-template-columns: repeat(4, 1fr); border-top: .8pt solid var(--ink); border-left: .8pt solid var(--ink); margin-bottom: 3mm; }
  .f { border-right: .8pt solid var(--ink); border-bottom: .8pt solid var(--ink); padding: 1.2mm 2mm; min-height: 9mm; display: flex; flex-direction: column; gap: .6mm; overflow: hidden; }
  .f.w2 { grid-column: span 2; } .f.w4 { grid-column: span 4; }
  .f.tall { min-height: 13mm; }
  .f .l { font-size: 6.6pt; color: var(--ink); text-transform: uppercase; letter-spacing: .06em; font-weight: 500; }
  .f .v { font-size: 9pt; white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.3; }
  .sec { margin-bottom: 3mm; }
  .sec-t { color: var(--ink); font-weight: 600; text-transform: uppercase; letter-spacing: .08em; font-size: 7.8pt; margin-bottom: 1.4mm; display: flex; align-items: center; gap: 5mm; flex-wrap: wrap; }
  .mc { display: inline-flex; align-items: center; gap: 1.4mm; text-transform: none; letter-spacing: 0; font-weight: 500; color: #1a1a1a; font-size: 8.6pt; }
  .mc u { text-decoration: none; border-bottom: .8pt solid var(--ink); padding: 0 1mm; min-width: 26mm; display: inline-block; }
  .cb { width: 3.4mm; height: 3.4mm; border: .8pt solid var(--ink); border-radius: .6mm; display: inline-grid; place-items: center; font-size: 7.4pt; line-height: 1; color: var(--ink); font-weight: 700; flex: 0 0 auto; }
  table.grid { width: 100%; border-collapse: collapse; table-layout: fixed; }
  .grid th, .grid td { border: .8pt solid var(--ink); padding: 1mm 1.4mm; text-align: left; vertical-align: middle; overflow-wrap: anywhere; }
  .grid th { color: var(--ink); font-weight: 500; font-size: 6.8pt; text-transform: uppercase; letter-spacing: .04em; background: rgba(139,0,0,.04); }
  .grid td { height: 8.6mm; font-size: 8.2pt; }
  .grid td.c, .grid th.c { text-align: center; }
  .inks th { text-align: center; } .inks th.rh { text-align: left; }
  .inks td { height: 7.4mm; }
  .grid .off { background: repeating-linear-gradient(135deg, transparent 0 2mm, rgba(139,0,0,.07) 2mm 2.4mm); color: #aaa; }
  .prod td { height: 8.6mm; }
  .tallrows .prod td { height: 11mm; }
  .del td { height: 7.6mm; }
  .lines { border: .8pt solid var(--ink); border-radius: 1mm; padding: 1.2mm 2mm; white-space: pre-wrap; line-height: 6.2mm; font-size: 9pt;
    background-image: linear-gradient(to bottom, transparent calc(6.2mm - .6pt), rgba(139,0,0,.3) calc(6.2mm - .6pt)); background-size: 100% 6.2mm; background-repeat: repeat-y; background-origin: content-box; background-clip: content-box; }
  .two { display: grid; grid-template-columns: 1.15fr 1fr; gap: 6mm; }
  .checks { display: grid; gap: 1.6mm; border: .8pt solid var(--ink); border-radius: 1mm; padding: 2mm 2.5mm; min-height: 25mm; }
  .checks div { display: flex; align-items: center; gap: 2mm; }
  .totals { display: grid; grid-template-columns: repeat(3, 1fr); border: .8pt solid var(--ink); }
  .totals div { padding: 1.5mm 2mm; min-height: 14mm; border-right: .8pt solid var(--ink); display: flex; flex-direction: column; }
  .totals div:last-child { border-right: 0; }
  .totals span { font-size: 6.8pt; color: var(--ink); text-transform: uppercase; letter-spacing: .06em; font-weight: 500; }
  .pf { position: absolute; left: 11mm; right: 11mm; bottom: 4mm; font-size: 6.4pt; color: #aaa; text-align: right; }
  @media print {
    body { background: #fff; }
    .bar { display: none; }
    .page { margin: 0; box-shadow: none; }
  }
  @media screen and (max-width: 820px) {
    .page { zoom: .46; }
  }`;

  PM.printJobCards = function (po, jobs) {
    jobs = (jobs || []).filter(Boolean);
    if (!jobs.length) { PM.toast('There are no job cards to print.', 'error'); return; }
    const w = window.open('', '_blank');
    if (!w) { PM.toast('Your browser blocked the new tab. Please allow pop-ups for this site and try again.', 'error', 7000); return; }
    const title = jobs.length === 1
      ? 'Job card ' + (jobs[0].jc_no || jobs[0].name) + ' · ' + PM.poLabel(po.number)
      : 'Job cards · ' + PM.poLabel(po.number);
    const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<title>' + esc(title) + '</title>' +
      '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
      '<link href="https://fonts.googleapis.com/css2?family=Jost:wght@400;500;600&display=swap" rel="stylesheet">' +
      '<link rel="icon" href="' + location.origin + '/img/favicon.png">' +
      '<style>' + CSS + '</style></head><body>' +
      '<div class="bar"><span class="info">' + esc(title) + ' — ' + jobs.length * 2 + ' A4 pages (front &amp; back)</span>' +
      '<button type="button" class="primary" onclick="window.print()">Print / Save as PDF</button><button type="button" onclick="window.close()">Close</button></div>' +
      jobs.map((j) => cardHTML(po, j)).join('') +
      '</body></html>';
    w.document.open();
    w.document.write(html);
    w.document.close();
  };
})();
