const path = require('path');
const express = require('express');
const { z } = require('zod');
const {
  initDb,
  upsertCandidateNote,
  searchNotes,
  getNoteByEmail,
  deleteNoteByEmail,
  upsertRequisition,
  listRequisitions,
  deleteRequisition
} = require('./storage');

const app = express();
const PORT = process.env.PORT || 3000;

initDb();

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
  comments: z.string().trim().min(1, 'Comments are required').max(20000)
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

  const { name, email, status, comments } = parsed.data;
  const saved = upsertCandidateNote({ name, email, status, comments });
  return res.json({ ok: true, note: saved });
});

app.get('/api/notes/search', (req, res) => {
  const q = String(req.query.q ?? '').trim();
  const status = String(req.query.status ?? '').trim();

  if (!q && !status) return res.status(400).json({ error: 'QueryOrStatusRequired' });

  // Validate status if provided.
  if (status && !allowedStatuses.includes(status)) {
    return res.status(400).json({ error: 'InvalidStatus' });
  }

  const results = searchNotes({ q, status });
  return res.json({ ok: true, results });
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

const requisitionSchema = z.object({
  reqId: z.string().trim().min(1, 'Requisition id is required').max(100),
  name: z.string().trim().min(1, 'Requisition name is required').max(200),
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

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Server running on http://localhost:${PORT}`);
});
