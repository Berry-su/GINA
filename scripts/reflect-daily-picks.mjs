/**
 * 每日 pick 回看 · 实战→反思→蒸馏 (reflect-daily-picks.mjs)
 *
 * 「所有的模拟/实战是学习和反思，蒸馏学到的知识，反思失败的点。」
 * 本脚本把每日盘前 pick 的胜负回看一遍，反思失败点，并蒸馏成交易技能。
 *
 * 做法：
 *   1. 读 data/daily-logs/*.json 里的今日最该打（top）记录；
 *   2. 用 data/eval-klines.json（题材池全历史后复权日线）算每笔的后续 +1/+5 日收益；
 *   3. 汇总命中率/平均收益/失败单；把失败单的「进场理由 vs 结果」写进反思日志；
 *   4. 蒸馏一条稳定技能 skills/trading/（同名去重，不刷屏）。
 *
 * 用法：node scripts/reflect-daily-picks.mjs   （也由 start-trading.mjs 每日自动调用）
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateTradingSkill } from '../src/memory/trading-skill-generator.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const LOG_DIR = join(root, 'data', 'daily-logs')
const REFLECT_DIR = join(root, 'data', 'reflections')
const SKILLS_DIR = join(root, 'skills')

function loadKlines() {
  const p = join(root, 'data', 'eval-klines.json')
  if (!existsSync(p)) return {}
  const kd = JSON.parse(readFileSync(p, 'utf8'))
  const out = {}
  for (const [code, info] of Object.entries(kd)) {
    out[code] = (info.bars ?? []).slice().sort((a, b) => a.date.localeCompare(b.date))
  }
  return out
}

function fwdReturn(bars, entryDate, N) {
  const dkey = String(entryDate).replace(/-/g, '')
  let i = 0
  while (i < bars.length && bars[i].date < dkey) i++
  if (i >= bars.length) return null
  const j = i + N
  if (j >= bars.length) return null
  return bars[j].close / bars[i].close - 1
}

export function reflectDailyPicks() {
  const klines = loadKlines()
  const picks = []
  if (existsSync(LOG_DIR)) {
    for (const f of readdirSync(LOG_DIR)) {
      if (!f.endsWith('.json')) continue
      const rec = JSON.parse(readFileSync(join(LOG_DIR, f), 'utf8'))
      if (rec.top && rec.top.code && rec.date) picks.push({ ...rec.top, date: rec.date })
    }
  }
  picks.sort((a, b) => (a.date < b.date ? -1 : 1))

  const evaluated = []
  for (const p of picks) {
    const bars = klines[p.code]
    if (!bars) { evaluated.push({ ...p, pending: true, note: '无行情' }); continue }
    const f1 = fwdReturn(bars, p.date, 1)
    const f5 = fwdReturn(bars, p.date, 5)
    if (f1 == null || f5 == null) { evaluated.push({ ...p, pending: true, note: '后续数据未出' }); continue }
    evaluated.push({ ...p, fwd1, fwd5, win: f5 > 0 })
  }

  const done = evaluated.filter((e) => !e.pending)
  const wins = done.filter((e) => e.win).length
  const hit5 = done.length ? wins / done.length : null
  const fwd5s = done.map((e) => e.fwd5)
  const avgFwd5 = fwd5s.length ? fwd5s.reduce((s, x) => s + x, 0) / fwd5s.length : null
  const failures = done.filter((e) => !e.win)

  // 反思失败点：把每笔失败单的「进场理由 vs 结果」记录清楚
  const failureLog = failures.map((e) => ({
    code: e.code,
    name: e.name,
    date: e.date,
    theme: e.theme ?? '',
    fwd5: +(e.fwd5 * 100).toFixed(2),
    score: e.score,
    action: e.action,
    analyst: e.analyst ?? '',
  }))

  // 蒸馏：一条稳定技能（同名去重），内容随最新样本滚动更新
  let skillWritten = 0
  if (done.length) {
    const ok = avgFwd5 != null && avgFwd5 > 0
    generateTradingSkill({
      name: 'trading-daily-pick-review',
      description: `每日盘前 pick 回看：样本 ${done.length} 笔，+5日平均 ${avgFwd5 == null ? 'N/A' : (avgFwd5 * 100).toFixed(2)}%，命中率 ${(hit5 * 100).toFixed(0)}%`,
      when: ok
        ? '综合分达标（分析师共识 + 信息选时 + 攻击手）时才进场，样本验证为正则保持该纪律'
        : '样本验证为负或不足时，收紧入场、提高阈值，优先空仓等待',
      how: ok
        ? '继续「新闻→题材EMERGE选时→分析师共识→高弹性小票」每日盘前选股，只打综合分最高的候选'
        : '降低仓位/空仓；逐一复盘失败单的进场理由，把共同特征固化为不进场纪律',
      notes: [
        `命中 ${wins} / 失败 ${failures.length}`,
        ...failureLog.slice(0, 5).map((f) => `失败单 ${f.name}(${f.code}) ${f.date} ${f.theme} +5日${f.fwd5}%`),
      ],
    }, SKILLS_DIR)
    skillWritten = 1
  }

  const reflection = {
    generated: new Date().toISOString(),
    totalPicks: picks.length,
    evaluatedCount: done.length,
    pendingCount: evaluated.length - done.length,
    hit5: hit5 == null ? null : +hit5.toFixed(4),
    avgFwd5: avgFwd5 == null ? null : +(avgFwd5 * 100).toFixed(2),
    failureCount: failures.length,
    failures: failureLog,
    picks: evaluated.map((e) => ({
      code: e.code, name: e.name, date: e.date, theme: e.theme ?? '',
      fwd1: e.fwd1 == null ? null : +(e.fwd1 * 100).toFixed(2),
      fwd5: e.fwd5 == null ? null : +(e.fwd5 * 100).toFixed(2),
      win: e.win, action: e.action, analyst: e.analyst ?? '',
    })),
  }
  mkdirSync(REFLECT_DIR, { recursive: true })
  writeFileSync(join(REFLECT_DIR, `${new Date().toISOString().slice(0, 10)}.json`), JSON.stringify(reflection, null, 2), 'utf8')

  return { ...reflection, skillWritten }
}

function main() {
  const r = reflectDailyPicks()
  console.log('='.repeat(62))
  console.log('  每日 pick 反思回看（实战 → 反思 → 蒸馏）')
  console.log('='.repeat(62))
  console.log(`  累计 pick ${r.totalPicks} 笔 | 有后续数据 ${r.evaluatedCount} 笔 | 待验证 ${r.pendingCount} 笔`)
  if (r.evaluatedCount) {
    console.log(`  +5日命中率 ${(r.hit5 * 100).toFixed(0)}% | 平均+5日 ${r.avgFwd5}% | 失败 ${r.failureCount} 笔`)
    for (const f of r.failures.slice(0, 5)) console.log(`    失败单: ${f.name}(${f.code}) ${f.date} ${f.theme} +5日${f.fwd5}% · ${String(f.analyst).slice(0, 36)}`)
  }
  console.log(`  蒸馏技能 ${r.skillWritten} 条 → skills/trading/`)
  console.log(`  反思日志 → data/reflections/`)
  console.log('='.repeat(62))
}

if (process.argv[1] && process.argv[1].endsWith('reflect-daily-picks.mjs')) {
  main()
}