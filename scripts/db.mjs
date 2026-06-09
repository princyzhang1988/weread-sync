#!/usr/bin/env node
// SQLite-based state store for weread-sync diff tracking.
// Replaces the regex-extracted JSON in baseline.md.
//
// Commands:
//   node db.mjs init                          Create tables
//   node db.mjs get-state <bookId>            Output state JSON for diff
//   node db.mjs update-state <bookData.json>  Upsert state from BookData

import Database from 'better-sqlite3';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { homedir } from 'os';

const DB_DIR = resolve(homedir(), '.weread-sync');
const DB_PATH = join(DB_DIR, 'state.db');

// ── Helpers ──────────────────────────────────────────────

function bookmarkFallbackKey(b) {
  return `${b.createTime || 0}::${(b.markText || '').slice(0, 80)}`;
}

function reviewFallbackKey(r) {
  return `${r.createTime || 0}::${(r.content || '').slice(0, 80)}`;
}

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// ── DB connection ────────────────────────────────────────

function openDb() {
  ensureDir(DB_DIR);
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

// ── Commands ─────────────────────────────────────────────

function cmdInit() {
  const db = openDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS books (
      book_id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      author TEXT DEFAULT '',
      category TEXT DEFAULT '',
      progress REAL DEFAULT 0,
      chapter_uid INTEGER,
      chapter_title TEXT DEFAULT '',
      total_read_time INTEGER DEFAULT 0,
      finish_reading INTEGER DEFAULT 0,
      finish_time INTEGER,
      last_sync TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bookmarks (
      bookmark_id TEXT NOT NULL,
      book_id TEXT NOT NULL,
      fallback_key TEXT NOT NULL,
      create_time INTEGER,
      PRIMARY KEY (book_id, bookmark_id)
    );

    CREATE TABLE IF NOT EXISTS reviews (
      review_id TEXT NOT NULL,
      book_id TEXT NOT NULL,
      fallback_key TEXT NOT NULL,
      create_time INTEGER,
      PRIMARY KEY (book_id, review_id)
    );

    CREATE TABLE IF NOT EXISTS sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id TEXT NOT NULL,
      sync_time TEXT NOT NULL,
      progress_from REAL,
      progress_to REAL,
      new_bookmarks_count INTEGER DEFAULT 0,
      new_reviews_count INTEGER DEFAULT 0
    );
  `);

  console.log(`✅ DB initialized: ${DB_PATH}`);
  db.close();
}

function cmdGetState(bookId) {
  const db = openDb();

  const book = db.prepare('SELECT * FROM books WHERE book_id = ?').get(bookId);
  if (!book) {
    console.log(JSON.stringify(null));
    db.close();
    return;
  }

  const bookmarkRows = db.prepare(
    'SELECT bookmark_id, fallback_key FROM bookmarks WHERE book_id = ?'
  ).all(bookId);

  const reviewRows = db.prepare(
    'SELECT review_id, fallback_key FROM reviews WHERE book_id = ?'
  ).all(bookId);

  const state = {
    bookId: book.book_id,
    title: book.title,
    author: book.author,
    category: book.category,
    progress: book.progress ?? 0,
    chapterUid: book.chapter_uid,
    chapterTitle: book.chapter_title,
    totalReadTime: book.total_read_time ?? 0,
    finishReading: !!book.finish_reading,
    bookmarkIds: bookmarkRows.map(r => r.bookmark_id),
    reviewIds: reviewRows.map(r => r.review_id),
    bookmarkFallbacks: bookmarkRows.map(r => r.fallback_key),
    reviewFallbacks: reviewRows.map(r => r.fallback_key),
  };

  console.log(JSON.stringify(state, null, 0));
  db.close();
}

function cmdUpdateState(dataFile) {
  const data = JSON.parse(readFileSync(dataFile, 'utf-8'));
  const db = openDb();

  const bookId = String(data.bookId);
  const now = new Date().toISOString();

  const upsertBook = db.prepare(`
    INSERT INTO books (book_id, title, author, category, progress, chapter_uid, chapter_title, total_read_time, finish_reading, finish_time, last_sync)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(book_id) DO UPDATE SET
      title = excluded.title,
      author = excluded.author,
      category = excluded.category,
      progress = excluded.progress,
      chapter_uid = excluded.chapter_uid,
      chapter_title = excluded.chapter_title,
      total_read_time = excluded.total_read_time,
      finish_reading = excluded.finish_reading,
      finish_time = excluded.finish_time,
      last_sync = excluded.last_sync
  `);

  const insertBookmark = db.prepare(`
    INSERT OR IGNORE INTO bookmarks (bookmark_id, book_id, fallback_key, create_time)
    VALUES (?, ?, ?, ?)
  `);

  const insertReview = db.prepare(`
    INSERT OR IGNORE INTO reviews (review_id, book_id, fallback_key, create_time)
    VALUES (?, ?, ?, ?)
  `);

  const txn = db.transaction(() => {
    upsertBook.run(
      bookId,
      data.title || '',
      data.author || '',
      data.category || '',
      data.progress ?? 0,
      data.chapterUid ?? null,
      data.chapterTitle || '',
      data.totalReadTime ?? 0,
      data.finishReading ? 1 : 0,
      data.finishTime ?? null,
      data.lastSync || now
    );

    for (const bm of data.bookmarks || []) {
      const id = String(bm.bookmarkId ?? bookmarkFallbackKey(bm));
      insertBookmark.run(id, bookId, bookmarkFallbackKey(bm), bm.createTime ?? null);
    }

    for (const rv of data.reviews || []) {
      const id = String(rv.reviewId ?? reviewFallbackKey(rv));
      insertReview.run(id, bookId, reviewFallbackKey(rv), rv.createTime ?? null);
    }
  });

  txn();
  console.log(`✅ State updated: ${data.title || bookId}`);
  db.close();
}

// ── CLI ───────────────────────────────────────────────────

const command = process.argv[2];
const arg = process.argv[3];

try {
  switch (command) {
    case 'init':
      cmdInit();
      break;
    case 'get-state':
      if (!arg) {
        console.error('Usage: node db.mjs get-state <bookId>');
        process.exit(1);
      }
      cmdGetState(arg);
      break;
    case 'update-state':
      if (!arg) {
        console.error('Usage: node db.mjs update-state <bookData.json>');
        process.exit(1);
      }
      cmdUpdateState(arg);
      break;
    default:
      console.error('Usage: node db.mjs <init|get-state|update-state> [arg]');
      process.exit(1);
  }
} catch (e) {
  console.error(`❌ ${e.message}`);
  process.exit(1);
}
