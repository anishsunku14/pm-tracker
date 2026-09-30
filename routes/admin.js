const express = require('express');
const bcrypt = require('bcryptjs');
const { dbRun, dbGet, dbAll, audit } = require('../db/database');
const { requireHeadAdmin } = require('../middleware/auth');
const router = express.Router();

const ASSIGNABLE = ['staff', 'planning'];
const me = (req) => req.session.user.username;

router.get('/team', requireHeadAdmin, (req, res) => {
  const users = dbAll('SELECT id, username, role, created_at FROM users ORDER BY created_at ASC');
  res.json({ users });
});

router.post('/team', requireHeadAdmin, (req, res) => {
  const { username, password, security_question, security_answer } = req.body;
  const role = ASSIGNABLE.indexOf(req.body.role) > -1 ? req.body.role : 'staff';
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required.' });
  if (password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters.' });

  const uname = String(username).toLowerCase().trim();
  if (dbGet('SELECT id FROM users WHERE username = ?', [uname])) return res.status(409).json({ error: 'Username already exists.' });

  dbRun('INSERT INTO users (username, password, role, security_question, security_answer) VALUES (?, ?, ?, ?, ?)',
    [uname, bcrypt.hashSync(password, 10), role, security_question || '', (security_answer || '').toLowerCase().trim()]);
  const created = dbGet('SELECT id FROM users WHERE username = ?', [uname]);

  audit(me(req), 'CREATE_USER', { details: 'Created user ' + uname + ' (' + role + ')' });
  res.json({ message: 'Team member "' + uname + '" created.', id: created && created.id });
});

router.post('/team/:userId/role', requireHeadAdmin, (req, res) => {
  const role = req.body.role;
  if (ASSIGNABLE.indexOf(role) === -1) return res.status(400).json({ error: 'Role must be staff or planning.' });
  const user = dbGet('SELECT * FROM users WHERE id = ?', [parseInt(req.params.userId, 10)]);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  if (user.role === 'head_admin') return res.status(403).json({ error: 'The Managing Director\'s role cannot be changed.' });

  dbRun('UPDATE users SET role = ? WHERE id = ?', [role, user.id]);
  audit(me(req), 'CHANGE_ROLE', { details: user.username + ': ' + user.role + ' → ' + role });
  res.json({ message: user.username + ' is now ' + role + '.' });
});

router.delete('/team/:userId', requireHeadAdmin, (req, res) => {
  const user = dbGet('SELECT * FROM users WHERE id = ?', [parseInt(req.params.userId, 10)]);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  if (user.role === 'head_admin') return res.status(403).json({ error: 'Cannot delete the head admin account.' });

  dbRun('DELETE FROM users WHERE id = ?', [user.id]);
  audit(me(req), 'DELETE_USER', { details: 'Deleted user ' + user.username });
  res.json({ message: 'User "' + user.username + '" deleted.' });
});

router.post('/team/:userId/reset-password', requireHeadAdmin, (req, res) => {
  const newPassword = req.body.newPassword || req.body.new_password || req.body.password;
  if (!newPassword || newPassword.length < 4) return res.status(400).json({ error: 'New password must be at least 4 characters.' });

  const user = dbGet('SELECT * FROM users WHERE id = ?', [parseInt(req.params.userId, 10)]);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  dbRun('UPDATE users SET password = ? WHERE id = ?', [bcrypt.hashSync(newPassword, 10), user.id]);
  audit(me(req), 'RESET_PASSWORD', { details: 'Reset password for ' + user.username });
  res.json({ message: 'Password reset for "' + user.username + '".' });
});

// Full audit log, including md_only entries (this route is MD-only)
router.get('/audit-log', requireHeadAdmin, (req, res) => {
  const logs = dbAll('SELECT * FROM audit_log ORDER BY created_at DESC, id DESC LIMIT 1000');
  res.json({ logs });
});

module.exports = router;
