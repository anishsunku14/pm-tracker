const express = require('express');
const session = require('express-session');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const { initDb } = require('./db/database');

// Keep the session secret stable across restarts so staff aren't logged out every deploy
function sessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const dir = path.join(__dirname, 'data');
  const file = path.join(dir, '.session-secret');
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
    return fs.readFileSync(file, 'utf8').trim();
  } catch (e) {
    return crypto.randomBytes(32).toString('hex');
  }
}

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1); // behind Nginx
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: sessionSecret(),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: false,
    sameSite: 'lax',
    maxAge: 12 * 60 * 60 * 1000 // 12 hours
  }
}));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/po', require('./routes/po'));
app.use('/api/clients', require('./routes/clients'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/reports', require('./routes/reports'));

// Unknown API routes return JSON, not the HTML page
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

// Any unexpected error returns JSON
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Something went wrong on the server. Please try again.' });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

async function start() {
  await initDb();
  app.listen(PORT, () => {
    console.log('');
    console.log('══════════════════════════════════════════════════');
    console.log('');
    console.log('   P.M. OFFSET PRINTERS - Order Tracking System');
    console.log('');
    console.log('   Server running on: http://localhost:' + PORT);
    console.log('');
    console.log('   First time? Open the site in a browser to create');
    console.log('   the head admin account.');
    console.log('');
    console.log('══════════════════════════════════════════════════');
    console.log('');
  });
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
