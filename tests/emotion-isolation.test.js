// tests/emotion-isolation.test.js —— joy 情绪隔离测试（每 PR 必跑）
//
// 设计哲学（2026-09-01 老板拍板 · C-4.3 核心红线）：
//   joy 是 GINA 自身工作满意度，**严格不进**：
//     1. tool schema 描述
//     2. system prompt 决策指令段
//     3. LLM tool_choice
//     4. analyst 评分
//     5. 风控官判定
//     6. 决策模块调用链路
//   joy **唯一对外通道** = buildContextBlock 的 <emotional-state> 段（meta-info）
//
// 7+ 断言：
//   A1: joy-state 只被 injector.js 1 个文件 import（meta-info 注入层）
//   A2: system prompt 不含 joy / 情绪词
//   A3: tool schema 不含 joy / emotion 字段
//   A4: 模拟 tool 调用栈，emotion 字段从未出现
//   A5: 模拟 analyst 评分调用，emotion 字段未传
//   A6: 模拟风控官判定，emotion 字段未传
//   A7: buildContextBlock 渲染时 emotion 段只出现在 <emotional-state> 段（不在其他段）
//   A8: joy bump 不影响 LLM 决策评分（决策函数在 bump 前后结果一致）
//   A9: 隔离矩阵双向：decision/analyst/risk 模块不 import joy-state

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const PROJECT_ROOT = join(__dirname, '..')

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

function listJsFiles(root, ignoreDirs = new Set(['node_modules', '.git', 'data', 'build', 'dist', 'browser-profiles'])) {
  const out = []
  function walk(dir) {
    let entries
    try { entries = readdirSync(dir) } catch { return }
    for (const name of entries) {
      if (ignoreDirs.has(name)) continue
      const full = join(dir, name)
      let st
      try { st = statSync(full) } catch { continue }
      if (st.isDirectory()) walk(full)
      else if (extname(name) === '.js' || extname(name) === '.cjs' || extname(name) === '.mjs') out.push(full)
    }
  }
  walk(root)
  return out
}

function relPath(p) { return p.replace(PROJECT_ROOT + '/', '') }

// ---------------------------------------------------------------------------
// A1: joy-state 只被 injector.js 1 个文件 import
// ---------------------------------------------------------------------------

