const express = require('express');
const bcrypt = require('bcryptjs');
const { dbRun, dbGet } = require('../db/database');
const router = express.Router();

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required.' });

  const user = dbGet('SELECT * FROM users WHERE username = ?', [username.toLowerCase().trim()]);
  if (!user) return res.status(401).json({ error: 'Incorrect username or password.' });

  if (!bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Incorrect username or password.' });
  }

  req.session.user = { id: user.id, username: user.username, role: user.role };
  res.json({ message: 'Login successful.', user: { id: user.id, username: user.username, role: user.role } });
});

router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ message: 'Logged out successfully.' });
});

router.get('/me', (req, res) => {
  if (req.session && req.session.user) {
    // Refresh from the database so role changes / removals take effect
    const u = dbGet('SELECT id, username, role FROM users WHERE id = ?', [req.session.user.id]);
    if (!u) { req.session.destroy(() => {}); return res.json({ user: null }); }
    req.session.user = { id: u.id, username: u.username, role: u.role };
    return res.json({ user: req.session.user });
  }
  res.json({ user: null });
});

// Client login check (client code + password). The dashboard itself is POST /api/clients/dashboard.
router.post('/client-login', (req, res) => {
  const code = String(req.body.client_code || req.body.code || '').trim().toUpperCase().replace(/\s+/g, '');
  const password = String(req.body.password || '');
  if (!code || !password) return res.status(400).json({ error: 'Client code and password are required.' });
  const client = dbGet('SELECT id, client_code, company_name, password FROM clients WHERE client_code = ?', [code]);
  if (!client || !bcrypt.compareSync(password, client.password)) return res.status(401).json({ error: 'Incorrect client code or password.' });
  res.json({ client: { client_code: client.client_code, company_name: client.company_name } });
});

router.post('/forgot-password/question', (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'Username is required.' });

  const user = dbGet('SELECT security_question FROM users WHERE username = ?', [username.toLowerCase().trim()]);
  if (!user || !user.security_question) return res.status(404).json({ error: 'User not found or no security question set.' });

  res.json({ question: user.security_question });
});

router.post('/forgot-password/reset', (req, res) => {
  const { username, answer, newPassword } = req.body;
  if (!username || !answer || !newPassword) return res.status(400).json({ error: 'All fields are required.' });
  if (newPassword.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters.' });

  const user = dbGet('SELECT * FROM users WHERE username = ?', [username.toLowerCase().trim()]);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  if (user.security_answer.toLowerCase().trim() !== answer.toLowerCase().trim()) {
    return res.status(401).json({ error: 'Incorrect security answer.' });
  }

  const hashed = bcrypt.hashSync(newPassword, 10);
  dbRun('UPDATE users SET password = ? WHERE id = ?', [hashed, user.id]);
  dbRun('INSERT INTO audit_log (user, action, details) VALUES (?, ?, ?)', [username, 'PASSWORD_RESET', 'Password reset via security question']);

  res.json({ message: 'Password reset successfully. You can now log in.' });
});

router.get('/needs-setup', (req, res) => {
  const admin = dbGet('SELECT id FROM users WHERE role = ?', ['head_admin']);
  res.json({ needsSetup: !admin });
});

router.post('/setup', (req, res) => {
  const admin = dbGet('SELECT id FROM users WHERE role = ?', ['head_admin']);
  if (admin) return res.status(400).json({ error: 'Setup already completed.' });

  const { username, password, security_question, security_answer } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required.' });
  if (password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters.' });

  const hashed = bcrypt.hashSync(password, 10);
  dbRun('INSERT INTO users (username, password, role, security_question, security_answer) VALUES (?, ?, ?, ?, ?)',
    [username.toLowerCase().trim(), hashed, 'head_admin', security_question || '', (security_answer || '').toLowerCase().trim()]);

  res.json({ message: 'Head admin created! You can now log in.' });
});

module.exports = router;
