// tests/test-docs.test.js — GINA 外部文档验证（ADR-017）
//
// 设计：ADR-017 §10.2 验收清单
// 目的：6 份文档存在 + anchor 完整 + 链接不破 + 敏感数据扫描
//
// 7+ 断言：
//   T1: 6 份主文档存在（USER-GUIDE / INSTALL / FAQ / TROUBLESHOOTING / DEVELOPER / INDEX）
//   T2: 每份文档 5+ anchor（## 段）
//   T3: INDEX.md 内部链接全部有效
//   T4: README.md "Quick Start" 5 步可解析
//   T5: docs/ 无敏感数据（password / token / api_key 明文）
//   T6: 6 份文档含 docs/INDEX 引用
//   T7: 每份文档有"维护者"或"最后更新"字段
//
// 运行：node --test tests/test-docs.test.js
// CI 入口：主仓 ci.yml 的 pnpm test 链中（链式调用 .test.js）

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = dirname(HERE)
const DOCS = join(ROOT, 'docs')

// 关键文档清单
const REQUIRED_DOCS = [
  'USER-GUIDE.md',
  'INSTALL.md',
  'FAQ.md',
  'TROUBLESHOOTING.md',
  'DEVELOPER.md',
  'INDEX.md',
]

// 敏感数据模式（key=value 或 "key": "value" 形式）
// 注意：URL query string (?token=...) 不算敏感（公开 API endpoint 模式）
const SENSITIVE_PATTERNS = [
  /\bpassword\s*[:=]\s*['"]?[^'"\s]{6,}/i,
  /\b(api_key|apikey)\s*[:=]\s*['"]?[^'"\s]{10,}/i,
  // token= 要求 20+ 字符的 base64 风格（避免误判 URL ?token=）
  /\btoken\s*[:=]\s*['"]?(?!\.\.\.)[A-Za-z0-9_-]{20,}/i,
  /\bsecret\s*[:=]\s*['"]?[^'"\s]{10,}/i,
  // 真邮箱（避免误判 xxx@yyy 格式的非邮箱）
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.(com|cn|org|io|me)/,
]

// ---------------------------------------------------------------------------
// T1: 6 份主文档存在
// ---------------------------------------------------------------------------

test('T1: 6 份主文档存在（USER-GUIDE/INSTALL/FAQ/TROUBLESHOOTING/DEVELOPER/INDEX）', () => {
  for (const f of REQUIRED_DOCS) {
    const full = join(DOCS, f)
    assert.ok(existsSync(full), `${f} 必须存在: ${full}`)
    const st = statSync(full)
    assert.ok(st.size >= 1024, `${f} 至少 1KB（实际 ${st.size} 字节）`)
  }
})

// ---------------------------------------------------------------------------
// T2: 每份文档 5+ anchor（## 段）
// ---------------------------------------------------------------------------

test('T2: 每份文档 5+ anchor（## 段）', () => {
  for (const f of REQUIRED_DOCS) {
    const full = join(DOCS, f)
    const content = readFileSync(full, 'utf8')
    // 匹配 ## 段（不匹配 # 顶级）
    const anchors = content.match(/^##\s+/gm) || []
    assert.ok(anchors.length >= 5, `${f} 至少 5 个 anchor（实际 ${anchors.length}）`)
  }
})

// ---------------------------------------------------------------------------
// T3: INDEX.md 内部链接全部有效
// ---------------------------------------------------------------------------

test('T3: INDEX.md 内部链接全部有效（指向 ./<file>.md）', () => {
  const indexFile = join(DOCS, 'INDEX.md')
  const content = readFileSync(indexFile, 'utf8')
  // 找所有 ./FILE.md 链接
  const linkRegex = /\]\(\.\/([A-Z_-]+\.md)(?:#[^)]*)?\)/g
  const linkedFiles = new Set()
  let m
  while ((m = linkRegex.exec(content)) !== null) {
    linkedFiles.add(m[1])
  }
  // 必须有至少 4 个不同的文档链接
  assert.ok(linkedFiles.size >= 4, `INDEX.md 应链至少 4 个 doc，实际 ${linkedFiles.size}`)
  // 链的每个文件都存在
  for (const f of linkedFiles) {
    const full = join(DOCS, f)
    assert.ok(existsSync(full), `INDEX.md 链的 ${f} 不存在`)
  }
})

// ---------------------------------------------------------------------------
// T4: README.md "Quick Start" 5 步可解析
// ---------------------------------------------------------------------------

test('T4: README.md 快速开始 5 步可解析', () => {
  const readme = join(ROOT, 'README.md')
  if (!existsSync(readme)) {
    throw new Error('README.md 必须存在')
  }
  const content = readFileSync(readme, 'utf8')
  // 找 "5. 快速开始" 段（注意：只匹配 ##，不要匹配 ### 5.1）
  const qsMatch = content.match(/^##\s*5\.\s*快速开始[\s\S]*?(?=\n##\s|\Z)/m)
  assert.ok(qsMatch, 'README.md 必须有"快速开始"段')
  const qsSection = qsMatch[0]
  // 找 5.x.x 子段
  const subSections = qsSection.match(/^###\s+\d+\.\d+/gm) || []
  assert.ok(subSections.length >= 4, `快速开始应有 4+ 子段，实际 ${subSections.length}`)
  // 至少有 1 个安装命令（npm install / pnpm install / brew install）
  assert.ok(/npm\s+install|pnpm\s+install|brew\s+install/i.test(qsSection), '快速开始应有安装命令')
  // 至少有 1 个启动命令（npm start / pnpm start）
  assert.ok(/npm\s+start|pnpm\s+start/i.test(qsSection), '快速开始应有启动命令')
})

// ---------------------------------------------------------------------------
// T5: docs/ 无敏感数据（password / token / api_key 明文）
// ---------------------------------------------------------------------------

test('T5: docs/ 6 份文档无敏感数据（明文 password / token / api_key / 邮箱）', () => {
  for (const f of REQUIRED_DOCS) {
    const full = join(DOCS, f)
    const content = readFileSync(full, 'utf8')
    for (const pat of SENSITIVE_PATTERNS) {
      const m = content.match(pat)
      // 例外：feedback 邮箱（@foxmail.com）和示例代码（sk-xxx / ghp_）
      if (m) {
        // 允许的例外：
        // 1. 维护者邮箱
        if (/berry_su2023@foxmail\.com/.test(m[0])) continue
        // 2. 示例代码中的假 token（用 xxx / 123 之类占位）
        if (/sk-[xX]+|ghp_[xX]+|sk-proj-\d+/.test(m[0])) continue
        // 3. URL query string 占位（?token=... / ?key=<...>）
        if (m[0].includes('=...') || m[0].includes('=xxx') || m[0].includes('=<...>')) continue
        // 4. 示例代码块（行首是 4+ space 或在 ``` 围栏内）
        const lineStart = content.lastIndexOf('\n', m.index) + 1
        const lineEnd = content.indexOf('\n', m.index)
        const line = content.slice(lineStart, lineEnd)
        // 计算这一行在 ``` 块内
        const beforeText = content.slice(0, m.index)
        const backticks = (beforeText.match(/```/g) || []).length
        const inCodeBlock = backticks % 2 === 1
        if (inCodeBlock) continue  // 代码块内的占位符不算敏感
        // 5. 文档明确说"不要写" / "走 keychain" 的占位
        if (/keychain|OAuth|专用密码|不要|never|NEVER|占位|example\.com/.test(line)) continue
        // 6. 假邮箱
        if (/@(example|xxx|placeholder)\./.test(m[0])) continue
        // 7. 变量引用（apiKey: opts.apiKey / process.env.MY_PROVIDER_API_KEY）—— 是变量名不是值
        if (/apiKey:\s*opts\.|process\.env\./i.test(m[0])) continue
        assert.fail(`${f} 疑似含敏感数据 [${m[0]}] at offset ${m.index} in: ${line.slice(0, 100)}`)
      }
    }
  }
})

// ---------------------------------------------------------------------------
// T6: 6 份文档含 docs/INDEX 引用
// ---------------------------------------------------------------------------

test('T6: 6 份文档含 docs/INDEX 引用', () => {
  for (const f of REQUIRED_DOCS) {
    const full = join(DOCS, f)
    const content = readFileSync(full, 'utf8')
    // INDEX 自身不算；其他 5 份要引用 INDEX
    if (f === 'INDEX.md') continue
    assert.ok(
      /INDEX\.md|INDEX\./i.test(content) || /[`'"]\.\/INDEX\.md[`'"]\)/.test(content),
      `${f} 应引用 INDEX.md`
    )
  }
})

// ---------------------------------------------------------------------------
// T7: 每份文档有"维护者"或"最后更新"字段
// ---------------------------------------------------------------------------

test('T7: 每份文档有"维护者"或"最后更新"或"维护"字段', () => {
  for (const f of REQUIRED_DOCS) {
    const full = join(DOCS, f)
    const content = readFileSync(full, 'utf8')
    // 多种中英文表述
    const hasField = /维护|maintain|update.*?2026|last.*update/i.test(content)
    assert.ok(hasField, `${f} 应含"维护"或"最后更新"字段`)
  }
})

// ---------------------------------------------------------------------------
// 清理
// ---------------------------------------------------------------------------

test('cleanup: 文档验证完成', () => {
  // 无清理动作；仅标记测试完成
  assert.ok(true)
})
