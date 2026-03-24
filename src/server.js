const path = require('path');
const express = require('express');
const { z } = require('zod');
const ExcelJS = require('exceljs');
const multer  = require('multer');
const { execSync } = require('child_process');
const {
  initDb,
  upsertCandidateNote,
  searchNotes,
  getNoteByEmail,
  deleteNoteByEmail,
  deleteNoteById,
  upsertRequisition,
  listRequisitions,
  deleteRequisition,
  getNoEmailNoteByName,
  getNextAvailableNoEmailName,
  upsertPanel,
  listPanels,
  deletePanel
} = require('./storage');

const {
  initLeaveDb,
  listEmployees,
  upsertEmployee,
  deleteEmployee,
  getLeavesForMonth,
  getLeavesForRange,
  getHolidaysForRange,
  upsertLeave,
  deleteLeave,
  listAllHolidays,
  upsertHoliday,
  deleteHoliday
} = require('./leave-storage');

const {
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
} = require('./todo-storage');

const {
  initOrgDb,
  listOrgNodes,
  upsertOrgNode,
  deleteOrgNode
} = require('./org-storage');

const {
  initKanbanDb,
  listBoards, getBoard, upsertBoard, deleteBoard,
  listColumns, upsertColumn, reorderColumns, deleteColumn,
  listCards, getCard, upsertCard, moveCard, deleteCard,
  listComments, addComment, deleteComment,
  getBoardStats
} = require('./kanban-storage');

const { version } = require('../package.json');

const app = express();
const PORT = process.env.PORT || 3000;

initDb();
initLeaveDb();
initTodoDb();
initOrgDb();
initKanbanDb();

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

const allowedStatuses = [
  'New',
  'Shortlisted for L1',
  'Shortlisted for L2',
  'Shortlisted for L3',
  'Offer made',
  'Offer accepted',
  'Offer rejected',
  'Rejected in L1',
  'Rejected in L2',
  'Rejected in L3',
  'Kept on hold'
];

const upsertSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200),
  email: z.string().trim().max(320).optional().or(z.literal('')),
  status: z.enum(allowedStatuses).default('New'),
  requisitionId: z.string().trim().max(100).optional().or(z.literal('')),
  panelId: z.number({ coerce: true }).int().positive().optional().nullable(),
  interviewDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD').optional().or(z.literal('')),
  onNameConflict: z.enum(['update', 'suffix']).optional(),
  comments: z.string().trim().max(20000).default('')
}).superRefine((val, ctx) => {
  if (val.email && !z.string().email().safeParse(val.email).success) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['email'], message: 'Email must be valid if provided' });
  }
});

app.post('/api/notes', (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'ValidationError', details: parsed.error.flatten() });
  }

  const { name, email, status, requisitionId, panelId, interviewDate, comments, onNameConflict } = parsed.data;
  const saved = upsertCandidateNote({ name, email, status, requisitionId, panelId, interviewDate, comments, onNameConflict });
  return res.json({ ok: true, note: saved });
});

app.get('/api/notes/search', (req, res) => {
  const q = String(req.query.q ?? '').trim();
  const status = String(req.query.status ?? '').trim();
  const requisitionId = String(req.query.requisitionId ?? '').trim();
  const reqType = String(req.query.reqType ?? '').trim();

  if (!q && !status && !requisitionId && !reqType) return res.status(400).json({ error: 'QueryOrStatusRequired' });

  if (status && !allowedStatuses.includes(status)) {
    return res.status(400).json({ error: 'InvalidStatus' });
  }

  if (reqType && !['FTE', 'FTC'].includes(reqType)) {
    return res.status(400).json({ error: 'InvalidReqType' });
  }

  const results = searchNotes({ q, status, requisitionId, reqType });
  return res.json({ ok: true, results });
});

