const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dataDir = path.join(__dirname, '..', 'data');
const dbPath = path.join(dataDir, 'hiring.sqlite');

let db;

function nowIso() {
  return new Date().toISOString();
}

function initAuthDb() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  db = new Database(dbPath);
  
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      email TEXT,
      role TEXT NOT NULL DEFAULT 'viewer',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
  `);
}

function createUser({ username, passwordHash, email, role = 'viewer' }) {
  const now = nowIso();
  const stmt = db.prepare(`
    INSERT INTO users (username, password_hash, email, role, created_at, updated_at)
    VALUES (@username, @passwordHash, NULLIF(@email, ''), @role, @now, @now)
    RETURNING id, username, email, role, created_at, updated_at;
  `);
  return stmt.get({ username, passwordHash, email: email ?? '', role, now });
}

function getUserByUsername(username) {
  const stmt = db.prepare(`
    SELECT id, username, password_hash AS passwordHash, email, role, created_at, updated_at
    FROM users
    WHERE lower(username) = lower(@username)
    LIMIT 1;
  `);
  return stmt.get({ username: String(username ?? '').trim() });
}

function listUsers() {
  return db.prepare(`
    SELECT id, username, email, role, created_at, updated_at
    FROM users
    ORDER BY created_at DESC;
  `).all();
}

function updateUserRole(id, role) {
  const now = nowIso();
  const stmt = db.prepare(`
    UPDATE users
    SET role = @role, updated_at = @now
    WHERE id = @id
    RETURNING id, username, email, role, created_at, updated_at;
  `);
  return stmt.get({ id: Number(id), role, now });
}

function deleteUser(id) {
  const info = db.prepare(`DELETE FROM users WHERE id = @id;`).run({ id: Number(id) });
  return { deleted: info.changes };
}

module.exports = {
  initAuthDb,
  createUser,
  getUserByUsername,
  listUsers,
  updateUserRole,
  deleteUser
};
