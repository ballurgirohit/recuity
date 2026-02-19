const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dataDir = path.join(__dirname, '..', 'data');
const dbPath = path.join(dataDir, 'hiring.sqlite');

let db;

function initDb() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  db = new Database(dbPath);

  db.pragma('journal_mode = WAL');

  // Ensure candidate_notes table exists (legacy schema may have email NOT NULL UNIQUE)
  // Migration: if email is NOT NULL, we can't alter easily; create a new table and copy.
  const info = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='candidate_notes'").get();
  if (info) {
    const cols0 = db.prepare('PRAGMA table_info(candidate_notes);').all();
    const emailCol = cols0.find((c) => c.name === 'email');
    const emailNotNull = emailCol?.notnull === 1;

    if (emailNotNull) {
      db.exec(`
        ALTER TABLE candidate_notes RENAME TO candidate_notes_old;

        CREATE TABLE candidate_notes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          email TEXT,
          status TEXT NOT NULL DEFAULT 'New',
          comments TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE UNIQUE INDEX IF NOT EXISTS ux_candidate_notes_email_not_null
          ON candidate_notes(lower(email))
          WHERE email IS NOT NULL AND email <> '';

        INSERT INTO candidate_notes (id, name, email, status, comments, created_at, updated_at)
        SELECT id, name, email, COALESCE(status, 'New'), comments, created_at, updated_at
        FROM candidate_notes_old;

        DROP TABLE candidate_notes_old;
      `);
    }
  }

  // Recreate indexes (safe to run)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_candidate_notes_name ON candidate_notes(name);
    CREATE INDEX IF NOT EXISTS idx_candidate_notes_email ON candidate_notes(email);
    CREATE INDEX IF NOT EXISTS idx_candidate_notes_status ON candidate_notes(status);

    CREATE UNIQUE INDEX IF NOT EXISTS ux_candidate_notes_email_not_null
      ON candidate_notes(lower(email))
      WHERE email IS NOT NULL AND email <> '';
  `);

  // Requisitions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS requisitions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      req_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      link TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_requisitions_req_id ON requisitions(req_id);
    CREATE INDEX IF NOT EXISTS idx_requisitions_status ON requisitions(status);
  `);

  // Migrate older DBs (add name column if missing)
  const reqCols = db.prepare('PRAGMA table_info(requisitions);').all();
  const hasReqName = reqCols.some((c) => c.name === 'name');
  if (!hasReqName) {
    db.exec("ALTER TABLE requisitions ADD COLUMN name TEXT NOT NULL DEFAULT ''; ");
  }

  // 2) Lightweight migration(s)
  const cols = db.prepare('PRAGMA table_info(candidate_notes);').all();
  const hasStatus = cols.some((c) => c.name === 'status');
  if (!hasStatus) {
    db.exec("ALTER TABLE candidate_notes ADD COLUMN status TEXT NOT NULL DEFAULT 'New';");
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_candidate_notes_status ON candidate_notes(status);');

  // 3) FTS (create after all columns exist). We drop/recreate to keep schema in sync.
  db.exec(`
    DROP TABLE IF EXISTS candidate_notes_fts;

    CREATE VIRTUAL TABLE candidate_notes_fts
    USING fts5(
      name,
      email,
      status,
      comments,
      content='candidate_notes',
      content_rowid='id',
      tokenize='unicode61 remove_diacritics 2'
    );

    DROP TRIGGER IF EXISTS candidate_notes_ai;
    DROP TRIGGER IF EXISTS candidate_notes_ad;
    DROP TRIGGER IF EXISTS candidate_notes_au;

    CREATE TRIGGER candidate_notes_ai AFTER INSERT ON candidate_notes BEGIN
      INSERT INTO candidate_notes_fts(rowid, name, email, status, comments)
      VALUES (new.id, new.name, new.email, new.status, new.comments);
    END;

    CREATE TRIGGER candidate_notes_ad AFTER DELETE ON candidate_notes BEGIN
      INSERT INTO candidate_notes_fts(candidate_notes_fts, rowid, name, email, status, comments)
      VALUES ('delete', old.id, old.name, old.email, old.status, old.comments);
    END;

    CREATE TRIGGER candidate_notes_au AFTER UPDATE ON candidate_notes BEGIN
      INSERT INTO candidate_notes_fts(candidate_notes_fts, rowid, name, email, status, comments)
      VALUES ('delete', old.id, old.name, old.email, old.status, old.comments);
      INSERT INTO candidate_notes_fts(rowid, name, email, status, comments)
      VALUES (new.id, new.name, new.email, new.status, new.comments);
    END;

    INSERT INTO candidate_notes_fts(rowid, name, email, status, comments)
    SELECT id, name, email, status, comments
    FROM candidate_notes;
  `);
}

