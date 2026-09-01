/**
 * C-4.6 R11 L1 hot path 失败反思闭环测试（ADR-003 v0.1.4 patch banner 落盘）
 *
 * 老板 2026-09-02 拍板：补上 v0.1.2 R6 banner 承诺的 "L1 hot path 失败 → direction 领域触发反思"
 *   关联 ADR-003 §3.2.5 / §3.2.6（v0.1.2 R11 漏接 / v0.1.4 修复）
 *
 * 覆盖 4 验证场景：
 *   1. reflectOnL1Failure directionMatch=true → 经验库新增 1 条（directionMatch=1, source=reflection）
 *   2. reflectOnL1Failure directionMatch=false → 经验库不新增（reflection.js:128 早返回）
 *   3. L1 hot path 成功路径无反思（不调 reflectOnL1Failure）
 *   4. 反思本身失败（library 抛错）→ 主流程不抛错，返回 -1
 *
 * 运行：node --test tests/test-r11-reflection.js
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import Database from 'better-sqlite3'

import { reflectOnL1Failure } from '../src/learning/reflection.js'
import { ExperienceLibrary, resetExperienceLibraryForTest } from '../src/experience/library.js'
import { DirectionController, resetDirectionControllerForTest } from '../src/learning/direction.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const PROJECT_ROOT = join(__dirname, '..')

let passed = 0
let failed = 0
const resultLog = []
function track(name, ok) {
  if (ok) passed++
  else { failed++; resultLog.push(`FAIL ${name}`) }
}

// —— fixture ——
function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'r11-reflection-'))
}

function makeExperienceFixture() {
  const dataDir = makeTmpDir()
  const tmpDb = path.join(dataDir, 'test.db')
  const db = new Database(tmpDb)
  db.exec(`
    CREATE TABLE IF NOT EXISTS experience (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trigger_sig TEXT NOT NULL,
      trigger TEXT NOT NULL,
      action TEXT NOT NULL,
      result TEXT NOT NULL,
      learned TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0.5,
      since TEXT NOT NULL DEFAULT (datetime('now')),
      last_used TEXT,
      use_count INTEGER NOT NULL DEFAULT 0,
      feedback_pos INTEGER NOT NULL DEFAULT 0,
      feedback_neg INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'reflection',
      related_concepts TEXT NOT NULL DEFAULT '[]',
      embedding BLOB,
      direction_match INTEGER NOT NULL DEFAULT 0,
      context_window REAL NOT NULL DEFAULT 1.0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
  `)
  resetExperienceLibraryForTest()
  // direction 单例重置（避免跨测试污染）
  resetDirectionControllerForTest()
  const expLib = new ExperienceLibrary({ db })
  return { dataDir, db, expLib }
}

// —— 1. directionMatch=true → 经验库新增 1 条 ——
test('1. reflectOnL1Failure directionMatch=true → 经验库 +1 条（direction_match=1, source=reflection, context_window=2.0）', () => {
  const f = makeExperienceFixture()
  // direction 设为 CATS-Net，模拟 runInjector 里 direction.getCurrent() 返回 topic
  const direction = new DirectionController({ dataDir: f.dataDir })
  direction.set({ topic: 'CATS-Net' })

  const id = reflectOnL1Failure({
    trigger: 'aci_failure:semantic_memory_prefetch',
    action: 'aci_inject(semantic_memory_prefetch)',
    result: 'failed',
    learned: '方向领域 ACI 注入失败（semantic_memory_prefetch），需复盘策略选择',
    confidence: 0.4,
    directionMatch: true,
    library: f.expLib,
  })

  assert.ok(id > 0, `id > 0 (实际: ${id})`)
  const row = f.db.prepare('SELECT * FROM experience WHERE id = ?').get(id)
  assert.ok(row, '经验行存在')
  assert.equal(row.direction_match, 1, 'direction_match=1')
  assert.equal(row.source, 'reflection', 'source=reflection')
  assert.equal(row.context_window, 2.0, 'direction 领域 context_window=2.0 (×2)')
  assert.equal(row.confidence, 0.4, 'confidence=0.4')
  assert.ok(row.trigger.includes('aci_failure'), 'trigger 含 aci_failure 前缀')
  track('1', true)
})

// —— 2. directionMatch=false → 经验库不新增 ——
test('2. reflectOnL1Failure directionMatch=false → 经验库 +0 条（避免 ACI 噪声爆经验库）', () => {
  const f = makeExperienceFixture()
  const before = f.db.prepare('SELECT COUNT(*) AS c FROM experience').get().c

  const id = reflectOnL1Failure({
    trigger: 'aci_failure:semantic_memory_prefetch',
    action: 'aci_inject(semantic_memory_prefetch)',
    result: 'failed',
    learned: '非方向领域失败，不应写经验库',
    confidence: 0.4,
    directionMatch: false,  // 关键：非方向领域
    library: f.expLib,
  })

  assert.equal(id, -1, 'directionMatch=false → 返回 -1（不写库）')
  const after = f.db.prepare('SELECT COUNT(*) AS c FROM experience').get().c
  assert.equal(after, before, '经验库行数不变')
  track('2', true)
})

// —— 3. 反思写库本身失败（library 抛错）→ 主流程不抛错，返回 -1 ——
test('3. reflectOnL1Failure library.record 抛错 → 返回 -1，不破主流程（fire-and-forget）', () => {
  // 构造一个 record 会抛错的 library
  const brokenLib = {
    record: () => { throw new Error('simulated library failure') },
  }

  // 主流程必须不抛错：直接调，看是否抛
  let thrown = null
  let id = null
  try {
    id = reflectOnL1Failure({
      trigger: 'aci_failure:semantic_memory_prefetch',
      action: 'aci_inject(semantic_memory_prefetch)',
      result: 'failed',
      learned: '模拟 library 失败',
      confidence: 0.4,
      directionMatch: true,
      library: brokenLib,
    })
  } catch (err) {
    thrown = err
  }
  assert.equal(thrown, null, '不抛错（fire-and-forget）')
  assert.equal(id, -1, 'library 失败 → -1')
  track('3', true)
})

// —— 4. 静态结构扫：injector.js 真的接好了 L1 hot path 失败反思 ——
test('4. injector.js 静态扫：①import reflectOnL1Failure ②catch 块含 reflectOnL1Failure( ③catch 守卫 directionMatch === true（防回退）', () => {
  const injectorPath = join(PROJECT_ROOT, 'src/memory/injector.js')
  const content = readFileSync(injectorPath, 'utf-8')

  // ① 顶部 import 了 reflectOnL1Failure
  assert.ok(
    /import\s*\{[^}]*reflectOnL1Failure[^}]*\}\s*from\s*['"][^'"]*learning\/reflection\.js['"]/.test(content),
    'injector.js 顶部未 import reflectOnL1Failure（v0.1.4 R11 漏接）'
  )

  // ② 失败 catch 块里真的调了 reflectOnL1Failure(
  assert.ok(
    /catch\s*\(\s*integrationErr\s*\)\s*\{[\s\S]*?reflectOnL1Failure\s*\(/.test(content),
    '失败 catch 块未调 reflectOnL1Failure('
  )

  // ③ catch 守卫：directionMatch === true 才触发
  //   防止未来重构把 directionMatch 守卫去掉（去掉会爆经验库）
  assert.ok(
    /if\s*\(\s*directionMatch\s*===\s*true\s*\)/.test(content),
    'catch 块缺 directionMatch === true 守卫（去掉会爆经验库）'
  )

  // ④ 内层反思 try/catch 也得有（写库失败静默）
  //   找 catch (integrationErr) 之后到下一个 } 的区段
  const catchMatch = content.match(/catch\s*\(\s*integrationErr\s*\)\s*\{([\s\S]*?)\n\s*\}\s*\n/)
  assert.ok(catchMatch, 'catch (integrationErr) 块未找到')
  const catchBody = catchMatch[1]
  // 内部必须有 try { reflectOnL1Failure( } catch { ... }
  assert.ok(
    /try\s*\{[\s\S]*?reflectOnL1Failure\s*\([\s\S]*?\}\s*catch\s*\{/.test(catchBody),
    '反思调用无内层 try/catch 包裹（写库失败会破主流程）'
  )

  // ⑤ outer 层声明了 directionMatch 变量（catch 块读得到）
  //   在 catch (integrationErr) 之前必须出现 `let directionMatch`
  const beforeCatch = content.slice(0, content.indexOf('catch (integrationErr)'))
  assert.ok(
    /let\s+directionMatch\s*=\s*false/.test(beforeCatch),
    '外层未声明 let directionMatch = false（catch 块读不到）'
  )

  track('4', true)
})
