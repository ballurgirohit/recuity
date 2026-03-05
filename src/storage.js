const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dataDir = path.join(__dirname, '..', 'data');
const dbPath = path.join(dataDir, 'hiring.sqlite');

let db;

function nowIso() {
  return new Date().toISOString();
}

function formatStatusAuditLine({ fromStatus, toStatus, at }) {
  const ts = String(at).replace('T', ' ').replace('Z', '');
  const from = fromStatus ? String(fromStatus) : '∅';
  const to = toStatus ? String(toStatus) : '∅';
  return `[${ts}] Status: ${from} → ${to}`;
}

function appendLine(existing, line) {
  const base = String(existing ?? '');
  if (!base) return line;
  return base.endsWith('\n') ? `${base}${line}` : `${base}\n${line}`;
}

function statusEquals(a, b) {
  const norm = (v) => {
    const s = String(v ?? '').trim();
    return s || 'New';
  };
  return norm(a) === norm(b);
}

function buildCommentsWithStatusAudit({ existing, newStatus, incomingComments }) {
  const prevStatusRaw = existing?.status;
  const nextStatusRaw = newStatus;

  // UI sends comments; if blank is allowed, keep whatever user provided.
  let comments = String(incomingComments ?? '');

  // Append audit line when status changes.
  // Treat missing/empty previous status as 'New' so the first change is recorded.
  if (existing && !statusEquals(prevStatusRaw, nextStatusRaw)) {
    const line = formatStatusAuditLine({
      fromStatus: String(prevStatusRaw ?? '').trim() || 'New',
      toStatus: String(nextStatusRaw ?? '').trim() || 'New',
      at: nowIso()
    });
    comments = appendLine(comments, line);
  }

  return comments;
}

function getExistingNoteForUpsert({ name, email }) {
  const normalizedEmail = String(email ?? '').trim();
  if (normalizedEmail) {
    const stmt = db.prepare(`
      SELECT id, name, email, COALESCE(status, 'New') AS status, requisition_id AS requisitionId, comments
      FROM candidate_notes
      WHERE lower(email) = lower(@email)
      LIMIT 1;
    `);
    return stmt.get({ email: normalizedEmail });
  }

  const stmt = db.prepare(`
    SELECT id, name, email, COALESCE(status, 'New') AS status, requisition_id AS requisitionId, comments
    FROM candidate_notes
    WHERE lower(name) = lower(@name)
      AND (email IS NULL OR email = '')
    LIMIT 1;
  `);
  return stmt.get({ name: String(name ?? '').trim() });
}

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
          requisition_id TEXT,
          comments TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE UNIQUE INDEX IF NOT EXISTS ux_candidate_notes_email_not_null
          ON candidate_notes(lower(email))
          WHERE email IS NOT NULL AND email <> '';

        INSERT INTO candidate_notes (id, name, email, status, requisition_id, comments, created_at, updated_at)
        SELECT id, name, email, COALESCE(status, 'New'), requisition_id, comments, created_at, updated_at
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

  // Ensure name is unique (case-insensitive) for notes that don't have an email.
  // This allows editing by name without creating new rows.
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_candidate_notes_name_when_no_email
      ON candidate_notes(lower(name))
      WHERE (email IS NULL OR email = '');
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

  // Add requisition_id column to candidate_notes if missing
  const hasReqId = cols.some((c) => c.name === 'requisition_id');
  if (!hasReqId) {
    db.exec("ALTER TABLE candidate_notes ADD COLUMN requisition_id TEXT;");
    db.exec('CREATE INDEX IF NOT EXISTS idx_candidate_notes_requisition_id ON candidate_notes(requisition_id);');
  }

  // 3) FTS (create after all columns exist). We drop/recreate to keep schema in sync.
  db.exec(`
    DROP TABLE IF EXISTS candidate_notes_fts;

    CREATE VIRTUAL TABLE candidate_notes_fts
    USING fts5(
      name,
      email,
      status,
      requisition_id,
      comments,
      content='candidate_notes',
      content_rowid='id',
      tokenize='unicode61 remove_diacritics 2'
    );

    DROP TRIGGER IF EXISTS candidate_notes_ai;
    DROP TRIGGER IF EXISTS candidate_notes_ad;
    DROP TRIGGER IF EXISTS candidate_notes_au;

    CREATE TRIGGER candidate_notes_ai AFTER INSERT ON candidate_notes BEGIN
      INSERT INTO candidate_notes_fts(rowid, name, email, status, requisition_id, comments)
      VALUES (new.id, new.name, new.email, new.status, new.requisition_id, new.comments);
    END;

    CREATE TRIGGER candidate_notes_ad AFTER DELETE ON candidate_notes BEGIN
      INSERT INTO candidate_notes_fts(candidate_notes_fts, rowid, name, email, status, requisition_id, comments)
      VALUES ('delete', old.id, old.name, old.email, old.status, old.requisition_id, old.comments);
    END;

    CREATE TRIGGER candidate_notes_au AFTER UPDATE ON candidate_notes BEGIN
      INSERT INTO candidate_notes_fts(candidate_notes_fts, rowid, name, email, status, requisition_id, comments)
      VALUES ('delete', old.id, old.name, old.email, old.status, old.requisition_id, old.comments);
      INSERT INTO candidate_notes_fts(rowid, name, email, status, requisition_id, comments)
      VALUES (new.id, new.name, new.email, new.status, new.requisition_id, new.comments);
    END;

    INSERT INTO candidate_notes_fts(rowid, name, email, status, requisition_id, comments)
    SELECT id, name, email, status, requisition_id, comments
    FROM candidate_notes;
  `);
}