// NOTE: This must be declared before `/api/notes/:email`.
app.get('/api/notes/name-exists', (req, res) => {
  const name = String(req.query.name ?? '').trim();
  if (!name) return res.status(400).json({ error: 'NameRequired' });

  const existing = getNoEmailNoteByName(name);
  if (!existing) return res.json({ ok: true, exists: false });

  const suggested = getNextAvailableNoEmailName(name);
  return res.json({ ok: true, exists: true, suggestedName: suggested, existing });
});

app.get('/api/notes/:email', (req, res) => {
  const email = String(req.params.email ?? '').trim();
  if (!email) return res.status(400).json({ error: 'EmailRequired' });

  const note = getNoteByEmail(email);
  if (!note) return res.status(404).json({ error: 'NotFound' });
  return res.json({ ok: true, note });
});

app.delete('/api/notes/:email', (req, res) => {
  const email = String(req.params.email ?? '').trim();
  if (!email) return res.status(400).json({ error: 'EmailRequired' });

  const result = deleteNoteByEmail(email);
  if (!result.deleted) return res.status(404).json({ error: 'NotFound' });
  return res.json({ ok: true, deleted: result.deleted });
});

app.delete('/api/notes/id/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'IdRequired' });

  const result = deleteNoteById(id);
  if (!result.deleted) return res.status(404).json({ error: 'NotFound' });
  return res.json({ ok: true, deleted: result.deleted });
});

const requisitionSchema = z.object({
  reqId: z.string().trim().min(1, 'Requisition id is required').max(100),
  name: z.string().trim().min(1, 'Requisition name is required').max(200),
  type: z.enum(['FTC', 'FTE']).default('FTE'),
  status: z.string().trim().min(1, 'Status is required').max(100),
  link: z.string().trim().min(1, 'Link is required').url('Valid URL is required').max(2000)
});

app.get('/api/requisitions', (req, res) => {
  const items = listRequisitions();
  return res.json({ ok: true, requisitions: items });
});

app.post('/api/requisitions', (req, res) => {
  const parsed = requisitionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'ValidationError', details: parsed.error.flatten() });
  }

  const saved = upsertRequisition(parsed.data);
  return res.json({ ok: true, requisition: saved });
});

app.delete('/api/requisitions/:reqId', (req, res) => {
  const reqId = String(req.params.reqId ?? '').trim();
  if (!reqId) return res.status(400).json({ error: 'ReqIdRequired' });

  const result = deleteRequisition(reqId);
  if (!result.deleted) return res.status(404).json({ error: 'NotFound' });
  return res.json({ ok: true, deleted: result.deleted });
});

// ── Leave Management API ───────────────────────────────────────────────────────

const employeeSchema = z.object({
  name:  z.string().trim().min(1, 'Name is required').max(200),
  email: z.string().trim().email('Must be a valid email').max(320).optional().or(z.literal(''))
});

const leaveSchema = z.object({
  employeeId: z.number({ coerce: true }).int().positive(),
  date:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  leaveType:  z.enum(['Full Day', 'Half Day - AM', 'Half Day - PM']).default('Full Day'),
  note:       z.string().trim().max(500).default('')
});

const holidaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  name: z.string().trim().min(1, 'Holiday name is required').max(200)
});

const panelSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200),
  email: z.string().trim().max(320).optional().or(z.literal('')),
  department: z.string().trim().max(200).default('')
}).superRefine((val, ctx) => {
  if (val.email && !z.string().email().safeParse(val.email).success) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['email'], message: 'Email must be valid if provided' });
  }
});

const yearMonthRe = /^\d{4}-\d{2}$/;
const dateRe = /^\d{4}-\d{2}-\d{2}$/;

/** Convert an ExcelJS cell value to a YYYY-MM-DD string, or '' on failure. */
function cellToDateStr(value) {
  if (!value) return '';
  if (value instanceof Date) {
    // Use UTC parts to avoid timezone shifts
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, '0');
    const d = String(value.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(value).trim();
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Employees
app.get('/api/leave/employees', (_req, res) => {
  res.json({ ok: true, employees: listEmployees() });
});

app.post('/api/leave/employees', (req, res) => {
  const parsed = employeeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'ValidationError', details: parsed.error.flatten() });
  const emp = upsertEmployee(parsed.data);
  res.json({ ok: true, employee: emp });
});

