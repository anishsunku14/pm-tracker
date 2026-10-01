/* ==========================================================================
   P.M. Offset Printers — Order Tracking
   app.js — core utilities, public tracking, client dashboard, auth, easter eggs
   (Admin dashboard lives in app2.js and uses window.PM exported from here.)
   ========================================================================== */
(function () {
  'use strict';

  const PM = (window.PM = window.PM || {});

  /* ------------------------------------------------------------------------
     Constants & state
     ------------------------------------------------------------------------ */
  PM.STAGES = [
    'Order Received',
    'Design / Prepress',
    'Printing',
    'Post-Press Finishing',
    'Quality Check',
    'Shipping / Ready for Pickup'
  ];
  PM.FINISH_OPTIONS = ['Matte', 'Glossy', 'Satin', 'Uncoated', 'Laminated', 'Varnished'];
  PM.GSM_OPTIONS = ['80', '100', '120', '150', '170', '200', '250', '300', '350'];
  PM.PROCESS_OPTIONS = ['Lamination', 'Pasting', 'UV Print', 'Drip Off', 'Embossing', 'Spot UV', 'Foiling'];
  // Job card options (must match lib/jobcard.js)
  PM.JC = {
    COLOURS: { P3: ['C', 'M', 'Y', 'K', 'Aqua'], P4: ['C', 'M', 'Y', 'K', 'Aqua', 'White', 'UV', 'Drip'] },
    COLOUR_NAMES: { C: 'Cyan', M: 'Magenta', Y: 'Yellow', K: 'Black', Aqua: 'Aqua', White: 'White', UV: 'UV', Drip: 'Drip' },
    LAMINATION: ['BOPP Gloss Wet Lamination', 'Matte Wet Lamination', 'Gloss Thermal Lamination', 'Matte Thermal Lamination', 'Matt Velvet Lamination', 'Metpet Lamination'],
    FOILING: ['Spot UV', 'Gloss', 'Regular Hot Foil', '3D Scodix Foil', 'Cast and Cure'],
    PUNCHING: ['Bobst Machine', 'Hand Punch']
  };
  // Department contacts shown in the Contact window (clients and visitors only)
  PM.DEPARTMENTS = [
    { name: 'Planning', phone: '9110600828', email: 'planning@pmoffsetprinters.com' },
    { name: 'Dispatch', phone: '9148856268', email: '' },
    { name: 'Billing', phone: '9035404344', email: 'accounts@pmoffsetprinters.com' },
    { name: 'Design', phone: '9611896022', email: 'design@pmoffsetprinters.com' },
    { name: 'Purchase & Logistics', phone: '9620956044', email: 'purchase@pmoffsetprinters.com' }
  ];
  PM.ROLE_LABELS = { head_admin: 'Managing Director', planning: 'Planning', staff: 'Staff' };

  PM.state = {
    user: null,     // staff user { id, username, role }
    client: null,   // { code, password, company, pos: [] }
    view: null
  };

  /* ------------------------------------------------------------------------
     DOM helpers
     ------------------------------------------------------------------------ */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  PM.$ = $;
  PM.$$ = $$;

  function esc(v) {
    if (v === null || v === undefined) return '';
    return String(v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  PM.esc = esc;

  /** "2461" → "PO 2461"; leaves "PO-2461" as-is */
  PM.poLabel = function (n) {
    n = String(n || '').trim();
    return /^p\.?\s*o\b|^po[-\s\d]/i.test(n) ? n : 'PO ' + n;
  };

  function debounce(fn, ms) {
    let t;
    return function () {
      const args = arguments;
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms || 200);
    };
  }
  PM.debounce = debounce;

  /* ------------------------------------------------------------------------
     API
     ------------------------------------------------------------------------ */
  async function request(method, url, body) {
    const opts = {
      method,
      credentials: 'same-origin',
      headers: { Accept: 'application/json' }
    };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    let res;
    try {
      res = await fetch(url, opts);
    } catch (e) {
      const err = new Error('Could not reach the server. Please check your connection.');
      err.status = 0;
      throw err;
    }
    let data = null;
    const text = await res.text();
    if (text) {
      try { data = JSON.parse(text); } catch (e) { data = { message: text }; }
    }
    if (!res.ok) {
      const err = new Error((data && (data.error || data.message)) || 'Request failed (' + res.status + ').');
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data || {};
  }
  PM.api = {
    get: (u) => request('GET', u),
    post: (u, b) => request('POST', u, b || {}),
    put: (u, b) => request('PUT', u, b || {}),
    del: (u, b) => request('DELETE', u, b)
  };

  /* ------------------------------------------------------------------------
     Time — server stores UTC via CURRENT_TIMESTAMP ("YYYY-MM-DD HH:MM:SS").
     Append 'Z' so JS parses as UTC, then display in Asia/Kolkata.
     ------------------------------------------------------------------------ */
  const IST = 'Asia/Kolkata';
  const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

  function parseTS(ts) {
    if (ts === null || ts === undefined || ts === '') return null;
    if (ts instanceof Date) return isNaN(ts) ? null : ts;
    if (typeof ts === 'number') return new Date(ts);
    let s = String(ts).trim();
    if (DATE_ONLY.test(s)) return new Date(s + 'T00:00:00+05:30');
    s = s.replace(' ', 'T');
    if (!/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)) s += 'Z';
    const d = new Date(s);
    return isNaN(d) ? null : d;
  }
  PM.parseTS = parseTS;

  const fmtDT = new Intl.DateTimeFormat('en-GB', {
    timeZone: IST, day: 'numeric', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true
  });
  const fmtDTShort = new Intl.DateTimeFormat('en-GB', {
    timeZone: IST, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true
  });
  const fmtD = new Intl.DateTimeFormat('en-GB', { timeZone: IST, day: 'numeric', month: 'short', year: 'numeric' });
  const fmtDUTC = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });

  /** Full timestamp in IST, e.g. "30 Sept 2026, 3:45 pm" */
  PM.fmtDateTime = function (ts, withZone) {
    const d = parseTS(ts);
    if (!d) return '—';
    if (typeof ts === 'string' && DATE_ONLY.test(ts.trim())) return PM.fmtDate(ts);
    return fmtDT.format(d) + (withZone ? ' IST' : '');
  };
  /** Short timestamp in IST, e.g. "30 Sept, 3:45 pm" */
  PM.fmtShort = function (ts) {
    const d = parseTS(ts);
    return d ? fmtDTShort.format(d) : '';
  };
  /** Calendar date. Plain dates (YYYY-MM-DD) are shown as-is, never shifted. */
  PM.fmtDate = function (v) {
    if (!v) return '—';
    const s = String(v).trim();
    if (DATE_ONLY.test(s)) {
      const d = new Date(s + 'T00:00:00Z');
      return isNaN(d) ? s : fmtDUTC.format(d);
    }
    const d = parseTS(s);
    return d ? fmtD.format(d) : s;
  };
  PM.tsValue = function (v) {
    const d = parseTS(v);
    return d ? d.getTime() : 0;
  };
  /** Today's date in IST as YYYY-MM-DD (for date inputs) */
  PM.todayIST = function () {
    return new Intl.DateTimeFormat('en-CA', { timeZone: IST, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  };
  /** Normalise a stored date for <input type=date> */
  PM.toDateInput = function (v) {
    if (!v) return '';
    const s = String(v).trim();
    if (DATE_ONLY.test(s)) return s;
    if (/^\d{4}-\d{2}-\d{2}/.test(s) && s.length <= 10) return s.slice(0, 10);
    const d = parseTS(s);
    if (!d) return '';
    return new Intl.DateTimeFormat('en-CA', { timeZone: IST, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  };

  /* ------------------------------------------------------------------------
     Normalisers — tolerant of a few naming variations in API payloads
     ------------------------------------------------------------------------ */
  function truthy(v) {
    return v === true || v === 1 || v === '1' || v === 'true' || v === 'yes' || v === 'Yes';
  }
  PM.truthy = truthy;

  function asArray(v) {
    if (v === null || v === undefined || v === '') return [];
    if (Array.isArray(v)) return v;
    if (typeof v === 'string') {
      const s = v.trim();
      if (s.startsWith('[')) {
        try { const a = JSON.parse(s); if (Array.isArray(a)) return a; } catch (e) { /* fall through */ }
      }
      return s.split(',').map((x) => x.trim()).filter(Boolean);
    }
    return [v];
  }
  PM.asArray = asArray;

  function pickArray(data, keys) {
    if (Array.isArray(data)) return data;
    if (!data || typeof data !== 'object') return [];
    for (const k of keys || []) if (Array.isArray(data[k])) return data[k];
    for (const k in data) if (Array.isArray(data[k])) return data[k];
    return [];
  }
  PM.pickArray = pickArray;

  function listStr(v) {
    return asArray(v).map((x) => (typeof x === 'object' && x ? x.name || x.value || '' : String(x))).filter(Boolean).join(', ');
  }
  PM.listStr = listStr;

  function clampStage(n) {
    n = parseInt(n, 10);
    if (!n || n < 1) return 1;
    return n > 6 ? 6 : n;
  }

  PM.normNote = function (n) {
    if (typeof n === 'string') return { id: null, text: n, author: '', at: null };
    return {
      id: n.id != null ? n.id : n.note_id,
      text: n.note != null ? n.note : (n.text != null ? n.text : n.message || ''),
      author: n.author || n.user || n.username || n.created_by || '',
      at: n.created_at || n.timestamp || n.date || null
    };
  };

  PM.normJob = function (j, i) {
    j = j || {};
    const notes = pickArray(j.notes || j.activity || j.activity_log || [], []).map(PM.normNote);
    notes.sort((a, b) => PM.tsValue(b.at) - PM.tsValue(a.at));
    const card = j.card && typeof j.card === 'object' ? j.card : null;
    return {
      raw: j,
      id: j.id != null ? j.id : j.job_id,
      jc_no: j.jc_no || '',
      card: card,
      entries: j.entries || null,
      job_size: j.job_size || (card && card.job_size) || '',
      qty: (card && card.quantity) || j.quantity || j.quantity_specs || '',
      lamination: asArray(j.lamination || (card && card.lamination) || []),
      foiling: asArray(j.foiling || (card && card.foiling) || []),
      isPublic: j.product_name !== undefined && !card,
      name: j.job_name || j.name || j.job_type || j.title || 'Job ' + ((i || 0) + 1),
      quantity_specs: j.quantity_specs || j.quantity || j.specs || '',
      finish_type: listStr(j.finish_type || j.finish),
      gsm: j.gsm != null ? String(j.gsm) : '',
      process: listStr(j.process),
      embellishments: j.embellishments,
      cast_and_cure: j.cast_and_cure != null ? j.cast_and_cure : j.cast_cure,
      other: j.other_specifications || j.other_specs || j.other || '',
      stage: clampStage(j.current_stage != null ? j.current_stage : j.stage),
      delayed: truthy(j.is_delayed != null ? j.is_delayed : j.delayed),
      delay_reason: j.delay_reason || '',
      history: pickArray(j.stages || j.stage_history || j.stageHistory || [], []),
      notes,
      archived: truthy(j.is_archived),
      archived_at: j.archived_at || null,
      created_at: j.created_at,
      updated_at: j.updated_at
    };
  };

  /** Jobs that are not archived */
  PM.activeJobs = function (po) {
    return (po.jobs || []).filter((j) => !j.archived);
  };

  function normCodes(p) {
    const src = p.clients || p.client_codes || p.linked_clients || p.codes || p.client_code;
    return asArray(src)
      .map((c) => (c && typeof c === 'object' ? c.client_code || c.code || '' : String(c)))
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
  }
  function normClientIds(p) {
    if (p.client_ids != null) return asArray(p.client_ids).map((x) => String(x));
    if (Array.isArray(p.clients)) {
      return p.clients
        .filter((c) => c && typeof c === 'object')
        .map((c) => String(c.client_id != null ? c.client_id : c.id))
        .filter((x) => x !== 'undefined');
    }
    return [];
  }

  PM.normPO = function (p) {
    p = p || {};
    const rawJobs = p.jobs || p.po_jobs;
    const jobs = Array.isArray(rawJobs) ? rawJobs.map(PM.normJob) : null;
    const status = String(p.status || '').toLowerCase();
    return {
      raw: p,
      id: p.id != null ? p.id : p.po_id,
      number: p.po_number || p.poNumber || p.po_no || p.number || p.order_id || '',
      customer: p.customer_name || p.client_name || p.company_name || p.customer || '',
      date: p.date_of_order || p.po_date || p.order_date || p.date || '',
      delivery: p.estimated_delivery || p.delivery_date || p.due_date || '',
      codes: normCodes(p),
      clientIds: normClientIds(p),
      jobs,
      jobCount: jobs ? jobs.filter((j) => !j.archived).length : parseInt(p.job_count || p.jobs_count || 0, 10) || 0,
      jobNames: jobs ? jobs.map((j) => j.name) : asArray(p.job_names || p.jobs_summary || ''),
      archived: truthy(p.is_archived != null ? p.is_archived : p.archived) || status === 'archived',
      archived_at: p.archived_at || null,
      created_at: p.created_at,
      updated_at: p.updated_at
    };
  };

  /** Summary numbers for a PO */
  PM.poStats = function (po) {
    const jobs = PM.activeJobs(po);
    if (!jobs.length) return { pct: 0, delayed: 0, ready: 0, total: 0 };
    const sum = jobs.reduce((a, j) => a + (j.stage - 1) / 5, 0);
    return {
      pct: Math.round((sum / jobs.length) * 100),
      delayed: jobs.filter((j) => j.delayed).length,
      ready: jobs.filter((j) => j.stage === 6).length,
      total: jobs.length
    };
  };

  /* ------------------------------------------------------------------------
     Shared renderers (public, client, admin)
     ------------------------------------------------------------------------ */
  const CHECK_SVG = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M3 8.5l3.2 3L13 5"/></svg>';

  function stageWhen(job, n) {
    const h = job.history.find((e) => clampStage(e.stage != null ? e.stage : (e.number != null ? e.number : e.stage_number)) === n && e.completed !== false);
    return h ? h.completed_at || h.created_at || h.updated_at || null : null;
  }

  /* Colour along the C → M → Y → K spectrum, t in [0, 1] */
  const INK_STOPS = [[0, [0, 180, 216]], [1 / 3, [224, 64, 251]], [2 / 3, [253, 216, 53]], [1, [17, 17, 17]]];
  function inkAt(t) {
    for (let k = 1; k < INK_STOPS.length; k++) {
      const [t1, c1] = INK_STOPS[k];
      const [t0, c0] = INK_STOPS[k - 1];
      if (t <= t1) {
        const f = (t - t0) / (t1 - t0);
        return c0.map((v, i) => Math.round(v + (c1[i] - v) * f));
      }
    }
    return INK_STOPS[INK_STOPS.length - 1][1];
  }
  function rgb(c) { return 'rgb(' + c.join(',') + ')'; }
  function onInk(c) { return (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255 > 0.62 ? '#1d1d1f' : '#fff'; }
  PM.stageInk = function (n) { return rgb(inkAt((n - 1) / 5)); };

  PM.renderPipeline = function (job, editable) {
    const items = PM.STAGES.map((name, i) => {
      const n = i + 1;
      const ink = inkAt(i / 5), prev = inkAt(Math.max(0, i - 1) / 5);
      const vars = '--ink:' + rgb(ink) + ';--prev:' + rgb(prev) + ';--on-ink:' + onInk(ink);
      let cls = 'pending';
      if (n < job.stage) cls = 'done';
      else if (n === job.stage) cls = 'current' + (n === 6 ? ' final' : '') + (job.delayed ? ' delayed' : '');
      const when = n <= job.stage ? stageWhen(job, n) : null;
      const dot = cls === 'done' || cls.indexOf('final') > -1 ? CHECK_SVG : String(n);
      return (
        '<li class="' + cls + '" data-stage="' + n + '" style="' + vars + '"' + (editable ? ' title="Set stage: ' + esc(name) + '"' : '') + '>' +
        '<span class="dot">' + dot + '</span>' +
        '<span class="name">' + esc(name) + '</span>' +
        (when ? '<span class="when">' + esc(PM.fmtShort(when)) + '</span>' : '') +
        '</li>'
      );
    }).join('');
    return '<ol class="pipeline' + (editable ? ' editable' : '') + '" data-job-id="' + esc(job.id) + '" aria-label="Production stages">' + items + '</ol>';
  };

  function flagVal(v) {
    if (v === null || v === undefined || v === '' || v === 0 || v === '0' || v === false || v === 'false' || v === 'no' || v === 'No') {
      return '<span class="no">No</span>';
    }
    if (truthy(v)) return '<span class="yes">Yes</span>';
    return esc(v);
  }

  function chips(list) {
    return list && list.length
      ? '<span class="tag-list">' + list.map((x) => '<span class="tag">' + esc(x) + '</span>').join('') + '</span>'
      : '<span class="no">—</span>';
  }
  function dash(v) { return v ? esc(v) : '<span class="no">—</span>'; }
  function specGrid(rows) {
    return '<div class="specs">' + rows.map((s) =>
      '<div class="spec' + (s[2] ? ' wide' : '') + '"><span class="k">' + s[0] + '</span><span class="v">' + s[1] + '</span></div>'
    ).join('') + '</div>';
  }
  function legacySpecs(job) {
    const rows = [];
    if (job.gsm) rows.push(['GSM', esc(job.gsm)]);
    if (job.process) rows.push(['Process', esc(job.process)]);
    if (flagOn(job.embellishments)) rows.push(['Embellishments', flagVal(job.embellishments)]);
    if (flagOn(job.cast_and_cure)) rows.push(['Cast &amp; cure', flagVal(job.cast_and_cure)]);
    if (job.other) rows.push(['Other specifications', esc(job.other), true]);
    return rows;
  }
  function flagOn(v) { return truthy(v) || (!!v && !/^(0|false|no)$/i.test(String(v))); }
  PM.flagOn = flagOn;

  /** Collapsible section that remembers whether it was open across re-renders */
  PM.foldOpen = new Set();
  PM.foldHTML = function (key, title, body) {
    return '<details class="prod" data-fold-key="' + esc(key) + '"' + (PM.foldOpen.has(key) ? ' open' : '') + '><summary>' + title + '</summary>' + body + '</details>';
  };

  PM.colourSwatch = function (name) {
    return '<span class="swatch sw-' + esc(String(name).toLowerCase()) + '" aria-hidden="true"></span>';
  };

  /** Details shown under a job. Staff see the whole job card; clients see a short public set. */
  PM.renderSpecs = function (job) {
    const c = job.card;
    if (c) {
      let html = specGrid([
        ['Job size', dash(c.job_size)],
        ['Quantity', dash(c.quantity || job.quantity_specs)],
        ['Material', dash(c.material)],
        ['Machine', c.machine ? esc(c.machine) : dash('')],
        ['Lamination', chips(c.lamination)],
        ['Foiling', chips(c.foiling)]
      ]);

      const rows = [
        ['Material rate', dash(c.material_rate)],
        ['Bill no.', dash(c.bill_no)],
        ['Bill date', c.bill_date ? esc(PM.fmtDate(c.bill_date)) : dash('')],
        ['New plate no.', dash(c.new_plate_no)],
        ['Old plate no.', dash(c.old_plate_no)],
        ['Die no.', dash(c.die_no)],
        ['Punching / binding', chips(c.punching)]
      ];
      if (c.job_details) rows.push(['Job details', esc(c.job_details), true]);
      if (c.processing_details) rows.push(['Processing details', esc(c.processing_details), true]);
      let inner = specGrid(rows);

      const cols = c.machine ? PM.JC.COLOURS[c.machine] : [];
      const colourCells = cols.map((n) => {
        const v = (c.colours || {})[n] || {};
        return '<div class="ink-cell' + (v.plate || v.ink ? ' on' : '') + '">' + PM.colourSwatch(n) +
          '<span class="ink-name">' + esc(n) + '</span>' +
          '<span class="ink-plate">' + (v.plate ? '✓ Plate' : '') + '</span>' +
          '<span class="ink-amt">' + esc(v.ink || '') + '</span></div>';
      }).join('');
      if (colourCells) inner += '<div class="card-sec-title">Plate details &amp; inks consumption · ' + esc(c.machine) + '</div><div class="ink-grid">' + colourCells + '</div>';

      const ins = [];
      if (c.printing_instructions) ins.push(['Printing instructions', esc(c.printing_instructions), true]);
      if (c.foiling_instructions) ins.push(['Foiling instructions', esc(c.foiling_instructions), true]);
      if (c.packing_instructions) ins.push(['Packing instructions', esc(c.packing_instructions), true]);
      if (ins.length) inner += '<div class="card-sec-title">Instructions</div>' + specGrid(ins);

      const legacy = legacySpecs(job);
      if (legacy.length) inner += '<div class="card-sec-title">Earlier details</div>' + specGrid(legacy);

      html += PM.foldHTML('card-' + job.id, 'Full job card' + (job.jc_no ? ' <span class="muted">· ' + esc(job.jc_no) + '</span>' : ''), '<div class="fold-body">' + inner + '</div>');
      return '<div class="jobcard-view">' + html + '</div>';
    }
    if (job.isPublic) {
      return specGrid([
        ['Job size', dash(job.job_size)],
        ['Quantity', dash(job.qty)],
        ['Lamination', chips(job.lamination)],
        ['Foiling', chips(job.foiling)]
      ]);
    }
    const legacy = legacySpecs(job);
    return legacy.length ? specGrid(legacy) : '';
  };

  PM.renderNotes = function (job, opts) {
    opts = opts || {};
    const limit = opts.limit || 3;
    const notes = job.notes || [];
    const items = notes.map((n, i) => (
      '<li class="note' + (i >= limit ? ' hidden extra' : '') + '">' +
      '<div class="note-meta"><span>' + esc(PM.fmtDateTime(n.at)) + '</span>' +
      (n.author ? '<span>· ' + esc(n.author) + '</span>' : '') +
      (opts.canDelete && n.id != null ? '<button type="button" class="link-btn danger small" data-action="delete-note" data-note-id="' + esc(n.id) + '">Remove</button>' : '') +
      '</div>' +
      '<div class="note-text">' + esc(n.text) + '</div></li>'
    )).join('');
    return (
      '<div class="notes">' +
      '<div class="notes-head"><span>Notes' + (notes.length ? ' (' + notes.length + ')' : '') + '</span>' +
      (notes.length > limit ? '<button type="button" class="link-btn small notes-toggle" data-action="toggle-notes">Show all</button>' : '') +
      '</div>' +
      (notes.length ? '<ul class="note-list">' + items + '</ul>' : '<p class="note-empty">No notes yet.</p>') +
      (opts.form
        ? '<form class="note-form" data-action="add-note" data-job-id="' + esc(job.id) + '"><input type="text" name="note" placeholder="Add a note visible to the client…" maxlength="1000" required><button type="submit" class="btn btn-sm">Add</button></form>'
        : '') +
      '</div>'
    );
  };

  PM.jobBadge = function (job) {
    if (job.delayed) return '<span class="badge badge-warn">Delayed</span>';
    if (job.stage === 6) return '<span class="badge badge-ok">Ready / Shipped</span>';
    return '<span class="badge badge-crimson" style="color:' + PM.stageInk(job.stage) + '"><span style="color:var(--text)">' + esc(PM.STAGES[job.stage - 1]) + '</span></span>';
  };

  /**
   * opts: { editable, actionsHtml, noteForm, canDeleteNotes }
   */
  PM.renderJob = function (job, idx, opts) {
    opts = opts || {};
    return (
      '<article class="job' + (job.delayed ? ' is-delayed' : '') + '" data-job-id="' + esc(job.id) + '">' +
      '<header class="job-head"><div class="job-title">' +
      '<h4>' + esc(job.name) + '</h4>' +
      '<span class="job-index">' + (job.jc_no ? 'J.C. No. ' + esc(job.jc_no) : 'Job ' + (idx + 1)) + (job.qty ? ' · ' + esc(job.qty) : '') + '</span>' +
      '</div><div class="job-actions">' + PM.jobBadge(job) + (opts.actionsHtml || '') + '</div></header>' +
      '<div class="job-body">' +
      (job.delayed
        ? '<div class="delay-banner"><div><strong>Delayed.</strong>' + (job.delay_reason ? ' ' + esc(job.delay_reason) : '') + '</div></div>'
        : '') +
      PM.renderPipeline(job, !!opts.editable) +
      PM.renderSpecs(job) +
      (opts.afterSpecs || '') +
      PM.renderNotes(job, { form: opts.noteForm, canDelete: opts.canDeleteNotes }) +
      '</div></article>'
    );
  };

  PM.renderCodes = function (codes) {
    return (codes || []).map((c) => '<span class="code-chip">' + esc(c) + '</span>').join('');
  };

  /** Collapsible PO row summary (client + admin) */
  PM.renderPOSummary = function (po) {
    const st = PM.poStats(po);
    const jobsLabel = po.jobs ? st.total + (st.total === 1 ? ' job' : ' jobs') : (po.jobCount ? po.jobCount + ' jobs' : 'Jobs');
    const remaining = po.jobs ? 100 - st.pct : 100;
    const flags = [];
    if (st.delayed) flags.push('<span class="badge badge-warn">' + st.delayed + ' delayed</span>');
    if (po.jobs && !st.total) flags.push('<span class="badge badge-muted no-dot">No jobs</span>');
    if (po.jobs && st.total && st.ready === st.total) flags.push('<span class="badge badge-ok">Ready</span>');
    return (
      '<div class="po-summary" tabindex="0" role="button" aria-expanded="false">' +
      '<div class="po-id"><span class="po-number">' + esc(po.number) + '</span>' +
      '<span class="cust">' + esc(po.customer || '—') + '</span>' +
      (po.codes.length ? '<div class="codes">' + PM.renderCodes(po.codes) + '</div>' : '') +
      '</div>' +
      '<div class="po-progress"><div class="bar"><span style="width:' + remaining + '%"></span></div>' +
      '<div class="lbl"><span>' + jobsLabel + '</span><span>' + (po.jobs ? st.pct + '% complete' : '') + '</span></div></div>' +
      '<div class="po-dates"><div><span class="k">Ordered</span>' + esc(PM.fmtDate(po.date)) + '</div>' +
      '<div><span class="k">Due</span>' + esc(PM.fmtDate(po.delivery)) + '</div></div>' +
      '<div style="display:flex;gap:10px;align-items:center;justify-content:flex-end">' +
      '<div class="po-flags">' + flags.join('') + '</div><span class="chev" aria-hidden="true">' +
      '<svg width="11" height="7" viewBox="0 0 12 8"><path d="M1 1l5 5 5-5" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></span></div>' +
      '</div>'
    );
  };


  /** Filter + sort helper shared by client & admin lists */
  PM.filterPOs = function (pos, f) {
    const q = (f.q || '').trim().toLowerCase().replace(/\s+/g, '');
    let out = pos.filter((po) => {
      if (q) {
        const hay = [po.number, po.customer, po.codes.join(' '), PM.activeJobs(po).map((j) => j.name + ' ' + j.jc_no + ' ' + j.qty).join(' '), po.jobNames.join(' ')]
          .join(' ').toLowerCase().replace(/\s+/g, '');
        if (hay.indexOf(q) === -1) return false;
      }
      if (f.stage) {
        const s = parseInt(f.stage, 10);
        if (!PM.activeJobs(po).some((j) => j.stage === s)) return false;
      }
      if (f.status) {
        const st = PM.poStats(po);
        if (f.status === 'delayed' && !st.delayed) return false;
        if (f.status === 'ontrack' && st.delayed) return false;
        if (f.status === 'ready' && !(st.total && st.ready === st.total)) return false;
        if (f.status === 'inprogress' && st.total && st.ready === st.total) return false;
      }
      if (f.from && PM.toDateInput(po.date) && PM.toDateInput(po.date) < f.from) return false;
      if (f.to && PM.toDateInput(po.date) && PM.toDateInput(po.date) > f.to) return false;
      return true;
    });
    const by = f.sort || 'newest';
    const dateOf = (po) => PM.tsValue(po.date) || PM.tsValue(po.created_at);
    out.sort((a, b) => {
      if (by === 'oldest') return dateOf(a) - dateOf(b);
      if (by === 'delivery') return (PM.tsValue(a.delivery) || Infinity) - (PM.tsValue(b.delivery) || Infinity);
      if (by === 'po') return String(a.number).localeCompare(String(b.number), undefined, { numeric: true });
      if (by === 'updated') return PM.tsValue(b.updated_at) - PM.tsValue(a.updated_at);
      return dateOf(b) - dateOf(a) || PM.tsValue(b.created_at) - PM.tsValue(a.created_at);
    });
    return out;
  };

  PM.stageOptions = function (label) {
    return '<option value="">' + esc(label || 'All stages') + '</option>' +
      PM.STAGES.map((s, i) => '<option value="' + (i + 1) + '">' + (i + 1) + '. ' + esc(s) + '</option>').join('');
  };

  PM.loadingHTML = function (msg) {
    return '<div class="loading-block"><div class="spinner"></div>' + esc(msg || 'Loading…') + '</div>';
  };
  PM.emptyHTML = function (title, msg) {
    return '<div class="empty"><h4>' + esc(title) + '</h4>' + (msg ? '<p class="mb-0">' + esc(msg) + '</p>' : '') + '</div>';
  };

  /* ------------------------------------------------------------------------
     Toasts, form helpers, modals
     ------------------------------------------------------------------------ */
  PM.toast = function (msg, type, ms) {
    const wrap = $('#toasts');
    const t = document.createElement('div');
    t.className = 'toast' + (type ? ' ' + type : '');
    t.textContent = msg;
    wrap.appendChild(t);
    setTimeout(() => {
      t.classList.add('out');
      setTimeout(() => t.remove(), 320);
    }, ms || (type === 'error' ? 5000 : 3200));
  };

  PM.setError = function (form, msg) {
    const box = $('[data-error]', form);
    if (!box) { if (msg) PM.toast(msg, 'error'); return; }
    box.textContent = msg || '';
    box.classList.toggle('hidden', !msg);
  };

  PM.setLoading = function (btn, on) {
    if (!btn) return;
    btn.disabled = !!on;
    btn.classList.toggle('is-loading', !!on);
  };

  /** Wrap an async form submit with loading/error handling */
  PM.handleSubmit = function (form, fn) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = form.querySelector('button[type=submit]') || $('button[type=submit][form="' + form.id + '"]');
      PM.setError(form, '');
      PM.setLoading(btn, true);
      try {
        await fn(e);
      } catch (err) {
        PM.setError(form, err.message || 'Something went wrong.');
      } finally {
        PM.setLoading(btn, false);
      }
    });
  };

  let modalStack = [];
  /**
   * Open a generic modal.
   * opts: { title, eyebrow, subtitle, body, foot, wide, onMount(el, close), onClose }
   */
  PM.modal = function (opts) {
    const root = $('#modal-root');
    const back = document.createElement('div');
    back.className = 'modal-backdrop';
    back.setAttribute('role', 'dialog');
    back.setAttribute('aria-modal', 'true');
    back.innerHTML =
      '<div class="modal' + (opts.wide ? ' wide' : '') + '">' +
      '<button type="button" class="icon-btn modal-close" data-close aria-label="Close"><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 3l10 10M13 3L3 13"/></svg></button>' +
      '<div class="modal-head">' + (opts.eyebrow ? '<span class="eyebrow">' + esc(opts.eyebrow) + '</span>' : '') +
      '<h3>' + esc(opts.title || '') + '</h3>' + (opts.subtitle ? '<p>' + esc(opts.subtitle) + '</p>' : '') + '</div>' +
      '<div class="modal-body">' + (opts.body || '') + '</div>' +
      (opts.foot ? '<div class="modal-foot">' + opts.foot + '</div>' : '') +
      '</div>';
    root.appendChild(back);
    document.body.style.overflow = 'hidden';

    let closed = false;
    function close() {
      if (closed) return;
      closed = true;
      back.remove();
      modalStack = modalStack.filter((m) => m !== close);
      if (!modalStack.length && $('#login-modal').classList.contains('hidden')) document.body.style.overflow = '';
      if (opts.onClose) opts.onClose();
    }
    modalStack.push(close);
    back.addEventListener('mousedown', (e) => { if (e.target === back) back._downOnBack = true; });
    back.addEventListener('mouseup', (e) => {
      if (e.target === back && back._downOnBack && !opts.sticky) close();
      back._downOnBack = false;
    });
    $$('[data-close]', back).forEach((b) => b.addEventListener('click', close));
    if (opts.onMount) opts.onMount(back, close);
    const first = back.querySelector('input:not([type=hidden]):not([readonly]), select, textarea');
    if (first && !opts.noAutofocus) setTimeout(() => first.focus(), 60);
    return { el: back, close };
  };

  /** Promise-based confirmation dialog. opts: { title, message, confirmText, danger, requireText } */
  PM.confirm = function (opts) {
    return new Promise((resolve) => {
      let answered = false;
      const need = opts.requireText;
      PM.modal({
        title: opts.title || 'Are you sure?',
        eyebrow: opts.eyebrow || '',
        body:
          '<p style="margin-top:0;color:var(--text-2)">' + (opts.html || esc(opts.message || '')) + '</p>' +
          (need ? '<div class="field"><label>Type <strong>' + esc(need) + '</strong> to confirm</label><input type="text" data-confirm-input autocomplete="off"></div>' : ''),
        foot:
          '<button type="button" class="btn btn-secondary" data-close>Cancel</button>' +
          '<button type="button" class="btn ' + (opts.danger ? 'btn-danger-solid' : '') + '" data-ok' + (need ? ' disabled' : '') + '>' + esc(opts.confirmText || 'Confirm') + '</button>',
        noAutofocus: !need,
        onMount(el, close) {
          const ok = $('[data-ok]', el);
          if (need) {
            const inp = $('[data-confirm-input]', el);
            inp.addEventListener('input', () => { ok.disabled = inp.value.trim().toUpperCase() !== String(need).toUpperCase(); });
            inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !ok.disabled) ok.click(); });
          } else {
            setTimeout(() => ok.focus(), 60);
          }
          ok.addEventListener('click', () => { answered = true; close(); resolve(true); });
        },
        onClose() { if (!answered) resolve(false); }
      });
    });
  };

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (modalStack.length) { modalStack[modalStack.length - 1](); return; }
    if (!$('#login-modal').classList.contains('hidden')) closeLogin();
  });

  /* ------------------------------------------------------------------------
     Views & navigation
     ------------------------------------------------------------------------ */
  const VIEWS = ['setup', 'landing', 'track', 'client', 'admin'];

  PM.showView = function (name) {
    $('#view-boot').classList.add('hidden');
    VIEWS.forEach((v) => $('#view-' + v).classList.toggle('hidden', v !== name));
    PM.state.view = name;
    document.body.classList.toggle('on-landing', name === 'landing');
    updateNav();
    window.scrollTo(0, 0);
  };

  function updateNav() {
    const u = PM.state.user, c = PM.state.client, v = PM.state.view;
    document.body.classList.toggle('is-staff', !!u);
    const contactBtn = $('#btn-contact');
    if (contactBtn) contactBtn.classList.toggle('hidden', !!u || v === 'setup');
    const showStaff = !!u;
    const showClient = !u && !!c && v === 'client';
    $('#nav-staff').classList.toggle('hidden', !showStaff);
    $('#nav-client').classList.toggle('hidden', !showClient);
    $('#btn-staff-login').classList.toggle('hidden', showStaff || showClient || v === 'setup');
    if (u) {
      $('#nav-staff-name').textContent = u.username;
      $('#nav-staff-role').textContent = PM.ROLE_LABELS[u.role] || u.role;
    }
    if (c) $('#nav-client-name').textContent = c.company || c.code;
  }
  PM.updateNav = updateNav;

  function setUrl(qs) {
    const url = location.pathname + (qs || '');
    if (location.pathname + location.search !== url) history.pushState({}, '', url);
  }

  PM.goHome = function () {
    if (PM.state.user) {
      setUrl('');
      if (PM.Admin) PM.Admin.enter();
      return;
    }
    if (PM.state.client) { PM.showView('client'); setUrl(''); return; }
    setUrl('');
    PM.showView('landing');
  };

  window.addEventListener('popstate', () => {
    const po = new URLSearchParams(location.search).get('po');
    if (po && !PM.state.user) trackPO(po, true);
    else PM.goHome();
  });

  /* ------------------------------------------------------------------------
     Public PO tracking
     ------------------------------------------------------------------------ */
  async function trackPO(num, fromHistory) {
    num = String(num || '').trim();
    if (!num) return;
    const out = $('#track-result');
    out.innerHTML = PM.loadingHTML('Looking up ' + num + '…');
    PM.showView('track');
    if (!fromHistory) setUrl('?po=' + encodeURIComponent(num));
    try {
      const data = await PM.api.get('/api/po/track/' + encodeURIComponent(num));
      out.innerHTML = renderTrackResult(data, num);
      requestAnimationFrame(() => {
        const fg = $('.summary-ring .fg', out);
        if (fg) { const final = fg.getAttribute('data-offset'); if (final) fg.style.strokeDashoffset = final; }
      });
    } catch (err) {
      out.innerHTML =
        '<div class="completed-card">' +
        '<div class="seal muted-seal"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/></svg></div>' +
        '<h2>' + (err.status === 404 ? 'Order not found' : 'Unable to load order') + '</h2>' +
        '<p class="muted" style="max-width:420px;margin:0 auto 24px">' +
        esc(err.status === 404 ? 'We couldn\'t find PO "' + num + '". Please check the number and try again, or contact your P.M. Offset Printers representative.' : err.message) +
        '</p><button type="button" class="btn" data-go="landing">Try another PO</button></div>';
    }
  }
  PM.trackPO = trackPO;

  function renderTrackResult(data, typed) {
    const rawPO = data.po || data.purchase_order || data.order || data;
    const po = PM.normPO(rawPO);
    if (!po.jobs && Array.isArray(data.jobs)) {
      po.jobs = data.jobs.map(PM.normJob);
      po.jobCount = po.jobs.length;
    }
    const archived =
      po.archived || truthy(data.archived) || truthy(data.is_archived) || truthy(data.completed) ||
      String(data.status || '').toLowerCase() === 'archived' || String(data.status || '').toLowerCase() === 'completed';

    if (archived) {
      return (
        '<div class="completed-card">' +
        '<div class="orbs soft" aria-hidden="true"><i class="orb oc"></i><i class="orb om"></i><i class="orb oy"></i></div>' +
        '<div class="seal"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>' +
        '<span class="eyebrow">' + esc(PM.poLabel(po.number || typed)) + '</span>' +
        '<h2>Order completed.</h2>' +
        '<p class="muted" style="max-width:440px;margin:0 auto">' +
        esc(data.message && /complet/i.test(data.message) ? data.message : 'This order has been completed and delivered. Thank you for choosing P.M. Offset Printers.') +
        '</p>' +
        (po.archived_at ? '<p class="small muted" style="margin-top:14px">Completed on ' + esc(PM.fmtDate(po.archived_at)) + '</p>' : '') +
        '</div>'
      );
    }

    const jobs = po.jobs || [];
    const st = PM.poStats(po);
    const r = 28, c = 2 * Math.PI * r;
    return (
      '<div class="po-sheet">' +
      '<div class="po-hero"><div class="orbs soft" aria-hidden="true"><i class="orb oc"></i><i class="orb om"></i><i class="orb oy"></i></div><div>' +
      '<span class="eyebrow">Purchase order</span>' +
      '<h2 class="po-number">' + esc(po.number || typed) + '</h2>' +
      '<dl class="meta-list">' +
      (po.customer ? '<div class="meta"><dt>Customer</dt><dd>' + esc(po.customer) + '</dd></div>' : '') +
      '<div class="meta"><dt>Order date</dt><dd>' + esc(PM.fmtDate(po.date)) + '</dd></div>' +
      '<div class="meta"><dt>Estimated delivery</dt><dd>' + esc(PM.fmtDate(po.delivery)) + '</dd></div>' +
      '<div class="meta"><dt>Jobs</dt><dd>' + jobs.length + '</dd></div>' +
      '</dl></div>' +
      '<div class="summary-ring">' +
      '<svg class="ring" viewBox="0 0 64 64"><defs><linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="#00b4d8"/><stop offset=".5" stop-color="#e040fb"/><stop offset="1" stop-color="#fdd835"/></linearGradient></defs>' +
      '<circle class="bg" cx="32" cy="32" r="' + r + '"/>' +
      '<circle class="fg" cx="32" cy="32" r="' + r + '" stroke="url(#ringGrad)" stroke-dasharray="' + c.toFixed(2) + '" stroke-dashoffset="' + c.toFixed(2) +
      '" data-offset="' + (c * (1 - st.pct / 100)).toFixed(2) + '" transform="rotate(-90 32 32)"/></svg>' +
      '<div class="label"><strong>' + st.pct + '%</strong>complete' +
      (st.delayed ? '<br><span style="color:var(--warn)">' + st.delayed + ' job' + (st.delayed > 1 ? 's' : '') + ' delayed</span>' : '') +
      '</div></div></div>' +
      '<div class="jobs-list">' +
      (jobs.length ? jobs.map((j, i) => PM.renderJob(j, i)).join('') : '<div class="empty" style="box-shadow:none;background:var(--fill)"><h4>Jobs are being prepared</h4><p class="mb-0">Job details for this PO will appear here shortly.</p></div>') +
      '</div></div>'
    );
  }

  /* Delegated: toggle notes + [data-go] links */
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-action="toggle-notes"]');
    if (t) {
      const wrap = t.closest('.notes');
      const extras = $$('.note.extra', wrap);
      const show = extras.some((x) => x.classList.contains('hidden'));
      extras.forEach((x) => x.classList.toggle('hidden', !show));
      t.textContent = show ? 'Show less' : 'Show all';
      return;
    }
    const go = e.target.closest('[data-go]');
    if (go) {
      const where = go.getAttribute('data-go');
      if (where === 'landing') { setUrl(''); PM.showView(PM.state.user ? 'admin' : 'landing'); if (PM.state.user && PM.Admin) PM.Admin.enter(); }
    }
  });

  /* ------------------------------------------------------------------------
     Client dashboard
     ------------------------------------------------------------------------ */
  const clientFilters = { q: '', stage: '', status: '', sort: 'newest' };
  const clientOpen = new Set();

  async function clientLogin(code, password) {
    const data = await PM.api.post('/api/clients/dashboard', { client_code: code, code: code, password: password });
    const cl = data.client || data;
    const pos = pickArray(data, ['pos', 'purchase_orders', 'active_pos', 'orders']).map(PM.normPO).filter((p) => !p.archived);
    PM.state.client = {
      code: (cl.client_code || cl.code || code).toUpperCase(),
      company: cl.company_name || data.company_name || cl.name || '',
      password,
      pos
    };
  }

  function renderClientDashboard() {
    const c = PM.state.client;
    if (!c) return;
    $('#client-company').textContent = c.company || 'Welcome';
    $('#client-code-chip').textContent = c.code;
    const jobs = c.pos.reduce((a, p) => a + (p.jobs ? p.jobs.length : p.jobCount), 0);
    const delayed = c.pos.reduce((a, p) => a + PM.poStats(p).delayed, 0);
    $('#client-stats').innerHTML =
      '<div class="stat"><strong>' + c.pos.length + '</strong><span>Active POs</span></div>' +
      '<div class="stat"><strong>' + jobs + '</strong><span>Jobs</span></div>' +
      '<div class="stat"><strong>' + delayed + '</strong><span>Delayed</span></div>';
    renderClientList();
  }

  function renderClientList() {
    const c = PM.state.client;
    const list = $('#client-pos');
    const pos = PM.filterPOs(c.pos, clientFilters);
    $('#client-count').textContent = c.pos.length ? 'Showing ' + pos.length + ' of ' + c.pos.length + ' active purchase orders' : '';
    if (!c.pos.length) {
      list.innerHTML = PM.emptyHTML('No active orders', 'When a new purchase order is placed, it will appear here.');
      return;
    }
    if (!pos.length) {
      list.innerHTML = PM.emptyHTML('No matching orders', 'Try a different search or clear the filters.');
      return;
    }
    list.innerHTML = pos.map((po) => {
      const open = clientOpen.has(String(po.id != null ? po.id : po.number));
      return '<div class="po-card' + (open ? ' open' : '') + '" data-key="' + esc(po.id != null ? po.id : po.number) + '">' +
        PM.renderPOSummary(po) +
        '<div class="po-detail' + (open ? '' : ' hidden') + '">' + (open ? clientDetail(po) : '') + '</div></div>';
    }).join('');
    $$('.po-card.open .po-summary', list).forEach((s) => s.setAttribute('aria-expanded', 'true'));
  }

  function clientDetail(po) {
    const jobs = po.jobs || [];
    if (!jobs.length) return '<p class="muted" style="padding-top:16px">Job details will appear here once added.</p>';
    return jobs.map((j, i) => PM.renderJob(j, i)).join('');
  }

  /** Accordion toggling (shared) — onOpen(card, key) returns html or undefined */
  PM.bindAccordion = function (container, openSet, onOpen) {
    function toggle(summary) {
      const card = summary.closest('.po-card');
      const key = card.getAttribute('data-key');
      const detail = $('.po-detail', card);
      const open = !card.classList.contains('open');
      card.classList.toggle('open', open);
      summary.setAttribute('aria-expanded', String(open));
      detail.classList.toggle('hidden', !open);
      if (open) { openSet.add(key); onOpen(card, key, detail); } else { openSet.delete(key); }
    }
    container.addEventListener('click', (e) => {
      const s = e.target.closest('.po-summary');
      if (s && container.contains(s)) toggle(s);
    });
    container.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('po-summary')) {
        e.preventDefault();
        toggle(e.target);
      }
    });
  };

  async function refreshClient(btn) {
    const c = PM.state.client;
    if (!c) return;
    PM.setLoading(btn, true);
    try {
      await clientLogin(c.code, c.password);
      renderClientDashboard();
      PM.toast('Orders refreshed.');
    } catch (err) {
      PM.toast(err.message, 'error');
      if (err.status === 401 || err.status === 403) clientLogout();
    } finally {
      PM.setLoading(btn, false);
    }
  }

  /* Contact window: department phone numbers and emails */
  const ICON_WA = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.4.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6a2.7 2.7 0 0 0 1.8-1.2 2.2 2.2 0 0 0 .1-1.2c0-.1-.2-.2-.5-.3z"/></svg>';
  const ICON_MAIL = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="4.5" width="15" height="11" rx="2"/><path d="M3 6l7 5 7-5"/></svg>';
  function fmtPhone(p) {
    const d = String(p).replace(/\D/g, '').slice(-10);
    return '+91 ' + d.slice(0, 5) + ' ' + d.slice(5);
  }
  function openContact() {
    PM.modal({
      title: 'Contact us',
      subtitle: 'Tap a number to chat on WhatsApp, or an email to write to us. Please have your PO number ready.',
      body: '<div class="dept-list">' + PM.DEPARTMENTS.map((d) =>
        '<div class="dept"><span class="dept-name">' + esc(d.name) + '</span><div class="dept-actions">' +
        '<a class="wa" href="https://wa.me/91' + esc(String(d.phone).replace(/\D/g, '').slice(-10)) + '" target="_blank" rel="noopener" title="Chat with ' + esc(d.name) + ' on WhatsApp">' + ICON_WA + esc(fmtPhone(d.phone)) + '</a>' +
        (d.email ? '<a href="mailto:' + esc(d.email) + '" title="Email ' + esc(d.name) + '">' + ICON_MAIL + esc(d.email) + '</a>' : '') +
        '</div></div>').join('') + '</div>' +
        '<p class="contact-hours">Mon &ndash; Sat &middot; 9:00 am &ndash; 6:00 pm IST</p>',
      noAutofocus: true
    });
  }
  PM.openContact = openContact;
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-open-contact]')) openContact();
  });

  /* Alert preferences: each contact picks email and/or WhatsApp */
  async function openClientAlerts() {
    let contacts;
    try {
      contacts = PM.pickArray(await PM.api.get('/api/clients/me/preferences'), ['contacts']);
    } catch (err) {
      PM.toast(err.message, 'error');
      if (err.status === 401) clientLogout();
      return;
    }
    const rows = contacts.length
      ? contacts.map((c) =>
        '<div class="pref-row" data-id="' + esc(c.id) + '"><div class="pref-who"><strong>' + esc(c.name || 'Contact') + '</strong>' +
        (c.designation ? '<span>' + esc(c.designation) + '</span>' : '') + '</div><div class="pref-opts">' +
        prefSwitch('notify_email', 'Email', c.email, truthy(c.notify_email), 'No email on file') +
        prefSwitch('notify_whatsapp', 'WhatsApp', c.phone, truthy(c.notify_whatsapp), 'No mobile on file') +
        '</div></div>').join('')
      : '<p class="muted">There are no contacts on your account yet. Please ask P.M. Offset Printers to add your contact details.</p>';
    PM.modal({
      title: 'Order updates',
      subtitle: 'Get a message every time one of your jobs moves to the next stage. Choose how each person hears from us.',
      body: '<div class="pref-list">' + rows + '</div>' +
        '<p class="small muted" style="margin:14px 0 0">To change an email address or mobile number, contact your P.M. Offset Printers representative.</p>',
      foot: contacts.length ? '<button type="button" class="btn btn-secondary" data-close>Cancel</button><button type="button" class="btn" data-save-prefs>Save</button>' : '<button type="button" class="btn" data-close>Close</button>',
      onMount(el, close) {
        const btn = el.querySelector('[data-save-prefs]');
        if (!btn) return;
        btn.addEventListener('click', async () => {
          const list = $$('.pref-row', el).map((r) => ({
            id: Number(r.getAttribute('data-id')),
            notify_email: r.querySelector('[data-pref="notify_email"]').checked ? 1 : 0,
            notify_whatsapp: r.querySelector('[data-pref="notify_whatsapp"]').checked ? 1 : 0
          }));
          PM.setLoading(btn, true);
          try {
            const res = await PM.api.put('/api/clients/me/preferences', { contacts: list });
            close();
            PM.toast(res.message || 'Saved.');
          } catch (err) {
            PM.toast(err.message, 'error');
          } finally { PM.setLoading(btn, false); }
        });
      }
    });
  }

  function prefSwitch(key, label, target, on, missing) {
    const disabled = !target;
    return '<label class="switch' + (disabled ? ' disabled' : '') + '" title="' + esc(disabled ? missing : target) + '">' +
      '<input type="checkbox" data-pref="' + key + '"' + (on && !disabled ? ' checked' : '') + (disabled ? ' disabled' : '') + '>' +
      '<span class="track"><span class="knob"></span></span><span class="sw-text">' + label +
      '<small>' + esc(disabled ? missing : target) + '</small></span></label>';
  }

  function clientLogout() {
    PM.api.post('/api/clients/me/logout').catch(() => {});
    PM.state.client = null;
    clientOpen.clear();
    $('#client-login-form').reset();
    setUrl('');
    PM.showView('landing');
  }

  /* ------------------------------------------------------------------------
     Staff auth
     ------------------------------------------------------------------------ */
  function openLogin(step) {
    const m = $('#login-modal');
    m.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    loginStep(step || 'login');
  }
  function closeLogin() {
    $('#login-modal').classList.add('hidden');
    if (!modalStack.length) document.body.style.overflow = '';
    $$('#login-modal form').forEach((f) => { f.reset(); PM.setError(f, ''); });
  }
  function loginStep(step) {
    $$('#login-modal [data-step]').forEach((s) => s.classList.toggle('hidden', s.getAttribute('data-step') !== step));
    const first = $('#login-modal [data-step="' + step + '"] input:not([readonly])');
    if (first) setTimeout(() => first.focus(), 60);
  }
  PM.openLogin = openLogin;

  async function afterStaffLogin(user) {
    if (!user || !user.role) {
      try { const me = await PM.api.get('/api/auth/me'); user = me.user || user; } catch (e) { /* ignore */ }
    }
    PM.state.user = user;
    PM.state.client = null;
    setUrl('');
    if (PM.Admin) PM.Admin.enter();
  }

  async function staffLogout() {
    try { await PM.api.post('/api/auth/logout'); } catch (e) { /* ignore */ }
    PM.state.user = null;
    if (PM.Admin && PM.Admin.reset) PM.Admin.reset();
    setUrl('');
    PM.showView('landing');
    PM.toast('You have been logged out.');
  }
  PM.staffLogout = staffLogout;

  /* ------------------------------------------------------------------------
     Easter eggs (landing page only) — four hidden CMYK touches
       1. Click the company name 3× quickly → misregistration wobble
       2. Click the CMYK strip in order C → M → Y → K → halftone dot shower
       3. Type "cmyk" anywhere → the headline separates into four plates
       4. Click all four registration marks on the tracking card → "in register"
     ------------------------------------------------------------------------ */
  function onLanding() { return PM.state.view === 'landing'; }

  function flashClass(cls, ms) {
    document.body.classList.remove(cls);
    void document.body.offsetWidth; // restart animation
    document.body.classList.add(cls);
    setTimeout(() => document.body.classList.remove(cls), ms);
  }

  function halftoneShower() {
    const wrap = document.createElement('div');
    wrap.className = 'halftone-burst';
    const inks = ['#00b4d8', '#e040fb', '#fdd835', '#111111'];
    let html = '';
    for (let i = 0; i < 70; i++) {
      const size = 5 + Math.random() * 14;
      html += '<i style="width:' + size + 'px;height:' + size + 'px;left:' + (Math.random() * 100).toFixed(2) + '%;top:' + (Math.random() * 12).toFixed(2) +
        'vh;background:' + inks[i % 4] + ';--fall:' + (40 + Math.random() * 55).toFixed(0) + 'vh;--t:' + (1.6 + Math.random() * 1.6).toFixed(2) +
        's;animation-delay:' + (Math.random() * .6).toFixed(2) + 's"></i>';
    }
    wrap.innerHTML = html;
    document.body.appendChild(wrap);
    setTimeout(() => wrap.remove(), 4000);
  }

  function initEasterEggs() {
    // 1. Triple-click the company name
    let clicks = [];
    $('#brand-home').addEventListener('click', () => {
      if (!onLanding()) return;
      const now = Date.now();
      clicks = clicks.filter((t) => now - t < 1200);
      clicks.push(now);
      if (clicks.length >= 3) {
        clicks = [];
        flashClass('eg-misreg', 1700);
        setTimeout(() => PM.toast('Plates re-registered. Good as new.', 'cmyk'), 900);
      }
    });

    // 2. Press check: C → M → Y → K on the strip
    const order = ['c', 'm', 'y', 'k'];
    let seq = 0;
    $$('#cmyk-strip span').forEach((s) => {
      s.addEventListener('click', () => {
        if (!onLanding()) return;
        const ink = s.className;
        if (ink === order[seq]) seq++;
        else seq = ink === 'c' ? 1 : 0;
        if (seq === 4) {
          seq = 0;
          halftoneShower();
          PM.toast('Press check passed: four inks, perfectly balanced.', 'cmyk', 4200);
        }
      });
    });

    // 3. Type "cmyk"
    let buf = '';
    document.addEventListener('keydown', (e) => {
      if (!onLanding()) return;
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.length !== 1) return;
      buf = (buf + e.key.toLowerCase()).slice(-4);
      if (buf === 'cmyk') {
        buf = '';
        flashClass('eg-plates', 2600);
      }
    });

    // 4. Four registration marks
    const hit = new Set();
    $$('#track-card .reg').forEach((r) => {
      r.style.cursor = 'crosshair';
      r.addEventListener('click', () => {
        const pos = r.classList[1];
        hit.add(pos);
        r.style.color = 'var(--crimson)';
        if (hit.size === 4) {
          hit.clear();
          const card = $('#track-card');
          card.classList.add('eg-aligned');
          PM.toast('All four marks in register. You have a printer\'s eye.', 'cmyk', 4200);
          setTimeout(() => {
            card.classList.remove('eg-aligned');
            $$('#track-card .reg').forEach((x) => (x.style.color = ''));
          }, 3200);
        }
      });
    });
  }

  /* ------------------------------------------------------------------------
     Bind UI
     ------------------------------------------------------------------------ */
  function bind() {
    $('#footer-year').textContent = new Intl.DateTimeFormat('en-GB', { timeZone: IST, year: 'numeric' }).format(new Date());

    $('#brand-home').addEventListener('click', () => PM.goHome());
    $('#btn-staff-login').addEventListener('click', () => openLogin('login'));
    $('#btn-staff-logout').addEventListener('click', staffLogout);
    $('#btn-client-logout').addEventListener('click', clientLogout);

    // Login modal
    const lm = $('#login-modal');
    $$('[data-close]', lm).forEach((b) => b.addEventListener('click', closeLogin));
    lm.addEventListener('mousedown', (e) => { lm._down = e.target === lm; });
    lm.addEventListener('mouseup', (e) => { if (e.target === lm && lm._down) closeLogin(); });
    $$('[data-step-go]', lm).forEach((b) => b.addEventListener('click', () => loginStep(b.getAttribute('data-step-go'))));

    PM.handleSubmit($('#staff-login-form'), async () => {
      const username = $('#login-username').value.trim();
      const password = $('#login-password').value;
      if (!username || !password) throw new Error('Please enter your username and password.');
      const data = await PM.api.post('/api/auth/login', { username, password });
      closeLogin();
      PM.toast('Welcome, ' + ((data.user && data.user.username) || username) + '.');
      await afterStaffLogin(data.user);
    });

    let forgotUser = '';
    PM.handleSubmit($('#forgot-form'), async () => {
      forgotUser = $('#forgot-username').value.trim();
      if (!forgotUser) throw new Error('Please enter your username.');
      const data = await PM.api.post('/api/auth/forgot-password/question', { username: forgotUser });
      $('#reset-question').textContent = data.question || data.security_question || '';
      loginStep('reset');
    });

    PM.handleSubmit($('#reset-form'), async () => {
      const answer = $('#reset-answer').value.trim();
      const pw = $('#reset-new').value;
      if (!answer) throw new Error('Please answer your security question.');
      if (pw.length < 4) throw new Error('Password must be at least 4 characters.');
      if (pw !== $('#reset-confirm').value) throw new Error('Passwords do not match.');
      const data = await PM.api.post('/api/auth/forgot-password/reset', { username: forgotUser, answer, newPassword: pw, new_password: pw });
      PM.toast(data.message || 'Password reset. You can now log in.');
      $('#reset-form').reset();
      loginStep('login');
      $('#login-username').value = forgotUser;
      $('#login-password').focus();
    });

    // First-time setup
    PM.handleSubmit($('#setup-form'), async () => {
      const f = $('#setup-form');
      const username = f.username.value.trim();
      const password = f.password.value;
      if (!username) throw new Error('Please choose a username.');
      if (password.length < 4) throw new Error('Password must be at least 4 characters.');
      if (password !== f.confirm.value) throw new Error('Passwords do not match.');
      const data = await PM.api.post('/api/auth/setup', {
        username, password,
        security_question: f.security_question.value.trim(),
        security_answer: f.security_answer.value.trim()
      });
      PM.toast(data.message || 'Head admin created.');
      f.reset();
      PM.showView('landing');
      openLogin('login');
      $('#login-username').value = username;
      $('#login-password').focus();
    });

    // PO search
    PM.handleSubmit($('#po-search-form'), async () => {
      const v = $('#po-search-input').value.trim();
      if (!v) throw new Error('Please enter a PO number.');
      await trackPO(v);
    });

    // Client login
    PM.handleSubmit($('#client-login-form'), async () => {
      const code = $('#client-code').value.trim().toUpperCase().replace(/\s+/g, '');
      const password = $('#client-password').value;
      if (!code || !password) throw new Error('Please enter your client code and password.');
      await clientLogin(code, password);
      $('#client-password').value = '';
      clientOpen.clear();
      Object.assign(clientFilters, { q: '', stage: '', status: '', sort: 'newest' });
      $('#cf-search').value = ''; $('#cf-stage').value = ''; $('#cf-status').value = ''; $('#cf-sort').value = 'newest';
      renderClientDashboard();
      PM.showView('client');
    });

    // Client toolbar
    $('#cf-stage').innerHTML = PM.stageOptions('All stages');
    $('#cf-search').addEventListener('input', debounce((e) => { clientFilters.q = e.target.value; renderClientList(); }, 150));
    $('#cf-stage').addEventListener('change', (e) => { clientFilters.stage = e.target.value; renderClientList(); });
    $('#cf-status').addEventListener('change', (e) => { clientFilters.status = e.target.value; renderClientList(); });
    $('#cf-sort').addEventListener('change', (e) => { clientFilters.sort = e.target.value; renderClientList(); });
    $('#client-refresh').addEventListener('click', (e) => refreshClient(e.currentTarget));
    $('#client-alerts').addEventListener('click', openClientAlerts);
    PM.bindAccordion($('#client-pos'), clientOpen, (card, key, detail) => {
      const po = PM.state.client.pos.find((p) => String(p.id != null ? p.id : p.number) === key);
      if (po) detail.innerHTML = clientDetail(po);
    });

    initEasterEggs();
  }

  /* ------------------------------------------------------------------------
     Boot
     ------------------------------------------------------------------------ */
  async function boot() {
    bind();

    let needsSetup = false;
    try {
      const s = await PM.api.get('/api/auth/needs-setup');
      needsSetup = truthy(s.needsSetup);
    } catch (e) { /* server will tell us later */ }
    if (needsSetup) { PM.showView('setup'); return; }

    try {
      const me = await PM.api.get('/api/auth/me');
      if (me && me.user) {
        PM.state.user = me.user;
        if (PM.Admin) { PM.Admin.enter(); return; }
      }
    } catch (e) { /* not logged in */ }

    const po = new URLSearchParams(location.search).get('po');
    if (po) { $('#po-search-input').value = po; trackPO(po, true); return; }
    PM.showView('landing');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
