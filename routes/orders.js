const express = require('express');
const { dbRun, dbGet, dbAll } = require('../db/database');
const { requireAuth, requireHeadAdmin } = require('../middleware/auth');
const router = express.Router();

const STAGES = [
  { number: 1, name: 'Order Received' },
  { number: 2, name: 'Design / Prepress' },
  { number: 3, name: 'Printing' },
  { number: 4, name: 'Post-Press Finishing' },
  { number: 5, name: 'Quality Check' },
  { number: 6, name: 'Shipping / Ready for Pickup' }
];

// CLIENT: Track order (public)
router.get('/track/:orderId', (req, res) => {
  const order = dbGet('SELECT * FROM orders WHERE LOWER(REPLACE(order_id, " ", "")) = ?', [req.params.orderId.trim().toLowerCase().replace(/\s/g, '')]);
  if (!order) return res.status(404).json({ error: 'Order not found. Please check the Order ID and try again.' });

  const stages = dbAll('SELECT * FROM order_stages WHERE order_id = ? ORDER BY stage ASC', [order.order_id]);
  const notes = dbAll('SELECT id, note, author, created_at FROM order_notes WHERE order_id = ? ORDER BY created_at DESC', [order.order_id]);

  res.json({
    order: {
      order_id: order.order_id, customer_name: order.customer_name, job_type: order.job_type,
      quantity_specs: order.quantity_specs, date_of_order: order.date_of_order,
      estimated_delivery: order.estimated_delivery, finish_type: order.finish_type,
      gsm: order.gsm, process: order.process, embellishments: order.embellishments,
      cast_and_cure: order.cast_and_cure, other_specifications: order.other_specifications,
      current_stage: order.current_stage, is_delayed: order.is_delayed, delay_reason: order.delay_reason
    },
    stages: STAGES.map(s => {
      const completed = stages.find(cs => cs.stage === s.number);
      return { ...s, completed: !!completed, completed_at: completed ? completed.completed_at : null, updated_by: completed ? completed.updated_by : null };
    }),
    notes
  });
});

// ADMIN: Get all orders
router.get('/', requireAuth, (req, res) => {
  const orders = dbAll('SELECT * FROM orders ORDER BY created_at DESC');
  res.json({ orders, stages: STAGES });
});

