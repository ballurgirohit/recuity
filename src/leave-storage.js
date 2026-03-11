'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dataDir = path.join(__dirname, '..', 'data');
const dbPath = path.join(dataDir, 'leave.sqlite');

let db;

function nowIso() {
  return new Date().toISOString();
}

function initLeaveDb() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS lm_employees (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      name      TEXT    NOT NULL UNIQUE,
      email     TEXT,
      created_at TEXT   NOT NULL,
      updated_at TEXT   NOT NULL
    );

    CREATE TABLE IF NOT EXISTS lm_leaves (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL REFERENCES lm_employees(id) ON DELETE CASCADE,
      date        TEXT    NOT NULL,          -- YYYY-MM-DD
      leave_type  TEXT    NOT NULL DEFAULT 'Full Day',
      note        TEXT    NOT NULL DEFAULT '',
      created_at  TEXT    NOT NULL,
      updated_at  TEXT    NOT NULL,
      UNIQUE(employee_id, date)
    );

    CREATE TABLE IF NOT EXISTS lm_holidays (
      id    INTEGER PRIMARY KEY AUTOINCREMENT,
      date  TEXT NOT NULL UNIQUE,            -- YYYY-MM-DD
      name  TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_lm_leaves_employee ON lm_leaves(employee_id);
    CREATE INDEX IF NOT EXISTS idx_lm_leaves_date     ON lm_leaves(date);
    CREATE INDEX IF NOT EXISTS idx_lm_holidays_date   ON lm_holidays(date);
  `);
}

// ── Employees ─────────────────────────────────────────────────────────────────

function listEmployees() {
  return db.prepare(`
    SELECT id, name, email, created_at, updated_at
    FROM lm_employees
    ORDER BY lower(name)
  `).all();
}

function upsertEmployee({ name, email }) {
  const now = nowIso();
  const trimName  = String(name  ?? '').trim();
  const trimEmail = String(email ?? '').trim();

  const existing = db.prepare(
    `SELECT id FROM lm_employees WHERE lower(name) = lower(@name) LIMIT 1`
  ).get({ name: trimName });

  if (existing) {
    return db.prepare(`
      UPDATE lm_employees SET email = @email, updated_at = @now
      WHERE id = @id
      RETURNING id, name, email, created_at, updated_at
    `).get({ id: existing.id, email: trimEmail || null, now });
  }

  return db.prepare(`
    INSERT INTO lm_employees (name, email, created_at, updated_at)
    VALUES (@name, @email, @now, @now)
    RETURNING id, name, email, created_at, updated_at
  `).get({ name: trimName, email: trimEmail || null, now });
}

function deleteEmployee(id) {
  const info = db.prepare(`DELETE FROM lm_employees WHERE id = @id`).run({ id: Number(id) });
  return { deleted: info.changes };
}

// ── Leaves ────────────────────────────────────────────────────────────────────

// Returns all leave rows for a given YYYY-MM (e.g. "2026-03")
function getLeavesForMonth(yearMonth) {
  return db.prepare(`
    SELECT l.id, l.employee_id AS employeeId, e.name AS employeeName,
           l.date, l.leave_type AS leaveType, l.note,
           l.created_at, l.updated_at
    FROM lm_leaves l
    JOIN lm_employees e ON e.id = l.employee_id
    WHERE strftime('%Y-%m', l.date) = @yearMonth
    ORDER BY l.date, lower(e.name)
  `).all({ yearMonth });
}

function upsertLeave({ employeeId, date, leaveType, note }) {
  const now = nowIso();
  return db.prepare(`
    INSERT INTO lm_leaves (employee_id, date, leave_type, note, created_at, updated_at)
    VALUES (@employeeId, @date, @leaveType, @note, @now, @now)
    ON CONFLICT(employee_id, date) DO UPDATE SET
      leave_type = excluded.leave_type,
      note       = excluded.note,
      updated_at = excluded.updated_at
    RETURNING id, employee_id AS employeeId, date, leave_type AS leaveType, note, created_at, updated_at
  `).get({
    employeeId: Number(employeeId),
    date: String(date).trim(),
    leaveType: String(leaveType ?? 'Full Day').trim(),
    note: String(note ?? '').trim(),
    now
  });
}

function deleteLeave(id) {
  const info = db.prepare(`DELETE FROM lm_leaves WHERE id = @id`).run({ id: Number(id) });
  return { deleted: info.changes };
}

// ── Holidays ──────────────────────────────────────────────────────────────────

function getHolidaysForMonth(yearMonth) {
  return db.prepare(`
    SELECT id, date, name, created_at, updated_at
    FROM lm_holidays
    WHERE strftime('%Y-%m', date) = @yearMonth
    ORDER BY date
  `).all({ yearMonth });
}

function listAllHolidays() {
  return db.prepare(`
    SELECT id, date, name, created_at, updated_at
    FROM lm_holidays
    ORDER BY date
  `).all();
}

function upsertHoliday({ date, name }) {
  const now = nowIso();
  return db.prepare(`
    INSERT INTO lm_holidays (date, name, created_at, updated_at)
    VALUES (@date, @name, @now, @now)
    ON CONFLICT(date) DO UPDATE SET
      name       = excluded.name,
      updated_at = excluded.updated_at
    RETURNING id, date, name, created_at, updated_at
  `).get({ date: String(date).trim(), name: String(name).trim(), now });
}

function deleteHoliday(id) {
  const info = db.prepare(`DELETE FROM lm_holidays WHERE id = @id`).run({ id: Number(id) });
  return { deleted: info.changes };
}

module.exports = {
  initLeaveDb,
  listEmployees,
  upsertEmployee,
  deleteEmployee,
  getLeavesForMonth,
  upsertLeave,
  deleteLeave,
  getHolidaysForMonth,
  listAllHolidays,
  upsertHoliday,
  deleteHoliday
};
