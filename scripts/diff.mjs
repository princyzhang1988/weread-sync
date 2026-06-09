#!/usr/bin/env node
// Compute diff between DB-stored baseline state and current BookData.
//
// Usage: node diff.mjs <bookId> <current.json>
// Output: JSON DiffResult to stdout

import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';

const DB_PATH = resolve(homedir(), '.weread-sync', 'state.db');

// ── State queries ────────────────────────────────────────

function getState(db, bookId) {
  const book = db.prepare('SELECT * FROM books WHERE book_id = ?').get(bookId);
  if (!book) return null;

  const bookmarkRows = db.prepare(
    'SELECT bookmark_id, fallback_key FROM bookmarks WHERE book_id = ?'
  ).all(bookId);

  const reviewRows = db.prepare(
    'SELECT review_id, fallback_key FROM reviews WHERE book_id = ?'
  ).all(bookId);

  return {
    bookId: book.book_id,
    title: book.title,
    author: book.author,
    category: book.category,
    progress: book.progress ?? 0,
    chapterUid: book.chapter_uid,
    chapterTitle: book.chapter_title,
    totalReadTime: book.total_read_time ?? 0,
    finishReading: !!book.finish_reading,
    bookmarkIds: new Set(bookmarkRows.map(r => r.bookmark_id)),
    reviewIds: new Set(reviewRows.map(r => r.review_id)),
    bookmarkFallbacks: new Set(bookmarkRows.map(r => r.fallback_key)),
    reviewFallbacks: new Set(reviewRows.map(r => r.fallback_key)),
  };
}

// ── Key helpers ──────────────────────────────────────────

function bookmarkIdKey(b) {
  return b.bookmarkId != null ? String(b.bookmarkId) : null;
}
function bookmarkFallbackKey(b) {
  return `${b.createTime || 0}::${(b.markText || '').slice(0, 80)}`;
}
function reviewIdKey(r) {
  return r.reviewId != null ? String(r.reviewId) : null;
}
function reviewFallbackKey(r) {
  return `${r.createTime || 0}::${(r.content || '').slice(0, 80)}`;
}

// ── Diff logic ───────────────────────────────────────────

function computeDiff(state, current) {
  const currentBookmarks = current.bookmarks || [];
  const currentReviews = current.reviews || [];

  const newBookmarks = currentBookmarks.filter(b => {
    const idKey = bookmarkIdKey(b);
    if (idKey && state.bookmarkIds.has(idKey)) return false;
    if (state.bookmarkFallbacks.has(bookmarkFallbackKey(b))) return false;
    return true;
  });

  const newReviews = currentReviews.filter(r => {
    const idKey = reviewIdKey(r);
    if (idKey && state.reviewIds.has(idKey)) return false;
    if (state.reviewFallbacks.has(reviewFallbackKey(r))) return false;
    return true;
  });

  const progressFrom = state.progress ?? 0;
  const progressTo = current.progress ?? 0;
  const timeFrom = state.totalReadTime ?? 0;
  const timeTo = current.totalReadTime ?? 0;

  const hasChanges =
    newBookmarks.length > 0 ||
    newReviews.length > 0 ||
    progressFrom !== progressTo ||
    timeFrom !== timeTo;

  return {
    bookId: current.bookId || state.bookId,
    title: current.title || state.title,
    hasChanges,
    progressChange: {
      from: progressFrom,
      to: progressTo,
      diff: progressTo - progressFrom,
    },
    chapterChange: {
      from: {
        chapterUid: state.chapterUid ?? null,
        chapterTitle: state.chapterTitle || '',
      },
      to: {
        chapterUid: current.chapterUid ?? null,
        chapterTitle: current.chapterTitle || '',
      },
    },
    timeChange: {
      from: timeFrom,
      to: timeTo,
      diff: timeTo - timeFrom,
    },
    newBookmarks,
    newReviews,
    totalBookmarksBefore: state.bookmarkIds.size,
    totalBookmarksAfter: currentBookmarks.length,
    totalReviewsBefore: state.reviewIds.size,
    totalReviewsAfter: currentReviews.length,
  };
}

// ── CLI ───────────────────────────────────────────────────

const bookId = process.argv[2];
const currentPath = process.argv[3];

if (!bookId || !currentPath) {
  console.error('Usage: node diff.mjs <bookId> <current.json>');
  console.error('Output: JSON DiffResult to stdout');
  process.exit(1);
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

const state = getState(db, bookId);
db.close();

if (!state) {
  // Book not in DB yet: treat as first sync, all bookmarks/reviews are new
  const current = JSON.parse(readFileSync(currentPath, 'utf-8'));
  const emptyState = {
    bookId: String(current.bookId),
    title: '',
    author: '',
    category: '',
    progress: 0,
    chapterUid: null,
    chapterTitle: '',
    totalReadTime: 0,
    finishReading: false,
    bookmarkIds: new Set(),
    reviewIds: new Set(),
    bookmarkFallbacks: new Set(),
    reviewFallbacks: new Set(),
  };
  const diff = computeDiff(emptyState, current);
  console.log(JSON.stringify(diff, null, 2));
} else {
  const current = JSON.parse(readFileSync(currentPath, 'utf-8'));
  const diff = computeDiff(state, current);
  console.log(JSON.stringify(diff, null, 2));
}
