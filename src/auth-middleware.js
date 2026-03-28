function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  }
  res.status(401).json({ error: 'Authentication required' });
}

function requireAdmin(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  if (req.session.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

function requireManagerOrAdmin(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  if (req.session.role !== 'admin' && req.session.role !== 'manager') {
    return res.status(403).json({ error: 'Manager or Admin access required' });
  }
  next();
}

function isAuthenticated(req) {
  return req.session && req.session.userId;
}

function hasRole(req, role) {
  return req.session && req.session.role === role;
}

function isAdmin(req) {
  return req.session && req.session.role === 'admin';
}

function isManagerOrAdmin(req) {
  return req.session && (req.session.role === 'admin' || req.session.role === 'manager');
}

module.exports = {
  requireAuth,
  requireAdmin,
  requireManagerOrAdmin,
  isAuthenticated,
  hasRole,
  isAdmin,
  isManagerOrAdmin
};
