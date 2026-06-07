#!/usr/bin/env node
// Bulk first-time sync: fetch all books and create baselines
// Usage: node bulk-first-sync.mjs

import { execSync } from 'child_process';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';

const WEREAD_API_KEY = process.env.WEREAD_API_KEY;
if (!WEREAD_API_KEY) {
  console.error('❌ WEREAD_API_KEY not set');
  process.exit(1);
}

const GATEWAY = 'https://i.weread.qq.com/api/agent/gateway';
const VAULT = "/Users/princyzhang/Library/Mobile Documents/iCloud~md~obsidian/Documents/知识太空舱";
const BASELINE_DIR = `${VAULT}/知识库/20.Areas/阅读/books`;
const SKILL_DIR = resolve(import.meta.dirname, '..');
const TMP_DIR = '/tmp/weread-sync';

function apiCall(apiName, params = {}) {
  const body = JSON.stringify({ api_name: apiName, skill_version: '1.0.3', ...params });
  const cmd = `curl -s -X POST "${GATEWAY}" -H "Authorization: Bearer ${WEREAD_API_KEY}" -H "Content-Type: application/json" -d '${body.replace(/'/g, "'\\''")}'`;
  try {
    return JSON.parse(execSync(cmd, { encoding: 'utf-8', timeout: 15000 }));
  } catch (e) {
    console.error(`  ⚠️ API call failed: ${apiName}`, e.message?.slice(0, 80));
    return null;
  }
}

function sanitizeFilename(title) {
  return title.replace(/[\/\\:*?"<>|]/g, '_').trim();
}

async function main() {
  mkdirSync(TMP_DIR, { recursive: true });

  // Step 1: Get shelf
  console.log('📚 Fetching shelf...');
  const shelf = apiCall('/shelf/sync');
  const books = [...(shelf.books || []), ...(shelf.albums || []).map(a => ({
    bookId: a.albumInfo?.albumId,
    title: a.albumInfo?.name,
    author: a.albumInfo?.authorName,
    finishReading: 0,
    category: '有声书',
  }))];

  console.log(`   ${books.length} items total\n`);

  // Step 2: Fetch details for each book
  let done = 0;
  let skipped = 0;
  let errors = 0;

  // Process in batches of 5 concurrent requests per book
  for (const book of books) {
    const bookId = book.bookId;
    const title = book.title || `book_${bookId}`;
    const safeName = sanitizeFilename(title);
    const bookDir = `${BASELINE_DIR}/${safeName}/weread`;
    const dataFile = `${TMP_DIR}/${bookId}.json`;

    done++;
    process.stdout.write(`[${done}/${books.length}] ${title.slice(0, 40)}... `);

    try {
      // Fetch 5 APIs for this book
      const [info, progress, chapters, bookmarklist, reviews] = await Promise.all([
        Promise.resolve().then(() => apiCall('/book/info', { bookId })),
        Promise.resolve().then(() => apiCall('/book/getprogress', { bookId })),
        Promise.resolve().then(() => apiCall('/book/chapterinfo', { bookId })),
        Promise.resolve().then(() => apiCall('/book/bookmarklist', { bookId })),
        Promise.resolve().then(() => apiCall('/review/list/mine', { bookid: bookId })),
      ]);

      // Find current chapter title
      let chapterTitle = '';
      if (progress?.book?.chapterUid && chapters?.chapters) {
        const ch = chapters.chapters.find(c => c.chapterUid === progress.book.chapterUid);
        chapterTitle = ch?.title || '';
      }

      // Assemble BookData
      const bookData = {
        bookId: String(bookId),
        title: info?.title || title,
        author: info?.author || book.author || '',
        translator: info?.translator || '',
        publisher: info?.publisher || '',
        publishTime: info?.publishTime || '',
        isbn: info?.isbn || '',
        wordCount: info?.wordCount || 0,
        rating: info?.newRating || 0,
        category: info?.category || book.category || '',
        cover: info?.cover || book.cover || '',
        progress: progress?.book?.progress || 0,
        chapterUid: progress?.book?.chapterUid || null,
        chapterTitle: chapterTitle,
        totalReadTime: progress?.book?.recordReadingTime || 0,
        finishReading: !!(progress?.book?.progress === 100 || book.finishReading === 1),
        finishTime: progress?.book?.finishTime || null,
        lastSync: new Date().toISOString(),
        chapters: chapters?.chapters || [],
        bookmarks: bookmarklist?.updated || [],
        reviews: (reviews?.reviews || []).map(r => ({
          reviewId: r.review?.reviewId || '',
          content: r.review?.content || '',
          createTime: r.review?.createTime || 0,
          chapterUid: r.review?.chapterUid,
          chapterName: r.review?.chapterName || '',
        })),
      };

      // Save BookData JSON for future use
      writeFileSync(dataFile, JSON.stringify(bookData, null, 2));

      // Generate baseline.md
      mkdirSync(bookDir, { recursive: true });
      const baselinePath = `${bookDir}/baseline.md`;

      try {
        execSync(`node "${SKILL_DIR}/scripts/baseline.mjs" generate "${dataFile}" "${baselinePath}"`, {
          encoding: 'utf-8',
          timeout: 5000,
        });
        console.log('✅');
      } catch (e) {
        console.log(`⚠️ baseline gen failed: ${e.message?.slice(0, 60)}`);
        errors++;
      }
    } catch (e) {
      console.log(`❌ ${e.message?.slice(0, 60)}`);
      errors++;
    }

    // Small delay to avoid rate limiting
    if (done % 10 === 0) {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  console.log(`\n---`);
  console.log(`✅ Done: ${done - errors} books`);
  if (errors > 0) console.log(`❌ Errors: ${errors}`);
  console.log(`📁 Baselines: ${BASELINE_DIR}/`);
}

main().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
