// Client alerts on job stage changes, by email (SMTP) and/or WhatsApp (Meta Cloud API).
// Each contact chooses their own channels (notify_email / notify_whatsapp).
const nodemailer = require('nodemailer');
const { dbGet, dbAll, dbRun } = require('../db/database');
const S = require('./settings');
const { stageName } = require('./poData');

// Wait a little before sending, so quick corrections (e.g. clicking the wrong stage)
// only send one message with the final stage.
const DELAY_MS = Number(process.env.NOTIFY_DELAY_MS || 30000);
const timers = new Map();

function scheduleStageNotice(jobId) {
  clearTimeout(timers.get(jobId));
  timers.set(jobId, setTimeout(() => {
    timers.delete(jobId);
    sendStageNotice(jobId).catch((e) => console.error('Stage notice failed:', e));
  }, DELAY_MS));
}

function log(entry) {
  dbRun('INSERT INTO notification_log (channel, recipient, client_code, po_number, job_name, stage, status, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [entry.channel, entry.recipient || '', entry.client_code || '', entry.po_number || '', entry.job_name || '', entry.stage || '', entry.status, entry.error || '']);
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Indian mobile numbers → WhatsApp format (country code, digits only) */
function waNumber(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length === 10) d = '91' + d;
  return d.length >= 11 ? d : '';
}

/** "2461" → "PO 2461"; leaves "PO 2461" / "PO-2461" as they are */
function poLabel(n) {
  n = String(n || '').trim();
  return /^p\.?\s*o\b|^po[-\s\d]/i.test(n) ? n : 'PO ' + n;
}

function trackUrl(settings, poNumber) {
  return String(settings.site_url || '').replace(/\/+$/, '') + '/?po=' + encodeURIComponent(poNumber);
}

/* ------------------------------------------------------------------ Email */
let transport = null, transportKey = '';
function mailer(settings) {
  const key = [settings.smtp_host, settings.smtp_port, settings.smtp_secure, settings.smtp_user, settings.smtp_pass].join('|');
  if (!transport || key !== transportKey) {
    transport = nodemailer.createTransport({
      host: settings.smtp_host,
      port: Number(settings.smtp_port) || 465,
      secure: settings.smtp_secure === '1',
      auth: settings.smtp_user ? { user: settings.smtp_user, pass: settings.smtp_pass } : undefined,
      connectionTimeout: 15000
    });
    transportKey = key;
  }
  return transport;
}

function emailHTML(o) {
  const bar = ['#00b4d8', '#e040fb', '#fdd835', '#111111'].map((c) => '<td style="height:4px;background:' + c + '"></td>').join('');
  const steps = [1, 2, 3, 4, 5, 6].map((n) => {
    const done = n <= o.stageNumber;
    return '<td style="padding:0 2px"><div style="height:6px;border-radius:3px;background:' + (done ? '#8B0000' : '#e5e5ea') + '"></div></td>';
  }).join('');
  return '<!doctype html><html><body style="margin:0;background:#f5f5f7;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1d1d1f">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f7;padding:32px 12px"><tr><td align="center">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:18px;overflow:hidden">' +
    '<tr>' + bar + '</tr>' +
    '<tr><td colspan="4" style="padding:28px 28px 8px"><div style="font-size:13px;color:#6e6e73">P.M. Offset Printers · Order update</div>' +
    '<div style="font-size:22px;font-weight:600;margin-top:10px;line-height:1.3">' + esc(o.jobName) + (o.stageNumber === 6 ? ' is ready' : ' has moved to ' + esc(o.stage)) + '</div>' +
    '<div style="font-size:15px;color:#6e6e73;margin-top:6px">' + esc(poLabel(o.poNumber)) + (o.company ? ' · ' + esc(o.company) : '') + '</div></td></tr>' +
    '<tr><td colspan="4" style="padding:18px 26px 4px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' + steps + '</tr></table>' +
    '<div style="font-size:13px;color:#6e6e73;margin-top:8px">Stage ' + o.stageNumber + ' of 6: <strong style="color:#1d1d1f">' + esc(o.stage) + '</strong></div></td></tr>' +
    '<tr><td colspan="4" style="padding:22px 28px 30px"><a href="' + esc(o.url) + '" style="display:inline-block;background:#8B0000;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:999px;font-size:15px;font-weight:500">Track your order</a></td></tr>' +
    '</table><div style="font-size:12px;color:#8e8e93;margin-top:16px">You receive these updates because you chose email alerts on your P.M. Offset Printers dashboard.</div>' +
    '</td></tr></table></body></html>';
}

async function sendEmail(settings, to, subject, html, text) {
  const from = settings.email_from_name ? '"' + settings.email_from_name.replace(/"/g, '') + '" <' + settings.smtp_user + '>' : settings.smtp_user;
  await mailer(settings).sendMail({ from, to, subject, html, text });
}

/* ------------------------------------------------------------------ WhatsApp */
async function sendWhatsApp(settings, to, params) {
  const url = 'https://graph.facebook.com/' + (settings.wa_api_version || 'v21.0') + '/' + encodeURIComponent(settings.wa_phone_number_id) + '/messages';
  const body = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: settings.wa_template,
      language: { code: settings.wa_language || 'en' },
      components: [{ type: 'body', parameters: params.map((t) => ({ type: 'text', text: String(t) })) }]
    }
  };
  const res = await fetch(process.env.WA_API_BASE ? process.env.WA_API_BASE + '/messages' : url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + settings.wa_token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000)
  });
  if (!res.ok) {
    let msg = 'HTTP ' + res.status;
    try { const j = await res.json(); if (j.error) msg += ': ' + (j.error.message || JSON.stringify(j.error)); } catch (e) { /* ignore */ }
    throw new Error(msg);
  }
}

