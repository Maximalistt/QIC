const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '../qic.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uin TEXT UNIQUE NOT NULL,
    nickname TEXT NOT NULL,
    email TEXT UNIQUE,
    password_hash TEXT NOT NULL,
    first_name TEXT DEFAULT '',
    last_name TEXT DEFAULT '',
    age INTEGER DEFAULT 0,
    gender TEXT DEFAULT 'unknown',
    country TEXT DEFAULT '',
    city TEXT DEFAULT '',
    homepage TEXT DEFAULT '',
    about TEXT DEFAULT '',
    status TEXT DEFAULT 'offline',
    status_message TEXT DEFAULT '',
    avatar TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_uin TEXT NOT NULL,
    contact_uin TEXT NOT NULL,
    nickname TEXT DEFAULT '',
    group_name TEXT DEFAULT 'General',
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(owner_uin, contact_uin)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_uin TEXT NOT NULL,
    receiver_uin TEXT NOT NULL,
    message TEXT NOT NULL,
    message_type TEXT DEFAULT 'text',
    is_read INTEGER DEFAULT 0,
    sent_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS contact_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_uin TEXT NOT NULL,
    to_uin TEXT NOT NULL,
    message TEXT DEFAULT '',
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(from_uin, to_uin)
  );

  CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_uin);
  CREATE INDEX IF NOT EXISTS idx_messages_receiver ON messages(receiver_uin);
  CREATE INDEX IF NOT EXISTS idx_contacts_owner ON contacts(owner_uin);
`);

module.exports = db;
