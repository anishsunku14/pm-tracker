const { dbGet } = require('../db/database');

/** Re-check the logged-in user against the database (handles removed users and role changes). */
function refreshUser(req) {
  if (!req.session || !req.session.user) return null;
  const u = dbGet('SELECT id, username, role FROM users WHERE id = ?', [req.session.user.id]);
  if (!u) { req.session.user = null; return null; }
  req.session.user = { id: u.id, username: u.username, role: u.role };
  return req.session.user;
}

function requireAuth(req, res, next) {
  if (refreshUser(req)) return next();
  return res.status(401).json({ error: 'Unauthorized. Please log in.' });
}

function requireHeadAdmin(req, res, next) {
  const u = refreshUser(req);
  if (u && u.role === 'head_admin') return next();
  if (!u) return res.status(401).json({ error: 'Unauthorized. Please log in.' });
  return res.status(403).json({ error: 'Access denied. Managing Director only.' });
}

/** Allow only the listed roles, e.g. requireRole('planning', 'head_admin') */
function requireRole() {
  const roles = Array.from(arguments);
  return function (req, res, next) {
    const u = refreshUser(req);
    if (!u) return res.status(401).json({ error: 'Unauthorized. Please log in.' });
    if (roles.indexOf(u.role) > -1) return next();
    return res.status(403).json({ error: 'You do not have permission to do this.' });
  };
}

module.exports = { requireAuth, requireHeadAdmin, requireRole };
