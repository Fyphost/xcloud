'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

fs.mkdirSync(config.uploadsDir, { recursive: true });

const db = new DatabaseSync(path.join(config.dataDir, 'xcloud.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY,
    email         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    name          TEXT    NOT NULL,
    password_hash TEXT    NOT NULL,
    created_at    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id         TEXT    PRIMARY KEY,           -- sha256 of the cookie value
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS files (
    id           INTEGER PRIMARY KEY AUTOINCREMENT, -- never reuse ids of deleted files
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    slug         TEXT    NOT NULL UNIQUE,
    name         TEXT    NOT NULL,
    storage_name TEXT    NOT NULL,
    size         INTEGER NOT NULL,
    is_public    INTEGER NOT NULL DEFAULT 1,
    downloads    INTEGER NOT NULL DEFAULT 0,
    created_at   INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_files_user ON files(user_id);

  -- Issued when the download page is viewed; redeemable only after the countdown.
  CREATE TABLE IF NOT EXISTS download_tickets (
    token      TEXT    PRIMARY KEY,
    file_id    INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    used       INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_tickets_created ON download_tickets(created_at);
`);

function cleanup() {
  const now = Date.now();
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
  db.prepare('DELETE FROM download_tickets WHERE created_at < ?').run(now - config.ticketTtl);
}
cleanup();
setInterval(cleanup, 10 * 60 * 1000).unref();

module.exports = db;
