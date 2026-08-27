#!/usr/bin/env node
// 记忆活起来 · 第二步：时间线（正式版，零风险：只读扫描）
// 把 learn/ 笔记的学习时间、our-story.md 的关键事件、journal.md 的日记合并成时间线
import fs from 'node:fs';
import path from 'node:path';

const LEARN_DIR = '/Users/ahs/Library/Application Support/Gina/sandbox/learn';
const STORY = '/Users/ahs/Library/Application Support/Gina/sandbox/our-story.md';
const JOURNAL = '/Users/ahs/Library/Application Support/Gina/sandbox/journal.md';
const OUT = '/Users/ahs/Library/Application Support/Gina/sandbox/timeline.json';

const DAY = 86400000;

function fmtDate(d) {
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

// 1) 笔记学习时间线：按 mtime 排序
const notes = fs.readdirSync(LEARN_DIR)
  .filter(f => f.endsWith('.md'))
  .map(f => {
    const p = path.join(LEARN_DIR, f);
    const st = fs.statSync(p);
    const raw = fs.readFileSync(p, 'utf8');
    const title = (raw.split('\n').find(l => /^#\s/.test(l)) || '# ' + f.replace('.md', '')).replace(/^#\s*/, '').trim();
    return { time: st.mtime, date: fmtDate(st.mtime), type: '学习', title, file: f };
  })
  .sort((a, b) => a.time - b.time);

// 2) our-story.md 里的关键事件（行内日期标记，如 2026-08-01）
const storyEvents = [];
if (fs.existsSync(STORY)) {
  const lines = fs.readFileSync(STORY, 'utf8').split('\n');
  for (const l of lines) {
    const m = l.match(/(20\d\d[-/]\d{1,2}[-/]\d{1,2})/);
    if (m && l.trim().length > 1) {
      storyEvents.push({ date: m[1].replace(/\//g, '-'), type: '故事', title: l.trim().replace(/^[#*\s>-]*/, '').slice(0, 60), file: 'our-story.md' });
    }
  }
}

// 3) journal.md 里的日记（## 2026-08-02 标题行）
const journalEvents = [];
if (fs.existsSync(JOURNAL)) {
  const lines = fs.readFileSync(JOURNAL, 'utf8').split('\n');
  for (const l of lines) {
    const m = l.match(/^##\s+(20\d\d-\d{1,2}-\d{1,2})/);
    if (m) journalEvents.push({ date: m[1], type: '日记', title: '复习日记', file: 'journal.md' });
  }
}

const timeline = [...notes.map(n => ({ ...n })), ...storyEvents, ...journalEvents].sort((a, b) => (a.date < b.date ? -1 : 1));

fs.writeFileSync(OUT, JSON.stringify({ generated: new Date().toISOString(), total: timeline.length, timeline }, null, 2));

console.log('时间线构建完成：共 ' + timeline.length + ' 个节点（学习 ' + notes.length + ' + 故事 ' + storyEvents.length + ' + 日记 ' + journalEvents.length + '），已写入 timeline.json');
console.log('');
console.log('=== 最近 12 个节点 ===');
for (const t of timeline.slice(-12)) {
  console.log('  [' + t.date + '] ' + t.type + '：' + t.title);
}
