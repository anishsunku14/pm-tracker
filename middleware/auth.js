function requireAuth(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }
  return res.status(401).json({ error: 'Unauthorized. Please log in.' });
}

function requireHeadAdmin(req, res, next) {
  if (req.session && req.session.user && req.session.user.role === 'head_admin') {
    return next();
  }
  return res.status(403).json({ error: 'Access denied. Head admin only.' });
}

module.exports = { requireAuth, requireHeadAdmin };
