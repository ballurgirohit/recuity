<!-- Use this file to provide workspace-specific custom instructions to Copilot. For more details, visit https://code.visualstudio.com/docs/copilot/copilot-customization#_use-a-githubcopilotinstructionsmd-file -->

## Project
- Node.js (CommonJS) + Express server
- SQLite storage via better-sqlite3
- Minimal static frontend in /public

## Coding conventions
- Keep endpoints small and predictable.
- Validate inputs (name/email/comments) on write.
- Prefer synchronous DB access in storage.js (better-sqlite3).