function createCandidateNote({ name, email, status, requisitionId, comments }) {
  const now = nowIso();
  const stmt = db.prepare(`
    INSERT INTO candidate_notes (name, email, status, requisition_id, comments, created_at, updated_at)
    VALUES (@name, NULLIF(@email, ''), @status, NULLIF(@requisitionId, ''), @comments, @now, @now)
    RETURNING id, name, email, status, requisition_id AS requisitionId, comments, created_at, updated_at;
  `);
  return stmt.get({ name, email: email ?? '', status, requisitionId: requisitionId ?? '', comments, now });
}

function getNoEmailNoteByName(name) {
  const stmt = db.prepare(`
    SELECT id, name, email, COALESCE(status, 'New') AS status,
      requisition_id AS requisitionId,
      comments, created_at, updated_at
    FROM candidate_notes
    WHERE lower(name) = lower(@name)
      AND (email IS NULL OR email = '')
    LIMIT 1;
  `);
  return stmt.get({ name: String(name ?? '').trim() });
}

function getNextAvailableNoEmailName(baseName) {
  const base = String(baseName ?? '').trim();
  if (!base) return base;

  // Find existing names like:
  //   base
  //   base - 2
  //   base - 3
  // and return the next available suffix.
  const rows = db.prepare(`
    SELECT name
    FROM candidate_notes
    WHERE (email IS NULL OR email = '')
      AND (
        lower(name) = lower(@base)
        OR lower(name) LIKE lower(@pattern)
      )
  `).all({
    base,
    pattern: `${base} - %`
  });

  let maxN = 1; // base itself
  for (const r of rows) {
    const m = String(r.name).match(/ - (\d+)$/);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n)) maxN = Math.max(maxN, n);
    }
  }

  const next = maxN + 1;
  return `${base} - ${next}`;
}

function updateNoEmailNoteByName({ name, status, requisitionId, comments }) {
  const now = nowIso();
  const stmt = db.prepare(`
    UPDATE candidate_notes
    SET status = @status,
        requisition_id = NULLIF(@requisitionId, ''),
        comments = @comments,
        updated_at = @now
    WHERE lower(name) = lower(@name)
      AND (email IS NULL OR email = '')
    RETURNING id, name, email, status, requisition_id AS requisitionId, comments, created_at, updated_at;
  `);
  return stmt.get({ name, status, requisitionId: requisitionId ?? '', comments, now });
}