app.delete('/api/leave/employees/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'InvalidId' });
  const result = deleteEmployee(id);
  if (!result.deleted) return res.status(404).json({ error: 'NotFound' });
  res.json({ ok: true, deleted: result.deleted });
});

// Leaves
app.get('/api/leave/month/:yearMonth', (req, res) => {
  const ym = req.params.yearMonth;
  if (!yearMonthRe.test(ym)) return res.status(400).json({ error: 'InvalidYearMonth — use YYYY-MM' });
  res.json({ ok: true, leaves: getLeavesForMonth(ym) });
});

app.post('/api/leave/leaves', (req, res) => {
  const parsed = leaveSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'ValidationError', details: parsed.error.flatten() });
  const leave = upsertLeave(parsed.data);
  res.json({ ok: true, leave });
});

app.delete('/api/leave/leaves/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'InvalidId' });
  const result = deleteLeave(id);
  if (!result.deleted) return res.status(404).json({ error: 'NotFound' });
  res.json({ ok: true, deleted: result.deleted });
});

// Holidays
app.get('/api/leave/holidays', (_req, res) => {
  res.json({ ok: true, holidays: listAllHolidays() });
});

app.post('/api/leave/holidays', (req, res) => {
  const parsed = holidaySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'ValidationError', details: parsed.error.flatten() });
  const holiday = upsertHoliday(parsed.data);
  res.json({ ok: true, holiday });
});

app.delete('/api/leave/holidays/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'InvalidId' });
  const result = deleteHoliday(id);
  if (!result.deleted) return res.status(404).json({ error: 'NotFound' });
  res.json({ ok: true, deleted: result.deleted });
});

// Panel
app.get('/api/panels', (_req, res) => {
  res.json({ ok: true, panels: listPanels() });
});

app.post('/api/panels', (req, res) => {
  const parsed = panelSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'ValidationError', details: parsed.error.flatten() });
  }
  const saved = upsertPanel(parsed.data);
  return res.json({ ok: true, panel: saved });
});

app.delete('/api/panels/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'InvalidId' });
  const result = deletePanel(id);
  if (!result.deleted) return res.status(404).json({ error: 'NotFound' });
  return res.json({ ok: true, deleted: result.deleted });
});

