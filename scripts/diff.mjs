#!/usr/bin/env node

import { readFileSync } from 'fs';

/**
 * 生成 bookmark 的匹配键。
 * 优先用 bookmarkId；缺失时 fallback 到 createTime + markText。
 */
function bookmarkIdKey(b) {
  return b.bookmarkId != null ? String(b.bookmarkId) : null;
}
function bookmarkFallbackKey(b) {
  return `${b.createTime || 0}::${(b.markText || '').slice(0, 80)}`;
}

/**
 * 生成 review 的匹配键。
 * 优先用 reviewId；缺失时 fallback 到 createTime + content。
 */
function reviewIdKey(r) {
  return r.reviewId != null ? String(r.reviewId) : null;
}
function reviewFallbackKey(r) {
  return `${r.createTime || 0}::${(r.content || '').slice(0, 80)}`;
}

/**
 * 对比基线和当前数据，输出 DiffResult
 */
function computeDiff(baseline, current) {
  const baselineBookmarks = baseline.bookmarks || [];
  const currentBookmarks = current.bookmarks || [];
  const baselineReviews = baseline.reviews || [];
  const currentReviews = current.reviews || [];

  // 建立基线索引：ID 集合 + fallback 键集合，兼容旧基线缺少 ID 的情况
  const baselineBookmarkIds = new Set();
  const baselineBookmarkFallbacks = new Set();
  for (const b of baselineBookmarks) {
    const idKey = bookmarkIdKey(b);
    if (idKey) baselineBookmarkIds.add(idKey);
    baselineBookmarkFallbacks.add(bookmarkFallbackKey(b));
  }

  const baselineReviewIds = new Set();
  const baselineReviewFallbacks = new Set();
  for (const r of baselineReviews) {
    const idKey = reviewIdKey(r);
    if (idKey) baselineReviewIds.add(idKey);
    baselineReviewFallbacks.add(reviewFallbackKey(r));
  }

  // 匹配：ID 优先，fallback 键兜底（即使 current 有 ID，也同时用 fallback 查 baseline）
  const newBookmarks = currentBookmarks.filter(b => {
    const idKey = bookmarkIdKey(b);
    if (idKey && baselineBookmarkIds.has(idKey)) return false;
    if (baselineBookmarkFallbacks.has(bookmarkFallbackKey(b))) return false;
    return true;
  });

  const newReviews = currentReviews.filter(r => {
    const idKey = reviewIdKey(r);
    if (idKey && baselineReviewIds.has(idKey)) return false;
    if (baselineReviewFallbacks.has(reviewFallbackKey(r))) return false;
    return true;
  });

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