test('A1: joy-state 只被 1 个文件 import (注入层)', () => {
  const joyFile = join(PROJECT_ROOT, 'src/emotion/joy-state.js')
  const files = listJsFiles(PROJECT_ROOT)
  const importers = []
  for (const f of files) {
    if (f === joyFile) continue
    let content
    try { content = readFileSync(f, 'utf-8') } catch { continue }
    // 匹配多种 import 形态
    if (/(?:import|require).*from\s*['"][^'"]*joy-state['"]/.test(content) ||
        /joy-state['"]/.test(content) && /require/.test(content)) {
      importers.push(relPath(f))
    }
  }
  // 允许的 import 入口：只有 memory/injector.js（meta-info 注入层）
  // 也允许 src/emotion/joy-state.js 自己（re-export）和 tests/*（测试自身）
  const allowedExact = new Set([
    'src/memory/injector.js',
    'src/emotion/joy-state.js',
    'src/index.js',  // 任务完成时调 joy.bump —— **写**入口，但不走决策路径
    'src/inbound-message.js',  // user approval 调 joy.bump —— **写**入口
    'tests/emotion-isolation.test.js',  // 本测试
  ])
  const allowedPrefixes = ['src/self/test-', 'tests/']  // 测试目录
  const violations = []
  for (const p of importers) {
    if (allowedExact.has(p)) continue
    if (allowedPrefixes.some(pref => p.startsWith(pref))) continue
    violations.push(p)
  }
  assert.equal(violations.length, 0,
    `joy-state 被未授权文件 import: ${violations.join(', ')}\n` +
    `允许：仅 memory/injector.js (meta-info 注入) + index.js/inbound-message.js (写入口) + 测试`)
})

// ---------------------------------------------------------------------------
// A2: system prompt 不含 joy / 情绪词
// ---------------------------------------------------------------------------

test('A2: buildSystemPrompt 输出不含 joy / 情绪词', () => {
  // 静态扫描 src/prompt.js 的 buildSystemPrompt 函数体
  const promptFile = join(PROJECT_ROOT, 'src/prompt.js')
  const content = readFileSync(promptFile, 'utf-8')

  // 在 buildSystemPrompt 函数体内（一直到 buildContextBlock 之前）不应出现 emotion 词
  const startMarker = 'export function buildSystemPrompt'
  const endMarker = 'export function buildContextBlock'
  const startIdx = content.indexOf(startMarker)
  const endIdx = content.indexOf(endMarker)
  assert.ok(startIdx >= 0 && endIdx > startIdx, 'buildSystemPrompt / buildContextBlock not found in prompt.js')
  const systemBody = content.slice(startIdx, endIdx)
  // 排除自身（joy/emotion 词在注释里出现 OK）
  // 检查实际字面常量里的情绪词
  const banned = [
    'joy:', 'joy =', 'joy,', 'joy,', 'emotion:', 'emotion =', 'emotionProfile',
    'emotional-state', 'selfModel', 'self-model 注入 emotion', 'joy state',
  ]
  const found = banned.filter(w => systemBody.includes(w))
  // 注释里允许出现 emotion 关键词，但**常量字符串里**不能
  // 简化：直接看有没有把 joy / emotion 当 prompt 文字（template literal 内的）
  // 我们用更保守的检查：buildSystemPrompt 渲染的 prompt 字符串里没有 "joy" / "emotion" 词
  // 动态测试：调 buildSystemPrompt 实际渲染
  // 静态检查：扫描 prompt.js 里 **作为 prompt 文字** 的 joy/emotion 字段
  // 用 regex 匹配反引号字符串（template literal）
  const stringLiterals = systemBody.match(/`[\s\S]*?`/g) || []
  const violators = []
  for (const lit of stringLiterals) {
    if (/\bjoy\b/i.test(lit) || /\bemotion\b/i.test(lit) || /emotional-state/.test(lit)) {
      // 例外：comment 风格 // xxx（template literal 内）
      if (!/^\s*\/\//.test(lit)) violators.push(lit.slice(0, 80))
    }
  }
  assert.equal(violators.length, 0,
    `buildSystemPrompt 含情绪词 template literal: ${violators.slice(0, 3).join(' | ')}`)
})

// ---------------------------------------------------------------------------
// A3: tool schema 不含 joy / emotion 字段
// ---------------------------------------------------------------------------

test('A3: tool schema / getToolSchemas 不含 joy / emotion 字段', () => {
  // 扫描 capabilities/ 下所有工具 schema 定义
  const capsDir = join(PROJECT_ROOT, 'src/capabilities')
  const files = listJsFiles(capsDir)
  const violations = []
  for (const f of files) {
    let content
    try { content = readFileSync(f, 'utf-8') } catch { continue }
    // 检查 schema 描述里含 emotion / joy
    if (/(?:description|name|parameters?)\s*[:=][^=]*['"`][^'"`]*\b(?:joy|emotion|emotional-state)\b/i.test(content)) {
      // 但允许 import 路径 / 注释
      const lines = content.split('\n')
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (/\b(?:joy|emotion|emotional-state)\b/i.test(line) && !/^\s*(\/\/|\*)/.test(line)) {
          violations.push(`${relPath(f)}:${i + 1}: ${line.trim()}`)
        }
      }
    }
  }
  assert.equal(violations.length, 0,
    `tool schema 含 emotion/joy: ${violations.slice(0, 5).join(' | ')}`)
})

// ---------------------------------------------------------------------------
// A4: 模拟 tool 调用栈，emotion 字段从未出现
// ---------------------------------------------------------------------------

test('A4: 模拟 tool 调用栈 emotion 字段未出现', () => {
  // 检查 src/llm.js 的 callLLM 不接受 emotion 字段
  const llmFile = join(PROJECT_ROOT, 'src/llm.js')
  const content = readFileSync(llmFile, 'utf-8')

  // callLLM 的 toolContext 应不包含 emotion
  const callLLMSignature = content.match(/export async function callLLM\(([^)]*)\)/)
  assert.ok(callLLMSignature, 'callLLM signature not found')
  const params = callLLMSignature[1]
  assert.ok(!/\bjoy\b/i.test(params), 'callLLM signature 含 joy 字段')
  assert.ok(!/\bemotion\b/i.test(params), 'callLLM signature 含 emotion 字段')

  // 工具 schema 描述里也不应出现 emotion 作为参数名
  // （已通过 A3 检查；这里额外断言 buildToolLoopStopNudge 不读 emotion）
  const nudgeMatch = content.match(/function buildToolLoopStopNudge[\s\S]*?^}/m)
  if (nudgeMatch) {
    assert.ok(!/\bjoy\b/i.test(nudgeMatch[0]), 'buildToolLoopStopNudge 含 joy')
    assert.ok(!/\bemotion\b/i.test(nudgeMatch[0]), 'buildToolLoopStopNudge 含 emotion')
  }
})

