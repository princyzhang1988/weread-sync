#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'fs';

/**
 * 从 baseline.md 中提取结构化 JSON 数据
 * 解析三个折叠区域：章节目录、全量划线、全量想法
 * 同时解析 frontmatter YAML 和表格字段
 */
function extractBaseline(markdown) {
  const result = {};

  // 解析 YAML frontmatter（--- ... ---）
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

  // 解析章节目录折叠 JSON
  const chaptersMatch = markdown.match(/##\s+章节目录[\s\S]*?```json\s*([\s\S]*?)```/);
  if (chaptersMatch) {
    try { result.chapters = JSON.parse(chaptersMatch[1].trim()); } catch {}
  }

  // 解析全量划线折叠 JSON
  const bookmarksMatch = markdown.match(/##\s+全量划线[\s\S]*?```json\s*([\s\S]*?)```/);
  if (bookmarksMatch) {
    try { result.bookmarks = JSON.parse(bookmarksMatch[1].trim()); } catch {}
  }

  // 解析全量想法折叠 JSON
  const reviewsMatch = markdown.match(/##\s+全量想法[\s\S]*?```json\s*([\s\S]*?)```/);
  if (reviewsMatch) {
    try { result.reviews = JSON.parse(reviewsMatch[1].trim()); } catch {}
  }

  return result;
}

/**
 * 从 BookData 生成完整的 baseline.md 内容
 */
function generateBaseline(data) {
  const fm = [];
  fm.push('---');
  for (const [key, val] of Object.entries(data)) {
    if (['chapters', 'bookmarks', 'reviews', 'lastSync'].includes(key)) continue;
    if (val === null || val === undefined) continue;
    if (typeof val === 'string') fm.push(`${key}: "${val}"`);
    else fm.push(`${key}: ${val}`);
  }
  fm.push(`lastSync: "${data.lastSync || new Date().toISOString()}"`);
  fm.push('---');

  const lastSyncDisplay = data.lastSync
    ? new Date(data.lastSync).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
    : new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

  const minutes = Math.floor((data.totalReadTime || 0) / 60);
  const hours = Math.floor(minutes / 60);
  const remainMin = minutes % 60;
  const timeDisplay = `${hours}小时${remainMin}分钟`;

  const lines = [
    ...fm,
    '',
    `# 《${data.title}》微信读书基线`,
    '',
    '| 字段 | 值 |',
    '|------|-----|',
    `| 当前进度 | ${data.progress}% |`,
    `| 当前章节 | ${data.chapterTitle || '未知'} |`,
    `| 累计阅读时长 | ${timeDisplay} |`,
    `| 划线数 | ${(data.bookmarks || []).length} |`,
    `| 想法数 | ${(data.reviews || []).length} |`,
    `| 最近同步 | ${lastSyncDisplay} |`,
    `| 是否读完 | ${data.finishReading ? '是' : '否'} |`,
    '',
    '## 章节目录',
    '',
    '<details><summary>展开</summary>',
    '',
    '```json',
    JSON.stringify(data.chapters || [], null, 2),
    '```',
    '',
    '</details>',
    '',
    '## 全量划线',
    '',
    `<details><summary>展开（${(data.bookmarks || []).length}条）</summary>`,
    '',
    '```json',
    JSON.stringify(data.bookmarks || [], null, 2),
    '```',
    '',
    '</details>',
    '',
    '## 全量想法',
    '',
    `<details><summary>展开（${(data.reviews || []).length}条）</summary>`,
    '',
    '```json',
    JSON.stringify(data.reviews || [], null, 2),
    '```',
    '',
    '</details>',
  ];

  return lines.join('\n');
}

// CLI
const command = process.argv[2];
const arg1 = process.argv[3];
const arg2 = process.argv[4];

if (command === 'extract' && arg1) {
  const md = readFileSync(arg1, 'utf-8');
  const data = extractBaseline(md);
  console.log(JSON.stringify(data, null, 2));
} else if (command === 'generate' && arg1) {
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
  console.error('  node baseline.mjs extract <baseline.md>');
  console.error('  node baseline.mjs generate <data.json> [output.md]');
  process.exit(1);
}