// ── Leave export (GET /api/leave/export?from=YYYY-MM-DD&to=YYYY-MM-DD) ────────
app.get('/api/leave/export', async (req, res) => {
  const from = String(req.query.from ?? '').trim();
  const to   = String(req.query.to   ?? '').trim();

  if (!dateRe.test(from) || !dateRe.test(to) || from > to) {
    return res.status(400).json({ error: 'Provide valid from and to dates (YYYY-MM-DD, from <= to)' });
  }

  const leaves   = getLeavesForRange(from, to);
  const holidays = getHolidaysForRange(from, to);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Recuity';

  // ── Sheet 1: Leaves ──
  const lws = wb.addWorksheet('Leaves');
  lws.columns = [
    { header: 'Employee',   key: 'employeeName', width: 24 },
    { header: 'Email',      key: 'employeeEmail', width: 28 },
    { header: 'Date',       key: 'date',         width: 14 },
    { header: 'Leave Type', key: 'leaveType',    width: 18 },
    { header: 'Note',       key: 'note',         width: 40 },
  ];

  // Style header row
  lws.getRow(1).eachCell(cell => {
    cell.font = { bold: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD0D7DE' } };
  });

  for (const l of leaves) {
    lws.addRow({
      employeeName:  l.employeeName,
      employeeEmail: l.employeeEmail ?? '',
      date:          l.date,
      leaveType:     l.leaveType,
      note:          l.note ?? '',
    });
  }

  // ── Sheet 2: Holidays ──
  const hws = wb.addWorksheet('Holidays');
  hws.columns = [
    { header: 'Date', key: 'date', width: 14 },
    { header: 'Name', key: 'name', width: 36 },
  ];
  hws.getRow(1).eachCell(cell => {
    cell.font = { bold: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD0D7DE' } };
  });
  for (const h of holidays) {
    hws.addRow({ date: h.date, name: h.name });
  }

  const filename = `leave_${from}_to_${to}.xlsx`;
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  await wb.xlsx.write(res);
  res.end();
});

// ── Leave import (POST /api/leave/import) ────────────────────────────────────
app.post('/api/leave/import', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(req.file.buffer);
  } catch {
    return res.status(400).json({ error: 'Could not parse Excel file' });
  }

  const lws = wb.getWorksheet('Leaves');
  if (!lws) return res.status(400).json({ error: 'Sheet "Leaves" not found in workbook' });

  // Build employee lookup by name (case-insensitive), auto-create if missing
  const empRows = listEmployees();
  const empByName = new Map(empRows.map(e => [e.name.toLowerCase(), e]));

  const errors  = [];
  let imported  = 0;
  let skipped   = 0;

  lws.eachRow((row, rowNum) => {
    if (rowNum === 1) return; // skip header

    const empName   = String(row.getCell(1).value ?? '').trim();
    const empEmail  = String(row.getCell(2).value ?? '').trim();
    const date      = cellToDateStr(row.getCell(3).value);
    const leaveType = String(row.getCell(4).value ?? 'Full Day').trim();
    const note      = String(row.getCell(5).value ?? '').trim();

    if (!empName || !date) { skipped++; return; }
    if (!dateRe.test(date)) {
      errors.push(`Row ${rowNum}: invalid date "${date}"`);
      return;
    }
    if (!['Full Day', 'Half Day - AM', 'Half Day - PM'].includes(leaveType)) {
      errors.push(`Row ${rowNum}: invalid leave type "${leaveType}"`);
      return;
    }

    // Find or create employee
    let emp = empByName.get(empName.toLowerCase());
    if (!emp) {
      emp = upsertEmployee({ name: empName, email: empEmail });
      empByName.set(empName.toLowerCase(), emp);
    }

    upsertLeave({ employeeId: emp.id, date, leaveType, note });
    imported++;
  });

  res.json({ ok: true, imported, skipped, errors });
});

// ── Todo API ───────────────────────────────────────────────────────────────────

const todoProjectSchema = z.object({
  name:  z.string().trim().min(1, 'Name is required').max(200),
  color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'Color must be a hex color').optional().default('#6366f1')
});

const todoSchema = z.object({
  id:          z.number({ coerce: true }).int().positive().optional(),
  title:       z.string().trim().min(1, 'Title is required').max(500),
  description: z.string().trim().max(5000).default(''),
  priority:    z.enum(['Low', 'Medium', 'High', 'Critical']).default('Medium'),
  status:      z.enum(['Open', 'In Progress', 'Blocked', 'Done']).default('Open'),
  dueDate:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD').optional().nullable(),
  projectId:   z.number({ coerce: true }).int().positive().optional().nullable()
});

const todoStatusSchema = z.object({
  status: z.enum(['Open', 'In Progress', 'Blocked', 'Done'])
});

// Projects
app.get('/api/todo/projects', (_req, res) => {
  res.json({ ok: true, projects: listProjects() });
});

app.post('/api/todo/projects', (req, res) => {
  const parsed = todoProjectSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'ValidationError', details: parsed.error.flatten() });
  const project = upsertProject(parsed.data);
  res.json({ ok: true, project });
});

app.delete('/api/todo/projects/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'InvalidId' });
  const result = deleteProject(id);
  if (!result.deleted) return res.status(404).json({ error: 'NotFound' });
  res.json({ ok: true, deleted: result.deleted });
});