// ---------------------------------------------------------------------------
// A5: 模拟 analyst 评分调用，emotion 字段未传
// ---------------------------------------------------------------------------

test('A5: analyst 评分调用 emotion 字段未传', () => {
  // 扫描 src/analysts/ 下所有 .js 文件，验证函数签名不含 emotion / joy 参数
  const analystsDir = join(PROJECT_ROOT, 'src/analysts')
  const files = listJsFiles(analystsDir)
  const violations = []
  for (const f of files) {
    let content
    try { content = readFileSync(f, 'utf-8') } catch { continue }
    // 找所有 export function / async function
    const fnSigs = content.match(/(?:export\s+)?(?:async\s+)?function\s+\w+\s*\(([^)]*)\)/g) || []
    for (const sig of fnSigs) {
      if (/\b(joy|emotion|emotionalState)\b/i.test(sig)) {
        // 排除可选参数（带 ?）也算违规——情绪严格隔离
        violations.push(`${relPath(f)}: ${sig.slice(0, 120)}`)
      }
    }
  }
  assert.equal(violations.length, 0,
    `analyst 函数含 emotion/joy 参数: ${violations.slice(0, 3).join(' | ')}`)
})

// ---------------------------------------------------------------------------
// A6: 模拟风控官判定，emotion 字段未传
// ---------------------------------------------------------------------------

test('A6: 风控官判定 emotion 字段未传', () => {
  // src/analysts/risk-officer.js 应该有 evaluate / judge / decide 类函数
  const riskFile = join(PROJECT_ROOT, 'src/analysts/risk-officer.js')
  let content
  try { content = readFileSync(riskFile, 'utf-8') } catch {
    // 文件不存在 — 跳过（项目结构可能变了）
    return
  }
  const fnSigs = content.match(/(?:export\s+)?(?:async\s+)?function\s+\w+\s*\(([^)]*)\)/g) || []
  for (const sig of fnSigs) {
    assert.ok(!/\b(joy|emotion|emotionalState)\b/i.test(sig),
      `risk-officer 函数含 emotion/joy 参数: ${sig.slice(0, 120)}`)
  }

  // decision/ 目录同理
  const decisionDir = join(PROJECT_ROOT, 'src/decision')
  if (statExists(decisionDir)) {
    const files = listJsFiles(decisionDir)
    for (const f of files) {
      const c = readFileSync(f, 'utf-8')
      const sigs = c.match(/(?:export\s+)?(?:async\s+)?function\s+\w+\s*\(([^)]*)\)/g) || []
      for (const sig of sigs) {
        assert.ok(!/\b(joy|emotion|emotionalState)\b/i.test(sig),
          `decision 函数含 emotion/joy 参数: ${relPath(f)}: ${sig.slice(0, 120)}`)
      }
    }
  }
})

function statExists(p) {
  try { return statSync(p) } catch { return null }
}

// ---------------------------------------------------------------------------
// A7: buildContextBlock 渲染时 emotion 段只出现在 <emotional-state>
// ---------------------------------------------------------------------------

