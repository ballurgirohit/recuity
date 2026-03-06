# Hiring Interview Notes

Simple local web app to save and retrieve interview notes.

## Features
- Add/update notes with **name**, optional **email**, **status** and **hiring notes**
- Data stored in a local **SQLite** database
- Search notes by **name/email/status**

## Quick start

### macOS
- If this repo is shared with `node_modules/` included, macOS can use it directly.

Steps:
1. Double-click `start.command`.
2. Open http://localhost:3000

To stop the server: close the Terminal window or press Ctrl+C.

### Windows
`node_modules/` is **OS-specific** (this project uses native SQLite bindings), so the macOS `node_modules/` cannot be reused on Windows.

Steps:
1. Double-click `start.bat`.
   - It will delete any bundled `node_modules/` and run `npm install` to install Windows-compatible dependencies.
2. Open http://localhost:3000

To stop the server: close the Command Prompt window or press Ctrl+C.

## Data
The SQLite DB file is stored in `data/hiring.sqlite`.

- If `data/` is shipped with the app, users will see the same data.
- If `data/` is removed, the app will create a fresh database on first run.

## Dev / advanced
If you want to run it manually (or develop locally), use:
- `npm run start`
- `npm run dev`