// Todos
app.get('/api/todo/todos', (req, res) => {
  const { projectId, status, priority, search, due } = req.query;
  if (status && !ALLOWED_STATUSES.includes(status))
    return res.status(400).json({ error: 'InvalidStatus' });
  if (priority && !ALLOWED_PRIORITIES.includes(priority))
    return res.status(400).json({ error: 'InvalidPriority' });
  const todos = listTodos({ projectId, status, priority, search, due });
  res.json({ ok: true, todos });
});

app.post('/api/todo/todos', (req, res) => {
  const parsed = todoSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'ValidationError', details: parsed.error.flatten() });
  const todo = upsertTodo(parsed.data);
  res.json({ ok: true, todo });
});

app.patch('/api/todo/todos/:id/status', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'InvalidId' });
  const parsed = todoStatusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'ValidationError', details: parsed.error.flatten() });
  const todo = patchTodoStatus(id, parsed.data.status);
  if (!todo) return res.status(404).json({ error: 'NotFound' });
  res.json({ ok: true, todo });
});

app.delete('/api/todo/todos/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'InvalidId' });
  const result = deleteTodo(id);
  if (!result.deleted) return res.status(404).json({ error: 'NotFound' });
  res.json({ ok: true, deleted: result.deleted });
});

// ── Org Chart API ─────────────────────────────────────────────────────────────

const orgNodeSchema = z.object({
  id:         z.number({ coerce: true }).int().positive().optional().nullable(),
  name:       z.string().trim().min(1, 'Name is required').max(200),
  title:      z.string().trim().max(200).default(''),
  department: z.string().trim().max(200).default(''),
  email:      z.string().trim().max(320).default(''),
  emp_id:     z.string().trim().max(100).default(''),
  phone:      z.string().trim().max(30).default(''),
  parent_id:  z.number({ coerce: true }).int().positive().optional().nullable(),
  sort_order: z.number({ coerce: true }).int().default(0)
}).superRefine((val, ctx) => {
  if (val.email && !z.string().email().safeParse(val.email).success) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['email'], message: 'Email must be valid if provided' });
  }
});

app.get('/api/org/nodes', (_req, res) => {
  res.json({ ok: true, nodes: listOrgNodes() });
});

app.post('/api/org/nodes', (req, res) => {
  const parsed = orgNodeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'ValidationError', details: parsed.error.flatten() });
  try {
    const node = upsertOrgNode(parsed.data);
    res.json({ ok: true, node });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/org/nodes/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'InvalidId' });
  const result = deleteOrgNode(id);
  if (!result.deleted) return res.status(404).json({ error: 'NotFound' });
  res.json({ ok: true, deleted: result.deleted });
});

// ── Kanban API ────────────────────────────────────────────────────────────────

const kbBoardSchema = z.object({
  id:          z.number({ coerce: true }).int().positive().optional(),
  name:        z.string().trim().min(1, 'Name is required').max(200),
  description: z.string().trim().max(1000).default('')
});

const kbColumnSchema = z.object({
  id:        z.number({ coerce: true }).int().positive().optional(),
  boardId:   z.number({ coerce: true }).int().positive(),
  name:      z.string().trim().min(1, 'Name is required').max(200),
  color:     z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'Must be a hex color').default('#6366f1'),
  sortOrder: z.number({ coerce: true }).int().default(0),
  wipLimit:  z.number({ coerce: true }).int().min(1).optional().nullable()
});

const kbReorderSchema = z.object({
  ids: z.array(z.number({ coerce: true }).int().positive()).min(1)
});

const KB_PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];

const kbCardSchema = z.object({
  id:          z.number({ coerce: true }).int().positive().optional(),
  columnId:    z.number({ coerce: true }).int().positive(),
  boardId:     z.number({ coerce: true }).int().positive(),
  title:       z.string().trim().min(1, 'Title is required').max(500),
  description: z.string().trim().max(10000).default(''),
  priority:    z.enum(['Low', 'Medium', 'High', 'Critical']).default('Medium'),
  assignee:    z.string().trim().max(200).default(''),
  dueDate:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  labels:      z.union([
                 z.array(z.string().trim().max(50)),
                 z.string().trim().max(500)
               ]).default([]),
  sortOrder:   z.number({ coerce: true }).int().default(0)
});

