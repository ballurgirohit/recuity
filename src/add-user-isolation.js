const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'data', 'hiring.sqlite');
const db = new Database(dbPath);

console.log('Adding user_id columns to tables...');

// Check and add user_id to candidate_notes
const notesCols = db.prepare('PRAGMA table_info(candidate_notes);').all();
if (!notesCols.some(c => c.name === 'user_id')) {
  db.exec("ALTER TABLE candidate_notes ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1;");
  db.exec('CREATE INDEX IF NOT EXISTS idx_candidate_notes_user_id ON candidate_notes(user_id);');
  console.log('✓ Added user_id to candidate_notes');
} else {
  console.log('✓ candidate_notes already has user_id');
}

// Check and add user_id to requisitions
const reqCols = db.prepare('PRAGMA table_info(requisitions);').all();
if (!reqCols.some(c => c.name === 'user_id')) {
  db.exec("ALTER TABLE requisitions ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1;");
  db.exec('CREATE INDEX IF NOT EXISTS idx_requisitions_user_id ON requisitions(user_id);');
  console.log('✓ Added user_id to requisitions');
} else {
  console.log('✓ requisitions already has user_id');
}

// Check and add user_id to panel_members
const panelCols = db.prepare('PRAGMA table_info(panel_members);').all();
if (!panelCols.some(c => c.name === 'user_id')) {
  db.exec("ALTER TABLE panel_members ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1;");
  db.exec('CREATE INDEX IF NOT EXISTS idx_panel_members_user_id ON panel_members(user_id);');
  console.log('✓ Added user_id to panel_members');
} else {
  console.log('✓ panel_members already has user_id');
}

db.close();
console.log('\nMigration complete!');
