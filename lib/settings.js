// Simple key/value settings stored in the database (edited by the MD in Settings).
const { dbRun, dbAll } = require('../db/database');

const DEFAULTS = {
  site_url: 'https://trackpmop.com',
  // Email (SMTP)
  email_enabled: '0',
  smtp_host: 'smtp.gmail.com',
  smtp_port: '465',
  smtp_secure: '1',
  smtp_user: '',
  smtp_pass: '',
  email_from_name: 'P.M. Offset Printers',
  // WhatsApp Cloud API (Meta)
  whatsapp_enabled: '0',
  wa_api_version: 'v21.0',
  wa_phone_number_id: '',
  wa_token: '',
  wa_template: 'order_stage_update',
  wa_language: 'en'
};

// Fields that are never sent back to the browser
const SECRETS = ['smtp_pass', 'wa_token'];

function getAll() {
  const out = Object.assign({}, DEFAULTS);
  dbAll('SELECT key, value FROM settings').forEach((r) => { out[r.key] = r.value; });
  return out;
}

function get(key) {
  return getAll()[key];
}

function setMany(obj) {
  Object.keys(obj).forEach((k) => {
    if (!(k in DEFAULTS)) return;
    dbRun('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [k, String(obj[k] == null ? '' : obj[k])]);
  });
}

/** Settings safe to show in the browser: secrets replaced by "is set" flags */
function publicView() {
  const all = getAll();
  const out = {};
  Object.keys(all).forEach((k) => {
    if (SECRETS.indexOf(k) > -1) out[k + '_set'] = !!all[k];
    else out[k] = all[k];
  });
  return out;
}

module.exports = { DEFAULTS, SECRETS, getAll, get, setMany, publicView };
