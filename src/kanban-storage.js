'use strict';

const fs       = require('fs');
const path     = require('path');
const Database = require('better-sqlite3');

const dataDir = path.join(__dirname, '..', 'data');
const dbPath  = path.join(dataDir, 'kanban.sqlite');

let db;

function nowIso() { return new Date().toISOString(); }

function initKanbanDb() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS kb_boards (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT    NOT NULL UNIQUE,
      description TEXT   NOT NULL DEFAULT '',
      created_at TEXT    NOT NULL,
      updated_at TEXT    NOT NULL
    );

    CREATE TABLE IF NOT EXISTS kb_columns (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      board_id   INTEGER NOT NULL REFERENCES kb_boards(id) ON DELETE CASCADE,
      name       TEXT    NOT NULL,
      color      TEXT    NOT NULL DEFAULT '#6366f1',
      sort_order INTEGER NOT NULL DEFAULT 0,
      wip_limit  INTEGER,          -- NULL = no limit
      created_at TEXT    NOT NULL,
      updated_at TEXT    NOT NULL
    );

    CREATE TABLE IF NOT EXISTS kb_cards (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      column_id   INTEGER NOT NULL REFERENCES kb_columns(id) ON DELETE CASCADE,
      board_id    INTEGER NOT NULL REFERENCES kb_boards(id)  ON DELETE CASCADE,
      title       TEXT    NOT NULL,
      description TEXT    NOT NULL DEFAULT '',
      priority    TEXT    NOT NULL DEFAULT 'Medium',
      assignee    TEXT    NOT NULL DEFAULT '',
      due_date    TEXT,
      labels      TEXT    NOT NULL DEFAULT '',   -- comma-separated
      sort_order  INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT    NOT NULL,
      updated_at  TEXT    NOT NULL
    );

    CREATE TABLE IF NOT EXISTS kb_card_comments (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      card_id    INTEGER NOT NULL REFERENCES kb_cards(id) ON DELETE CASCADE,
      body       TEXT    NOT NULL,
      created_at TEXT    NOT NULL,
      updated_at TEXT    NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_kb_columns_board  ON kb_columns(board_id, sort_order);
    CREATE INDEX IF NOT EXISTS idx_kb_cards_column   ON kb_cards(column_id, sort_order);
    CREATE INDEX IF NOT EXISTS idx_kb_cards_board    ON kb_cards(board_id);
    CREATE INDEX IF NOT EXISTS idx_kb_comments_card  ON kb_card_comments(card_id);
  `);
}

// ── Boards ────────────────────────────────────────────────────────────────────

function listBoards() {
  return db.prepare(`
    SELECT b.id, b.name, b.description, b.created_at, b.updated_at,
           COUNT(DISTINCT c.id) AS card_count,
           COUNT(DISTINCT col.id) AS column_count
    FROM kb_boards b
    LEFT JOIN kb_columns col ON col.board_id = b.id
    LEFT JOIN kb_cards   c   ON c.board_id   = b.id
    GROUP BY b.id
    ORDER BY lower(b.name)
  `).all();
}

function getBoard(id) {
  return db.prepare(`SELECT * FROM kb_boards WHERE id = @id`).get({ id: Number(id) });
}

function upsertBoard({ id, name, description }) {
  const now  = nowIso();
  const data = {
    name:        String(name        ?? '').trim(),
    description: String(description ?? '').trim(),
    now
  };

  if (id) {
    return db.prepare(`
      UPDATE kb_boards SET name = @name, description = @description, updated_at = @now
      WHERE id = @id
      RETURNING *
    `).get({ ...data, id: Number(id) });
  }

  return db.prepare(`
    INSERT INTO kb_boards (name, description, created_at, updated_at)
    VALUES (@name, @description, @now, @now)
    RETURNING *
  `).get(data);
}

function deleteBoard(id) {
  const info = db.prepare(`DELETE FROM kb_boards WHERE id = @id`).run({ id: Number(id) });
  return { deleted: info.changes };
}

// ── Columns (workflow) ────────────────────────────────────────────────────────

function listColumns(boardId) {
  return db.prepare(`
    SELECT col.id, col.board_id, col.name, col.color, col.sort_order, col.wip_limit,
           col.created_at, col.updated_at,
           COUNT(c.id) AS card_count
    FROM kb_columns col
    LEFT JOIN kb_cards c ON c.column_id = col.id
    WHERE col.board_id = @boardId
    GROUP BY col.id
    ORDER BY col.sort_order, col.id
  `).all({ boardId: Number(boardId) });
}

function upsertColumn({ id, boardId, name, color, sortOrder, wipLimit }) {
  const now  = nowIso();
  const data = {
    boardId:   Number(boardId),
    name:      String(name  ?? '').trim(),
    color:     String(color ?? '#6366f1').trim(),
    sortOrder: Number(sortOrder ?? 0),
    wipLimit:  (wipLimit !== undefined && wipLimit !== null && wipLimit !== '') ? Number(wipLimit) : null,
    now
  };

  if (id) {
    return db.prepare(`
      UPDATE kb_columns
      SET name = @name, color = @color, sort_order = @sortOrder, wip_limit = @wipLimit, updated_at = @now
      WHERE id = @id AND board_id = @boardId
      RETURNING *
    `).get({ ...data, id: Number(id) });
  }

  return db.prepare(`
    INSERT INTO kb_columns (board_id, name, color, sort_order, wip_limit, created_at, updated_at)
    VALUES (@boardId, @name, @color, @sortOrder, @wipLimit, @now, @now)
    RETURNING *
  `).get(data);
}

function reorderColumns(boardId, orderedIds) {
  const update = db.prepare(
    `UPDATE kb_columns SET sort_order = @sortOrder, updated_at = @now WHERE id = @id AND board_id = @boardId`
  );
  const now = nowIso();
  db.transaction(() => {
    orderedIds.forEach((colId, i) => {
      update.run({ id: Number(colId), boardId: Number(boardId), sortOrder: i, now });
    });
  })();
}

function deleteColumn(id, boardId) {
  // Cards cascade via FK
  const info = db.prepare(
    `DELETE FROM kb_columns WHERE id = @id AND board_id = @boardId`
  ).run({ id: Number(id), boardId: Number(boardId) });
  return { deleted: info.changes };
}

// ── Cards ─────────────────────────────────────────────────────────────────────

function listCards(boardId, filters = {}) {
  const conditions = ['c.board_id = @boardId'];
  const params     = { boardId: Number(boardId) };

  if (filters.columnId) { conditions.push('c.column_id = @columnId'); params.columnId = Number(filters.columnId); }
  if (filters.priority)  { conditions.push('c.priority = @priority');   params.priority = filters.priority; }
  if (filters.assignee)  { conditions.push('c.assignee LIKE @assignee'); params.assignee = `%${filters.assignee}%`; }
  if (filters.label)     { conditions.push("(',' || c.labels || ',') LIKE @label"); params.label = `%,${filters.label},%`; }
  if (filters.search) {
    conditions.push('(c.title LIKE @search OR c.description LIKE @search OR c.assignee LIKE @search)');
    params.search = `%${filters.search}%`;
  }
  if (filters.due === 'overdue') {
    conditions.push("c.due_date IS NOT NULL AND c.due_date < date('now')");
  } else if (filters.due === 'today') {
    conditions.push("c.due_date = date('now')");
  }

  return db.prepare(`
    SELECT c.id, c.column_id AS columnId, c.board_id AS boardId,
           c.title, c.description, c.priority, c.assignee,
           c.due_date AS dueDate, c.labels, c.sort_order AS sortOrder,
           c.created_at, c.updated_at,
           col.name AS columnName, col.color AS columnColor,
           (SELECT COUNT(*) FROM kb_card_comments cc WHERE cc.card_id = c.id) AS commentCount
    FROM kb_cards c
    JOIN kb_columns col ON col.id = c.column_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY c.column_id, c.sort_order, c.id
  `).all(params);
}

function getCard(id) {
  return db.prepare(`
    SELECT c.*, col.name AS columnName, col.color AS columnColor
    FROM kb_cards c
    JOIN kb_columns col ON col.id = c.column_id
    WHERE c.id = @id
  `).get({ id: Number(id) });
}

function upsertCard({ id, columnId, boardId, title, description, priority, assignee, dueDate, labels, sortOrder }) {
  const now  = nowIso();
  const data = {
    columnId:    Number(columnId),
    boardId:     Number(boardId),
    title:       String(title       ?? '').trim(),
    description: String(description ?? '').trim(),
    priority:    String(priority    ?? 'Medium').trim(),
    assignee:    String(assignee    ?? '').trim(),
    dueDate:     dueDate ? String(dueDate).trim() : null,
    labels:      Array.isArray(labels) ? labels.map(l => String(l).trim()).filter(Boolean).join(',') : String(labels ?? '').trim(),
    sortOrder:   Number(sortOrder ?? 0),
    now
  };

  if (id) {
    return db.prepare(`
      UPDATE kb_cards
      SET column_id = @columnId, title = @title, description = @description,
          priority = @priority, assignee = @assignee, due_date = @dueDate,
          labels = @labels, sort_order = @sortOrder, updated_at = @now
      WHERE id = @id AND board_id = @boardId
      RETURNING id, column_id AS columnId, board_id AS boardId, title, description,
                priority, assignee, due_date AS dueDate, labels, sort_order AS sortOrder,
                created_at, updated_at
    `).get({ ...data, id: Number(id) });
  }

  // Default sort_order = max in column + 1
  const maxRow = db.prepare(`SELECT COALESCE(MAX(sort_order),0) AS m FROM kb_cards WHERE column_id = @columnId`).get({ columnId: data.columnId });
  data.sortOrder = (maxRow?.m ?? 0) + 1;

  return db.prepare(`
    INSERT INTO kb_cards
      (column_id, board_id, title, description, priority, assignee, due_date, labels, sort_order, created_at, updated_at)
    VALUES
      (@columnId, @boardId, @title, @description, @priority, @assignee, @dueDate, @labels, @sortOrder, @now, @now)
    RETURNING id, column_id AS columnId, board_id AS boardId, title, description,
              priority, assignee, due_date AS dueDate, labels, sort_order AS sortOrder,
              created_at, updated_at
  `).get(data);
}

function moveCard(cardId, toColumnId, afterCardId) {
  const now  = nowIso();
  const card = db.prepare(`SELECT * FROM kb_cards WHERE id = @id`).get({ id: Number(cardId) });
  if (!card) return null;

  let newOrder;
  if (afterCardId == null) {
    // place at top
    const top = db.prepare(`SELECT COALESCE(MIN(sort_order),1) AS m FROM kb_cards WHERE column_id = @col`).get({ col: Number(toColumnId) });
    newOrder = (top?.m ?? 1) - 1;
  } else {
    const anchor = db.prepare(`SELECT sort_order FROM kb_cards WHERE id = @id`).get({ id: Number(afterCardId) });
    const next   = db.prepare(`
      SELECT sort_order FROM kb_cards
      WHERE column_id = @col AND sort_order > @ord AND id != @cardId
      ORDER BY sort_order LIMIT 1
    `).get({ col: Number(toColumnId), ord: anchor?.sort_order ?? 0, cardId: Number(cardId) });
    newOrder = next ? (anchor.sort_order + next.sort_order) / 2 : (anchor?.sort_order ?? 0) + 1;
  }

  return db.prepare(`
    UPDATE kb_cards SET column_id = @col, sort_order = @ord, updated_at = @now WHERE id = @id
    RETURNING id, column_id AS columnId, sort_order AS sortOrder, updated_at
  `).get({ id: Number(cardId), col: Number(toColumnId), ord: newOrder, now });
}

function deleteCard(id) {
  const info = db.prepare(`DELETE FROM kb_cards WHERE id = @id`).run({ id: Number(id) });
  return { deleted: info.changes };
}

// ── Comments ──────────────────────────────────────────────────────────────────

function listComments(cardId) {
  return db.prepare(`
    SELECT * FROM kb_card_comments WHERE card_id = @cardId ORDER BY created_at
  `).all({ cardId: Number(cardId) });
}

function addComment({ cardId, body }) {
  const now = nowIso();
  return db.prepare(`
    INSERT INTO kb_card_comments (card_id, body, created_at, updated_at)
    VALUES (@cardId, @body, @now, @now)
    RETURNING *
  `).get({ cardId: Number(cardId), body: String(body ?? '').trim(), now });
}

function deleteComment(id) {
  const info = db.prepare(`DELETE FROM kb_card_comments WHERE id = @id`).run({ id: Number(id) });
  return { deleted: info.changes };
}

// ── Board stats ───────────────────────────────────────────────────────────────

function getBoardStats(boardId) {
  const byCol = db.prepare(`
    SELECT col.id, col.name, col.color, col.wip_limit,
           COUNT(c.id) AS card_count,
           SUM(CASE WHEN c.priority = 'Critical' THEN 1 ELSE 0 END) AS critical,
           SUM(CASE WHEN c.due_date IS NOT NULL AND c.due_date < date('now') THEN 1 ELSE 0 END) AS overdue
    FROM kb_columns col
    LEFT JOIN kb_cards c ON c.column_id = col.id
    WHERE col.board_id = @boardId
    GROUP BY col.id
    ORDER BY col.sort_order
  `).all({ boardId: Number(boardId) });

  const totals = db.prepare(`
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN c.due_date IS NOT NULL AND c.due_date < date('now') THEN 1 ELSE 0 END) AS overdue,
           SUM(CASE WHEN c.priority = 'Critical' THEN 1 ELSE 0 END) AS critical
    FROM kb_cards c WHERE c.board_id = @boardId
  `).get({ boardId: Number(boardId) });

  return { byColumn: byCol, totals };
}

module.exports = {
  initKanbanDb,
  listBoards, getBoard, upsertBoard, deleteBoard,
  listColumns, upsertColumn, reorderColumns, deleteColumn,
  listCards, getCard, upsertCard, moveCard, deleteCard,
  listComments, addComment, deleteComment,
  getBoardStats
};
