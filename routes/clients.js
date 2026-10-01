const express = require('express');
const bcrypt = require('bcryptjs');
const { dbRun, dbInsert, dbBatch, dbGet, dbAll, audit, STAGES } = require('../db/database');
const { requireAuth, requireHeadAdmin, requireRole } = require('../middleware/auth');
const P = require('../lib/poData');
const router = express.Router();

const CODE_RE = /^[A-Z]{2,4}[0-9]{0,3}$/;
const me = (req) => req.session.user.username;

function clean(v, max) {
  return String(v == null ? '' : v).trim().slice(0, max || 200);
}

function contactsFor(clientId) {
  return dbAll('SELECT id, name, phone, email, designation, notify_email, notify_whatsapp FROM client_contacts WHERE client_id = ? ORDER BY id', [clientId]);
}

const flag01 = (v) => (v === true || v === 1 || v === '1' || v === 'true' || v === 'on' ? 1 : 0);

function saveContacts(clientId, list) {
  // Keep each existing contact's alert choices unless new ones are sent
  const prev = {};
  contactsFor(clientId).forEach((c) => { prev[c.id] = c; });
  dbRun('DELETE FROM client_contacts WHERE client_id = ?', [clientId]);
  (Array.isArray(list) ? list : []).slice(0, 20).forEach((c) => {
    const row = [clean(c.name), clean(c.phone, 40), clean(c.email, 120), clean(c.designation, 100)];
    if (!row.some(Boolean)) return;
    const old = c.id != null ? prev[c.id] : null;
    const ne = c.notify_email !== undefined ? flag01(c.notify_email) : (old ? old.notify_email : 1);
    const nw = c.notify_whatsapp !== undefined ? flag01(c.notify_whatsapp) : (old ? old.notify_whatsapp : 0);
    dbRun('INSERT INTO client_contacts (client_id, name, phone, email, designation, notify_email, notify_whatsapp) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [clientId].concat(row, [ne, nw]));
  });
}

function publicClient(c) {
  const count = dbGet(
    'SELECT COUNT(*) AS n FROM po_clients pc JOIN purchase_orders p ON p.id = pc.po_id WHERE pc.client_id = ? AND p.is_archived = 0',
    [c.id]
  );
  return {
    id: c.id,
    client_code: c.client_code,
    company_name: c.company_name,
    created_by: c.created_by,
    created_at: c.created_at,
    contacts: contactsFor(c.id),
    po_count: count ? count.n : 0
  };
}

/* ---------------------------------------------------------------- PUBLIC: client dashboard */

// Simple brute-force protection: 10 failed attempts per IP per 15 minutes
const failures = new Map();
function tooMany(ip) {
  const f = failures.get(ip);
  if (!f) return false;
  if (Date.now() - f.first > 15 * 60 * 1000) { failures.delete(ip); return false; }
  return f.count >= 10;
}
function recordFailure(ip) {
  const f = failures.get(ip);
  if (!f || Date.now() - f.first > 15 * 60 * 1000) failures.set(ip, { count: 1, first: Date.now() });
  else f.count++;
}

router.post('/dashboard', (req, res) => {
  const ip = req.ip;
  if (tooMany(ip)) return res.status(429).json({ error: 'Too many attempts. Please try again in 15 minutes.' });

  const code = clean(req.body.client_code || req.body.code, 10).toUpperCase().replace(/\s+/g, '');
  const password = String(req.body.password || '');
  if (!code || !password) return res.status(400).json({ error: 'Client code and password are required.' });

  const client = dbGet('SELECT * FROM clients WHERE client_code = ?', [code]);
  if (!client || !bcrypt.compareSync(password, client.password)) {
    recordFailure(ip);
    return res.status(401).json({ error: 'Incorrect client code or password.' });
  }
  failures.delete(ip);
  req.session.client = { id: client.id, code: client.client_code };

  const rows = dbAll(
    'SELECT p.* FROM purchase_orders p JOIN po_clients pc ON pc.po_id = p.id WHERE pc.client_id = ? AND p.is_archived = 0 ORDER BY p.created_at DESC, p.id DESC',
    [client.id]
  );
  const pos = P.fullPOs(rows, { public: true }).map((full, i) => {
    full.id = rows[i].id; // needed for expand/collapse on the dashboard
    return full;
  });

  res.json({ client: { client_code: client.client_code, company_name: client.company_name }, pos, stages: STAGES });
});

/* ---------------------------------------------------------------- CLIENT: alert preferences */

function requireClient(req, res, next) {
  if (req.session && req.session.client && dbGet('SELECT id FROM clients WHERE id = ?', [req.session.client.id])) return next();
  return res.status(401).json({ error: 'Please sign in with your client code again.' });
}

// Each contact chooses email and/or WhatsApp alerts for stage changes
router.get('/me/preferences', requireClient, (req, res) => {
  const contacts = contactsFor(req.session.client.id).map((c) => ({
    id: c.id, name: c.name, designation: c.designation,
    email: c.email, phone: c.phone,
    notify_email: c.notify_email ? 1 : 0, notify_whatsapp: c.notify_whatsapp ? 1 : 0
  }));
  res.json({ contacts });
});

router.put('/me/preferences', requireClient, (req, res) => {
  const list = Array.isArray(req.body.contacts) ? req.body.contacts : [];
  const mine = {};
  contactsFor(req.session.client.id).forEach((c) => { mine[c.id] = c; });
  dbBatch(() => {
    list.forEach((c) => {
      const cur = mine[Number(c.id)];
      if (!cur) return;
      dbRun('UPDATE client_contacts SET notify_email = ?, notify_whatsapp = ? WHERE id = ?',
        [cur.email ? flag01(c.notify_email) : 0, cur.phone ? flag01(c.notify_whatsapp) : 0, cur.id]);
    });
  });
  audit('client:' + req.session.client.code, 'UPDATE_ALERT_PREFERENCES', { details: 'Client updated alert preferences' });
  res.json({ message: 'Your alert preferences are saved.' });
});

router.post('/me/logout', (req, res) => {
  if (req.session) req.session.client = null;
  res.json({ message: 'Signed out.' });
});

/* ---------------------------------------------------------------- STAFF: manage clients */

router.get('/', requireAuth, (req, res) => {
  const clients = dbAll('SELECT * FROM clients ORDER BY client_code').map(publicClient);
  res.json({ clients });
});

router.post('/', requireAuth, (req, res) => {
  const code = clean(req.body.client_code || req.body.code, 10).toUpperCase().replace(/\s+/g, '');
  const company = clean(req.body.company_name, 200);
  const password = String(req.body.password || '');
  if (!CODE_RE.test(code)) return res.status(400).json({ error: 'Client code must be 2–4 letters followed by up to 3 numbers (e.g. TATA, BV01).' });
  if (!company) return res.status(400).json({ error: 'Company name is required.' });
  if (password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters.' });
  if (dbGet('SELECT id FROM clients WHERE client_code = ?', [code])) return res.status(409).json({ error: 'Client code ' + code + ' already exists.' });

  const id = dbBatch(() => {
    const newId = dbInsert('INSERT INTO clients (client_code, company_name, password, created_by) VALUES (?, ?, ?, ?)',
      [code, company, bcrypt.hashSync(password, 10), me(req)]);
    saveContacts(newId, req.body.contacts);
    return newId;
  });
  audit(me(req), 'CREATE_CLIENT', { details: 'Created client ' + code + ' (' + company + ')' });
  res.json({ message: 'Client ' + code + ' created.', id });
});

router.get('/:id', requireAuth, (req, res) => {
  const c = dbGet('SELECT * FROM clients WHERE id = ?', [Number(req.params.id)]);
  if (!c) return res.status(404).json({ error: 'Client not found.' });
  res.json({ client: publicClient(c) });
});

router.put('/:id', requireAuth, (req, res) => {
  const c = dbGet('SELECT * FROM clients WHERE id = ?', [Number(req.params.id)]);
  if (!c) return res.status(404).json({ error: 'Client not found.' });
  const company = clean(req.body.company_name, 200) || c.company_name;
  dbBatch(() => {
    dbRun('UPDATE clients SET company_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [company, c.id]);
    if (Array.isArray(req.body.contacts)) saveContacts(c.id, req.body.contacts);
  });
  audit(me(req), 'UPDATE_CLIENT', { details: 'Updated client ' + c.client_code });
  res.json({ message: 'Client updated.' });
});

// Only Planning or the MD can change a client's password
router.post('/:id/change-password', requireRole('planning', 'head_admin'), (req, res) => {
  const c = dbGet('SELECT * FROM clients WHERE id = ?', [Number(req.params.id)]);
  if (!c) return res.status(404).json({ error: 'Client not found.' });
  const pw = String(req.body.newPassword || req.body.new_password || req.body.password || '');
  if (pw.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters.' });
  dbRun('UPDATE clients SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [bcrypt.hashSync(pw, 10), c.id]);
  audit(me(req), 'CHANGE_CLIENT_PASSWORD', { details: 'Changed password for client ' + c.client_code });
  res.json({ message: 'Password updated for ' + c.client_code + '.' });
});

// Delete client (MD only). POs stay, but are unlinked from this client.
router.delete('/:id', requireHeadAdmin, (req, res) => {
  const c = dbGet('SELECT * FROM clients WHERE id = ?', [Number(req.params.id)]);
  if (!c) return res.status(404).json({ error: 'Client not found.' });
  dbBatch(() => {
    dbRun('DELETE FROM client_contacts WHERE client_id = ?', [c.id]);
    dbRun('DELETE FROM po_clients WHERE client_id = ?', [c.id]);
    dbRun('DELETE FROM clients WHERE id = ?', [c.id]);
  });
  audit(me(req), 'DELETE_CLIENT', { details: 'Deleted client ' + c.client_code + ' (' + c.company_name + ')' });
  res.json({ message: 'Client deleted.' });
});

module.exports = router;
