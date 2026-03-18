# Recuity — Hiring, Leave, Todo & Org Tracker

A local web app with four integrated modules: **Interview Notes**, **Leave Management**, **Todo / Task Tracker**, and **Org Chart**. All data is stored in local SQLite databases — no internet connection or cloud account required.

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

### 4. Org Chart (`/org.html`)
Visualise your organisation as an interactive tree.

- Add nodes with **name**, **job title**, **department**, **email**, **employee ID**, **phone**, and **sort order**
- Drag-free tree layout — set `sort_order` to control sibling ordering
- Collapse / expand branches
- Edit or delete any node inline; orphaned children become root nodes

---

## Quick start

### macOS
If `node_modules/` is included in the package, you can run the app immediately.

1. Double-click **`start.command`**.
2. Open <http://localhost:3000>.

To stop the server: close the Terminal window or press **Ctrl+C**.

### Windows
`node_modules/` is OS-specific (native SQLite bindings). The macOS `node_modules/` **cannot** be reused on Windows.

If a `node_modules/` folder is already present (e.g. shipped from macOS), delete it first and install fresh:

```cmd
rmdir /s /q node_modules
npm install
```

Then to start the app:

1. Double-click **`start.bat`**.
2. Open <http://localhost:3000>.

To stop the server: close the Command Prompt window or press **Ctrl+C**.

### Manual / development
```bash
npm install        # first time only
npm start          # production
npm run dev        # auto-restarts on file changes (node --watch)
```

---

## Software updates

Every page shows the current app version (from `package.json`) in the top-right of the navbar, alongside a **Check for updates** button.

### How it works

The update system uses **Git** to detect and apply updates. The server exposes two endpoints:

| Endpoint | Method | Description |
|---|---|---|
| `/api/update/check` | `GET` | Runs `git fetch` then compares `HEAD` with the upstream branch |
| `/api/update/apply` | `POST` | Runs `git pull` and restarts the server process (`process.exit(0)`) |

When an update is available, a yellow banner appears on the page with an **Update now** button. Clicking it runs `git pull` on the server and reloads the page after 2.5 seconds.

The **Check for updates** button in the navbar triggers an on-demand check and shows a brief status message ("Checking… / Up to date / No updates available").

### Requirements

- **Git must be installed** and available on `PATH`.
  - macOS: install via [Homebrew](https://brew.sh) (`brew install git`) or Xcode Command Line Tools (`xcode-select --install`).
  - Windows: install from <https://git-scm.com>.
- The app folder must be a **Git repository** with a configured **upstream remote** (i.e. cloned with `git clone`, not downloaded as a ZIP).
- The server process must have **write access** to the app folder so `git pull` can update files.

If any of these conditions are not met, the check silently returns `available: false` with a reason — no error is shown to the user.

### Behind a corporate proxy

If your machine routes outbound traffic through a proxy, `git fetch` / `git pull` may fail silently. Configure Git to use your proxy:

```bash
# HTTP/HTTPS proxy
git config --global http.proxy http://proxy.example.com:8080

# If your proxy requires authentication
git config --global http.proxy http://user:password@proxy.example.com:8080

# To remove the proxy setting later
git config --global --unset http.proxy
```

On Windows the same commands work in Git Bash or Command Prompt (after installing Git for Windows).

---

## Dependencies

| Package | Version | Purpose |
|---|---|---|
| `express` | ^5.2.1 | HTTP server |
| `better-sqlite3` | ^12.6.2 | Synchronous SQLite access |
| `zod` | ^4.3.6 | Input validation |
| `exceljs` | ^4.4.0 | Excel export & import |
| `multer` | ^2.1.1 | Multipart file upload (for import) |

> **Note:** `better-sqlite3` includes a native C++ addon compiled for the host OS and Node.js version. If you move the app between machines or upgrade Node.js, delete `node_modules/` and run `npm install` again.

---

## Data files

| File | Contents |
|---|---|
| `data/hiring.sqlite` | Candidates, requisitions, panels |
| `data/leave.sqlite` | Employees, leave records, holidays |
| `data/todo.sqlite` | Projects, tasks |
| `data/org.sqlite` | Org chart nodes |

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
