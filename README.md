# Recuity — Hiring, Leave & Todo Tracker

A local web app with three integrated modules: **Interview Notes**, **Leave Management**, and **Todo / Task Tracker**. All data is stored in local SQLite databases — no internet connection or cloud account required.

---

## Modules

### 1. Interview Notes (`/`)
Manage candidate pipeline from first contact to offer.

- Add / update candidate notes with **name**, **email** (optional), **status**, **requisition**, **interview panel**, **interview date**, and free-text **comments**
- **Status pipeline:** New → Shortlisted for L1/L2/L3 → Offer made → Offer accepted / rejected → Rejected in L1/L2/L3 → Kept on hold
- Search candidates by **name / email**, **status**, **requisition**, or **req type** (FTE / FTC)
- Manage **Requisitions** (ID, name, type FTE/FTC, status, link)
- Manage **Interview Panels** (name, email, department)
- Duplicate-name detection with auto-suffix suggestion

### 2. Leave Management (`/leave.html`)
Track team leave on a monthly calendar.

- Monthly **calendar view** — colour-coded leave cells per employee
- Leave types: **Full Day**, **Half Day – AM**, **Half Day – PM**
- Optional per-leave **note**
- Manage **Employees** (name, optional email)
- Manage **Public Holidays** — holiday dates are highlighted on the calendar
- **Export** leave data to `.xlsx` (date-range picker → downloads a workbook with a *Leaves* sheet and a *Holidays* sheet)
- **Import** leave data from `.xlsx` — auto-creates missing employees, upserts leave rows, reports imported / skipped / warning counts

### 3. Todo / Task Tracker (`/todo.html`)
Lightweight task board for the hiring team.

- Create and manage **tasks** with title, description, **priority** (Low / Medium / High / Critical), **status** (Open / In Progress / Blocked / Done), and optional **due date**
- Assign tasks to colour-coded **Projects**
- Filter by project, status, priority, or due-date bucket (**Overdue / Today / Upcoming 7 days**)
- Full-text search across title and description
- One-click status toggle directly from the list

---

## Quick start

### macOS
If `node_modules/` is included in the package, you can run the app immediately.

1. Double-click **`start.command`**.
2. Open <http://localhost:3000>.

To stop the server: close the Terminal window or press **Ctrl+C**.

### Windows
`node_modules/` is OS-specific (native SQLite bindings). The macOS `node_modules/` **cannot** be reused on Windows.

1. Double-click **`start.bat`**.
   - It will delete any existing `node_modules/` and run `npm install` automatically.
2. Open <http://localhost:3000>.

To stop the server: close the Command Prompt window or press **Ctrl+C**.

### Manual / development
```bash
npm install        # first time only
npm start          # production
npm run dev        # auto-restarts on file changes (node --watch)
```

---

## Dependencies

| Package | Purpose |
|---|---|
| `express` | HTTP server |
| `better-sqlite3` | Synchronous SQLite access |
| `zod` | Input validation |
| `exceljs` | Excel export & import |
| `multer` | Multipart file upload (for import) |

---

## Data files

| File | Contents |
|---|---|
| `data/hiring.sqlite` | Candidates, requisitions, panels |
| `data/leave.sqlite` | Employees, leave records, holidays |
| `data/todo.sqlite` | Projects, tasks |

- If the `data/` folder is shipped with the app, all existing records will be visible on first run.
- If `data/` is absent or empty, fresh databases are created automatically.
- To reset a module, delete the corresponding `.sqlite` file (and its `-shm` / `-wal` siblings).

---

## Excel Import format (Leave)

The import file must contain a sheet named **`Leaves`** with the following columns (row 1 = header, skipped automatically):

| Column | Description |
|---|---|
| A | Employee name (required) |
| B | Employee email (optional, used only when auto-creating a new employee) |
| C | Date — date-formatted cell **or** plain `YYYY-MM-DD` text |
| D | Leave type: `Full Day`, `Half Day - AM`, or `Half Day - PM` |
| E | Note (optional) |

The easiest way to get a correctly formatted file is to use the **Export** feature first, edit the downloaded workbook, and re-import it.