function updateNoEmailNoteSetEmailByName({ name, email, status, requisitionId, comments }) {
  const now = nowIso();
  const stmt = db.prepare(`
    UPDATE candidate_notes
    SET email = @email,
        status = @status,
        requisition_id = NULLIF(@requisitionId, ''),
        comments = @comments,
        updated_at = @now
    WHERE lower(name) = lower(@name)
      AND (email IS NULL OR email = '')
    RETURNING id, name, email, status, requisition_id AS requisitionId, comments, created_at, updated_at;
  `);
  return stmt.get({ name: String(name ?? '').trim(), email: String(email ?? '').trim(), status, requisitionId: requisitionId ?? '', comments, now });
}

function upsertCandidateNote({ name, email, status, requisitionId, comments, onNameConflict }) {
  const normalizedEmail = String(email ?? '').trim();

  // Find existing row first so we can append a dated status change line.
  const existing = getExistingNoteForUpsert({ name, email: normalizedEmail });
  const commentsWithAudit = buildCommentsWithStatusAudit({ existing, newStatus: status, incomingComments: comments });

  // If the user provided an email but there is no existing record by email,
  // allow "promoting" a no-email record (matched by name) to have this email.
  if (normalizedEmail && !existing) {
    const existingNoEmail = getNoEmailNoteByName(name);
    if (existingNoEmail) {
      return updateNoEmailNoteSetEmailByName({
        name,
        email: normalizedEmail,
        status,
        requisitionId,
        comments: commentsWithAudit
      });
    }
  }

  // If email isn't provided, upsert by (case-insensitive) name.
  const baseName = String(name ?? '').trim();
  const mode = onNameConflict === 'suffix' ? 'suffix' : 'update';

  const existingNoEmail = getNoEmailNoteByName(baseName);
  if (existingNoEmail && mode === 'suffix') {
    const newName = getNextAvailableNoEmailName(baseName);
    return createCandidateNote({ name: newName, email: '', status, requisitionId, comments: commentsWithAudit });
  }

  if (existingNoEmail) {
    return updateNoEmailNoteByName({ name: baseName, status, requisitionId, comments: commentsWithAudit });
  }

  return createCandidateNote({ name: baseName, email: '', status, requisitionId, comments: commentsWithAudit });
}

function getNoteByEmail(email) {
  const normalizedEmail = String(email ?? '').trim();
  if (!normalizedEmail) return null;

  const stmt = db.prepare(`
    SELECT id, name, email, COALESCE(status, 'New') AS status,
      requisition_id AS requisitionId,
      comments, created_at, updated_at
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

function deleteNoteById(id) {
  const noteId = Number(id);
  if (!Number.isFinite(noteId)) return { deleted: 0 };

  const stmt = db.prepare(`
    DELETE FROM candidate_notes
    WHERE id = @id;
  `);
  const info = stmt.run({ id: noteId });
  return { deleted: info.changes };
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
        requisition_id AS requisitionId,
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

  // Build FTS terms; keep unicode letters/numbers and common email/url symbols.
  const terms = raw
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => t.replace(/[^\p{L}\p{N}@._-]/gu, ''))
    .filter(Boolean);

  // If we can't build an FTS query (e.g. user typed only punctuation), use LIKE.
  const ftsQuery = terms.length ? terms.map((t) => `${t}*`).join(' AND ') : '';

  // Prefer FTS results; fall back to LIKE.
  if (ftsQuery) {
    try {
      const stmt = db.prepare(`
        SELECT
          cn.id,
          cn.name,
          cn.email,
          COALESCE(cn.status, 'New') AS status,
          cn.requisition_id AS requisitionId,
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
      // fall through to LIKE
    }
  }

  const likeQuery = `%${raw.toLowerCase()}%`;
  const stmt = db.prepare(`
    SELECT
      id,
      name,
      email,
      COALESCE(status, 'New') AS status,
      requisition_id AS requisitionId,
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
  deleteNoteById,
  searchNotes,
  upsertRequisition,
  listRequisitions,
  deleteRequisition,
  // exported for UI conflict check
  getNoEmailNoteByName,
  getNextAvailableNoEmailName
};