const kbMoveSchema = z.object({
  toColumnId:  z.number({ coerce: true }).int().positive(),
  afterCardId: z.number({ coerce: true }).int().positive().optional().nullable()
});

const kbCommentSchema = z.object({
  body: z.string().trim().min(1, 'Comment body is required').max(5000)
});

// Boards
app.get('/api/kanban/boards', (_req, res) => {
  res.json({ ok: true, boards: listBoards() });
});

app.post('/api/kanban/boards', (req, res) => {
  const parsed = kbBoardSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'ValidationError', details: parsed.error.flatten() });
  try {
    const board = upsertBoard(parsed.data);
    res.json({ ok: true, board });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/kanban/boards/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'InvalidId' });
  const result = deleteBoard(id);
  if (!result.deleted) return res.status(404).json({ error: 'NotFound' });
  res.json({ ok: true, deleted: result.deleted });
});

app.get('/api/kanban/boards/:id/stats', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'InvalidId' });
  if (!getBoard(id)) return res.status(404).json({ error: 'NotFound' });
  res.json({ ok: true, stats: getBoardStats(id) });
});

// Columns
app.get('/api/kanban/boards/:boardId/columns', (req, res) => {
  const boardId = Number(req.params.boardId);
  if (!Number.isFinite(boardId)) return res.status(400).json({ error: 'InvalidId' });
  res.json({ ok: true, columns: listColumns(boardId) });
});

app.post('/api/kanban/boards/:boardId/columns', (req, res) => {
  const boardId = Number(req.params.boardId);
  if (!Number.isFinite(boardId)) return res.status(400).json({ error: 'InvalidId' });
  const parsed = kbColumnSchema.safeParse({ ...req.body, boardId });
  if (!parsed.success) return res.status(400).json({ error: 'ValidationError', details: parsed.error.flatten() });
  const col = upsertColumn(parsed.data);
  if (!col) return res.status(404).json({ error: 'NotFound' });
  res.json({ ok: true, column: col });
});

app.put('/api/kanban/boards/:boardId/columns/reorder', (req, res) => {
  const boardId = Number(req.params.boardId);
  if (!Number.isFinite(boardId)) return res.status(400).json({ error: 'InvalidId' });
  const parsed = kbReorderSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'ValidationError', details: parsed.error.flatten() });
  reorderColumns(boardId, parsed.data.ids);
  res.json({ ok: true });
});

app.delete('/api/kanban/boards/:boardId/columns/:id', (req, res) => {
  const boardId = Number(req.params.boardId);
  const id      = Number(req.params.id);
  if (!Number.isFinite(boardId) || !Number.isFinite(id)) return res.status(400).json({ error: 'InvalidId' });
  const result = deleteColumn(id, boardId);
  if (!result.deleted) return res.status(404).json({ error: 'NotFound' });
  res.json({ ok: true, deleted: result.deleted });
});

// Cards
app.get('/api/kanban/boards/:boardId/cards', (req, res) => {
  const boardId = Number(req.params.boardId);
  if (!Number.isFinite(boardId)) return res.status(400).json({ error: 'InvalidId' });
  const { columnId, priority, assignee, label, search, due } = req.query;
  if (priority && !KB_PRIORITIES.includes(priority))
    return res.status(400).json({ error: 'InvalidPriority' });
  const cards = listCards(boardId, { columnId, priority, assignee, label, search, due });
  res.json({ ok: true, cards });
});

