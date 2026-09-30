const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
const dbPath = path.join(dataDir, 'tracker.db');

const STAGES = [
  { number: 1, name: 'Order Received' },
  { number: 2, name: 'Design / Prepress' },
  { number: 3, name: 'Printing' },
  { number: 4, name: 'Post-Press Finishing' },
  { number: 5, name: 'Quality Check' },
  { number: 6, name: 'Shipping / Ready for Pickup' }
];

let db = null;
let dbReady = null;
let batching = 0;

function initDb() {
  if (dbReady) return dbReady;

  dbReady = new Promise(async (resolve, reject) => {
    try {
      if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

      const SQL = await initSqlJs();
      db = fs.existsSync(dbPath) ? new SQL.Database(fs.readFileSync(dbPath)) : new SQL.Database();

      createTables();
      migrate();

      saveDb();
      resolve(db);
    } catch (err) {
      reject(err);
    }
  });

  return dbReady;
}

function createTables() {
  // ---- Staff accounts ----
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'staff',
    security_question TEXT,
    security_answer TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // ---- Clients ----
  db.run(`CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_code TEXT UNIQUE NOT NULL,
    company_name TEXT NOT NULL,
    password TEXT NOT NULL,
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS client_contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL,
    name TEXT,
    phone TEXT,
    email TEXT,
    designation TEXT,
    notify_email INTEGER DEFAULT 1,
    notify_whatsapp INTEGER DEFAULT 0
  )`);

  // ---- Purchase orders & jobs ----
  db.run(`CREATE TABLE IF NOT EXISTS purchase_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    po_number TEXT UNIQUE NOT NULL,
    customer_name TEXT,
    date_of_order DATE,
    estimated_delivery DATE,
    is_archived INTEGER DEFAULT 0,
    archived_at DATETIME,
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS po_clients (
    po_id INTEGER NOT NULL,
    client_id INTEGER NOT NULL,
    PRIMARY KEY (po_id, client_id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    po_id INTEGER NOT NULL,
    job_name TEXT NOT NULL,
    quantity_specs TEXT,
    finish_type TEXT,
    gsm TEXT,
    process TEXT,
    embellishments INTEGER DEFAULT 0,
    cast_and_cure INTEGER DEFAULT 0,
    other_specifications TEXT,
    current_stage INTEGER DEFAULT 1,
    is_delayed INTEGER DEFAULT 0,
    delay_reason TEXT,
    is_archived INTEGER DEFAULT 0,
    archived_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS job_stages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    stage INTEGER NOT NULL,
    stage_name TEXT NOT NULL,
    completed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_by TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS job_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    note TEXT NOT NULL,
    author TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // ---- Audit log ----
  db.run(`CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user TEXT NOT NULL,
    action TEXT NOT NULL,
    order_id TEXT,
    po_number TEXT,
    details TEXT,
    visible_to TEXT DEFAULT 'all',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`);

  // App settings editable by the MD (email / WhatsApp configuration)
  db.run(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`);

  // Every alert attempt, for troubleshooting
  db.run(`CREATE TABLE IF NOT EXISTS notification_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel TEXT NOT NULL,
    recipient TEXT,
    client_code TEXT,
    po_number TEXT,
    job_name TEXT,
    stage TEXT,
    status TEXT NOT NULL,
    error TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run('CREATE INDEX IF NOT EXISTS idx_jobs_po ON jobs(po_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_stages_job ON job_stages(job_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_notes_job ON job_notes(job_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_poc_client ON po_clients(client_id)');
}

function columns(table) {
  const res = db.exec('PRAGMA table_info(' + table + ')');
  return res.length ? res[0].values.map((r) => r[1]) : [];
}

function tableExists(name) {
  const res = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='" + name + "'");
  return res.length > 0 && res[0].values.length > 0;
}

function metaGet(key) {
  const res = db.exec("SELECT value FROM meta WHERE key = '" + key + "'");
  return res.length && res[0].values.length ? res[0].values[0][0] : null;
}

/**
 * Upgrades an existing database from the old single-order system.
 * - Adds new audit_log columns.
 * - Copies every old order into a PO with one job (stages + notes kept).
 * The old tables are left untouched as a backup.
 */
function migrate() {
  const auditCols = columns('audit_log');
  if (auditCols.indexOf('po_number') === -1) db.run('ALTER TABLE audit_log ADD COLUMN po_number TEXT');
  if (auditCols.indexOf('visible_to') === -1) db.run("ALTER TABLE audit_log ADD COLUMN visible_to TEXT DEFAULT 'all'");

  const jobCols = columns('jobs');
  if (jobCols.indexOf('is_archived') === -1) db.run('ALTER TABLE jobs ADD COLUMN is_archived INTEGER DEFAULT 0');
  if (jobCols.indexOf('archived_at') === -1) db.run('ALTER TABLE jobs ADD COLUMN archived_at DATETIME');
  if (jobCols.indexOf('last_notified_stage') === -1) {
    db.run('ALTER TABLE jobs ADD COLUMN last_notified_stage INTEGER');
    // Existing jobs: treat their current stage as already notified, so nothing is sent on upgrade
    db.run('UPDATE jobs SET last_notified_stage = current_stage');
  }

  const contactCols = columns('client_contacts');
  if (contactCols.indexOf('notify_email') === -1) db.run('ALTER TABLE client_contacts ADD COLUMN notify_email INTEGER DEFAULT 1');
  if (contactCols.indexOf('notify_whatsapp') === -1) db.run('ALTER TABLE client_contacts ADD COLUMN notify_whatsapp INTEGER DEFAULT 0');

  if (metaGet('migrated_orders_v1') || !tableExists('orders')) return;

  const orders = db.exec('SELECT order_id, customer_name, job_type, quantity_specs, date_of_order, estimated_delivery, finish_type, gsm, process, embellishments, cast_and_cure, other_specifications, current_stage, is_delayed, delay_reason, created_at, updated_at FROM orders ORDER BY id');
  let moved = 0;
  if (orders.length) {
    for (const r of orders[0].values) {
      const [orderId, customer, jobType, qty, dateOrder, delivery, finish, gsm, proc, emb, cc, other, stage, delayed, reason, createdAt, updatedAt] = r;
      const exists = db.exec("SELECT id FROM purchase_orders WHERE LOWER(REPLACE(REPLACE(po_number,' ',''),'-','')) = LOWER(REPLACE(REPLACE(?,' ',''),'-',''))", [orderId]);
      if (exists.length && exists[0].values.length) continue;

      db.run('INSERT INTO purchase_orders (po_number, customer_name, date_of_order, estimated_delivery, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [orderId, customer, dateOrder, delivery, 'migration', createdAt, updatedAt]);
      const poId = db.exec('SELECT last_insert_rowid()')[0].values[0][0];

      db.run(`INSERT INTO jobs (po_id, job_name, quantity_specs, finish_type, gsm, process, embellishments, cast_and_cure, other_specifications, current_stage, is_delayed, delay_reason, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [poId, jobType || 'Job', qty, finish, gsm, proc, emb || 0, cc || 0, other, stage || 1, delayed || 0, reason, createdAt, updatedAt]);
      const jobId = db.exec('SELECT last_insert_rowid()')[0].values[0][0];

      db.run('INSERT INTO job_stages (job_id, stage, stage_name, completed_at, updated_by) SELECT ?, stage, stage_name, completed_at, updated_by FROM order_stages WHERE order_id = ?', [jobId, orderId]);
      db.run('INSERT INTO job_notes (job_id, note, author, created_at) SELECT ?, note, author, created_at FROM order_notes WHERE order_id = ?', [jobId, orderId]);
      moved++;
    }
  }
  db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('migrated_orders_v1', ?)", [new Date().toISOString() + ' (' + moved + ' orders)']);
  if (moved) console.log('   Migrated ' + moved + ' old order(s) into purchase orders.');
}

