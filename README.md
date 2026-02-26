# Hiring Interview Notes

Simple web app to save and retrieve interview notes.

## Features
- Add/update notes with **name**, **email**, and **comments**
- Data stored in a local **SQLite** database
- Search notes anytime by **name or email**

## Run
- Start the server:
  - `npm run start`
- Dev mode (auto-reload):
  - `npm run dev`

Then open http://localhost:3000

## Start by double-click (macOS)

### Option 1: `.command` launcher (recommended)

This repo includes a `start.command` file you can double-click to start the server.

1. Make it executable (one time):
   - `chmod +x start.command`
2. Double-click `start.command`.
3. Open: http://localhost:3000

To stop the server, close the Terminal window (or press Ctrl+C).

### Option 2: Automator app

You can also wrap the command in an Automator “Application” and drag it to your Desktop.

- Automator → New Document → Application → “Run Shell Script”
- Script:
  - `cd "/Users/rohitballurgi/Desktop/Hiring"`
  - `npm run start`

## Data
SQLite DB file is created at `data/hiring.sqlite`.
# recuity
