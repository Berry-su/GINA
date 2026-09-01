#!/usr/bin/env node
// scripts/smoke-experience-joy.mjs —— 经验库 + joy 情绪 端到端 demo
//
// 演示：
//   1. joy 情绪触发 / 隔离
//   2. 经验库 record → query → feedback 闭环
//   3. 跟 CATS-Net 联动
//   4. 跟 direction 联动
//
// 运行：GINA_USER_DIR=/tmp/gina-smoke-exp node scripts/smoke-experience-joy.mjs

import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { JoyState, resetJoyStateForTest, JOY_CONSTANTS } from '../src/emotion/joy-state.js'
import { ExperienceLibrary, resetExperienceLibraryForTest } from '../src/experience/library.js'
import { getDB, closeDBForTest } from '../src/db/connection.js'

const TEST_DIR = process.env.GINA_USER_DIR || mkdtempSync(join(tmpdir(), 'gina-smoke-exp-'))
process.env.GINA_USER_DIR = TEST_DIR

async function main() {
  console.log('=== GINA 经验库 + joy 端到端 demo ===\n')

  // ---------- 1. joy 情绪触发 ----------
  console.log('--- 1. joy 情绪触发 ---')
  resetJoyStateForTest()
  const joy = new JoyState()
  console.log(`初始: ${joy.get().toFixed(2)} (${(joy.get() * 100).toFixed(0)}%)`)
  console.log(`reason: ${JOY_CONSTANTS.DEFAULT_VALUE === joy.get() ? 'init' : 'unknown'}`)

  // 任务完成
  joy.bump({ amount: 0.2, reason: 'task_success' })
  console.log(`任务完成 +0.2: ${joy.get().toFixed(2)} (${(joy.get() * 100).toFixed(0)}%)`)

  // 用户认可
  joy.bump({ amount: 0.1, reason: 'user_approval' })
  console.log(`用户认可 +0.1: ${joy.get().toFixed(2)} (${(joy.get() * 100).toFixed(0)}%)`)

  // 任务失败
  joy.bump({ amount: -0.3, reason: 'task_failure' })
  console.log(`任务失败 -0.3: ${joy.get().toFixed(2)} (${(joy.get() * 100).toFixed(0)}%)`)

  // 注入 context
  console.log(`\n注入 context:\n${joy.injectFor()}\n`)

  // ---------- 2. 经验库 record / query / feedback ----------
  console.log('--- 2. 经验库 record / query / feedback ---')
  try { getDB().exec('DELETE FROM experience') } catch {}
  resetExperienceLibraryForTest()
  const exp = new ExperienceLibrary({ db: getDB() })

  // 录入
  const id1 = exp.record({
    trigger: '用户问 TUI 渠道的天气',
    action: '调 getWeather 工具',
    result: '成功返回 25°C 上海',
    learned: '对 TUI 用户直接调工具，不要问地点',
    confidence: 0.7,
    source: 'reflection',
    relatedConcepts: ['weather', 'tui_channel'],
  })
  console.log(`录入经验 #${id1}`)

  const id2 = exp.record({
    trigger: '用户问行情',
    action: '调 getStock 工具',
    result: '成功',
    learned: '股票查询用 ticker 字段',
    confidence: 0.6,
    source: 'manual',
    relatedConcepts: ['stock', 'ticker'],
  })
  console.log(`录入经验 #${id2}`)

  // 重复录入 → 合并
  const id3 = exp.record({
    trigger: '用户问 TUI 渠道的天气',
    action: '调 getWeather 工具',
    result: '又成功了',
    learned: '对 TUI 用户直接调工具',
    confidence: 0.8,
    source: 'reflection',
    relatedConcepts: ['weather', 'tui_channel'],
  })
  console.log(`重复 trigger 合并 → id ${id3} (应 = ${id1})`)

  // 查询
  console.log(`\n查询 "TUI 用户问天气":`)
  const r1 = exp.query({ currentContext: 'TUI 用户问天气' })
  for (const r of r1) {
    console.log(`  - id=${r.id} confidence=${r.confidence.toFixed(2)} use_count=${r.use_count}: ${r.learned}`)
  }

  // direction 加权
  console.log(`\n查询 + directionTopic="天气" 加权:`)
  const r2 = exp.query({ currentContext: 'TUI 用户问天气', directionTopic: '天气' })
  for (const r of r2) {
    console.log(`  - id=${r.id} relevance_score=${r.relevance_score.toFixed(2)} (vs base ${r.confidence.toFixed(2)})`)
  }

  // 反馈
  exp.feedback(id1, { worked: true })
  console.log(`\n反馈经验 #${id1} worked=true → 强化`)
  const after = exp.list().find(e => e.id === id1)
  console.log(`  confidence: ${after.confidence.toFixed(2)} (从 0.7 → ${after.confidence.toFixed(2)})`)

  exp.feedback(id1, { worked: false, better: '应该先用 llm 推断用户所在地' })
  console.log(`反馈经验 #${id1} worked=false, better=... → 弱化 + 新增经验`)
  const all = exp.list()
  console.log(`  当前经验数: ${all.length}`)

  // ---------- 3. 统计 ----------
  console.log('\n--- 3. 经验库统计 ---')
  console.log(JSON.stringify(exp.stats(), null, 2))

  // ---------- 4. 持久化验证 ----------
  console.log('\n--- 4. 重启后能读到吗？---')
  resetExperienceLibraryForTest()
  const exp2 = new ExperienceLibrary({ db: getDB() })
  const list = exp2.list()
  console.log(`新实例读到 ${list.length} 条经验`)

  // ---------- 5. joy 重启后 ----------
  console.log('\n--- 5. joy 重启后 ---')
  resetJoyStateForTest()
  const joy2 = new JoyState()
  console.log(`新实例 joy: ${joy2.get().toFixed(2)}`)

  closeDBForTest()
  try { rmSync(TEST_DIR, { recursive: true, force: true }) } catch {}

  console.log('\n=== PASS ===')
}

main().catch(err => {
  console.error('Smoke test failed:', err)
  process.exit(1)
})