function saveDb() {
  if (db && !batching) {
    fs.writeFileSync(dbPath, Buffer.from(db.export()));
  }
}

function dbRun(sql, params) {
  if (!db) throw new Error('Database not initialized');
  db.run(sql, params || []);
  saveDb();
}

/** Runs an INSERT and returns the new row id. */
function dbInsert(sql, params) {
  if (!db) throw new Error('Database not initialized');
  db.run(sql, params || []);
  // Read the id BEFORE saving: db.export() reopens the database and resets last_insert_rowid.
  const id = db.exec('SELECT last_insert_rowid()')[0].values[0][0];
  saveDb();
  return id;
}

/** Runs several writes and saves to disk once at the end. */
function dbBatch(fn) {
  batching++;
  try {
    return fn();
  } finally {
    batching--;
    saveDb();
  }
}

function dbGet(sql, params) {
  if (!db) throw new Error('Database not initialized');
  const stmt = db.prepare(sql);
  if (params) stmt.bind(params);
  let row = null;
  if (stmt.step()) row = stmt.getAsObject();
  stmt.free();
  return row;
}

function dbAll(sql, params) {
  if (!db) throw new Error('Database not initialized');
  const results = [];
  const stmt = db.prepare(sql);
  if (params) stmt.bind(params);
  while (stmt.step()) results.push(stmt.getAsObject());
  stmt.free();
  return results;
}

/** Writes an audit entry. opts: { po_number, details, visible_to } */
function audit(user, action, opts) {
  opts = opts || {};
  dbRun('INSERT INTO audit_log (user, action, po_number, details, visible_to) VALUES (?, ?, ?, ?, ?)',
    [user || 'system', action, opts.po_number || null, opts.details || '', opts.visible_to || 'all']);
}

module.exports = { initDb, saveDb, dbRun, dbInsert, dbBatch, dbGet, dbAll, audit, STAGES };