function createCandidateNote({ name, email, status, comments }) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO candidate_notes (name, email, status, comments, created_at, updated_at)
    VALUES (@name, NULLIF(@email, ''), @status, @comments, @now, @now)
    RETURNING id, name, email, status, comments, created_at, updated_at;
  `);
  return stmt.get({ name, email: email ?? '', status, comments, now });
}

function upsertCandidateNote({ name, email, status, comments }) {
  const normalizedEmail = String(email ?? '').trim();

  // If email isn't provided, we can't upsert by unique key.
  // In this case create a new note record.
  if (!normalizedEmail) {
    return createCandidateNote({ name, email: '', status, comments });
  }

  const now = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO candidate_notes (name, email, status, comments, created_at, updated_at)
    VALUES (@name, @email, @status, @comments, @now, @now)
    ON CONFLICT DO UPDATE SET
      name = excluded.name,
      status = excluded.status,
      comments = excluded.comments,
      updated_at = excluded.updated_at
    WHERE lower(candidate_notes.email) = lower(excluded.email)
    RETURNING id, name, email, status, comments, created_at, updated_at;
  `);

  return stmt.get({ name, email: normalizedEmail, status, comments, now });
}

function getNoteByEmail(email) {
  const normalizedEmail = String(email ?? '').trim();
  if (!normalizedEmail) return null;

  const stmt = db.prepare(`
    SELECT id, name, email, COALESCE(status, 'New') AS status, comments, created_at, updated_at
    FROM candidate_notes
    WHERE lower(email) = lower(@email)
    LIMIT 1;
  `);
  return stmt.get({ email: normalizedEmail });
}

function deleteNoteByEmail(email) {
  const normalizedEmail = String(email ?? '').trim();
  if (!normalizedEmail) return { deleted: 0 };

  const stmt = db.prepare(`
    DELETE FROM candidate_notes
    WHERE lower(email) = lower(@email);
  `);
  const info2 = stmt.run({ email: normalizedEmail });
  return { deleted: info2.changes };
}

function searchNotes(input) {
  const q = typeof input === 'string' ? input : String(input?.q ?? '').trim();
  const status = typeof input === 'string' ? '' : String(input?.status ?? '').trim();

  // If only status filter is provided, use an indexed query (no FTS required)
  if (!q && status) {
    const stmt = db.prepare(`
      SELECT
        id,
        name,
        email,
        COALESCE(status, 'New') AS status,
        comments,
        created_at,
        updated_at
      FROM candidate_notes
      WHERE status = @status
      ORDER BY updated_at DESC
      LIMIT 100;
    `);
    return stmt.all({ status });
  }

  const raw = q;
  if (!raw && !status) return [];

  const terms = raw
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => t.replace(/[^a-z0-9@._-]/g, ''))
    .filter(Boolean);

  const ftsQuery = terms.map((t) => `${t}*`).join(' AND ');

  try {
    const stmt = db.prepare(`
      SELECT
        cn.id,
        cn.name,
        cn.email,
        COALESCE(cn.status, 'New') AS status,
        cn.comments,
        cn.created_at,
        cn.updated_at
      FROM candidate_notes_fts fts
      JOIN candidate_notes cn ON cn.id = fts.rowid
      WHERE candidate_notes_fts MATCH @ftsQuery
        AND (@status = '' OR cn.status = @status)
      ORDER BY cn.updated_at DESC
      LIMIT 100;
    `);
    return stmt.all({ ftsQuery, status: status || '' });
  } catch {
    const likeQuery = `%${raw.toLowerCase()}%`;
    const stmt = db.prepare(`
      SELECT
        id,
        name,
        email,
        COALESCE(status, 'New') AS status,
        comments,
        created_at,
        updated_at
      FROM candidate_notes
      WHERE (
        lower(name) LIKE @likeQuery OR
        lower(email) LIKE @likeQuery OR
        lower(status) LIKE @likeQuery
      )
        AND (@status = '' OR status = @status)
      ORDER BY updated_at DESC
      LIMIT 100;
    `);
    return stmt.all({ likeQuery, status: status || '' });
  }
}

function upsertRequisition({ reqId, name, status, link }) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO requisitions (req_id, name, status, link, created_at, updated_at)
    VALUES (@reqId, @name, @status, @link, @now, @now)
    ON CONFLICT(req_id) DO UPDATE SET
      name = excluded.name,
      status = excluded.status,
      link = excluded.link,
      updated_at = excluded.updated_at
    RETURNING id, req_id AS reqId, name, status, link, created_at, updated_at;
  `);
  return stmt.get({ reqId, name, status, link, now });
}

function listRequisitions() {
  const stmt = db.prepare(`
    SELECT id, req_id AS reqId, name, status, link, created_at, updated_at
    FROM requisitions
    ORDER BY updated_at DESC
    LIMIT 200;
  `);
  return stmt.all();
}

function deleteRequisition(reqId) {
  const stmt = db.prepare(`
    DELETE FROM requisitions
    WHERE req_id = @reqId;
  `);
  const info = stmt.run({ reqId });
  return { deleted: info.changes };
}

module.exports = {
  initDb,
  upsertCandidateNote,
  getNoteByEmail,
  deleteNoteByEmail,
  searchNotes,
  upsertRequisition,
  listRequisitions,
  deleteRequisition
};