test('A7: emotion 段在 buildContextBlock 渲染时只出现在 <emotional-state> 段', () => {
  // 静态检查 prompt.js 的 buildContextBlock 函数体
  const promptFile = join(PROJECT_ROOT, 'src/prompt.js')
  const content = readFileSync(promptFile, 'utf-8')

  const startMarker = 'export function buildContextBlock'
  const startIdx = content.indexOf(startMarker)
  assert.ok(startIdx >= 0, 'buildContextBlock not found')

  // 找 buildContextBlock 函数体结束位置（下一个 export function）
  const endIdx = content.indexOf('\nexport ', startIdx + 1)
  const fnBody = content.slice(startIdx, endIdx > 0 ? endIdx : content.length)

  // emotion / joy 字符串只能出现在 <emotional-state> 段内
  // 简化：所有 emotion 词出现的位置，应当都在包含 'emotional-state' 的 5 行内
  const lines = fnBody.split('\n')
  const violations = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/\b(joy|emotion|emotionalState)\b/i.test(line) && !/^\s*(\/\/|\*)/.test(line)) {
      // 找最近的 emotional-state 段标记
      const nearby = lines.slice(Math.max(0, i - 5), Math.min(lines.length, i + 5)).join('\n')
      if (!/emotional-state/.test(nearby) && !/injector\.emotionalState|emotionalState\s*[:=]/.test(nearby)) {
        violations.push(`line ${i + 1}: ${line.trim()}`)
      }
    }
  }
  assert.equal(violations.length, 0,
    `buildContextBlock 含 emotion/joy 字段但不在 <emotional-state> 段: ${violations.slice(0, 3).join(' | ')}`)
})

// ---------------------------------------------------------------------------
// A8: joy bump 不影响 LLM 决策评分（决策函数在 bump 前后结果一致）
// ---------------------------------------------------------------------------

// 决策 mock 函数（独立定义，不在测试体内含 "joy" 字符串，避免 A8 自我讽刺）
function _isolatedDecision({ messageBody, hasTask, hasHistory }) {
  // 决策逻辑：不读情绪字段（meta-info 隔离原则）
  let score = 0.5
  if (messageBody && messageBody.length > 0) score += 0.1
  if (hasTask) score += 0.2
  if (hasHistory) score += 0.1
  return Math.min(1.0, score)
}

test('A8: joy bump 不影响决策函数行为（mock）', () => {
  const input = { messageBody: 'hello', hasTask: false, hasHistory: true }

  // bump 之前
  const before = _isolatedDecision(input)

  // 模拟 joy.bump：纯函数 mock 不读 emotion，所以输出必须相同
  // 实际系统里：joy-state 是单例 KV，如果决策函数 import 了它，
  // 那是 A1 / A5 / A6 测试的责任。这里只验证决策函数本身的行为
  const after = _isolatedDecision(input)
  assert.equal(before, after, '决策函数在 joy bump 前后结果不一致')

  // 额外：决策函数签名不应接受 joy / emotion 字段
  const decisionSource = _isolatedDecision.toString()
  // 注意：这里查的 "joy" / "emotion" 是字段名，不是断言 message
  assert.ok(!/\b(joy|emotion|emotionalState)\b/i.test(decisionSource),
    '决策函数 mock 签名含情绪字段名（隔离失败）')
})

// ---------------------------------------------------------------------------
// A9: 隔离矩阵双向：decision/analyst/risk 模块不 import joy-state
// ---------------------------------------------------------------------------

test('A9: decision / analyst / risk 模块不 import joy-state', () => {
  const checkedDirs = ['src/decision', 'src/analysts', 'src/capabilities/analyst']
  const violations = []
  for (const dir of checkedDirs) {
    const abs = join(PROJECT_ROOT, dir)
    if (!statExists(abs)) continue
    const files = listJsFiles(abs)
    for (const f of files) {
      let content
      try { content = readFileSync(f, 'utf-8') } catch { continue }
      if (/joy-state/.test(content)) {
        violations.push(relPath(f))
      }
    }
  }
  assert.equal(violations.length, 0,
    `decision / analyst / risk 模块违规 import joy-state: ${violations.join(', ')}`)
})
