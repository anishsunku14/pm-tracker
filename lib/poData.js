// Helpers for reading purchase orders with their clients, jobs, stages and notes.
const { dbGet, dbAll, STAGES } = require('../db/database');

function normalizePO(s) {
  return String(s || '').toLowerCase().replace(/[\s\-]+/g, '');
}

function stageName(n) {
  const s = STAGES.find((x) => x.number === Number(n));
  return s ? s.name : '';
}

function jobsFor(poId, opts) {
  opts = opts || {};
  // Clients never see archived jobs; staff see them (flagged) so they can be restored
  const jobs = dbAll('SELECT * FROM jobs WHERE po_id = ?' + (opts.public ? ' AND COALESCE(is_archived, 0) = 0' : '') + ' ORDER BY id ASC', [poId]);
  return jobs.map((j) => {
    const stages = dbAll('SELECT stage, stage_name, completed_at' + (opts.public ? '' : ', updated_by') + ' FROM job_stages WHERE job_id = ? ORDER BY stage ASC', [j.id]);
    const notes = dbAll('SELECT id, note, author, created_at FROM job_notes WHERE job_id = ? ORDER BY created_at DESC, id DESC', [j.id]);
    return Object.assign({}, j, { stages, notes });
  });
}

function clientsFor(poId) {
  return dbAll(
    'SELECT c.id, c.client_code, c.company_name FROM po_clients pc JOIN clients c ON c.id = pc.client_id WHERE pc.po_id = ? ORDER BY c.client_code',
    [poId]
  );
}

/** Full PO: clients + jobs (with stages and notes). opts.public hides internal fields. */
function fullPO(po, opts) {
  opts = opts || {};
  const out = Object.assign({}, po, { jobs: jobsFor(po.id, opts) });
  if (opts.public) {
    delete out.created_by;
    delete out.id;
  } else {
    out.clients = clientsFor(po.id);
  }
  return out;
}

/** Minimal archived PO for the archive list */
function archivedPO(po) {
  const names = dbAll('SELECT job_name FROM jobs WHERE po_id = ? ORDER BY id', [po.id]).map((r) => r.job_name);
  return {
    id: po.id,
    po_number: po.po_number,
    customer_name: po.customer_name,
    date_of_order: po.date_of_order,
    archived_at: po.archived_at,
    is_archived: 1,
    job_names: names,
    clients: clientsFor(po.id)
  };
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

module.exports = { normalizePO, stageName, fullPO, archivedPO, findPOByNumber, findJob, deletePOCascade, deleteJobCascade, clientsFor };
