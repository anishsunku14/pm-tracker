// Business reports for the MD and Planning.
const express = require('express');
const { dbAll, STAGES } = require('../db/database');
const { requireRole } = require('../middleware/auth');
const router = express.Router();

const DAY = 24 * 60 * 60 * 1000;
const IST_OFFSET = 5.5 * 60 * 60 * 1000;

// Stored timestamps are UTC "YYYY-MM-DD HH:MM:SS"
function ts(v) {
  if (!v) return null;
  const t = Date.parse(String(v).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? '' : 'Z'));
  return isNaN(t) ? null : t;
}
function istDate(t) { return new Date(t + IST_OFFSET).toISOString().slice(0, 10); }
function istMonth(t) { return new Date(t + IST_OFFSET).toISOString().slice(0, 7); }
const round1 = (n) => Math.round(n * 10) / 10;

router.get('/', requireRole('planning', 'head_admin'), (req, res) => {
  const range = String(req.query.range || '90');
  const now = Date.now();
  const since = range === 'all' ? 0 : now - (parseInt(range, 10) || 90) * DAY;

  const pos = dbAll('SELECT id, po_number, customer_name, estimated_delivery, is_archived, created_at FROM purchase_orders');
  const jobs = dbAll('SELECT id, po_id, job_name, current_stage, is_delayed, COALESCE(is_archived, 0) AS is_archived, created_at FROM jobs');
  const stages = dbAll('SELECT job_id, stage, completed_at FROM job_stages');
  const links = dbAll('SELECT pc.po_id, c.id AS client_id, c.client_code, c.company_name FROM po_clients pc JOIN clients c ON c.id = pc.client_id');

  const poById = {};
  pos.forEach((p) => { poById[p.id] = p; });
  const stageTimes = {}; // job_id -> {stage: ts}
  stages.forEach((s) => {
    const t = ts(s.completed_at);
    if (t == null) return;
    (stageTimes[s.job_id] = stageTimes[s.job_id] || {})[s.stage] = t;
  });

  // ---- Headline numbers
  const posInRange = pos.filter((p) => (ts(p.created_at) || 0) >= since);
  const liveJobs = jobs.filter((j) => !j.is_archived);
  const jobsCreated = liveJobs.filter((j) => (ts(j.created_at) || 0) >= since).length;

  const completed = liveJobs
    .map((j) => ({ j, t6: (stageTimes[j.id] || {})[6] }))
    .filter((x) => x.j.current_stage === 6 && x.t6 && x.t6 >= since);

  let onTimeKnown = 0, onTime = 0, turnaroundSum = 0, turnaroundN = 0;
  completed.forEach(({ j, t6 }) => {
    const po = poById[j.po_id];
    if (po && po.estimated_delivery) {
      onTimeKnown++;
      if (istDate(t6) <= String(po.estimated_delivery).slice(0, 10)) onTime++;
    }
    const t1 = (stageTimes[j.id] || {})[1];
    if (t1 && t6 >= t1) { turnaroundSum += (t6 - t1) / DAY; turnaroundN++; }
  });

  const activeJobs = liveJobs.filter((j) => { const p = poById[j.po_id]; return p && !p.is_archived && j.current_stage < 6; });

  // ---- Average days spent in each stage (time from reaching stage n to reaching n+1)
  const stageAvg = STAGES.slice(0, 5).map((s) => {
    let sum = 0, n = 0;
    liveJobs.forEach((j) => {
      const t = stageTimes[j.id] || {};
      if (t[s.number] && t[s.number + 1] && t[s.number + 1] >= since && t[s.number + 1] >= t[s.number]) {
        sum += (t[s.number + 1] - t[s.number]) / DAY; n++;
      }
    });
    return { stage: s.number, name: s.name, avg_days: n ? round1(sum / n) : null, jobs: n };
  });

  // ---- Work in progress right now, by stage
  const wip = STAGES.map((s) => ({
    stage: s.number, name: s.name,
    jobs: liveJobs.filter((j) => { const p = poById[j.po_id]; return p && !p.is_archived && j.current_stage === s.number; }).length
  }));

  // ---- POs created per month (last 12 months, IST)
  const months = [];
  const d = new Date(now + IST_OFFSET);
  for (let i = 11; i >= 0; i--) {
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    months.push({ month: m.toISOString().slice(0, 7), pos: 0, jobs_completed: 0 });
  }
  const monthIdx = {};
  months.forEach((m, i) => { monthIdx[m.month] = i; });
  pos.forEach((p) => { const t = ts(p.created_at); if (t != null && monthIdx[istMonth(t)] != null) months[monthIdx[istMonth(t)]].pos++; });
  liveJobs.forEach((j) => { const t6 = (stageTimes[j.id] || {})[6]; if (j.current_stage === 6 && t6 && monthIdx[istMonth(t6)] != null) months[monthIdx[istMonth(t6)]].jobs_completed++; });

  // ---- Top clients by POs in range
  const inRangeIds = new Set(posInRange.map((p) => p.id));
  const clients = {};
  links.forEach((l) => {
    if (!inRangeIds.has(l.po_id)) return;
    const c = clients[l.client_id] = clients[l.client_id] || { client_code: l.client_code, company_name: l.company_name, pos: 0, jobs: 0 };
    c.pos++;
    c.jobs += liveJobs.filter((j) => j.po_id === l.po_id).length;
  });
  const topClients = Object.values(clients).sort((a, b) => b.pos - a.pos || b.jobs - a.jobs).slice(0, 10);

  res.json({
    range,
    kpis: {
      pos_created: posInRange.length,
      jobs_created: jobsCreated,
      jobs_completed: completed.length,
      on_time_rate: onTimeKnown ? Math.round((onTime / onTimeKnown) * 100) : null,
      on_time_basis: onTimeKnown,
      avg_turnaround_days: turnaroundN ? round1(turnaroundSum / turnaroundN) : null,
      active_jobs: activeJobs.length,
      delayed_now: activeJobs.filter((j) => j.is_delayed).length
    },
    stage_avg: stageAvg,
    wip,
    monthly: months,
    top_clients: topClients
  });
});

module.exports = router;
