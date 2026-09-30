/* ==========================================================================
   P.M. Offset Printers — Order Tracking
   app2.js — Staff / Admin dashboard
   Tabs: Orders · Archive · Manage Clients · Manage Team (MD) · Audit Log (MD)
   Depends on window.PM from app.js
   ========================================================================== */
(function () {
  'use strict';

  const PM = window.PM;
  const { $, $$, esc, api } = PM;

  const A = {
    bound: false,
    tab: 'orders',
    pos: [],
    archived: [],
    clients: [],
    team: [],
    logs: [],
    open: new Set(),
    filters: { q: '', stage: '', status: '', from: '', to: '', sort: 'newest' },
    archiveQ: '',
    clientQ: '',
    auditF: { q: '', action: '', mdOnly: false }
  };

  const role = () => (PM.state.user && PM.state.user.role) || 'staff';
  const isHead = () => role() === 'head_admin';
  const canChangeClientPw = () => role() === 'head_admin' || role() === 'planning';
  const keyOf = (po) => String(po.id != null ? po.id : po.number);

  /* ------------------------------------------------------------------------
     Error handling — bounce to login when the session has expired
     ------------------------------------------------------------------------ */
  function fail(err) {
    if (err && err.status === 401) {
      PM.toast('Your session has expired. Please log in again.', 'error');
      PM.state.user = null;
      reset();
      PM.showView('landing');
      PM.openLogin('login');
      return;
    }
    PM.toast((err && err.message) || 'Something went wrong.', 'error');
  }

  function idFrom(data) {
    if (!data) return null;
    const cands = [data.id, data.po_id, data.poId, data.insertId, data.lastInsertRowid,
      data.po && data.po.id, data.purchase_order && data.purchase_order.id, data.job && data.job.id, data.jobId, data.job_id];
    for (const c of cands) if (c !== undefined && c !== null) return c;
    return null;
  }

  /* ------------------------------------------------------------------------
     Enter / reset / tabs
     ------------------------------------------------------------------------ */
  function enter() {
    PM.showView('admin');
    const u = PM.state.user || {};
    const hr = parseInt(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false }).format(new Date()), 10);
    const greet = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
    $('#admin-greeting').textContent = greet + (u.username ? ', ' + u.username : '');
    $$('#admin-tabs [data-role]').forEach((t) => t.classList.toggle('hidden', role() !== t.getAttribute('data-role')));
    if (!A.bound) bindOnce();
    if ((A.tab === 'team' || A.tab === 'audit') && !isHead()) A.tab = 'orders';
    switchTab(A.tab, true);
    loadClients(true);
    loadOrders();
  }

  function reset() {
    A.pos = []; A.archived = []; A.clients = []; A.team = []; A.logs = [];
    A.open.clear();
    A.tab = 'orders';
    $$('.tab-panel').forEach((p) => (p.innerHTML = ''));
  }

  function switchTab(tab, silent) {
    A.tab = tab;
    $$('#admin-tabs .tab').forEach((t) => t.classList.toggle('active', t.getAttribute('data-tab') === tab));
    $$('.tab-panel').forEach((p) => p.classList.toggle('hidden', p.id !== 'tab-' + tab));
    if (tab === 'orders') renderOrdersShell();
    if (tab === 'archive') { renderArchiveShell(); loadArchive(); }
    if (tab === 'clients') { renderClientsShell(); loadClients(); }
    if (tab === 'team') { renderTeamShell(); loadTeam(); }
    if (tab === 'audit') { renderAuditShell(); loadAudit(); }
    if (!silent) window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function setCount(id, n) {
    const el = $('#count-' + id);
    if (el) el.textContent = n ? String(n) : '';
  }

  /* ========================================================================
     ORDERS
     ======================================================================== */
  function renderOrdersShell() {
    const el = $('#tab-orders');
    if (el.dataset.ready) { renderOrdersList(); return; }
    el.dataset.ready = '1';
    const f = A.filters;
    el.innerHTML =
      '<div class="stat-row" id="order-stats"></div>' +
      '<div class="toolbar">' +
      '<div class="field grow"><label for="of-q">Search</label><div class="input-icon"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="9" cy="9" r="6"/><path d="M13.5 13.5L18 18"/></svg><input type="search" id="of-q" placeholder="PO, customer, client code or job" value="' + esc(f.q) + '"></div></div>' +
      '<div class="field"><label for="of-stage">Stage</label><select id="of-stage">' + PM.stageOptions('All stages') + '</select></div>' +
      '<div class="field"><label for="of-status">Status</label><select id="of-status">' +
      '<option value="">All statuses</option><option value="inprogress">In progress</option><option value="delayed">Delayed</option>' +
      '<option value="ontrack">On track</option><option value="ready">Ready / Shipped</option></select></div>' +
      '<div class="field"><label for="of-from">From</label><input type="date" id="of-from" value="' + esc(f.from) + '"></div>' +
      '<div class="field"><label for="of-to">To</label><input type="date" id="of-to" value="' + esc(f.to) + '"></div>' +
      '<div class="field"><label for="of-sort">Sort</label><select id="of-sort">' +
      '<option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="delivery">Delivery date</option>' +
      '<option value="updated">Recently updated</option><option value="po">PO number</option></select></div>' +
      '</div>' +
      '<div class="list-head"><p class="result-count" id="orders-count"></p><div class="grp">' +
      '<button type="button" class="btn btn-secondary btn-sm" data-po-action="refresh">Refresh</button>' +
      '<button type="button" class="btn btn-sm" data-po-action="new"><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 3v10M3 8h10"/></svg>New PO</button></div></div>' +
      '<div id="orders-list">' + PM.loadingHTML('Loading orders…') + '</div>';

    $('#of-stage').value = f.stage;
    $('#of-status').value = f.status;
    $('#of-sort').value = f.sort;
    $('#of-q').addEventListener('input', PM.debounce((e) => { f.q = e.target.value; renderOrdersList(); }, 150));
    [['of-stage', 'stage'], ['of-status', 'status'], ['of-from', 'from'], ['of-to', 'to'], ['of-sort', 'sort']].forEach(([id, k]) => {
      $('#' + id).addEventListener('change', (e) => { f[k] = e.target.value; renderOrdersList(); });
    });

    PM.bindAccordion($('#orders-list'), A.open, (card, key, detail) => {
      const po = A.pos.find((p) => keyOf(p) === key);
      if (!po) return;
      detail.innerHTML = po.jobs ? poDetailHTML(po) : PM.loadingHTML('Loading jobs…');
      refreshPO(po.id, { quiet: true });
    });
  }

  async function loadOrders() {
    try {
      const data = await api.get('/api/po');
      const all = PM.pickArray(data, ['pos', 'purchase_orders', 'orders', 'items']).map(PM.normPO);
      A.pos = all.filter((p) => !p.archived);
      if (Array.isArray(data.archived)) { A.archived = data.archived.map(PM.normPO); setCount('archive', A.archived.length); }
      setCount('orders', A.pos.length);
      renderOrdersList();
    } catch (err) {
      const list = $('#orders-list');
      if (list) list.innerHTML = PM.emptyHTML('Could not load orders', err.message);
      if (err.status === 401) fail(err);
    }
  }

  function renderOrderStats() {
    const el = $('#order-stats');
    if (!el) return;
    let jobs = 0, delayed = 0, ready = 0;
    A.pos.forEach((p) => {
      const s = PM.poStats(p);
      jobs += p.jobs ? s.total : p.jobCount;
      delayed += s.delayed;
      ready += s.ready;
    });
    el.innerHTML =
      '<div class="stat-card"><strong>' + A.pos.length + '</strong><span>Active POs</span></div>' +
      '<div class="stat-card"><strong>' + jobs + '</strong><span>Jobs</span></div>' +
      '<div class="stat-card"><strong>' + delayed + '</strong><span>Delayed</span></div>' +
      '<div class="stat-card"><strong>' + ready + '</strong><span>Ready or shipped</span></div>';
  }

  function renderOrdersList() {
    const list = $('#orders-list');
    if (!list) return;
    renderOrderStats();
    const pos = PM.filterPOs(A.pos, A.filters);
    $('#orders-count').textContent = A.pos.length ? 'Showing ' + pos.length + ' of ' + A.pos.length + ' active purchase orders' : '';
    if (!A.pos.length) {
      list.innerHTML = '<div class="empty"><h4>No active orders</h4><p>Create your first purchase order to get started.</p>' +
        '<button type="button" class="btn btn-sm" data-po-action="new">New PO</button></div>';
      return;
    }
    if (!pos.length) { list.innerHTML = PM.emptyHTML('No matching orders', 'Try adjusting your search or filters.'); return; }
    list.innerHTML = pos.map(poCardHTML).join('');
  }

  function poCardHTML(po) {
    const open = A.open.has(keyOf(po));
    return '<div class="po-card' + (open ? ' open' : '') + '" data-key="' + esc(keyOf(po)) + '" data-po-id="' + esc(po.id) + '">' +
      PM.renderPOSummary(po).replace('aria-expanded="false"', 'aria-expanded="' + open + '"') +
      '<div class="po-detail' + (open ? '' : ' hidden') + '">' + (open ? (po.jobs ? poDetailHTML(po) : PM.loadingHTML()) : '') + '</div></div>';
  }

  function poDetailHTML(po) {
    const jobs = PM.activeJobs(po);
    const archivedJobs = (po.jobs || []).filter((j) => j.archived);
    const pid = esc(po.id);
    const meta =
      '<div class="meta-list">' +
      (po.updated_at ? '<div class="meta"><span class="k">Last updated</span><span class="v">' + esc(PM.fmtDateTime(po.updated_at)) + '</span></div>' : '') +
      '</div>';
    const actions =
      '<div class="grp">' +
      '<button type="button" class="btn btn-secondary btn-sm" data-po-action="edit" data-po-id="' + pid + '">Edit PO</button>' +
      '<button type="button" class="btn btn-secondary btn-sm" data-po-action="archive" data-po-id="' + pid + '">Archive PO</button>' +
      '</div>';
    const jobsHTML = jobs.length
      ? jobs.map((j, i) => PM.renderJob(j, i, {
        editable: true,
        noteForm: true,
        canDeleteNotes: isHead(),
        actionsHtml:
          '<button type="button" class="btn btn-secondary btn-xs" data-job-action="edit" data-job-id="' + esc(j.id) + '">Edit</button>' +
          (j.delayed
            ? '<button type="button" class="btn btn-secondary btn-xs" data-job-action="clear-delay" data-job-id="' + esc(j.id) + '">Clear delay</button>'
            : '<button type="button" class="btn btn-secondary btn-xs" data-job-action="delay" data-job-id="' + esc(j.id) + '">Mark delayed</button>') +
          '<button type="button" class="btn btn-secondary btn-xs" data-job-action="archive" data-job-id="' + esc(j.id) + '">Archive</button>'
      })).join('')
      : '<div class="empty" style="box-shadow:none;background:var(--fill);margin-top:12px;padding:32px"><h4>No active jobs</h4><p class="mb-0">' +
        (archivedJobs.length ? 'All jobs on this PO are archived. Restore one below.' : 'Jobs can only be added when a PO is created.') + '</p></div>';
    const archivedHTML = archivedJobs.length
      ? '<details class="archived-jobs"' + (jobs.length ? '' : ' open') + '><summary>Archived jobs (' + archivedJobs.length + ')</summary>' +
        archivedJobs.map((j) =>
          '<div class="archived-job"><div><div class="nm">' + esc(j.name) + '</div>' +
          '<div class="dt">Archived ' + esc(PM.fmtDateTime(j.archived_at)) + ' · hidden from clients</div></div>' +
          '<button type="button" class="btn btn-secondary btn-xs" data-job-action="restore" data-job-id="' + esc(j.id) + '">Restore</button></div>'
        ).join('') + '</details>'
      : '';
    return '<div class="po-toolbar">' + meta + actions + '</div>' + jobsHTML + archivedHTML;
  }

  /** Re-fetch a single PO's detail and re-render its card */
  async function refreshPO(poId, opts) {
    opts = opts || {};
    try {
      const data = await api.get('/api/po/' + encodeURIComponent(poId) + '/detail');
      const raw = data.po || data.purchase_order || data;
      const fresh = PM.normPO(raw);
      if (!fresh.jobs) fresh.jobs = PM.pickArray(data, ['jobs']).map(PM.normJob);
      if (fresh.id == null) fresh.id = poId;
      const idx = A.pos.findIndex((p) => String(p.id) === String(poId));
      if (fresh.archived || truthyArchived(data)) {
        if (idx > -1) A.pos.splice(idx, 1);
        A.open.delete(String(poId));
        PM.toast(PM.poLabel(fresh.number) + ' is complete and has been archived.');
        setCount('orders', A.pos.length);
        renderOrdersList();
        loadArchive();
        return;
      }
      if (idx > -1) {
        // keep list-level fields (e.g. codes) if detail omits them
        const old = A.pos[idx];
        if (!fresh.codes.length && old.codes.length) { fresh.codes = old.codes; fresh.clientIds = old.clientIds; }
        A.pos[idx] = fresh;
      } else {
        A.pos.unshift(fresh);
      }
      replaceCard(fresh);
    } catch (err) {
      if (err.status === 404) { loadOrders(); loadArchive(); return; }
      if (!opts.quiet) fail(err);
      else {
        const card = $('#orders-list .po-card[data-key="' + cssEsc(String(poId)) + '"]');
        const po = A.pos.find((p) => String(p.id) === String(poId));
        if (card && po && !po.jobs) $('.po-detail', card).innerHTML = PM.emptyHTML('Could not load jobs', err.message);
      }
    }
  }

  function truthyArchived(d) {
    return PM.truthy(d.archived) || PM.truthy(d.is_archived) || String(d.status || '').toLowerCase() === 'archived';
  }

  function cssEsc(s) { return window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/"/g, '\\"'); }

  function replaceCard(po) {
    renderOrderStats();
    const card = $('#orders-list .po-card[data-key="' + cssEsc(keyOf(po)) + '"]');
    if (!card) { renderOrdersList(); return; }
    const tmp = document.createElement('div');
    tmp.innerHTML = poCardHTML(po);
    card.replaceWith(tmp.firstElementChild);
  }

  function findPO(poId) { return A.pos.find((p) => String(p.id) === String(poId)); }
  function findJob(jobId) {
    for (const p of A.pos) {
      const j = (p.jobs || []).find((x) => String(x.id) === String(jobId));
      if (j) return { po: p, job: j };
    }
    return { po: null, job: null };
  }
  function poIdFromEl(el) {
    const card = el.closest('.po-card');
    return card ? card.getAttribute('data-po-id') : null;
  }

  /* ---------- PO form ---------- */
  function clientPickerHTML(selectedIds) {
    return '<div class="client-picker" data-client-picker>' +
      '<div class="picked" data-picked></div>' +
      '<select data-client-select aria-label="Add client code"></select>' +
      '</div><span class="hint">Linked clients see this PO on their dashboard.</span>';
  }

  function mountClientPicker(root, initialIds, onPick) {
    const picked = new Set((initialIds || []).map(String));
    const box = $('[data-picked]', root);
    const sel = $('[data-client-select]', root);
    function draw() {
      box.innerHTML = Array.from(picked).map((id) => {
        const c = A.clients.find((x) => String(x.id) === id);
        const label = c ? c.code : id;
        return '<span class="code-chip" title="' + esc(c ? c.company : '') + '">' + esc(label) +
          '<button type="button" data-unpick="' + esc(id) + '" aria-label="Remove ' + esc(label) + '">×</button></span>';
      }).join('');
      const avail = A.clients.filter((c) => !picked.has(String(c.id)));
      sel.innerHTML = '<option value="">' + (A.clients.length ? (avail.length ? '+ Link a client code…' : 'All clients linked') : 'No clients yet — add them under Manage Clients') + '</option>' +
        avail.map((c) => '<option value="' + esc(c.id) + '">' + esc(c.code) + (c.company ? ' — ' + esc(c.company) : '') + '</option>').join('');
    }
    sel.addEventListener('change', () => {
      if (!sel.value) return;
      picked.add(sel.value);
      const c = A.clients.find((x) => String(x.id) === sel.value);
      if (onPick && c) onPick(c);
      draw();
    });
    box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-unpick]');
      if (b) { picked.delete(b.getAttribute('data-unpick')); draw(); }
    });
    draw();
    return {
      ids: () => Array.from(picked),
      codes: () => Array.from(picked).map((id) => (A.clients.find((c) => String(c.id) === id) || {}).code).filter(Boolean)
    };
  }

  async function openPOForm(po) {
    if (!A.clients.length) await loadClients(true);
    const editing = !!po;
    let initialIds = [];
    if (po) {
      initialIds = po.clientIds.length
        ? po.clientIds
        : po.codes.map((code) => (A.clients.find((c) => c.code === code) || {}).id).filter((x) => x != null).map(String);
    }
    PM.modal({
      title: editing ? 'Edit purchase order' : 'New purchase order',
      eyebrow: editing ? PM.poLabel(po.number) : '',
      subtitle: editing ? '' : 'Enter the PO details and every job on it. Jobs cannot be added to a PO after it is created.',
      wide: true,
      sticky: true,
      body:
        '<form id="po-form" novalidate><div class="form-error hidden" data-error></div>' +
        '<div class="form-grid">' +
        '<div class="field"><label for="pf-number">PO number <span class="req">*</span></label>' +
        '<input type="text" id="pf-number" class="upper" required value="' + esc(po ? po.number : '') + '" placeholder="e.g. PO-2461"></div>' +
        '<div class="field"><label for="pf-customer">Customer name</label>' +
        '<input type="text" id="pf-customer" value="' + esc(po ? po.customer : '') + '" placeholder="Company or contact name"></div>' +
        '<div class="field"><label for="pf-date">Date of order</label>' +
        '<input type="date" id="pf-date" value="' + esc(po ? PM.toDateInput(po.date) : PM.todayIST()) + '"></div>' +
        '<div class="field"><label for="pf-delivery">Estimated delivery</label>' +
        '<input type="date" id="pf-delivery" value="' + esc(po ? PM.toDateInput(po.delivery) : '') + '"></div>' +
        '<div class="field span-2"><label>Client codes <span class="optional">Optional</span></label>' + clientPickerHTML() + '</div>' +
        (editing ? '' :
          '<div class="form-section-title">Jobs</div>' +
          '<div class="span-2" id="pf-jobs"></div>' +
          '<div class="span-2"><button type="button" class="btn btn-ghost btn-sm" id="pf-add-job">Add another job</button></div>') +
        '</div></form>',
      foot:
        '<button type="button" class="btn btn-secondary" data-close>Cancel</button>' +
        '<button type="submit" class="btn" form="po-form">' + (editing ? 'Save changes' : 'Create PO') + '</button>',
      onMount(el, close) {
        const picker = mountClientPicker(el, initialIds, (c) => {
          const cust = $('#pf-customer', el);
          if (!cust.value.trim() && c.company) cust.value = c.company;
        });

        const jobsWrap = $('#pf-jobs', el);
        function renumber() {
          const blocks = $$('.job-block', jobsWrap);
          blocks.forEach((b, i) => {
            $('.job-block-title', b).textContent = 'Job ' + (i + 1);
            $('[data-remove-job]', b).classList.toggle('hidden', blocks.length === 1);
          });
        }
        function addBlock(focus) {
          const d = document.createElement('div');
          d.className = 'job-block';
          d.innerHTML =
            '<div class="job-block-head"><span class="job-block-title"></span>' +
            '<button type="button" class="link-btn danger small" data-remove-job>Remove</button></div>' +
            jobFieldsHTML(null);
          jobsWrap.appendChild(d);
          wireJobBlock(d);
          renumber();
          if (focus) $('[data-f="name"]', d).focus();
        }
        if (jobsWrap) {
          addBlock(false);
          $('#pf-add-job', el).addEventListener('click', () => addBlock(true));
          jobsWrap.addEventListener('click', (e) => {
            const r = e.target.closest('[data-remove-job]');
            if (r) { r.closest('.job-block').remove(); renumber(); }
          });
        }

        PM.handleSubmit($('#po-form', el), async () => {
          const number = $('#pf-number', el).value.trim().toUpperCase();
          if (!number) throw new Error('PO number is required.');
          const date = $('#pf-date', el).value;
          const delivery = $('#pf-delivery', el).value;
          if (date && delivery && delivery < date) throw new Error('Estimated delivery cannot be before the order date.');
          const body = {
            po_number: number,
            customer_name: $('#pf-customer', el).value.trim(),
            date_of_order: date || null,
            estimated_delivery: delivery || null,
            client_ids: picker.ids().map((x) => (isNaN(x) ? x : Number(x))),
            client_codes: picker.codes()
          };

          if (editing) {
            await api.put('/api/po/' + encodeURIComponent(po.id), body);
            close();
            PM.toast(PM.poLabel(number) + ' updated.');
            await refreshPO(po.id);
            return;
          }

          const blocks = $$('.job-block', jobsWrap);
          blocks.forEach((b, i) => {
            if (!$('[data-f="name"]', b).value.trim()) throw new Error('Please enter a job name for Job ' + (i + 1) + '.');
          });
          const jobs = blocks.map(readJobBlock);

          const data = await api.post('/api/po', body);
          let newId = idFrom(data);
          if (newId == null) {
            await loadOrders();
            const found = A.pos.find((p) => String(p.number).toUpperCase() === number);
            if (found) newId = found.id;
          }
          if (newId == null) throw new Error('PO was created, but its ID could not be read, so the jobs were not saved. Please contact your administrator.');

          const failed = [];
          for (const j of jobs) {
            try { await api.post('/api/po/' + encodeURIComponent(newId) + '/jobs', j); }
            catch (err) { failed.push(j.job_name + ' (' + err.message + ')'); }
          }
          close();
          if (failed.length) PM.toast(PM.poLabel(number) + ' created, but these jobs failed: ' + failed.join('; '), 'error', 9000);
          else PM.toast(PM.poLabel(number) + ' created with ' + jobs.length + (jobs.length === 1 ? ' job.' : ' jobs.'));
          A.open.add(String(newId));
          await loadOrders();
          await refreshPO(newId, { quiet: true });
        });
      }
    });
  }

  /* ---------- Job fields (shared by New PO form and Edit Job) ---------- */
  function checkHTML(name, value, checked) {
    return '<label class="check"><input type="checkbox" data-f="' + esc(name) + '" value="' + esc(value) + '"' + (checked ? ' checked' : '') + '>' +
      '<span class="box"></span>' + esc(value) + '</label>';
  }
  function flagOn(v) {
    return PM.truthy(v) || (!!v && !/^(0|false|no)$/i.test(String(v)));
  }

  function jobFieldsHTML(job) {
    const finishVals = PM.asArray(job ? job.finish_type : '');
    const isKnown = (v) => PM.FINISH_OPTIONS.some((o) => o.toLowerCase() === v.toLowerCase());
    const finishOther = finishVals.filter((v) => !isKnown(v)).join(', ');
    const gsm = job ? String(job.gsm || '').replace(/\s*gsm$/i, '') : '';
    const gsmKnown = PM.GSM_OPTIONS.indexOf(gsm) > -1;
    const procVals = PM.asArray(job ? job.process : '').map((v) => v.toLowerCase());

    return '<div class="form-grid">' +
      '<div class="field"><label><span>Job name <span class="req">*</span></span>' +
      '<input type="text" data-f="name" required value="' + esc(job ? job.name : '') + '" placeholder="e.g. Mono cartons, Letterheads" style="margin-top:6px"></label></div>' +
      '<div class="field"><label><span>Quantity / specs</span>' +
      '<input type="text" data-f="qty" value="' + esc(job ? job.quantity_specs : '') + '" placeholder="e.g. 5,000 pcs · A4 · 4+0" style="margin-top:6px"></label></div>' +

      '<div class="field span-2"><span class="field-label">Finish type</span><div class="check-grid">' +
      PM.FINISH_OPTIONS.map((o) => checkHTML('finish', o, finishVals.some((v) => v.toLowerCase() === o.toLowerCase()))).join('') +
      checkHTML('finish-other-toggle', 'Other', !!finishOther) +
      '</div><input type="text" data-f="finish-other" class="other-input' + (finishOther ? '' : ' hidden') + '" placeholder="Describe other finish" value="' + esc(finishOther) + '"></div>' +

      '<div class="field"><span class="field-label">GSM</span><select data-f="gsm" aria-label="GSM">' +
      '<option value="">Select GSM</option>' +
      PM.GSM_OPTIONS.map((g) => '<option value="' + g + '"' + (gsm === g ? ' selected' : '') + '>' + g + ' GSM</option>').join('') +
      '<option value="__other"' + (gsm && !gsmKnown ? ' selected' : '') + '>Other…</option></select>' +
      '<input type="text" data-f="gsm-other" class="other-input' + (gsm && !gsmKnown ? '' : ' hidden') + '" placeholder="Enter GSM, e.g. 230" value="' + esc(gsm && !gsmKnown ? gsm : '') + '"></div>' +

      '<div class="field"><span class="field-label">Add-ons</span><div class="check-grid">' +
      checkHTML('embellishments', 'Embellishments', job && flagOn(job.embellishments)) +
      checkHTML('cast_and_cure', 'Cast & cure', job && flagOn(job.cast_and_cure)) +
      '</div></div>' +

      '<div class="field span-2"><span class="field-label">Process</span><div class="check-grid">' +
      PM.PROCESS_OPTIONS.map((o) => checkHTML('process', o, procVals.indexOf(o.toLowerCase()) > -1)).join('') +
      '</div></div>' +

      '<div class="field span-2"><label><span>Other specifications</span>' +
      '<textarea data-f="other" rows="2" placeholder="Paper stock, die-line reference, packing instructions…" style="margin-top:6px">' + esc(job ? job.other : '') + '</textarea></label></div>' +
      '</div>';
  }

  function wireJobBlock(root) {
    const toggle = $('[data-f="finish-other-toggle"]', root);
    const other = $('[data-f="finish-other"]', root);
    toggle.addEventListener('change', () => {
      other.classList.toggle('hidden', !toggle.checked);
      if (toggle.checked) other.focus();
    });
    const sel = $('[data-f="gsm"]', root), gsmOther = $('[data-f="gsm-other"]', root);
    sel.addEventListener('change', () => {
      const o = sel.value === '__other';
      gsmOther.classList.toggle('hidden', !o);
      if (o) gsmOther.focus();
    });
  }

  function readJobBlock(root) {
    const name = $('[data-f="name"]', root).value.trim();
    const finishes = $$('[data-f="finish"]:checked', root).map((i) => i.value);
    const otherTxt = $('[data-f="finish-other"]', root).value.trim();
    if ($('[data-f="finish-other-toggle"]', root).checked && otherTxt) finishes.push(otherTxt);
    const sel = $('[data-f="gsm"]', root);
    const gsm = (sel.value === '__other' ? $('[data-f="gsm-other"]', root).value.trim() : sel.value).replace(/\s*gsm$/i, '');
    return {
      job_name: name,
      name: name,
      quantity_specs: $('[data-f="qty"]', root).value.trim(),
      finish_type: finishes.join(', '),
      gsm: gsm,
      process: $$('[data-f="process"]:checked', root).map((i) => i.value).join(', '),
      embellishments: $('[data-f="embellishments"]', root).checked ? 1 : 0,
      cast_and_cure: $('[data-f="cast_and_cure"]', root).checked ? 1 : 0,
      other_specifications: $('[data-f="other"]', root).value.trim()
    };
  }

  /** Edit an existing job (new jobs can only be added while creating a PO) */
  function openJobForm(po, job) {
    PM.modal({
      title: 'Edit job',
      eyebrow: PM.poLabel(po.number),
      wide: true,
      sticky: true,
      body: '<form id="job-form" novalidate><div class="form-error hidden" data-error></div>' + jobFieldsHTML(job) + '</form>',
      foot:
        '<button type="button" class="btn btn-secondary" data-close>Cancel</button>' +
        '<button type="submit" class="btn" form="job-form">Save job</button>',
      onMount(el, close) {
        const form = $('#job-form', el);
        wireJobBlock(form);
        PM.handleSubmit(form, async () => {
          const body = readJobBlock(form);
          if (!body.job_name) throw new Error('Job name is required.');
          await api.put('/api/po/jobs/' + encodeURIComponent(job.id), body);
          close();
          PM.toast('Job "' + body.job_name + '" updated.');
          A.open.add(keyOf(po));
          await refreshPO(po.id);
        });
      }
    });
  }

  /* ---------- Delay form ---------- */
  function openDelayForm(po, job) {
    PM.modal({
      title: 'Mark job as delayed',
      eyebrow: po.number + ' · ' + job.name,
      subtitle: 'The client will see this reason on their tracking page.',
      body:
        '<form id="delay-form" novalidate><div class="form-error hidden" data-error></div>' +
        '<div class="field"><label for="df-reason">Reason for delay <span class="req">*</span></label>' +
        '<textarea id="df-reason" rows="3" required placeholder="e.g. Awaiting paper stock; expected by Friday.">' + esc(job.delay_reason) + '</textarea></div>' +
        '</form>',
      foot: '<button type="button" class="btn btn-secondary" data-close>Cancel</button><button type="submit" class="btn" form="delay-form">Mark Delayed</button>',
      onMount(el, close) {
        PM.handleSubmit($('#delay-form', el), async () => {
          const reason = $('#df-reason', el).value.trim();
          if (!reason) throw new Error('Please give a reason for the delay.');
          await api.post('/api/po/jobs/' + encodeURIComponent(job.id) + '/delay', { is_delayed: 1, delay_reason: reason });
          close();
          PM.toast('"' + job.name + '" marked as delayed.');
          await refreshPO(po.id);
        });
      }
    });
  }

  /* ---------- Orders: delegated actions ---------- */
  async function onOrdersClick(e) {
    const poBtn = e.target.closest('[data-po-action]');
    if (poBtn) {
      const act = poBtn.getAttribute('data-po-action');
      const po = findPO(poBtn.getAttribute('data-po-id'));
      if (act === 'new') return openPOForm(null);
      if (act === 'refresh') {
        PM.setLoading(poBtn, true);
        await loadOrders();
        await Promise.all(Array.from(A.open).map((k) => { const p = A.pos.find((x) => keyOf(x) === k); return p ? refreshPO(p.id, { quiet: true }) : null; }));
        PM.setLoading(poBtn, false);
        return;
      }
      if (!po) return;
      if (act === 'edit') return openPOForm(po);
      if (act === 'archive') {
        const ok = await PM.confirm({
          title: 'Archive ' + PM.poLabel(po.number) + '?',
          message: 'It moves to the Archive tab and clients will see "Order completed". You can restore it at any time.',
          confirmText: 'Archive PO'
        });
        if (!ok) return;
        try {
          await api.post('/api/po/' + encodeURIComponent(po.id) + '/archive');
          PM.toast(PM.poLabel(po.number) + ' archived.');
          A.open.delete(keyOf(po));
          await loadOrders();
          loadArchive();
        } catch (err) { fail(err); }
        return;
      }
      return;
    }

    const jobBtn = e.target.closest('[data-job-action]');
    if (jobBtn) {
      const act = jobBtn.getAttribute('data-job-action');
      const { po, job } = findJob(jobBtn.getAttribute('data-job-id'));
      if (!job) return;
      if (act === 'edit') return openJobForm(po, job);
      if (act === 'delay') return openDelayForm(po, job);
      if (act === 'clear-delay') {
        try {
          await api.post('/api/po/jobs/' + encodeURIComponent(job.id) + '/delay', { is_delayed: 0, delay_reason: '' });
          PM.toast('Delay cleared for "' + job.name + '".');
          await refreshPO(po.id);
        } catch (err) { fail(err); }
        return;
      }
      if (act === 'archive') {
        const ok = await PM.confirm({
          title: 'Archive "' + job.name + '"?',
          message: 'The job is hidden from clients and moved to "Archived jobs" on this PO. Its history and notes are kept, and you can restore it at any time.',
          confirmText: 'Archive job'
        });
        if (!ok) return;
        try {
          await api.post('/api/po/jobs/' + encodeURIComponent(job.id) + '/archive');
          PM.toast('"' + job.name + '" archived.');
          await refreshPO(po.id);
        } catch (err) { fail(err); }
        return;
      }
      if (act === 'restore') {
        try {
          await api.post('/api/po/jobs/' + encodeURIComponent(job.id) + '/unarchive');
          PM.toast('"' + job.name + '" restored.');
          await refreshPO(po.id);
        } catch (err) { fail(err); }
      }
      return;
    }

    const stageLi = e.target.closest('.pipeline.editable li[data-stage]');
    if (stageLi) {
      const jobId = stageLi.closest('.pipeline').getAttribute('data-job-id');
      const { po, job } = findJob(jobId);
      if (!job) return;
      const stage = parseInt(stageLi.getAttribute('data-stage'), 10);
      if (stage === job.stage) return;
      const name = PM.STAGES[stage - 1];
      if (stage < job.stage) {
        const ok = await PM.confirm({
          title: 'Move back to "' + name + '"?',
          message: '"' + job.name + '" is currently at ' + PM.STAGES[job.stage - 1] + '. Moving back clears the later stage history.',
          confirmText: 'Move back'
        });
        if (!ok) return;
      } else if (stage === 6) {
        const ok = await PM.confirm({
          title: 'Mark "' + job.name + '" as ready?',
          message: 'This moves the job to Shipping / Ready for Pickup. When every job on the PO is complete, the PO may be archived automatically.',
          confirmText: 'Mark ready'
        });
        if (!ok) return;
      }
      try {
        stageLi.closest('.pipeline').style.opacity = '.5';
        await api.post('/api/po/jobs/' + encodeURIComponent(job.id) + '/stage', { stage });
        PM.toast('"' + job.name + '" → ' + name);
        await refreshPO(po.id);
      } catch (err) {
        fail(err);
        stageLi.closest('.pipeline').style.opacity = '';
      }
      return;
    }

    const delNote = e.target.closest('[data-action="delete-note"]');
    if (delNote) {
      const noteId = delNote.getAttribute('data-note-id');
      const poId = poIdFromEl(delNote);
      const ok = await PM.confirm({ title: 'Remove this note?', message: 'The note will no longer be visible to the client.', confirmText: 'Remove', danger: true });
      if (!ok) return;
      try {
        await api.del('/api/po/notes/' + encodeURIComponent(noteId));
        PM.toast('Note removed.');
        await refreshPO(poId);
      } catch (err) { fail(err); }
    }
  }

  async function onOrdersSubmit(e) {
    const form = e.target.closest('form[data-action="add-note"]');
    if (!form) return;
    e.preventDefault();
    const input = form.querySelector('input[name="note"]');
    const note = input.value.trim();
    if (!note) return;
    const btn = form.querySelector('button');
    const jobId = form.getAttribute('data-job-id');
    const poId = poIdFromEl(form);
    PM.setLoading(btn, true);
    try {
      await api.post('/api/po/jobs/' + encodeURIComponent(jobId) + '/notes', { note });
      input.value = '';
      PM.toast('Note added.');
      await refreshPO(poId);
    } catch (err) { fail(err); } finally { PM.setLoading(btn, false); }
  }

  /* ========================================================================
     ARCHIVE
     ======================================================================== */
  function renderArchiveShell() {
    const el = $('#tab-archive');
    if (el.dataset.ready) { renderArchiveList(); return; }
    el.dataset.ready = '1';
    el.innerHTML =
      '<div class="page-head"><div><h2>Archive</h2><p class="muted mb-0">Completed purchase orders. Clients looking these up will see “Order completed”.</p></div></div>' +
      '<div class="toolbar"><div class="field grow"><label for="ar-q">Search</label><input type="search" id="ar-q" placeholder="PO number, client, job name…"></div>' +
      '<div class="tb-actions"><button type="button" class="btn btn-ghost btn-sm" data-ar-action="refresh">Refresh</button></div></div>' +
      '<p class="result-count" id="archive-count"></p>' +
      '<div id="archive-list">' + PM.loadingHTML('Loading archive…') + '</div>' +
      '<p class="small muted" style="margin-top:14px">Permanent deletions are recorded in the Managing Director\'s audit log.</p>';
    $('#ar-q').addEventListener('input', PM.debounce((e) => { A.archiveQ = e.target.value; renderArchiveList(); }, 150));
  }

  async function loadArchive() {
    try {
      const data = await api.get('/api/po?archived=1&include_archived=1');
      let list;
      if (Array.isArray(data.archived)) list = data.archived.map(PM.normPO);
      else list = PM.pickArray(data, ['pos', 'purchase_orders', 'orders', 'items']).map(PM.normPO).filter((p) => p.archived);
      A.archived = list;
      setCount('archive', list.length);
      renderArchiveList();
    } catch (err) {
      const l = $('#archive-list');
      if (l) l.innerHTML = PM.emptyHTML('Could not load archive', err.message);
    }
  }

  function renderArchiveList() {
    const l = $('#archive-list');
    if (!l || !$('#tab-archive').dataset.ready) return;
    const q = A.archiveQ.trim().toLowerCase();
    let rows = A.archived.filter((p) => !q || [p.number, p.customer, p.codes.join(' '), p.jobNames.join(' ')].join(' ').toLowerCase().indexOf(q) > -1);
    rows.sort((a, b) => (PM.tsValue(b.archived_at) || PM.tsValue(b.date)) - (PM.tsValue(a.archived_at) || PM.tsValue(a.date)));
    $('#archive-count').textContent = A.archived.length ? 'Showing ' + rows.length + ' of ' + A.archived.length + ' archived purchase orders' : '';
    if (!A.archived.length) { l.innerHTML = PM.emptyHTML('The archive is empty', 'Completed purchase orders will appear here.'); return; }
    if (!rows.length) { l.innerHTML = PM.emptyHTML('No matches', 'Try a different search.'); return; }
    l.innerHTML =
      '<div class="table-wrap"><table class="data stack"><thead><tr>' +
      '<th>PO number</th><th>Client</th><th>Date</th><th>Jobs</th><th class="text-right">Actions</th></tr></thead><tbody>' +
      rows.map((p) =>
        '<tr><td data-label="PO Number"><span class="po-number" style="font-size:1.15rem">' + esc(p.number) + '</span></td>' +
        '<td data-label="Client">' + esc(p.customer || '—') + (p.codes.length ? '<div style="margin-top:4px;display:flex;gap:4px;flex-wrap:wrap">' + PM.renderCodes(p.codes) + '</div>' : '') + '</td>' +
        '<td data-label="Date" class="nowrap">' + esc(PM.fmtDate(p.date)) +
        (p.archived_at ? '<div class="small muted">Archived ' + esc(PM.fmtDateTime(p.archived_at)) + '</div>' : '') + '</td>' +
        '<td data-label="Jobs">' + (p.jobNames.length ? esc(p.jobNames.join(', ')) : '<span class="muted">—</span>') + '</td>' +
        '<td><div class="actions">' +
        '<button type="button" class="btn btn-ghost btn-xs" data-ar-action="restore" data-po-id="' + esc(p.id) + '">Restore</button>' +
        '<button type="button" class="btn btn-danger btn-xs" data-ar-action="delete" data-po-id="' + esc(p.id) + '">Delete</button>' +
        '</div></td></tr>'
      ).join('') + '</tbody></table></div>';
  }

  async function onArchiveClick(e) {
    const b = e.target.closest('[data-ar-action]');
    if (!b) return;
    const act = b.getAttribute('data-ar-action');
    if (act === 'refresh') { PM.setLoading(b, true); await loadArchive(); PM.setLoading(b, false); return; }
    const po = A.archived.find((p) => String(p.id) === b.getAttribute('data-po-id'));
    if (!po) return;
    if (act === 'restore') {
      const ok = await PM.confirm({ title: 'Restore ' + PM.poLabel(po.number) + '?', message: 'It will return to the active Orders list.', confirmText: 'Restore' });
      if (!ok) return;
      try {
        await api.post('/api/po/' + encodeURIComponent(po.id) + '/unarchive');
        PM.toast(PM.poLabel(po.number) + ' restored to active orders.');
        await Promise.all([loadArchive(), loadOrders()]);
      } catch (err) { fail(err); }
    }
    if (act === 'delete') {
      const ok = await PM.confirm({
        title: 'Permanently delete ' + PM.poLabel(po.number) + '?',
        html: 'This archived PO and all of its records will be erased. This action is <strong>logged for the Managing Director</strong> and cannot be undone.',
        confirmText: 'Delete permanently',
        danger: true,
        requireText: po.number
      });
      if (!ok) return;
      try {
        await api.del('/api/po/' + encodeURIComponent(po.id) + '/archive');
        PM.toast('Archived ' + PM.poLabel(po.number) + ' deleted.');
        await loadArchive();
      } catch (err) { fail(err); }
    }
  }

  /* ========================================================================
     CLIENTS
     ======================================================================== */
  const CODE_RE = /^[A-Z]{2,4}[0-9]{0,3}$/;

  function normClient(c) {
    const contacts = PM.asArray(c.contacts).filter((x) => x && typeof x === 'object').map((x) => ({
      id: x.id,
      name: x.name || x.contact_name || '',
      phone: x.phone || x.mobile || '',
      email: x.email || '',
      designation: x.designation || x.title || x.role || ''
    }));
    return {
      raw: c,
      id: c.id != null ? c.id : c.client_id,
      code: String(c.client_code || c.code || '').toUpperCase(),
      company: c.company_name || c.company || c.name || '',
      contacts,
      poCount: c.po_count != null ? c.po_count : (c.active_pos != null ? c.active_pos : (Array.isArray(c.pos) ? c.pos.length : null)),
      created_at: c.created_at
    };
  }

  function renderClientsShell() {
    const el = $('#tab-clients');
    if (el.dataset.ready) { renderClientsList(); return; }
    el.dataset.ready = '1';
    el.innerHTML =
      '<div class="page-head"><div><h2>Clients</h2><p class="muted mb-0">Client codes let customers log in and see all of their active POs.</p></div>' +
      '<button type="button" class="btn btn-sm" data-cl-action="new">New client</button></div>' +
      '<div class="toolbar"><div class="field grow"><label for="cl-q">Search</label><input type="search" id="cl-q" placeholder="Code, company, contact…"></div>' +
      '<div class="tb-actions"><button type="button" class="btn btn-ghost btn-sm" data-cl-action="refresh">Refresh</button></div></div>' +
      '<div id="clients-list">' + PM.loadingHTML('Loading clients…') + '</div>';
    $('#cl-q').addEventListener('input', PM.debounce((e) => { A.clientQ = e.target.value; renderClientsList(); }, 150));
  }

  async function loadClients(silent) {
    try {
      const data = await api.get('/api/clients');
      A.clients = PM.pickArray(data, ['clients', 'items']).map(normClient).sort((a, b) => a.code.localeCompare(b.code));
      setCount('clients', A.clients.length);
      renderClientsList();
    } catch (err) {
      if (!silent) {
        const l = $('#clients-list');
        if (l) l.innerHTML = PM.emptyHTML('Could not load clients', err.message);
      }
    }
  }

  function renderClientsList() {
    const l = $('#clients-list');
    if (!l || !$('#tab-clients').dataset.ready) return;
    const q = A.clientQ.trim().toLowerCase();
    const rows = A.clients.filter((c) => !q || [c.code, c.company, c.contacts.map((x) => [x.name, x.phone, x.email, x.designation].join(' ')).join(' ')]
      .join(' ').toLowerCase().indexOf(q) > -1);
    if (!A.clients.length) {
      l.innerHTML = '<div class="empty"><h4>No clients yet</h4><p>Create a client code (e.g. TATA, BV01) and share it with your customer along with their password.</p>' +
        '<button type="button" class="btn btn-sm" data-cl-action="new">New client</button></div>';
      return;
    }
    if (!rows.length) { l.innerHTML = PM.emptyHTML('No matches', 'Try a different search.'); return; }
    l.innerHTML =
      '<div class="table-wrap"><table class="data stack"><thead><tr><th>Code</th><th>Company</th><th>Contacts</th><th>POs</th><th class="text-right">Actions</th></tr></thead><tbody>' +
      rows.map((c) =>
        '<tr><td data-label="Code"><span class="code-chip">' + esc(c.code) + '</span></td>' +
        '<td data-label="Company"><strong style="font-weight:500">' + esc(c.company || '—') + '</strong>' +
        (c.created_at ? '<div class="small muted">Added ' + esc(PM.fmtDate(c.created_at)) + '</div>' : '') + '</td>' +
        '<td data-label="Contacts">' + (c.contacts.length
          ? c.contacts.map((x) => '<div class="contact-mini"><div>' + esc(x.name || '—') + (x.designation ? ' <span class="d">· ' + esc(x.designation) + '</span>' : '') + '</div>' +
            '<div class="d">' + [x.phone ? '<a href="tel:' + esc(x.phone.replace(/\s/g, '')) + '">' + esc(x.phone) + '</a>' : '', x.email ? '<a href="mailto:' + esc(x.email) + '">' + esc(x.email) + '</a>' : ''].filter(Boolean).join(' · ') + '</div></div>').join('')
          : '<span class="muted small">No contacts</span>') + '</td>' +
        '<td data-label="POs">' + (c.poCount != null ? esc(c.poCount) : '<span class="muted">—</span>') + '</td>' +
        '<td><div class="actions">' +
        '<button type="button" class="btn btn-ghost btn-xs" data-cl-action="edit" data-id="' + esc(c.id) + '">Edit</button>' +
        (canChangeClientPw() ? '<button type="button" class="btn btn-ghost btn-xs" data-cl-action="password" data-id="' + esc(c.id) + '">Password</button>' : '') +
        (isHead() ? '<button type="button" class="btn btn-danger btn-xs" data-cl-action="delete" data-id="' + esc(c.id) + '">Delete</button>' : '') +
        '</div></td></tr>'
      ).join('') + '</tbody></table></div>';
  }

  function contactRowHTML(c) {
    c = c || {};
    return '<div class="contact-row" data-contact' + (c.id != null ? ' data-contact-id="' + esc(c.id) + '"' : '') + '>' +
      '<input type="text" data-k="name" placeholder="Name" value="' + esc(c.name) + '" aria-label="Contact name">' +
      '<input type="tel" data-k="phone" placeholder="Phone" value="' + esc(c.phone) + '" aria-label="Phone">' +
      '<input type="email" data-k="email" placeholder="Email" value="' + esc(c.email) + '" aria-label="Email">' +
      '<input type="text" data-k="designation" placeholder="Designation" value="' + esc(c.designation) + '" aria-label="Designation">' +
      '<button type="button" class="icon-btn" data-remove-contact aria-label="Remove contact">×</button></div>';
  }

  async function openClientForm(client) {
    const editing = !!client;
    if (editing && client.id != null) {
      try {
        const data = await api.get('/api/clients/' + encodeURIComponent(client.id));
        const full = normClient(data.client || data);
        if (full.contacts.length || !client.contacts.length) client = Object.assign({}, client, { contacts: full.contacts, company: full.company || client.company });
      } catch (e) { /* use list data */ }
    }
    const contacts = editing && client.contacts.length ? client.contacts : [{}];
    PM.modal({
      title: editing ? 'Edit client' : 'New client',
      eyebrow: editing ? client.code : 'Manage Clients',
      wide: true,
      sticky: true,
      body:
        '<form id="client-form" novalidate><div class="form-error hidden" data-error></div>' +
        '<div class="form-grid">' +
        '<div class="field"><label for="cf-code">Client code <span class="req">*</span></label>' +
        '<input type="text" id="cf-code" class="upper" maxlength="7" required value="' + esc(editing ? client.code : '') + '" placeholder="e.g. TATA or BV01"' + (editing ? ' readonly style="background:var(--parchment)"' : '') + '>' +
        '<span class="hint">' + (editing ? 'Client codes cannot be changed once created.' : '2–4 letters, optionally followed by 1–3 numbers.') + '</span></div>' +
        '<div class="field"><label for="cf-company">Company name <span class="req">*</span></label>' +
        '<input type="text" id="cf-company" required value="' + esc(editing ? client.company : '') + '"></div>' +
        (editing ? '' :
          '<div class="field"><label for="cf-pw">Client password <span class="req">*</span></label><input type="password" id="cf-pw" autocomplete="new-password" required>' +
          '<span class="hint">Share this with the client. Only Planning or the MD can change it later.</span></div>' +
          '<div class="field"><label for="cf-pw2">Confirm password <span class="req">*</span></label><input type="password" id="cf-pw2" autocomplete="new-password" required></div>') +
        '<div class="form-section-title">Contacts</div>' +
        '<div class="span-2" id="cf-contacts">' + contacts.map(contactRowHTML).join('') + '</div>' +
        '<div class="span-2"><button type="button" class="link-btn" id="cf-add-contact">+ Add another contact</button></div>' +
        '</div></form>',
      foot: '<button type="button" class="btn btn-secondary" data-close>Cancel</button><button type="submit" class="btn" form="client-form">' + (editing ? 'Save changes' : 'Create client') + '</button>',
      onMount(el, close) {
        const wrap = $('#cf-contacts', el);
        $('#cf-add-contact', el).addEventListener('click', () => {
          wrap.insertAdjacentHTML('beforeend', contactRowHTML({}));
          wrap.lastElementChild.querySelector('input').focus();
        });
        wrap.addEventListener('click', (e) => {
          const r = e.target.closest('[data-remove-contact]');
          if (!r) return;
          const row = r.closest('[data-contact]');
          if ($$('[data-contact]', wrap).length > 1) row.remove();
          else $$('input', row).forEach((i) => (i.value = ''));
        });
        const codeIn = $('#cf-code', el);
        if (!editing) codeIn.addEventListener('input', () => { codeIn.value = codeIn.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });

        PM.handleSubmit($('#client-form', el), async () => {
          const code = codeIn.value.trim().toUpperCase();
          const company = $('#cf-company', el).value.trim();
          if (!CODE_RE.test(code)) throw new Error('Client code must be 2–4 letters followed by up to 3 numbers (e.g. TATA, BV01).');
          if (!company) throw new Error('Company name is required.');
          const list = $$('[data-contact]', wrap).map((row) => {
            const o = {};
            $$('input', row).forEach((i) => (o[i.getAttribute('data-k')] = i.value.trim()));
            const cid = row.getAttribute('data-contact-id');
            if (cid) o.id = isNaN(cid) ? cid : Number(cid);
            return o;
          }).filter((o) => o.name || o.phone || o.email || o.designation);
          const bad = list.find((o) => o.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(o.email));
          if (bad) throw new Error('Please check the email address for ' + (bad.name || 'a contact') + '.');
          const body = { client_code: code, code, company_name: company, contacts: list };
          if (editing) {
            await api.put('/api/clients/' + encodeURIComponent(client.id), body);
            PM.toast('Client ' + code + ' updated.');
          } else {
            const pw = $('#cf-pw', el).value;
            if (pw.length < 4) throw new Error('Password must be at least 4 characters.');
            if (pw !== $('#cf-pw2', el).value) throw new Error('Passwords do not match.');
            body.password = pw;
            await api.post('/api/clients', body);
            PM.toast('Client ' + code + ' created.');
          }
          close();
          await loadClients();
        });
      }
    });
  }

  function openClientPassword(client) {
    PM.modal({
      title: 'Change client password',
      eyebrow: client.code + (client.company ? ' · ' + client.company : ''),
      subtitle: 'Remember to share the new password with the client.',
      body:
        '<form id="cpw-form" novalidate><div class="form-error hidden" data-error></div>' +
        '<div class="field"><label for="cpw-1">New password</label><input type="password" id="cpw-1" autocomplete="new-password" required></div>' +
        '<div class="field"><label for="cpw-2">Confirm New password</label><input type="password" id="cpw-2" autocomplete="new-password" required></div></form>',
      foot: '<button type="button" class="btn btn-secondary" data-close>Cancel</button><button type="submit" class="btn" form="cpw-form">Update password</button>',
      onMount(el, close) {
        PM.handleSubmit($('#cpw-form', el), async () => {
          const pw = $('#cpw-1', el).value;
          if (pw.length < 4) throw new Error('Password must be at least 4 characters.');
          if (pw !== $('#cpw-2', el).value) throw new Error('Passwords do not match.');
          await api.post('/api/clients/' + encodeURIComponent(client.id) + '/change-password', { password: pw, newPassword: pw, new_password: pw });
          close();
          PM.toast('Password updated for ' + client.code + '.');
        });
      }
    });
  }

  async function onClientsClick(e) {
    const b = e.target.closest('[data-cl-action]');
    if (!b) return;
    const act = b.getAttribute('data-cl-action');
    if (act === 'new') return openClientForm(null);
    if (act === 'refresh') { PM.setLoading(b, true); await loadClients(); PM.setLoading(b, false); return; }
    const c = A.clients.find((x) => String(x.id) === b.getAttribute('data-id'));
    if (!c) return;
    if (act === 'edit') { PM.setLoading(b, true); await openClientForm(c); PM.setLoading(b, false); return; }
    if (act === 'password') return openClientPassword(c);
    if (act === 'delete') {
      const ok = await PM.confirm({
        title: 'Delete client ' + c.code + '?',
        message: 'The client will no longer be able to log in. Their purchase orders are not deleted, but will be unlinked from this code.',
        confirmText: 'Delete client',
        danger: true,
        requireText: c.code
      });
      if (!ok) return;
      try {
        await api.del('/api/clients/' + encodeURIComponent(c.id));
        PM.toast('Client ' + c.code + ' deleted.');
        await loadClients();
      } catch (err) { fail(err); }
    }
  }

  /* ========================================================================
     TEAM (head_admin only)
     ======================================================================== */
  function renderTeamShell() {
    const el = $('#tab-team');
    if (!isHead()) { el.innerHTML = PM.emptyHTML('Restricted', 'Only the Managing Director can manage the team.'); delete el.dataset.ready; return; }
    if (el.dataset.ready) { renderTeamList(); return; }
    el.dataset.ready = '1';
    el.innerHTML =
      '<div class="page-head"><div><h2>Team</h2><p class="muted mb-0">Add staff, assign roles and reset passwords. <strong style="font-weight:500">Planning</strong> can also change client passwords.</p></div>' +
      '<button type="button" class="btn btn-sm" data-tm-action="new">Add member</button></div>' +
      '<div id="team-list">' + PM.loadingHTML('Loading team…') + '</div>';
  }

  async function loadTeam() {
    if (!isHead()) return;
    try {
      const data = await api.get('/api/admin/team');
      A.team = PM.pickArray(data, ['users', 'team', 'members']);
      renderTeamList();
    } catch (err) {
      const l = $('#team-list');
      if (l) l.innerHTML = PM.emptyHTML('Could not load team', err.message);
      if (err.status === 401) fail(err);
    }
  }

  function renderTeamList() {
    const l = $('#team-list');
    if (!l) return;
    if (!A.team.length) { l.innerHTML = PM.emptyHTML('No team members yet', 'Add your first team member.'); return; }
    const me = PM.state.user || {};
    const order = { head_admin: 0, planning: 1, staff: 2 };
    const rows = A.team.slice().sort((a, b) => (order[a.role] - order[b.role]) || String(a.username).localeCompare(String(b.username)));
    l.innerHTML =
      '<div class="table-wrap"><table class="data stack"><thead><tr><th>Username</th><th>Role</th><th>Added</th><th class="text-right">Actions</th></tr></thead><tbody>' +
      rows.map((u) => {
        const self = u.username === me.username || (me.id != null && String(u.id) === String(me.id));
        const head = u.role === 'head_admin';
        return '<tr><td data-label="Username"><strong style="font-weight:500">' + esc(u.username) + '</strong>' + (self ? ' <span class="small muted">(you)</span>' : '') + '</td>' +
          '<td data-label="Role">' + (head
            ? '<span class="badge badge-dark no-dot">Managing Director</span>'
            : '<select class="role-select" data-tm-role data-id="' + esc(u.id) + '" aria-label="Role for ' + esc(u.username) + '">' +
              '<option value="staff"' + (u.role === 'staff' ? ' selected' : '') + '>Staff</option>' +
              '<option value="planning"' + (u.role === 'planning' ? ' selected' : '') + '>Planning</option></select>') + '</td>' +
          '<td data-label="Added">' + esc(PM.fmtDate(u.created_at)) + '</td>' +
          '<td><div class="actions">' +
          '<button type="button" class="btn btn-ghost btn-xs" data-tm-action="reset" data-id="' + esc(u.id) + '">Reset password</button>' +
          (head ? '' : '<button type="button" class="btn btn-danger btn-xs" data-tm-action="delete" data-id="' + esc(u.id) + '">Remove</button>') +
          '</div></td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function openMemberForm() {
    PM.modal({
      title: 'Add team member',
      eyebrow: 'Manage Team',
      sticky: true,
      body:
        '<form id="tm-form" novalidate><div class="form-error hidden" data-error></div>' +
        '<div class="field"><label for="tm-user">Username <span class="req">*</span></label><input type="text" id="tm-user" autocomplete="off" required></div>' +
        '<div class="form-grid">' +
        '<div class="field"><label for="tm-pw">Password <span class="req">*</span></label><input type="password" id="tm-pw" autocomplete="new-password" required></div>' +
        '<div class="field"><label for="tm-role">Role</label><select id="tm-role"><option value="staff">Staff</option><option value="planning">Planning</option></select></div>' +
        '</div>' +
        '<div class="field"><label for="tm-q">Security question</label><input type="text" id="tm-q" placeholder="Optional — for password recovery"></div>' +
        '<div class="field"><label for="tm-a">Security answer</label><input type="text" id="tm-a" autocomplete="off"></div>' +
        '</form>',
      foot: '<button type="button" class="btn btn-secondary" data-close>Cancel</button><button type="submit" class="btn" form="tm-form">Add member</button>',
      onMount(el, close) {
        PM.handleSubmit($('#tm-form', el), async () => {
          const username = $('#tm-user', el).value.trim();
          const password = $('#tm-pw', el).value;
          const r = $('#tm-role', el).value;
          if (!username) throw new Error('Username is required.');
          if (password.length < 4) throw new Error('Password must be at least 4 characters.');
          const data = await api.post('/api/admin/team', {
            username, password, role: r,
            security_question: $('#tm-q', el).value.trim(),
            security_answer: $('#tm-a', el).value.trim()
          });
          // Make sure the role sticks even if the create endpoint ignores it
          if (r !== 'staff') {
            let id = idFrom(data) || (data.user && data.user.id);
            if (id == null) {
              try {
                const t = await api.get('/api/admin/team');
                const u = PM.pickArray(t, ['users', 'team']).find((x) => String(x.username).toLowerCase() === username.toLowerCase());
                if (u) { id = u.id; if (u.role === r) id = null; }
              } catch (e) { /* ignore */ }
            }
            if (id != null) { try { await api.post('/api/admin/team/' + encodeURIComponent(id) + '/role', { role: r }); } catch (e) { /* ignore */ } }
          }
          close();
          PM.toast((data && data.message) || 'Team member added.');
          await loadTeam();
        });
      }
    });
  }

  function openResetStaffPw(u) {
    PM.modal({
      title: 'Reset password',
      eyebrow: u.username,
      body:
        '<form id="rp-form" novalidate><div class="form-error hidden" data-error></div>' +
        '<div class="field"><label for="rp-1">New password</label><input type="password" id="rp-1" autocomplete="new-password" required></div>' +
        '<div class="field"><label for="rp-2">Confirm New password</label><input type="password" id="rp-2" autocomplete="new-password" required></div></form>',
      foot: '<button type="button" class="btn btn-secondary" data-close>Cancel</button><button type="submit" class="btn" form="rp-form">Reset password</button>',
      onMount(el, close) {
        PM.handleSubmit($('#rp-form', el), async () => {
          const pw = $('#rp-1', el).value;
          if (pw.length < 4) throw new Error('Password must be at least 4 characters.');
          if (pw !== $('#rp-2', el).value) throw new Error('Passwords do not match.');
          const data = await api.post('/api/admin/team/' + encodeURIComponent(u.id) + '/reset-password', { newPassword: pw, new_password: pw, password: pw });
          close();
          PM.toast((data && data.message) || 'Password reset for ' + u.username + '.');
        });
      }
    });
  }

  async function onTeamClick(e) {
    const b = e.target.closest('[data-tm-action]');
    if (!b) return;
    const act = b.getAttribute('data-tm-action');
    if (act === 'new') return openMemberForm();
    const u = A.team.find((x) => String(x.id) === b.getAttribute('data-id'));
    if (!u) return;
    if (act === 'reset') return openResetStaffPw(u);
    if (act === 'delete') {
      const ok = await PM.confirm({ title: 'Remove ' + u.username + '?', message: 'They will no longer be able to log in. Their past activity stays in the audit log.', confirmText: 'Remove', danger: true });
      if (!ok) return;
      try {
        await api.del('/api/admin/team/' + encodeURIComponent(u.id));
        PM.toast(u.username + ' removed from the team.');
        await loadTeam();
      } catch (err) { fail(err); }
    }
  }

  async function onTeamChange(e) {
    const sel = e.target.closest('[data-tm-role]');
    if (!sel) return;
    const u = A.team.find((x) => String(x.id) === sel.getAttribute('data-id'));
    if (!u) return;
    const prev = u.role;
    const next = sel.value;
    sel.disabled = true;
    try {
      await api.post('/api/admin/team/' + encodeURIComponent(u.id) + '/role', { role: next });
      u.role = next;
      PM.toast(u.username + ' is now ' + (PM.ROLE_LABELS[next] || next) + '.');
    } catch (err) {
      sel.value = prev;
      fail(err);
    } finally {
      sel.disabled = false;
    }
  }

  /* ========================================================================
     AUDIT LOG (head_admin only)
     ======================================================================== */
  function renderAuditShell() {
    const el = $('#tab-audit');
    if (!isHead()) { el.innerHTML = PM.emptyHTML('Restricted', 'Only the Managing Director can view the audit log.'); delete el.dataset.ready; return; }
    if (el.dataset.ready) { renderAuditList(); return; }
    el.dataset.ready = '1';
    el.innerHTML =
      '<div class="page-head"><div><h2>Audit log</h2><p class="muted mb-0">Every change made in the system, newest first. Rows marked <span class="badge badge-md no-dot">MD only</span> are visible to you alone.</p></div></div>' +
      '<div class="toolbar">' +
      '<div class="field grow"><label for="au-q">Search</label><input type="search" id="au-q" placeholder="User, PO number, details…"></div>' +
      '<div class="field"><label for="au-action">Action</label><select id="au-action"><option value="">All actions</option></select></div>' +
      '<div class="field" style="flex:0 0 auto;justify-content:flex-end"><label class="check" style="margin-top:18px"><input type="checkbox" id="au-md"><span class="box"></span>MD-only</label></div>' +
      '<div class="tb-actions"><button type="button" class="btn btn-ghost btn-sm" id="au-refresh">Refresh</button></div>' +
      '</div>' +
      '<p class="result-count" id="audit-count"></p>' +
      '<div id="audit-list">' + PM.loadingHTML('Loading audit log…') + '</div>';
    $('#au-q').addEventListener('input', PM.debounce((e) => { A.auditF.q = e.target.value; renderAuditList(); }, 150));
    $('#au-action').addEventListener('change', (e) => { A.auditF.action = e.target.value; renderAuditList(); });
    $('#au-md').addEventListener('change', (e) => { A.auditF.mdOnly = e.target.checked; renderAuditList(); });
    $('#au-refresh').addEventListener('click', async (e) => { const b = e.currentTarget; PM.setLoading(b, true); await loadAudit(); PM.setLoading(b, false); });
  }

  async function loadAudit() {
    if (!isHead()) return;
    try {
      const data = await api.get('/api/admin/audit-log');
      A.logs = PM.pickArray(data, ['logs', 'audit', 'entries']);
      const actions = Array.from(new Set(A.logs.map((l) => l.action).filter(Boolean))).sort();
      const sel = $('#au-action');
      if (sel) {
        sel.innerHTML = '<option value="">All actions</option>' + actions.map((a) => '<option value="' + esc(a) + '">' + esc(prettyAction(a)) + '</option>').join('');
        sel.value = actions.indexOf(A.auditF.action) > -1 ? A.auditF.action : '';
      }
      renderAuditList();
    } catch (err) {
      const l = $('#audit-list');
      if (l) l.innerHTML = PM.emptyHTML('Could not load audit log', err.message);
      if (err.status === 401) fail(err);
    }
  }

  function prettyAction(a) {
    return String(a || '').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase());
  }
  function actionClass(a) {
    a = String(a || '').toUpperCase();
    if (/DELETE|REMOVE/.test(a)) return 'del';
    if (/ARCHIVE/.test(a)) return 'archive';
    if (/CREATE|ADD|SETUP/.test(a)) return 'create';
    if (/DELAY|RESET|PASSWORD|ROLE/.test(a)) return 'warn';
    return '';
  }

  function renderAuditList() {
    const l = $('#audit-list');
    if (!l || !$('#tab-audit').dataset.ready) return;
    const f = A.auditF;
    const q = f.q.trim().toLowerCase();
    const rows = A.logs.filter((x) => {
      if (f.action && x.action !== f.action) return false;
      if (f.mdOnly && x.visible_to !== 'md_only') return false;
      if (q) {
        const hay = [x.user, x.username, x.action, x.po_number, x.order_id, x.reference, x.details].join(' ').toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    }).sort((a, b) => PM.tsValue(b.created_at) - PM.tsValue(a.created_at));
    $('#audit-count').textContent = A.logs.length ? 'Showing ' + rows.length + ' of ' + A.logs.length + ' entries' : '';
    if (!A.logs.length) { l.innerHTML = PM.emptyHTML('No activity yet', 'Actions taken in the system will be recorded here.'); return; }
    if (!rows.length) { l.innerHTML = PM.emptyHTML('No matching entries', 'Try a different search or filter.'); return; }
    l.innerHTML =
      '<div class="table-wrap"><table class="data stack"><thead><tr><th>When (IST)</th><th>User</th><th>Action</th><th>Reference</th><th>Details</th></tr></thead><tbody>' +
      rows.map((x) => {
        const md = x.visible_to === 'md_only';
        const ref = x.po_number || x.order_id || x.reference || x.client_code || '';
        return '<tr class="' + (md ? 'md-only' : '') + '">' +
          '<td data-label="When (IST)" class="nowrap small">' + esc(PM.fmtDateTime(x.created_at)) + '</td>' +
          '<td data-label="User">' + esc(x.user || x.username || '—') + '</td>' +
          '<td data-label="Action"><span class="action-tag ' + actionClass(x.action) + '">' + esc(prettyAction(x.action)) + '</span>' +
          (md ? ' <span class="badge badge-crimson no-dot" style="padding:1px 8px;margin-top:4px">MD only</span>' : '') + '</td>' +
          '<td data-label="Reference">' + (ref ? '<span class="po-number">' + esc(ref) + '</span>' : '<span class="muted">—</span>') + '</td>' +
          '<td data-label="Details" class="small">' + esc(x.details || '') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  /* ========================================================================
     Bind once
     ======================================================================== */
  function bindOnce() {
    A.bound = true;
    $('#admin-tabs').addEventListener('click', (e) => {
      const t = e.target.closest('.tab');
      if (t && !t.classList.contains('hidden')) switchTab(t.getAttribute('data-tab'));
    });
    $('#tab-orders').addEventListener('click', onOrdersClick);
    $('#tab-orders').addEventListener('submit', onOrdersSubmit);
    $('#tab-archive').addEventListener('click', onArchiveClick);
    $('#tab-clients').addEventListener('click', onClientsClick);
    $('#tab-team').addEventListener('click', onTeamClick);
    $('#tab-team').addEventListener('change', onTeamChange);
  }

  PM.Admin = { enter, reset, refreshPO, loadOrders };
})();
