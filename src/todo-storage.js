'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dataDir = path.join(__dirname, '..', 'data');
const dbPath  = path.join(dataDir, 'todo.sqlite');

let db;

function nowIso() { return new Date().toISOString(); }

function initTodoDb() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS td_projects (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT    NOT NULL UNIQUE,
      color      TEXT    NOT NULL DEFAULT '#6366f1',
      created_at TEXT    NOT NULL,
      updated_at TEXT    NOT NULL
    );

    CREATE TABLE IF NOT EXISTS td_todos (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id  INTEGER REFERENCES td_projects(id) ON DELETE SET NULL,
      title       TEXT    NOT NULL,
      description TEXT    NOT NULL DEFAULT '',
      priority    TEXT    NOT NULL DEFAULT 'Medium',
      status      TEXT    NOT NULL DEFAULT 'Open',
      due_date    TEXT,
      created_at  TEXT    NOT NULL,
      updated_at  TEXT    NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_td_todos_project  ON td_todos(project_id);
    CREATE INDEX IF NOT EXISTS idx_td_todos_status   ON td_todos(status);
    CREATE INDEX IF NOT EXISTS idx_td_todos_priority ON td_todos(priority);
    CREATE INDEX IF NOT EXISTS idx_td_todos_due_date ON td_todos(due_date);
  `);
}

// ── Projects ──────────────────────────────────────────────────────────────────

function listProjects() {
  return db.prepare(`
    SELECT p.id, p.name, p.color, p.created_at, p.updated_at,
           COUNT(t.id) AS total,
           SUM(CASE WHEN t.status = 'Done' THEN 1 ELSE 0 END) AS done
    FROM td_projects p
    LEFT JOIN td_todos t ON t.project_id = p.id
    GROUP BY p.id
    ORDER BY lower(p.name)
  `).all();
}

function upsertProject({ name, color }) {
  const now      = nowIso();
  const trimName = String(name  ?? '').trim();
  const trimColor= String(color ?? '#6366f1').trim();

  const existing = db.prepare(
    `SELECT id FROM td_projects WHERE lower(name) = lower(@name) LIMIT 1`
  ).get({ name: trimName });

  if (existing) {
    return db.prepare(`
      UPDATE td_projects SET name = @name, color = @color, updated_at = @now
      WHERE id = @id
      RETURNING id, name, color, created_at, updated_at
    `).get({ id: existing.id, name: trimName, color: trimColor, now });
  }

  return db.prepare(`
    INSERT INTO td_projects (name, color, created_at, updated_at)
    VALUES (@name, @color, @now, @now)
    RETURNING id, name, color, created_at, updated_at
  `).get({ name: trimName, color: trimColor, now });
}

function deleteProject(id) {
  const info = db.prepare(`DELETE FROM td_projects WHERE id = @id`).run({ id: Number(id) });
  return { deleted: info.changes };
}

// ── Todos ─────────────────────────────────────────────────────────────────────

const ALLOWED_PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];
const ALLOWED_STATUSES   = ['Open', 'In Progress', 'Blocked', 'Done'];

function listTodos({ projectId, status, priority, search, due } = {}) {
  const conditions = [];
  const params     = {};

  if (projectId) { conditions.push('t.project_id = @projectId'); params.projectId = Number(projectId); }
  if (status)    { conditions.push('t.status = @status');         params.status    = status; }
  if (priority)  { conditions.push('t.priority = @priority');     params.priority  = priority; }
  if (due === 'overdue') {
    conditions.push("t.due_date IS NOT NULL AND t.due_date < date('now') AND t.status != 'Done'");
  } else if (due === 'today') {
    conditions.push("t.due_date = date('now')");
  } else if (due === 'upcoming') {
    conditions.push("t.due_date IS NOT NULL AND t.due_date >= date('now') AND t.due_date <= date('now', '+7 days') AND t.status != 'Done'");
  }
  if (search) {
    conditions.push(`(t.title LIKE @search OR t.description LIKE @search)`);
    params.search = `%${search}%`;
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  return db.prepare(`
    SELECT t.id, t.title, t.description, t.priority, t.status, t.due_date AS dueDate,
           t.project_id AS projectId, p.name AS projectName, p.color AS projectColor,
           t.created_at, t.updated_at
    FROM td_todos t
    LEFT JOIN td_projects p ON p.id = t.project_id
    ${where}
    ORDER BY
      CASE t.status WHEN 'Done' THEN 1 ELSE 0 END,
      CASE t.priority WHEN 'Critical' THEN 0 WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 ELSE 3 END,
      t.due_date NULLS LAST,
      t.created_at DESC
  `).all(params);
}

function getTodo(id) {
  return db.prepare(`
    SELECT t.id, t.title, t.description, t.priority, t.status, t.due_date AS dueDate,
           t.project_id AS projectId, p.name AS projectName, p.color AS projectColor,
           t.created_at, t.updated_at
    FROM td_todos t
    LEFT JOIN td_projects p ON p.id = t.project_id
    WHERE t.id = @id
  `).get({ id: Number(id) });
}

function upsertTodo({ id, title, description, priority, status, dueDate, projectId }) {
  const now = nowIso();
  const data = {
    title:       String(title       ?? '').trim(),
    description: String(description ?? '').trim(),
    priority:    String(priority    ?? 'Medium').trim(),
    status:      String(status      ?? 'Open').trim(),
    dueDate:     dueDate ? String(dueDate).trim() : null,
    projectId:   projectId ? Number(projectId) : null,
    now
  };

  if (id) {
    return db.prepare(`
      UPDATE td_todos
      SET title = @title, description = @description, priority = @priority,
          status = @status, due_date = @dueDate, project_id = @projectId, updated_at = @now
      WHERE id = @id
      RETURNING id, title, description, priority, status, due_date AS dueDate,
                project_id AS projectId, created_at, updated_at
    `).get({ ...data, id: Number(id) });
  }

  return db.prepare(`
    INSERT INTO td_todos (title, description, priority, status, due_date, project_id, created_at, updated_at)
    VALUES (@title, @description, @priority, @status, @dueDate, @projectId, @now, @now)
    RETURNING id, title, description, priority, status, due_date AS dueDate,
              project_id AS projectId, created_at, updated_at
  `).get(data);
}

function patchTodoStatus(id, status) {
  const now = nowIso();
  return db.prepare(`
    UPDATE td_todos SET status = @status, updated_at = @now WHERE id = @id
    RETURNING id, status, updated_at
  `).get({ id: Number(id), status, now });
}

function deleteTodo(id) {
  const info = db.prepare(`DELETE FROM td_todos WHERE id = @id`).run({ id: Number(id) });
  return { deleted: info.changes };
}

module.exports = {
  initTodoDb,
  ALLOWED_PRIORITIES,
  ALLOWED_STATUSES,
  listProjects,
  upsertProject,
  deleteProject,
  listTodos,
  getTodo,
  upsertTodo,
  patchTodoStatus,
  deleteTodo
};
