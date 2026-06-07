#!/usr/bin/env node

import { readFileSync } from 'fs';

/**
 * 对比基线和当前数据，输出 DiffResult
 */
function computeDiff(baseline, current) {
  const baselineBookmarks = baseline.bookmarks || [];
  const currentBookmarks = current.bookmarks || [];
  const baselineReviews = baseline.reviews || [];
  const currentReviews = current.reviews || [];

  const baselineBookmarkIds = new Set(baselineBookmarks.map(b => b.bookmarkId));
  const baselineReviewIds = new Set(baselineReviews.map(r => r.reviewId));

  const newBookmarks = currentBookmarks.filter(b => !baselineBookmarkIds.has(b.bookmarkId));
  const newReviews = currentReviews.filter(r => !baselineReviewIds.has(r.reviewId));

  const progressFrom = baseline.progress || 0;
  const progressTo = current.progress || 0;
  const timeFrom = baseline.totalReadTime || 0;
  const timeTo = current.totalReadTime || 0;

  const hasChanges =
    newBookmarks.length > 0 ||
    newReviews.length > 0 ||
    progressFrom !== progressTo ||
    timeFrom !== timeTo;

  return {
    bookId: current.bookId || baseline.bookId,
    title: current.title || baseline.title,
    hasChanges,
    progressChange: {
      from: progressFrom,
      to: progressTo,
      diff: progressTo - progressFrom,
    },
    chapterChange: {
      from: {
        chapterUid: baseline.chapterUid || null,
        chapterTitle: baseline.chapterTitle || '',
      },
      to: {
        chapterUid: current.chapterUid || null,
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
    totalBookmarksBefore: baselineBookmarks.length,
    totalBookmarksAfter: currentBookmarks.length,
    totalReviewsBefore: baselineReviews.length,
    totalReviewsAfter: currentReviews.length,
  };
}

// CLI
const baselinePath = process.argv[2];
const currentPath = process.argv[3];

if (!baselinePath || !currentPath) {
  console.error('Usage: node diff.mjs <baseline.json> <current.json>');
  console.error('Output: JSON DiffResult to stdout');
  process.exit(1);
}

const baseline = JSON.parse(readFileSync(baselinePath, 'utf-8'));
const current = JSON.parse(readFileSync(currentPath, 'utf-8'));

const diff = Array.isArray(baseline) || Array.isArray(current)
  ? null  // 顶层数组不支持
  : computeDiff(baseline, current);

if (!diff) {
  console.error('Error: baseline and current must be single objects, not arrays');
  process.exit(1);
}

console.log(JSON.stringify(diff, null, 2));
