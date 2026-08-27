#!/usr/bin/env node
/**
 * surfacing.mjs — 记忆活起来 · 第三块：旧事主动浮现（正式部署版）
 * 功能1：复习调度 —— 每天挑"最久没复习"的笔记，提醒主动复习（间隔递增）
 * 功能2：自动记日子 —— 每天追加一条复习日志，作为时间线数据源
 * 零风险：只读写笔记知识库目录，不碰任何系统配置
 * 数据位置：笔记库与日记在 Gina 沙盒 learn/（与沙盒验证版同源，路径写死保证任意目录可跑）
 */
import fs from 'node:fs'
import path from 'node:path'

const LEARN = '/Users/ahs/Library/Application Support/Gina/sandbox/learn'
const INDEX = path.join(LEARN, 'notes-index.json')
const REVIEW_LOG = path.join(LEARN, '.review-log.json')
const JOURNAL = path.join(LEARN, '..', 'journal.md')

// ---------- 读取 ----------
const index = JSON.parse(fs.readFileSync(INDEX, 'utf8'))
const notes = index.notes

let reviewLog = {}
if (fs.existsSync(REVIEW_LOG)) {
  reviewLog = JSON.parse(fs.readFileSync(REVIEW_LOG, 'utf8'))
}

const today = new Date().toISOString().slice(0, 10) // 2026-08-02

// ---------- 复习调度：最久没复习的优先 ----------
function daysSince(dateStr) {
  if (!dateStr) return Infinity
  return Math.floor((new Date(today) - new Date(dateStr)) / 86400000)
}

const candidates = notes.map(n => {
  const rec = reviewLog[n.file] || { lastReview: null, count: 0 }
  return { file: n.file, title: n.title, lastReview: rec.lastReview, count: rec.count, due: daysSince(rec.lastReview) }
})

// 排序：没复习过的排最前（due=Infinity），然后按上次复习最旧排
candidates.sort((a, b) => (b.due === Infinity) - (a.due === Infinity) || b.due - a.due)

// 今天挑 2 篇（复习间隔：已复习过且间隔不足 3 天的不选）
const pick = []
for (const c of candidates) {
  if (pick.length >= 2) break
  if (c.lastReview && c.due < 3) continue // 最近复习过的歇一歇
  pick.push(c)
}

// ---------- 更新复习日志 ----------
for (const p of pick) {
  const rec = reviewLog[p.file] || { lastReview: null, count: 0 }
  rec.lastReview = today
  rec.count += 1
  reviewLog[p.file] = rec
}
fs.writeFileSync(REVIEW_LOG, JSON.stringify(reviewLog, null, 2))

// ---------- 自动记日子：追加到 journal.md ----------
const lines = []
lines.push(`## ${today}`)
lines.push(`- 今日复习：${pick.map(p => p.title).join('；') || '无（都在新鲜期）'}`)
lines.push(`- 笔记总数：${notes.length} 篇；已复习 ${Object.keys(reviewLog).length} 篇`)
lines.push('')
fs.appendFileSync(JOURNAL, lines.join('\n'))

// ---------- 输出 ----------
console.log(`今天是 ${today}，复习调度完成：`)
if (pick.length) {
  for (const p of pick) {
    const stat = p.count > 0 ? `（第 ${p.count + 1} 次复习，距上次 ${p.due === Infinity ? '从未' : p.due + ' 天'}）` : '（首次复习）'
    console.log(`  📖 ${p.title} ${stat}`)
  }
} else {
  console.log('  🌿 所有笔记都在新鲜期，今天歇着，明天再来。')
}
console.log(`日记已记入 journal.md（累计 ${today} 条）`)
