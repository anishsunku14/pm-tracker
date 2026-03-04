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
  res.json({ message: 'Login successful.', user: { username: user.username, role: user.role } });
});

router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ message: 'Logged out successfully.' });
});

router.get('/me', (req, res) => {
  if (req.session && req.session.user) return res.json({ user: req.session.user });
  res.json({ user: null });
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

module.exports = router;
