const express = require('express');
const session = require('express-session');
const path = require('path');
const crypto = require('crypto');
const { initDb } = require('./db/database');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: false,
    maxAge: null
  }
}));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/admin', require('./routes/admin'));

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
    console.log('   If this is your first time, run:');
    console.log('   node setup.js');
    console.log('');
    console.log('══════════════════════════════════════════════════');
    console.log('');
  });
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
