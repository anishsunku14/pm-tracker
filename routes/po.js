const express = require('express');
const { dbRun, dbInsert, dbBatch, dbGet, dbAll, audit, STAGES } = require('../db/database');
const { requireAuth, requireHeadAdmin } = require('../middleware/auth');
const P = require('../lib/poData');
const notify = require('../lib/notify');
const router = express.Router();

/* ---------------------------------------------------------------- helpers */
const me = (req) => req.session.user.username;

function text(v, max) {
  if (v === undefined || v === null) return '';
  const s = Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).join(', ') : String(v).trim();
  return max ? s.slice(0, max) : s;
}
function flag(v) {
  return v === true || v === 1 || v === '1' || v === 'true' || v === 'yes' || v === 'on' ? 1 : 0;
}
function dateOrNull(v) {
  const s = text(v);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/** Resolve client_ids (or client_codes) from the request into valid client ids */
function resolveClientIds(body) {
  const ids = new Set();
  (Array.isArray(body.client_ids) ? body.client_ids : []).forEach((id) => {
    const c = dbGet('SELECT id FROM clients WHERE id = ?', [Number(id)]);
    if (c) ids.add(c.id);
  });
  if (!ids.size && Array.isArray(body.client_codes)) {
    body.client_codes.forEach((code) => {
      const c = dbGet('SELECT id FROM clients WHERE client_code = ?', [String(code).trim().toUpperCase()]);
      if (c) ids.add(c.id);
    });
  }
  return Array.from(ids);
}

function jobFields(body) {
  return {
    job_name: text(body.job_name || body.name, 200),
    quantity_specs: text(body.quantity_specs, 500),
    finish_type: text(body.finish_type, 300),
    gsm: text(body.gsm, 50),
    process: text(body.process, 300),
    embellishments: flag(body.embellishments),
    cast_and_cure: flag(body.cast_and_cure),
    other_specifications: text(body.other_specifications, 2000)
  };
}

/** Archive the PO automatically once every job is at the final stage */
function autoArchiveIfComplete(po, user) {
  const counts = dbGet('SELECT COUNT(*) AS total, SUM(CASE WHEN current_stage >= 6 THEN 1 ELSE 0 END) AS done FROM jobs WHERE po_id = ? AND COALESCE(is_archived, 0) = 0', [po.id]);
  if (counts.total > 0 && counts.done === counts.total && !po.is_archived) {
    dbRun('UPDATE purchase_orders SET is_archived = 1, archived_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [po.id]);
    audit(user, 'AUTO_ARCHIVE_PO', { po_number: po.po_number, details: 'All jobs complete, PO archived automatically' });
    return true;
  }
  return false;
}

function touchPO(poId) {
  dbRun('UPDATE purchase_orders SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [poId]);
}

/* ---------------------------------------------------------------- PUBLIC */

// Track a PO (no login). Case- and space-insensitive.
router.get('/track/:poNumber', (req, res) => {
  const po = P.findPOByNumber(req.params.poNumber);
  if (!po) return res.status(404).json({ error: 'Order not found. Please check the PO number and try again.' });
  if (po.is_archived) {
    return res.json({ archived: true, message: 'Order Completed', po: { po_number: po.po_number, is_archived: 1, archived_at: po.archived_at } });
  }
  res.json({ po: P.fullPO(po, { public: true }), stages: STAGES });
});

/* ---------------------------------------------------------------- JOBS */

// Update job details
router.put('/jobs/:jobId', requireAuth, (req, res) => {
  const { job, po } = P.findJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found.' });
  const f = jobFields(req.body);
  if (!f.job_name) return res.status(400).json({ error: 'Job name is required.' });
  dbRun(`UPDATE jobs SET job_name=?, quantity_specs=?, finish_type=?, gsm=?, process=?, embellishments=?, cast_and_cure=?, other_specifications=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
    [f.job_name, f.quantity_specs, f.finish_type, f.gsm, f.process, f.embellishments, f.cast_and_cure, f.other_specifications, job.id]);
  touchPO(po.id);
  audit(me(req), 'UPDATE_JOB', { po_number: po.po_number, details: 'Updated job "' + f.job_name + '"' });
  res.json({ message: 'Job updated.' });
});

// Archive a job (hidden from clients, restorable). Jobs are never deleted.
router.post('/jobs/:jobId/archive', requireAuth, (req, res) => {
  const { job, po } = P.findJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found.' });
  dbRun('UPDATE jobs SET is_archived = 1, archived_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [job.id]);
  touchPO(po.id);
  audit(me(req), 'ARCHIVE_JOB', { po_number: po.po_number, details: 'Archived job "' + job.job_name + '"' });
  res.json({ message: 'Job archived.' });
});

router.post('/jobs/:jobId/unarchive', requireAuth, (req, res) => {
  const { job, po } = P.findJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found.' });
  dbRun('UPDATE jobs SET is_archived = 0, archived_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [job.id]);
  touchPO(po.id);
  audit(me(req), 'UNARCHIVE_JOB', { po_number: po.po_number, details: 'Restored job "' + job.job_name + '"' });
  res.json({ message: 'Job restored.' });
});

// Set job stage (1–6). Moving back clears later stage history.
router.post('/jobs/:jobId/stage', requireAuth, (req, res) => {
  const { job, po } = P.findJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found.' });
  const stage = parseInt(req.body.stage, 10);
  if (!(stage >= 1 && stage <= 6)) return res.status(400).json({ error: 'Invalid stage number.' });

  dbBatch(() => {
    dbRun('UPDATE jobs SET current_stage=?, updated_at=CURRENT_TIMESTAMP WHERE id=?', [stage, job.id]);
    dbRun('DELETE FROM job_stages WHERE job_id=? AND stage>?', [job.id, stage]);
    // Record every stage up to this one that has no timestamp yet
    for (let s = 1; s <= stage; s++) {
      const exists = dbGet('SELECT id FROM job_stages WHERE job_id=? AND stage=?', [job.id, s]);
      if (!exists) dbRun('INSERT INTO job_stages (job_id, stage, stage_name, updated_by) VALUES (?, ?, ?, ?)', [job.id, s, P.stageName(s), me(req)]);
    }
    touchPO(po.id);
  });
  audit(me(req), 'UPDATE_STAGE', { po_number: po.po_number, details: '"' + job.job_name + '" → ' + P.stageName(stage) });
  notify.scheduleStageNotice(job.id);
  const archived = autoArchiveIfComplete(po, me(req));
  res.json({ message: 'Stage updated.', archived });
});

// Set / clear delay
router.post('/jobs/:jobId/delay', requireAuth, (req, res) => {
  const { job, po } = P.findJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found.' });
  const delayed = flag(req.body.is_delayed);
  const reason = delayed ? text(req.body.delay_reason, 1000) : '';
  if (delayed && !reason) return res.status(400).json({ error: 'Please give a reason for the delay.' });
  dbRun('UPDATE jobs SET is_delayed=?, delay_reason=?, updated_at=CURRENT_TIMESTAMP WHERE id=?', [delayed, reason, job.id]);
  touchPO(po.id);
  audit(me(req), delayed ? 'SET_DELAY' : 'REMOVE_DELAY', { po_number: po.po_number, details: '"' + job.job_name + '"' + (delayed ? ': ' + reason : ' delay removed') });
  res.json({ message: delayed ? 'Job marked as delayed.' : 'Delay removed.' });
});

// Add note to job
router.post('/jobs/:jobId/notes', requireAuth, (req, res) => {
  const { job, po } = P.findJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found.' });
  const note = text(req.body.note, 1000);
  if (!note) return res.status(400).json({ error: 'Note cannot be empty.' });
  dbRun('INSERT INTO job_notes (job_id, note, author) VALUES (?, ?, ?)', [job.id, note, me(req)]);
  touchPO(po.id);
  audit(me(req), 'ADD_NOTE', { po_number: po.po_number, details: 'Note on "' + job.job_name + '"' });
  res.json({ message: 'Note added.' });
});

// Delete note (MD only)
router.delete('/notes/:noteId', requireHeadAdmin, (req, res) => {
  const note = dbGet('SELECT * FROM job_notes WHERE id = ?', [Number(req.params.noteId)]);
  if (!note) return res.status(404).json({ error: 'Note not found.' });
  const { job, po } = P.findJob(note.job_id);
  dbRun('DELETE FROM job_notes WHERE id = ?', [note.id]);
  audit(me(req), 'DELETE_NOTE', { po_number: po && po.po_number, details: 'Deleted note by ' + note.author + (job ? ' on "' + job.job_name + '"' : '') });
  res.json({ message: 'Note deleted.' });
});

/* ---------------------------------------------------------------- PURCHASE ORDERS */

// List: active POs (full) + archived POs (minimal)
router.get('/', requireAuth, (req, res) => {
  const active = dbAll('SELECT * FROM purchase_orders WHERE is_archived = 0 ORDER BY created_at DESC, id DESC').map((po) => P.fullPO(po));
  const archived = dbAll('SELECT * FROM purchase_orders WHERE is_archived = 1 ORDER BY archived_at DESC, id DESC').map(P.archivedPO);
  res.json({ pos: active, archived, stages: STAGES });
});

// Create PO
router.post('/', requireAuth, (req, res) => {
  const number = text(req.body.po_number, 60).toUpperCase();
  if (!number) return res.status(400).json({ error: 'PO number is required.' });
  if (P.findPOByNumber(number)) return res.status(409).json({ error: 'A PO with this number already exists.' });

  const clientIds = resolveClientIds(req.body);
  const id = dbBatch(() => {
    const newId = dbInsert('INSERT INTO purchase_orders (po_number, customer_name, date_of_order, estimated_delivery, created_by) VALUES (?, ?, ?, ?, ?)',
      [number, text(req.body.customer_name, 200), dateOrNull(req.body.date_of_order), dateOrNull(req.body.estimated_delivery), me(req)]);
    clientIds.forEach((cid) => dbRun('INSERT OR IGNORE INTO po_clients (po_id, client_id) VALUES (?, ?)', [newId, cid]));
    return newId;
  });
  audit(me(req), 'CREATE_PO', { po_number: number, details: 'Created PO' + (req.body.customer_name ? ' for ' + text(req.body.customer_name) : '') });
  res.json({ message: 'PO ' + number + ' created.', id });
});

// PO detail
router.get('/:id/detail', requireAuth, (req, res) => {
  const po = dbGet('SELECT * FROM purchase_orders WHERE id = ?', [Number(req.params.id)]);
  if (!po) return res.status(404).json({ error: 'PO not found.' });
  res.json({ po: P.fullPO(po), stages: STAGES });
});

// Update PO
router.put('/:id', requireAuth, (req, res) => {
  const po = dbGet('SELECT * FROM purchase_orders WHERE id = ?', [Number(req.params.id)]);
  if (!po) return res.status(404).json({ error: 'PO not found.' });
  const number = text(req.body.po_number, 60).toUpperCase() || po.po_number;
  const clash = P.findPOByNumber(number);
  if (clash && clash.id !== po.id) return res.status(409).json({ error: 'Another PO already uses this number.' });

  const clientIds = resolveClientIds(req.body);
  dbBatch(() => {
    dbRun('UPDATE purchase_orders SET po_number=?, customer_name=?, date_of_order=?, estimated_delivery=?, updated_at=CURRENT_TIMESTAMP WHERE id=?',
      [number, text(req.body.customer_name, 200), dateOrNull(req.body.date_of_order), dateOrNull(req.body.estimated_delivery), po.id]);
    dbRun('DELETE FROM po_clients WHERE po_id = ?', [po.id]);
    clientIds.forEach((cid) => dbRun('INSERT OR IGNORE INTO po_clients (po_id, client_id) VALUES (?, ?)', [po.id, cid]));
  });
  audit(me(req), 'UPDATE_PO', { po_number: number, details: number !== po.po_number ? 'Renamed from ' + po.po_number : 'Updated PO details' });
  res.json({ message: 'PO updated.' });
});

// Add job to PO
router.post('/:id/jobs', requireAuth, (req, res) => {
  const po = dbGet('SELECT * FROM purchase_orders WHERE id = ?', [Number(req.params.id)]);
  if (!po) return res.status(404).json({ error: 'PO not found.' });
  const f = jobFields(req.body);
  if (!f.job_name) return res.status(400).json({ error: 'Job name is required.' });
  const jobId = dbBatch(() => {
    const id = dbInsert(`INSERT INTO jobs (po_id, job_name, quantity_specs, finish_type, gsm, process, embellishments, cast_and_cure, other_specifications, current_stage, last_notified_stage)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)`,
      [po.id, f.job_name, f.quantity_specs, f.finish_type, f.gsm, f.process, f.embellishments, f.cast_and_cure, f.other_specifications]);
    dbRun('INSERT INTO job_stages (job_id, stage, stage_name, updated_by) VALUES (?, 1, ?, ?)', [id, P.stageName(1), me(req)]);
    touchPO(po.id);
    return id;
  });
  audit(me(req), 'ADD_JOB', { po_number: po.po_number, details: 'Added job "' + f.job_name + '"' });
  res.json({ message: 'Job added.', id: jobId });
});

// Archive / unarchive
router.post('/:id/archive', requireAuth, (req, res) => {
  const po = dbGet('SELECT * FROM purchase_orders WHERE id = ?', [Number(req.params.id)]);
  if (!po) return res.status(404).json({ error: 'PO not found.' });
  dbRun('UPDATE purchase_orders SET is_archived=1, archived_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=?', [po.id]);
  audit(me(req), 'ARCHIVE_PO', { po_number: po.po_number, details: 'Archived PO' });
  res.json({ message: 'PO archived.' });
});

router.post('/:id/unarchive', requireAuth, (req, res) => {
  const po = dbGet('SELECT * FROM purchase_orders WHERE id = ?', [Number(req.params.id)]);
  if (!po) return res.status(404).json({ error: 'PO not found.' });
  dbRun('UPDATE purchase_orders SET is_archived=0, archived_at=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=?', [po.id]);
  audit(me(req), 'UNARCHIVE_PO', { po_number: po.po_number, details: 'Restored PO from archive' });
  res.json({ message: 'PO restored.' });
});

// Permanently delete an ARCHIVED PO — logged for the MD only
router.delete('/:id/archive', requireAuth, (req, res) => {
  const po = dbGet('SELECT * FROM purchase_orders WHERE id = ?', [Number(req.params.id)]);
  if (!po) return res.status(404).json({ error: 'PO not found.' });
  if (!po.is_archived) return res.status(400).json({ error: 'Only archived POs can be deleted from the archive.' });
  const jobNames = dbAll('SELECT job_name FROM jobs WHERE po_id = ?', [po.id]).map((r) => r.job_name).join(', ');
  dbBatch(() => P.deletePOCascade(dbRun, po.id));
  audit(me(req), 'DELETE_ARCHIVED_PO', {
    po_number: po.po_number,
    details: 'Permanently deleted archived PO' + (po.customer_name ? ' for ' + po.customer_name : '') + (jobNames ? ' (jobs: ' + jobNames + ')' : ''),
    visible_to: 'md_only'
  });
  res.json({ message: 'Archived PO deleted.' });
});

module.exports = router;
