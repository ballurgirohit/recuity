const path = require('path');
const express = require('express');
const { z } = require('zod');
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
  getNextAvailableNoEmailName
} = require('./storage');

const {
  initLeaveDb,
  listEmployees,
  upsertEmployee,
  deleteEmployee,
  getLeavesForMonth,
  upsertLeave,
  deleteLeave,
  listAllHolidays,
  upsertHoliday,
  deleteHoliday
} = require('./leave-storage');

const app = express();
const PORT = process.env.PORT || 3000;

initDb();
initLeaveDb();

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

  const { name, email, status, requisitionId, comments, onNameConflict } = parsed.data;
  const saved = upsertCandidateNote({ name, email, status, requisitionId, comments, onNameConflict });
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

const yearMonthRe = /^\d{4}-\d{2}$/;

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

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Server running on http://localhost:${PORT}`);
});
