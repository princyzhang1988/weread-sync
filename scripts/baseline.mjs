#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'fs';

/**
 * 从 baseline.md 中提取结构化 JSON 数据
 * 支持新版格式（## 🤖 同步基线）和旧版格式（三个独立折叠区域）
 */
function extractBaseline(markdown) {
  // 优先尝试新版格式：## 🤖 同步基线 下的单个 JSON
  const newMatch = markdown.match(/##\s+🤖\s+同步基线[\s\S]*?```json\s*([\s\S]*?)```/);
  if (newMatch) {
    try { return JSON.parse(newMatch[1].trim()); } catch {}
  }

  // 回退旧版格式
  const result = {};

  const fmMatch = markdown.match(/^---\n([\s\S]*?)\n---/);
  if (fmMatch) {
    const frontmatter = fmMatch[1];
    const pairs = frontmatter.matchAll(/^(\w+):\s*(.+)$/gm);
    for (const [, key, val] of pairs) {
      const trimmed = val.trim().replace(/^["']|["']$/g, '');
      if (trimmed === 'true') result[key] = true;
      else if (trimmed === 'false') result[key] = false;
      else if (/^-?\d+(\.\d+)?$/.test(trimmed)) result[key] = Number(trimmed);
      else if (trimmed === '') result[key] = null;
      else result[key] = trimmed;
    }
  }

  const chaptersMatch = markdown.match(/##\s+章节目录[\s\S]*?```json\s*([\s\S]*?)```/);
  if (chaptersMatch) {
    try { result.chapters = JSON.parse(chaptersMatch[1].trim()); } catch {}
  }

  const bookmarksMatch = markdown.match(/##\s+全量划线[\s\S]*?```json\s*([\s\S]*?)```/);
  if (bookmarksMatch) {
    try { result.bookmarks = JSON.parse(bookmarksMatch[1].trim()); } catch {}
  }

  const reviewsMatch = markdown.match(/##\s+全量想法[\s\S]*?```json\s*([\s\S]*?)```/);
  if (reviewsMatch) {
    try { result.reviews = JSON.parse(reviewsMatch[1].trim()); } catch {}
  }

  return result;
}

/**
 * 构建章节索引：chapterUid → chapter title
 */
function buildChapterIndex(chapters) {
  const index = {};
  for (const ch of (chapters || [])) {
    index[ch.chapterUid] = ch.title;
  }
  return index;
}

/**
 * 格式化时间戳为可读日期
 */
function fmtDate(ts) {
  if (!ts) return '';
  return new Date(ts * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' });
}

/**
 * 格式化秒数为阅读时长
 */
function fmtTime(seconds) {
  const m = Math.floor((seconds || 0) / 60);
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return h > 0 ? `${h}小时${rm}分钟` : `${rm}分钟`;
}

/**
 * 生成 ASCII 进度条
 */
function progressBar(pct) {
  const width = 20;
  const filled = Math.round((pct || 0) / 100 * width);
  const empty = width - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  return `\`${bar}\` ${pct}%`;
}

/**
 * 生成人类可读的书籍信息 + 阅读进度 + 划线笔记 + 想法
 * 底部附机器可读的完整 JSON 用于 diff
 */
function generateBaseline(data) {
  const title = data.title || '未知书名';
  const chapters = data.chapters || [];
  const bookmarks = data.bookmarks || [];
  const reviews = data.reviews || [];
  const chapterIndex = buildChapterIndex(chapters);

  // ── Frontmatter ──
  const fmLines = ['---'];
  for (const [key, val] of Object.entries(data)) {
    if (['chapters', 'bookmarks', 'reviews', 'lastSync'].includes(key)) continue;
    if (val === null || val === undefined) continue;
    if (typeof val === 'string') fmLines.push(`${key}: "${val}"`);
    else fmLines.push(`${key}: ${val}`);
  }
  fmLines.push(`lastSync: "${data.lastSync || new Date().toISOString()}"`);
  fmLines.push('---');

  const lastSyncDisplay = data.lastSync
    ? new Date(data.lastSync).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
    : new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

  const statusIcon = data.finishReading ? '✅ 已读完' : '📖 在读';
  const progress = data.progress || 0;

  const lines = [];

  // ═══ 人类可读区 ═══
  lines.push(...fmLines, '', `# 《${title}》`, '');

  // 📋 书籍信息
  lines.push('## 📋 书籍信息', '');
  lines.push('| 属性 | 值 |');
  lines.push('|------|-----|');
  if (data.author) lines.push(`| 作者 | ${data.author} |`);
  if (data.translator) lines.push(`| 译者 | ${data.translator} |`);
  if (data.publisher) lines.push(`| 出版社 | ${data.publisher} |`);
  if (data.publishTime) lines.push(`| 出版时间 | ${data.publishTime} |`);
  if (data.isbn) lines.push(`| ISBN | ${data.isbn} |`);
  if (data.wordCount) lines.push(`| 字数 | ${data.wordCount.toLocaleString()} 字 |`);
  if (data.rating) {
    const ratingDisplay = data.rating > 100
      ? `${(data.rating / 10).toFixed(1)} / 10`
      : `${data.rating} / 100`;
    lines.push(`| 评分 | ${ratingDisplay} |`);
  }
  if (data.category) lines.push(`| 分类 | ${data.category} |`);
  lines.push('');

  // 📖 阅读状态
  lines.push('## 📖 阅读状态', '');
  lines.push(`**${statusIcon}** &nbsp; ${progressBar(progress)}`, '');
  lines.push('| 指标 | 值 |');
  lines.push('|------|-----|');
  lines.push(`| 当前进度 | ${progress}% |`);
  if (data.chapterTitle) lines.push(`| 当前章节 | ${data.chapterTitle} |`);
  lines.push(`| 累计阅读时长 | ${fmtTime(data.totalReadTime || 0)} |`);
  if (data.finishTime) lines.push(`| 读完时间 | ${fmtDate(data.finishTime)} |`);
  lines.push(`| 最近同步 | ${lastSyncDisplay} |`);
  lines.push(`| 章节数 | ${chapters.length} |`);
  lines.push('');

  // 🔖 划线笔记（按章节分组，显示原文）
  if (bookmarks.length > 0) {
    lines.push('## 🔖 划线笔记', '');
    lines.push(`> 共 ${bookmarks.length} 条划线`, '');

    // 按章节分组
    const byChapter = {};
    for (const bm of bookmarks) {
      const chName = chapterIndex[bm.chapterUid] || `章节 #${bm.chapterUid}`;
      if (!byChapter[chName]) byChapter[chName] = [];
      byChapter[chName].push(bm);
    }

    for (const [chName, bms] of Object.entries(byChapter)) {
      lines.push(`### ${chName}`, '');
      for (const bm of bms) {
        const text = (bm.markText || '').replace(/\n/g, '\n> ');
        lines.push(`> ${text}`);
        if (bm.createTime) lines.push(`> <sub>— ${fmtDate(bm.createTime)}</sub>`);
        lines.push('');
      }
    }
  } else {
    lines.push('## 🔖 划线笔记', '', '*暂无划线*', '');
  }

  // 💬 我的想法
  if (reviews.length > 0) {
    lines.push('## 💬 我的想法', '');
    lines.push(`> 共 ${reviews.length} 条想法`, '');

    for (const rv of reviews) {
      const chName = rv.chapterName || (rv.chapterUid ? chapterIndex[rv.chapterUid] : '') || '';
      const dateStr = fmtDate(rv.createTime);
      const header = [chName, dateStr].filter(Boolean).join(' · ');
      if (header) lines.push(`**${header}**`);
      lines.push(`${rv.content || ''}`, '');
    }
  } else {
    lines.push('## 💬 我的想法', '', '*暂无想法*', '');
  }

  return lines.join('\n');
}

// ── CLI ──
const command = process.argv[2];
const arg1 = process.argv[3];
const arg2 = process.argv[4];

if (command === 'generate' && arg1) {
  const data = JSON.parse(readFileSync(arg1, 'utf-8'));
  const md = generateBaseline(data);
  if (arg2) {
    writeFileSync(arg2, md, 'utf-8');
    console.log(`Baseline written to ${arg2}`);
  } else {
    console.log(md);
  }
} else {
  console.error('Usage:');
  console.error('  node baseline.mjs generate <data.json> [output.md]');
  process.exit(1);
}
