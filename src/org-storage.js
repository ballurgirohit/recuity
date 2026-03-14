'use strict';

const path    = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '..', 'data', 'org.sqlite');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

function initOrgDb() {
  const d = getDb();
  d.exec(`
    CREATE TABLE IF NOT EXISTS org_nodes (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT    NOT NULL,
      title      TEXT    NOT NULL DEFAULT '',
      department TEXT    NOT NULL DEFAULT '',
      email      TEXT    NOT NULL DEFAULT '',
      parent_id  INTEGER REFERENCES org_nodes(id) ON DELETE SET NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

/** Return the full flat list of all org nodes. */
function listOrgNodes() {
  return getDb().prepare(
    `SELECT id, name, title, department, email, parent_id, sort_order, created_at, updated_at
     FROM org_nodes ORDER BY sort_order ASC, id ASC`
  ).all();
}

const upsertStmt = () => getDb().prepare(`
  INSERT INTO org_nodes (id, name, title, department, email, parent_id, sort_order, updated_at)
  VALUES (@id, @name, @title, @department, @email, @parent_id, @sort_order, datetime('now'))
  ON CONFLICT(id) DO UPDATE SET
    name       = excluded.name,
    title      = excluded.title,
    department = excluded.department,
    email      = excluded.email,
    parent_id  = excluded.parent_id,
    sort_order = excluded.sort_order,
    updated_at = datetime('now')
`);

/**
 * Upsert an org node. Pass id=null/undefined to insert a new one.
 * Returns the saved node.
 */
function upsertOrgNode({ id, name, title, department, email, parent_id, sort_order }) {
  const d = getDb();

  // Prevent a node from being its own parent or creating a cycle
  if (id && parent_id && parent_id === id) {
    throw new Error('A node cannot be its own parent');
  }

  const stmt = upsertStmt();

  if (id) {
    stmt.run({ id, name, title, department, email, parent_id: parent_id ?? null, sort_order: sort_order ?? 0 });
    return d.prepare('SELECT * FROM org_nodes WHERE id = ?').get(id);
  } else {
    const info = d.prepare(`
      INSERT INTO org_nodes (name, title, department, email, parent_id, sort_order)
      VALUES (@name, @title, @department, @email, @parent_id, @sort_order)
    `).run({ name, title, department, email, parent_id: parent_id ?? null, sort_order: sort_order ?? 0 });
    return d.prepare('SELECT * FROM org_nodes WHERE id = ?').get(info.lastInsertRowid);
  }
}

function deleteOrgNode(id) {
  const info = getDb().prepare('DELETE FROM org_nodes WHERE id = ?').run(id);
  return { deleted: info.changes };
}

module.exports = { initOrgDb, listOrgNodes, upsertOrgNode, deleteOrgNode };