/* ------------------------------------------------------------------ Stage notice */
async function sendStageNotice(jobId) {
  const job = dbGet('SELECT * FROM jobs WHERE id = ?', [jobId]);
  if (!job || job.is_archived) return;
  const po = dbGet('SELECT * FROM purchase_orders WHERE id = ?', [job.po_id]);
  if (!po) return;

  const last = job.last_notified_stage || 1;
  if (job.current_stage <= last) {
    // Moved back (a correction): remember the lower stage so moving forward again notifies
    if (job.current_stage < last) dbRun('UPDATE jobs SET last_notified_stage = ? WHERE id = ?', [job.current_stage, job.id]);
    return;
  }
  dbRun('UPDATE jobs SET last_notified_stage = ? WHERE id = ?', [job.current_stage, job.id]);

  const settings = S.getAll();
  const emailOn = settings.email_enabled === '1' && settings.smtp_user && settings.smtp_pass;
  const waOn = settings.whatsapp_enabled === '1' && settings.wa_phone_number_id && settings.wa_token && settings.wa_template;
  if (!emailOn && !waOn) return;

  const stage = stageName(job.current_stage);
  const url = trackUrl(settings, po.po_number);
  const contacts = dbAll(
    'SELECT cc.*, c.client_code, c.company_name FROM po_clients pc JOIN clients c ON c.id = pc.client_id JOIN client_contacts cc ON cc.client_id = c.id WHERE pc.po_id = ?',
    [po.id]
  );

  const sentEmails = new Set(), sentPhones = new Set();
  for (const c of contacts) {
    const base = { client_code: c.client_code, po_number: po.po_number, job_name: job.job_name, stage };

    if (emailOn && c.notify_email && c.email && !sentEmails.has(c.email.toLowerCase())) {
      sentEmails.add(c.email.toLowerCase());
      const subject = job.current_stage === 6
        ? job.job_name + ' is ready · ' + poLabel(po.po_number)
        : job.job_name + ' is now at ' + stage + ' · ' + poLabel(po.po_number);
      const text = 'Hello' + (c.name ? ' ' + c.name : '') + ',\n\n' + job.job_name + ' (' + poLabel(po.po_number) + ') ' +
        (job.current_stage === 6 ? 'is ready for pickup / shipping.' : 'has moved to: ' + stage + '.') +
        '\n\nTrack your order: ' + url + '\n\nP.M. Offset Printers';
      try {
        await sendEmail(settings, c.email, subject, emailHTML({ jobName: job.job_name, stage, stageNumber: job.current_stage, poNumber: po.po_number, company: c.company_name, url }), text);
        log(Object.assign({ channel: 'email', recipient: c.email, status: 'sent' }, base));
      } catch (e) {
        log(Object.assign({ channel: 'email', recipient: c.email, status: 'failed', error: e.message }, base));
      }
    }

    const wa = waNumber(c.phone);
    if (waOn && c.notify_whatsapp && wa && !sentPhones.has(wa)) {
      sentPhones.add(wa);
      try {
        await sendWhatsApp(settings, wa, [c.name || c.company_name || 'there', job.job_name, poLabel(po.po_number), stage, url]);
        log(Object.assign({ channel: 'whatsapp', recipient: wa, status: 'sent' }, base));
      } catch (e) {
        log(Object.assign({ channel: 'whatsapp', recipient: wa, status: 'failed', error: e.message }, base));
      }
    }
  }
}

/* ------------------------------------------------------------------ Tests from Settings */
async function testEmail(to) {
  const settings = S.getAll();
  if (!settings.smtp_user || !settings.smtp_pass) throw new Error('Enter the email address and app password first, then save.');
  const url = trackUrl(settings, 'PO 0000');
  await sendEmail(settings, to, 'Test alert · P.M. Offset Printers',
    emailHTML({ jobName: 'Sample job', stage: 'Printing', stageNumber: 3, poNumber: 'PO 0000', company: 'Test', url }),
    'This is a test alert from P.M. Offset Printers order tracking.');
  log({ channel: 'email', recipient: to, po_number: 'TEST', job_name: 'Test message', stage: 'Printing', status: 'sent' });
}

async function testWhatsApp(phone) {
  const settings = S.getAll();
  if (!settings.wa_phone_number_id || !settings.wa_token || !settings.wa_template) throw new Error('Enter the WhatsApp phone number ID, access token and template name first, then save.');
  const to = waNumber(phone);
  if (!to) throw new Error('Enter a valid mobile number, e.g. 98450 12345.');
  await sendWhatsApp(settings, to, ['there', 'Sample job', 'PO 0000', 'Printing', trackUrl(settings, 'PO 0000')]);
  log({ channel: 'whatsapp', recipient: to, po_number: 'TEST', job_name: 'Test message', stage: 'Printing', status: 'sent' });
}

module.exports = { scheduleStageNotice, sendStageNotice, testEmail, testWhatsApp, waNumber };
