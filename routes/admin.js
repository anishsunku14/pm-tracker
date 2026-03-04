const express = require('express');
const bcrypt = require('bcryptjs');
const { dbRun, dbGet, dbAll } = require('../db/database');
const { requireHeadAdmin } = require('../middleware/auth');
const router = express.Router();

router.get('/team', requireHeadAdmin, (req, res) => {
  const users = dbAll('SELECT id, username, role, created_at FROM users ORDER BY created_at ASC');
  res.json({ users });
});

router.post('/team', requireHeadAdmin, (req, res) => {
  const { username, password, security_question, security_answer } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required.' });
  if (password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters.' });

  const existing = dbGet('SELECT id FROM users WHERE username = ?', [username.toLowerCase().trim()]);
  if (existing) return res.status(409).json({ error: 'Username already exists.' });

  const hashed = bcrypt.hashSync(password, 10);
  dbRun('INSERT INTO users (username, password, role, security_question, security_answer) VALUES (?, ?, ?, ?, ?)',
    [username.toLowerCase().trim(), hashed, 'staff', security_question || '', (security_answer || '').toLowerCase().trim()]);

  dbRun('INSERT INTO audit_log (user, action, details) VALUES (?, ?, ?)', [req.session.user.username, 'CREATE_USER', 'Created user: ' + username]);
  res.json({ message: 'Team member "' + username + '" created successfully.' });
});

router.delete('/team/:userId', requireHeadAdmin, (req, res) => {
  const user = dbGet('SELECT * FROM users WHERE id = ?', [parseInt(req.params.userId)]);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  if (user.role === 'head_admin') return res.status(403).json({ error: 'Cannot delete the head admin account.' });

  dbRun('DELETE FROM users WHERE id = ?', [parseInt(req.params.userId)]);
  dbRun('INSERT INTO audit_log (user, action, details) VALUES (?, ?, ?)', [req.session.user.username, 'DELETE_USER', 'Deleted user: ' + user.username]);
  res.json({ message: 'User "' + user.username + '" deleted.' });
});

router.post('/team/:userId/reset-password', requireHeadAdmin, (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 4) return res.status(400).json({ error: 'New password must be at least 4 characters.' });

  const user = dbGet('SELECT * FROM users WHERE id = ?', [parseInt(req.params.userId)]);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  const hashed = bcrypt.hashSync(newPassword, 10);
  dbRun('UPDATE users SET password = ? WHERE id = ?', [hashed, parseInt(req.params.userId)]);
  dbRun('INSERT INTO audit_log (user, action, details) VALUES (?, ?, ?)', [req.session.user.username, 'RESET_PASSWORD', 'Reset password for: ' + user.username]);
  res.json({ message: 'Password reset for "' + user.username + '".' });
});

router.get('/audit-log', requireHeadAdmin, (req, res) => {
  const logs = dbAll('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 500');
  res.json({ logs });
});

module.exports = router;