// ADMIN: Create order
router.post('/', requireAuth, (req, res) => {
  const { order_id, customer_name, job_type, quantity_specs, date_of_order, estimated_delivery, finish_type, gsm, process, embellishments, cast_and_cure, other_specifications } = req.body;

  if (!order_id || !customer_name || !job_type || !date_of_order) {
    return res.status(400).json({ error: 'Order ID, Customer Name, Job Type, and Date of Order are required.' });
  }

  const existing = dbGet('SELECT id FROM orders WHERE order_id = ?', [order_id.trim()]);
  if (existing) return res.status(409).json({ error: 'An order with this ID already exists.' });

  const processStr = Array.isArray(process) ? process.join(', ') : (process || '');

  dbRun(`INSERT INTO orders (order_id, customer_name, job_type, quantity_specs, date_of_order, estimated_delivery, finish_type, gsm, process, embellishments, cast_and_cure, other_specifications, current_stage) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [order_id.trim(), customer_name.trim(), job_type.trim(), quantity_specs || '', date_of_order, estimated_delivery || null, finish_type || '', gsm || '', processStr, embellishments ? 1 : 0, cast_and_cure ? 1 : 0, other_specifications || '']);

  dbRun('INSERT INTO order_stages (order_id, stage, stage_name, updated_by) VALUES (?, 1, ?, ?)', [order_id.trim(), 'Order Received', req.session.user.username]);
  dbRun('INSERT INTO audit_log (user, action, order_id, details) VALUES (?, ?, ?, ?)', [req.session.user.username, 'CREATE_ORDER', order_id.trim(), 'Created order for ' + customer_name.trim()]);

  res.json({ message: 'Order created successfully.' });
});

// ADMIN: Update order
router.put('/:orderId', requireAuth, (req, res) => {
  const order = dbGet('SELECT * FROM orders WHERE order_id = ?', [req.params.orderId]);
  if (!order) return res.status(404).json({ error: 'Order not found.' });

  const { customer_name, job_type, quantity_specs, date_of_order, estimated_delivery, finish_type, gsm, process, embellishments, cast_and_cure, other_specifications } = req.body;
  const processStr = Array.isArray(process) ? process.join(', ') : (process || order.process);

  dbRun(`UPDATE orders SET customer_name=?, job_type=?, quantity_specs=?, date_of_order=?, estimated_delivery=?, finish_type=?, gsm=?, process=?, embellishments=?, cast_and_cure=?, other_specifications=?, updated_at=CURRENT_TIMESTAMP WHERE order_id=?`,
    [customer_name || order.customer_name, job_type || order.job_type, quantity_specs !== undefined ? quantity_specs : order.quantity_specs, date_of_order || order.date_of_order, estimated_delivery !== undefined ? estimated_delivery : order.estimated_delivery, finish_type !== undefined ? finish_type : order.finish_type, gsm !== undefined ? gsm : order.gsm, processStr, embellishments !== undefined ? (embellishments ? 1 : 0) : order.embellishments, cast_and_cure !== undefined ? (cast_and_cure ? 1 : 0) : order.cast_and_cure, other_specifications !== undefined ? other_specifications : order.other_specifications, req.params.orderId]);

  dbRun('INSERT INTO audit_log (user, action, order_id, details) VALUES (?, ?, ?, ?)', [req.session.user.username, 'UPDATE_ORDER', req.params.orderId, 'Updated order details']);
  res.json({ message: 'Order updated successfully.' });
});

// ADMIN: Update stage
router.post('/:orderId/stage', requireAuth, (req, res) => {
  const { stage } = req.body;
  const order = dbGet('SELECT * FROM orders WHERE order_id = ?', [req.params.orderId]);
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  if (stage < 1 || stage > 6) return res.status(400).json({ error: 'Invalid stage number.' });

  dbRun('UPDATE orders SET current_stage=?, updated_at=CURRENT_TIMESTAMP WHERE order_id=?', [stage, req.params.orderId]);
  dbRun('DELETE FROM order_stages WHERE order_id=? AND stage>?', [req.params.orderId, stage]);

  const existingStage = dbGet('SELECT * FROM order_stages WHERE order_id=? AND stage=?', [req.params.orderId, stage]);
  if (!existingStage) {
    const stageName = STAGES.find(s => s.number === stage)?.name || '';
    dbRun('INSERT INTO order_stages (order_id, stage, stage_name, updated_by) VALUES (?, ?, ?, ?)', [req.params.orderId, stage, stageName, req.session.user.username]);
  }

  const stageName = STAGES.find(s => s.number === stage)?.name || '';
  dbRun('INSERT INTO audit_log (user, action, order_id, details) VALUES (?, ?, ?, ?)', [req.session.user.username, 'UPDATE_STAGE', req.params.orderId, 'Stage changed to: ' + stageName]);
  res.json({ message: 'Stage updated successfully.' });
});

// ADMIN: Set delay
router.post('/:orderId/delay', requireAuth, (req, res) => {
  const { is_delayed, delay_reason } = req.body;
  dbRun('UPDATE orders SET is_delayed=?, delay_reason=?, updated_at=CURRENT_TIMESTAMP WHERE order_id=?', [is_delayed ? 1 : 0, delay_reason || '', req.params.orderId]);
  dbRun('INSERT INTO audit_log (user, action, order_id, details) VALUES (?, ?, ?, ?)', [req.session.user.username, is_delayed ? 'SET_DELAY' : 'REMOVE_DELAY', req.params.orderId, is_delayed ? 'Delay reason: ' + delay_reason : 'Delay removed']);
  res.json({ message: is_delayed ? 'Order marked as delayed.' : 'Delay removed.' });
});

// ADMIN: Add note
router.post('/:orderId/notes', requireAuth, (req, res) => {
  const { note } = req.body;
  if (!note || !note.trim()) return res.status(400).json({ error: 'Note cannot be empty.' });
  dbRun('INSERT INTO order_notes (order_id, note, author) VALUES (?, ?, ?)', [req.params.orderId, note.trim(), req.session.user.username]);
  dbRun('INSERT INTO audit_log (user, action, order_id, details) VALUES (?, ?, ?, ?)', [req.session.user.username, 'ADD_NOTE', req.params.orderId, 'Added a note']);
  res.json({ message: 'Note added successfully.' });
});

// HEAD ADMIN: Delete note
router.delete('/notes/:noteId', requireHeadAdmin, (req, res) => {
  const note = dbGet('SELECT * FROM order_notes WHERE id = ?', [parseInt(req.params.noteId)]);
  if (!note) return res.status(404).json({ error: 'Note not found.' });
  dbRun('DELETE FROM order_notes WHERE id = ?', [parseInt(req.params.noteId)]);
  dbRun('INSERT INTO audit_log (user, action, order_id, details) VALUES (?, ?, ?, ?)', [req.session.user.username, 'DELETE_NOTE', note.order_id, 'Deleted note by ' + note.author]);
  res.json({ message: 'Note deleted.' });
});

// ADMIN: Delete order
router.delete('/:orderId', requireAuth, (req, res) => {
  const order = dbGet('SELECT * FROM orders WHERE order_id = ?', [req.params.orderId]);
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  dbRun('DELETE FROM order_notes WHERE order_id = ?', [req.params.orderId]);
  dbRun('DELETE FROM order_stages WHERE order_id = ?', [req.params.orderId]);
  dbRun('DELETE FROM orders WHERE order_id = ?', [req.params.orderId]);
  dbRun('INSERT INTO audit_log (user, action, order_id, details) VALUES (?, ?, ?, ?)', [req.session.user.username, 'DELETE_ORDER', req.params.orderId, 'Deleted order for ' + order.customer_name]);
  res.json({ message: 'Order deleted successfully.' });
});

module.exports = router;
