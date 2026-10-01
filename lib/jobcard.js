// Job card: the fields from P.M. Offset Printers' paper job card, stored per job.
// Card details live in jobs.card (JSON). Production rows live in job_entries.

const COLOURS = {
  P3: ['C', 'M', 'Y', 'K', 'Aqua'],
  P4: ['C', 'M', 'Y', 'K', 'Aqua', 'White', 'UV', 'Drip']
};

const LAMINATION = [
  'BOPP Gloss Wet Lamination',
  'Matte Wet Lamination',
  'Gloss Thermal Lamination',
  'Matte Thermal Lamination',
  'Matt Velvet Lamination',
  'Metpet Lamination'
];

const FOILING = ['Spot UV', 'Gloss', 'Regular Hot Foil', '3D Scodix Foil', 'Cast and Cure'];

const PUNCHING = ['Bobst Machine', 'Hand Punch'];

const SECTIONS = ['printing', 'punching', 'pasting', 'delivery'];

// Text fields on the card, with max lengths
const TEXT_FIELDS = {
  bill_no: 60, bill_date: 10, material_rate: 60, new_plate_no: 60, old_plate_no: 60,
  job_details: 1000, job_size: 120, quantity: 120, material: 300, processing_details: 1000,
  printing_instructions: 2000, foiling_instructions: 2000, die_no: 60, packing_instructions: 2000
};

function str(v, max) {
  return String(v == null ? '' : v).trim().slice(0, max || 200);
}

function pick(list, allowed) {
  const set = new Set();
  (Array.isArray(list) ? list : []).forEach((v) => {
    const hit = allowed.find((a) => a.toLowerCase() === String(v).trim().toLowerCase());
    if (hit) set.add(hit);
  });
  return allowed.filter((a) => set.has(a)); // keep the standard order
}

/** Clean a card object sent from the browser */
function sanitizeCard(input) {
  const c = input && typeof input === 'object' ? input : {};
  const out = {};
  Object.keys(TEXT_FIELDS).forEach((k) => { out[k] = str(c[k], TEXT_FIELDS[k]); });
  if (out.bill_date && !/^\d{4}-\d{2}-\d{2}$/.test(out.bill_date)) out.bill_date = '';
  out.machine = c.machine === 'P3' || c.machine === 'P4' ? c.machine : '';
  out.colours = {};
  const allColours = COLOURS.P4;
  const src = c.colours && typeof c.colours === 'object' ? c.colours : {};
  allColours.forEach((name) => {
    const v = src[name] || {};
    const plate = v.plate === true || v.plate === 1 || v.plate === '1' || v.plate === 'true';
    const ink = str(v.ink, 20);
    if (plate || ink) out.colours[name] = { plate, ink };
  });
  out.lamination = pick(c.lamination, LAMINATION);
  out.foiling = pick(c.foiling, FOILING);
  out.punching = pick(c.punching, PUNCHING);
  return out;
}

function parseCard(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch (e) { return null; }
}

/** What a client may see about a job (nothing internal) */
function publicJob(j) {
  const card = parseCard(j.card) || {};
  return {
    id: j.id,
    job_name: j.job_name,
    product_name: j.job_name,
    job_size: card.job_size || '',
    quantity: card.quantity || j.quantity_specs || '',
    lamination: card.lamination || [],
    foiling: card.foiling || [],
    current_stage: j.current_stage,
    is_delayed: j.is_delayed,
    delay_reason: j.delay_reason,
    created_at: j.created_at,
    updated_at: j.updated_at,
    stages: j.stages || [],
    notes: j.notes || []
  };
}

function sanitizeEntry(section, b) {
  b = b || {};
  if (section === 'delivery') {
    return { del_date: str(b.del_date, 10), invoice: str(b.invoice, 60), quantity: str(b.quantity, 40) };
  }
  return {
    job_name: str(b.job_name, 200),
    start_date: str(b.start_date, 10), start_time: str(b.start_time, 8),
    end_date: str(b.end_date, 10), end_time: str(b.end_time, 8),
    total_qty: str(b.total_qty, 40), bal_qty: str(b.bal_qty, 40),
    operator: str(b.operator, 80)
  };
}

function jcLabel(n) {
  return 'N' + String(n).padStart(3, '0');
}

module.exports = { COLOURS, LAMINATION, FOILING, PUNCHING, SECTIONS, TEXT_FIELDS, sanitizeCard, parseCard, publicJob, sanitizeEntry, jcLabel };