app.post('/api/kanban/boards/:boardId/cards', (req, res) => {
  const boardId = Number(req.params.boardId);
  if (!Number.isFinite(boardId)) return res.status(400).json({ error: 'InvalidId' });
  const parsed = kbCardSchema.safeParse({ ...req.body, boardId });
  if (!parsed.success) return res.status(400).json({ error: 'ValidationError', details: parsed.error.flatten() });
  const card = upsertCard(parsed.data);
  if (!card) return res.status(404).json({ error: 'NotFound' });
  res.json({ ok: true, card });
});

app.patch('/api/kanban/cards/:id/move', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'InvalidId' });
  const parsed = kbMoveSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'ValidationError', details: parsed.error.flatten() });
  const card = moveCard(id, parsed.data.toColumnId, parsed.data.afterCardId ?? null);
  if (!card) return res.status(404).json({ error: 'NotFound' });
  res.json({ ok: true, card });
});

app.delete('/api/kanban/cards/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'InvalidId' });
  const result = deleteCard(id);
  if (!result.deleted) return res.status(404).json({ error: 'NotFound' });
  res.json({ ok: true, deleted: result.deleted });
});

// Comments
app.get('/api/kanban/cards/:cardId/comments', (req, res) => {
  const cardId = Number(req.params.cardId);
  if (!Number.isFinite(cardId)) return res.status(400).json({ error: 'InvalidId' });
  res.json({ ok: true, comments: listComments(cardId) });
});

app.post('/api/kanban/cards/:cardId/comments', (req, res) => {
  const cardId = Number(req.params.cardId);
  if (!Number.isFinite(cardId)) return res.status(400).json({ error: 'InvalidId' });
  const parsed = kbCommentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'ValidationError', details: parsed.error.flatten() });
  const comment = addComment({ cardId, body: parsed.data.body });
  res.json({ ok: true, comment });
});

app.delete('/api/kanban/comments/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'InvalidId' });
  const result = deleteComment(id);
  if (!result.deleted) return res.status(404).json({ error: 'NotFound' });
  res.json({ ok: true, deleted: result.deleted });
});

app.get('/api/update/check', (_req, res) => {
  try {
    execSync('git --version', { timeout: 5000 });
  } catch {
    return res.json({ ok: true, available: false, reason: 'git not installed' });
  }

  try {
    execSync('git rev-parse --is-inside-work-tree', { cwd: path.join(__dirname, '..'), timeout: 5000 });
  } catch {
    return res.json({ ok: true, available: false, reason: 'not a git repository' });
  }

  try {
    execSync('git fetch --quiet', { cwd: path.join(__dirname, '..'), timeout: 10000 });
  } catch {
    return res.json({ ok: true, available: false, reason: 'git fetch failed — no network or no remote' });
  }

  try {
    const local  = execSync('git rev-parse HEAD',               { cwd: path.join(__dirname, '..') }).toString().trim();
    const remote = execSync('git rev-parse @{u}',               { cwd: path.join(__dirname, '..') }).toString().trim();
    const behind = execSync('git rev-list --count HEAD..@{u}',  { cwd: path.join(__dirname, '..') }).toString().trim();
    return res.json({ ok: true, available: true, upToDate: local === remote, behind: Number(behind), local, remote });
  } catch {
    return res.json({ ok: true, available: false, reason: 'no upstream branch configured' });
  }
});

app.post('/api/update/apply', (_req, res) => {
  try {
    execSync('git --version', { timeout: 5000 });
  } catch {
    return res.status(400).json({ ok: false, error: 'git is not installed' });
  }

  try {
    execSync('git rev-parse --is-inside-work-tree', { cwd: path.join(__dirname, '..'), timeout: 5000 });
  } catch {
    return res.status(400).json({ ok: false, error: 'not a git repository' });
  }

  try {
    const output = execSync('git pull', { cwd: path.join(__dirname, '..'), timeout: 30000 }).toString().trim();
    res.json({ ok: true, output });
    setTimeout(() => process.exit(0), 500);
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'git pull failed', detail: err.message });
  }
});

app.get('/api/version', (_req, res) => {
  res.json({ ok: true, version });
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Server running on http://localhost:${PORT}`);
});
