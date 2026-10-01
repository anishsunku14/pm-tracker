// Helpers for reading purchase orders with their clients, jobs, stages and notes.
const { dbGet, dbAll, STAGES } = require('../db/database');
const JC = require('./jobcard');

function normalizePO(s) {
  return String(s || '').toLowerCase().replace(/[\s\-]+/g, '');
}

function stageName(n) {
  const s = STAGES.find((x) => x.number === Number(n));
  return s ? s.name : '';
}

/* ---------------------------------------------------------------------------
   Bulk loaders: a handful of queries for any number of POs, instead of several
   queries per PO. Keeps the order and archive lists fast as history grows.
   --------------------------------------------------------------------------- */
const CHUNK = 400; // stay well under SQLite's limit on query parameters

function allIn(sqlBefore, ids, sqlAfter, extraParams) {
  const out = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const part = ids.slice(i, i + CHUNK);
    const ph = part.map(() => '?').join(',');
    dbAll(sqlBefore + '(' + ph + ')' + (sqlAfter || ''), part.concat(extraParams || [])).forEach((r) => out.push(r));
  }
  return out;
}

function groupBy(rows, key) {
  const m = new Map();
  rows.forEach((r) => {
    const k = r[key];
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  });
  return m;
}

function clientsByPO(poIds) {
  if (!poIds.length) return new Map();
  const rows = allIn('SELECT pc.po_id, c.id, c.client_code, c.company_name FROM po_clients pc JOIN clients c ON c.id = pc.client_id WHERE pc.po_id IN ', poIds);
  rows.sort((a, b) => String(a.client_code).localeCompare(String(b.client_code)));
  const m = groupBy(rows, 'po_id');
  m.forEach((list) => list.forEach((r) => delete r.po_id));
  return m;
}

/** Full POs: clients + jobs (with stages and notes). opts.public hides internal fields and archived jobs. */
function fullPOs(pos, opts) {
  opts = opts || {};
  if (!pos.length) return [];
  const poIds = pos.map((p) => p.id);
  // Clients never see archived jobs; staff see them (flagged) so they can be restored
  const jobs = allIn('SELECT * FROM jobs WHERE po_id IN ', poIds, opts.public ? ' AND COALESCE(is_archived, 0) = 0' : '');
  jobs.sort((a, b) => a.id - b.id);
  const jobIds = jobs.map((j) => j.id);
  const stages = jobIds.length
    ? allIn('SELECT job_id, stage, stage_name, completed_at' + (opts.public ? '' : ', updated_by') + ' FROM job_stages WHERE job_id IN ', jobIds)
    : [];
  stages.sort((a, b) => a.stage - b.stage);
  const notes = jobIds.length ? allIn('SELECT id, job_id, note, author, created_at FROM job_notes WHERE job_id IN ', jobIds) : [];
  notes.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : b.id - a.id));
  const stagesBy = groupBy(stages, 'job_id');
  const notesBy = groupBy(notes, 'job_id');
  // Production rows are internal: staff only
  const entries = !opts.public && jobIds.length ? allIn('SELECT * FROM job_entries WHERE job_id IN ', jobIds) : [];
  entries.sort((a, b) => a.id - b.id);
  const entriesBy = groupBy(entries, 'job_id');
  const jobsBy = new Map();
  jobs.forEach((j) => {
    const st = (stagesBy.get(j.id) || []).map((s) => { const o = Object.assign({}, s); delete o.job_id; return o; });
    const nt = (notesBy.get(j.id) || []).map((n) => { const o = Object.assign({}, n); delete o.job_id; return o; });
    if (!jobsBy.has(j.po_id)) jobsBy.set(j.po_id, []);
    const full = Object.assign({}, j, { stages: st, notes: nt });
    if (opts.public) {
      jobsBy.get(j.po_id).push(JC.publicJob(full));
    } else {
      full.card = JC.parseCard(j.card) || {};
      full.entries = {};
      JC.SECTIONS.forEach((sec) => { full.entries[sec] = []; });
      (entriesBy.get(j.id) || []).forEach((e) => { if (full.entries[e.section]) full.entries[e.section].push(e); });
      jobsBy.get(j.po_id).push(full);
    }
  });
  const clientsBy = opts.public ? null : clientsByPO(poIds);
  return pos.map((po) => {
    const out = Object.assign({}, po, { jobs: jobsBy.get(po.id) || [] });
    if (opts.public) {
      delete out.created_by;
      delete out.id;
    } else {
      out.clients = clientsBy.get(po.id) || [];
    }
    return out;
  });
}

function fullPO(po, opts) {
  return fullPOs([po], opts)[0];
}

/** Minimal archived POs for the archive list */
function archivedPOs(pos) {
  if (!pos.length) return [];
  const poIds = pos.map((p) => p.id);
  const names = allIn('SELECT po_id, id, job_name FROM jobs WHERE po_id IN ', poIds);
  names.sort((a, b) => a.id - b.id);
  const namesBy = groupBy(names, 'po_id');
  const clientsBy = clientsByPO(poIds);
  return pos.map((po) => ({
    id: po.id,
    po_number: po.po_number,
    customer_name: po.customer_name,
    date_of_order: po.date_of_order,
    archived_at: po.archived_at,
    is_archived: 1,
    job_names: (namesBy.get(po.id) || []).map((r) => r.job_name),
    clients: clientsBy.get(po.id) || []
  }));
}

function archivedPO(po) {
  return archivedPOs([po])[0];
}

function clientsFor(poId) {
  return clientsByPO([poId]).get(poId) || [];
}

function findPOByNumber(num) {
  return dbGet("SELECT * FROM purchase_orders WHERE LOWER(REPLACE(REPLACE(REPLACE(REPLACE(po_number, ' ', ''), '-', ''), char(9), ''), char(160), '')) = ?", [normalizePO(num)]);
}

function findJob(jobId) {
  const job = dbGet('SELECT * FROM jobs WHERE id = ?', [Number(jobId)]);
  if (!job) return { job: null, po: null };
  return { job, po: dbGet('SELECT * FROM purchase_orders WHERE id = ?', [job.po_id]) };
}

/** Removes a PO and everything under it. */
function deletePOCascade(run, poId) {
  const jobIds = dbAll('SELECT id FROM jobs WHERE po_id = ?', [poId]).map((r) => r.id);
  jobIds.forEach((id) => deleteJobCascade(run, id));
  run('DELETE FROM po_clients WHERE po_id = ?', [poId]);
  run('DELETE FROM purchase_orders WHERE id = ?', [poId]);
}

function deleteJobCascade(run, jobId) {
  run('DELETE FROM job_stages WHERE job_id = ?', [jobId]);
  run('DELETE FROM job_notes WHERE job_id = ?', [jobId]);
  run('DELETE FROM jobs WHERE id = ?', [jobId]);
}

module.exports = { normalizePO, stageName, fullPO, fullPOs, archivedPO, archivedPOs, findPOByNumber, findJob, deletePOCascade, deleteJobCascade, clientsFor };
