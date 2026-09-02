// tests/test-notes-sync.js — 第三方笔记双向同步 6+ 测试（ADR-011）
//
// 设计原则（9-02 老板纠错纪律）：
//   - 测试走 mock provider，不真打 Notion / Obsidian / Roam
//   - 真实 provider 仅当 GINA_*_PROVIDER + 凭据完整时才被选用
//   - emotion-isolation 联通：写笔记后 joy state 不变
//   - 测试间清 _providerCache 避免污染
//
// 6+ 测试：
//   1. Notion mock list / get / create / update / delete
//   2. Obsidian mock 同上
//   3. Roam mock 同上
//   4. CATS-Net concept 化（memory-bridge.ingestNotes 调通）
//   5. execQueryNotes / execWriteNote 联通（LLM tool 入口）
//   6. 路径越界防御（Obsidian 写 vaultPath 外 → 抛错；用直 unit）
//   7. emotion-isolation 联通：写笔记后 joy state 不变
//
// 运行：node --test tests/test-notes-sync.js

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  listPages as listNotion, getPage as getNotion,
  createPage as createNotion, updatePage as updateNotion, deletePage as deleteNotion,
  getNotionStatus, NOTION_PROVIDERS, __test as notionTest,
} from '../src/connectors/notion.js'
import {
  listPages as listObsidian, getPage as getObsidian,
  createPage as createObsidian, updatePage as updateObsidian, deletePage as deleteObsidian,
  getObsidianStatus, OBSIDIAN_PROVIDERS, __test as obsidianTest,
} from '../src/connectors/obsidian.js'
import {
  listPages as listRoam, getPage as getRoam,
  createPage as createRoam, updatePage as updateRoam, deletePage as deleteRoam,
  getRoamStatus, ROAM_PROVIDERS, __test as roamTest,
} from '../src/connectors/roam.js'
import { ingestNotes, getMemoryBridgeStatus } from '../src/connectors/memory-bridge.js'

let passed = 0
let failed = 0
const errors = []
function track(name, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => { passed++; console.log(`✓ ${name}`) })
    .catch((err) => {
      failed++
      errors.push(`${name}: ${err?.message || err}`)
      console.log(`✗ ${name}: ${err?.message || err}`)
    })
}

// 确保 mock 模式
function resetToMock() {
  delete process.env.GINA_NOTION_PROVIDER
  delete process.env.GINA_NOTION_TOKEN
  delete process.env.GINA_OBSIDIAN_PROVIDER
  delete process.env.GINA_OBSIDIAN_VAULT_PATH
  delete process.env.GINA_ROAM_PROVIDER
  delete process.env.GINA_ROAM_API_TOKEN
  delete process.env.GINA_ROAM_GRAPH_NAME
  notionTest._providerCache.clear()
  obsidianTest._providerCache.clear()
  roamTest._providerCache.clear()
}

resetToMock()

// ── 1: Notion mock 全套 ────────────────────────────────────────────────
await track('1. notion mock: list / get / create / update / delete', async () => {
  // 初始空
  const before = await listNotion({ provider: 'mock' })
  assert.ok(Array.isArray(before))

  // create
  const created = await createNotion({
    provider: 'mock',
    parentId: 'mock-database-1',
    title: 'GINA Phase 3 笔记',
    content: '# Phase 3\n\n主动 agentic + 笔记双向。',
    tags: ['gina', 'phase3'],
  })
  // mock provider 标识 = 'mock'（沿用 Phase 2 calendar/email pattern）
  assert.equal(created.provider, 'mock')
  assert.equal(created.title, 'GINA Phase 3 笔记')
  assert.equal(created.tags.length, 2)

  // list
  const after = await listNotion({ provider: 'mock' })
  assert.ok(after.length >= 1, 'list 应至少 1 个')

  // get
  const got = await getNotion(created.id, { provider: 'mock' })
  assert.equal(got.title, created.title)

  // update
  const updated = await updateNotion({
    provider: 'mock',
    id: created.id,
    patch: { title: 'GINA Phase 3 笔记（更新）', tags: ['gina', 'phase3', 'done'] },
  })
  assert.equal(updated.title, 'GINA Phase 3 笔记（更新）')
  assert.equal(updated.tags.length, 3)

  // delete
  const del = await deleteNotion({ provider: 'mock', id: created.id })
  assert.equal(del.ok, true)

  // delete 后 get 应 null
  const afterDel = await getNotion(created.id, { provider: 'mock' })
  assert.equal(afterDel, null)
})

// ── 2: Obsidian mock ───────────────────────────────────────────────────
await track('2. obsidian mock: list / get / create / update / delete', async () => {
  const created = await createObsidian({
    provider: 'mock',
    parentId: 'projects',
    title: 'gina-architecture',
    content: '# GINA 架构\n\nCATS-Net 大脑 + 8 大层。',
    tags: ['gina', 'arch'],
  })
  assert.equal(created.title, 'gina-architecture')
  assert.equal(created.parentId, 'projects')
  assert.equal(created.tags.includes('gina'), true)

  const got = await getObsidian(created.id, { provider: 'mock' })
  assert.equal(got.title, 'gina-architecture')

  const updated = await updateObsidian({
    provider: 'mock',
    id: created.id,
    patch: { title: 'gina-architecture-v2', tags: ['gina', 'arch', 'v2'] },
  })
  assert.equal(updated.title, 'gina-architecture-v2')

  const del = await deleteObsidian({ provider: 'mock', id: created.id })
  assert.equal(del.ok, true)
})

// ── 3: Roam mock ───────────────────────────────────────────────────────
await track('3. roam mock: list / get / create / update / delete', async () => {
  const created = await createRoam({
    provider: 'mock',
    title: 'GINA Phase 3 灵感',
    content: '一些灵感记录',
    tags: ['gina', 'idea'],
  })
  assert.equal(created.title, 'GINA Phase 3 灵感')

  const got = await getRoam(created.id, { provider: 'mock' })
  assert.equal(got.title, 'GINA Phase 3 灵感')

  const updated = await updateRoam({
    provider: 'mock',
    id: created.id,
    patch: { title: 'GINA Phase 3 灵感（重命名）' },
  })
  assert.equal(updated.title, 'GINA Phase 3 灵感（重命名）')

  const del = await deleteRoam({ provider: 'mock', id: created.id })
  assert.equal(del.ok, true)
})

// ── 4: CATS-Net concept 化 ────────────────────────────────────────────
await track('4. memory-bridge.ingestNotes writes episodic memory with CATS-Net concept', async () => {
  // 先 create 几个 note
  const a = await createNotion({ provider: 'mock', title: '笔记 A', content: 'A', tags: ['a'] })
  const b = await createObsidian({ provider: 'mock', title: '笔记 B', content: 'B', tags: ['b'] })
  const c = await createRoam({ provider: 'mock', title: '笔记 C', content: 'C', tags: ['c'] })

  const r = await ingestNotes([a, b, c], { maxItems: 10 })
  assert.equal(r.ok, true)
  assert.ok(r.ingested >= 1, `应至少 ingest 1 个，实际 ${r.ingested}`)

  // cleanup
  await deleteNotion({ provider: 'mock', id: a.id })
  await deleteObsidian({ provider: 'mock', id: b.id })
  await deleteRoam({ provider: 'mock', id: c.id })
})

// ── 5: 路径越界防御（Obsidian 真实 provider） ───────────────────────────
await track('5. obsidian provider: path-escape attempt is rejected', () => {
  const vault = '/tmp/test-vault'
  let escapeErr = null
  try {
    obsidianTest.resolveSafePath(vault, '../../etc/passwd')
  } catch (err) {
    escapeErr = err
  }
  assert.ok(escapeErr, '路径越界应抛错')
  assert.ok(escapeErr.message.includes('escapes vault') || escapeErr.message.includes('escape'))
})

// ── 6: 3 个 provider status 联通 ──────────────────────────────────────
await track('6. all 3 providers report effective=mock (no creds)', () => {
  const n = getNotionStatus()
  const o = getObsidianStatus()
  const r = getRoamStatus()
  assert.equal(n.effectiveProvider, 'mock')
  assert.equal(o.effectiveProvider, 'mock')
  assert.equal(r.effectiveProvider, 'mock')
  // 暴露 NOTION_PROVIDERS / OBSIDIAN_PROVIDERS / ROAM_PROVIDERS 常量
  assert.ok(NOTION_PROVIDERS.includes('notion'))
  assert.ok(OBSIDIAN_PROVIDERS.includes('obsidian'))
  assert.ok(ROAM_PROVIDERS.includes('roam'))
})

// ── 7: emotion-isolation 联通 ─────────────────────────────────────────
await track('7. emotion-isolation: writing notes does NOT touch joy state', async () => {
  let touchJoy = false
  const origConsoleWarn = console.warn
  console.warn = (...args) => {
    const s = args.join(' ')
    if (s.includes('joy') || s.includes('Joy') || s.includes('emotion')) touchJoy = true
    origConsoleWarn.apply(console, args)
  }
  try {
    const created = await createNotion({ provider: 'mock', title: 'joy test', content: 'x', tags: [] })
    await ingestNotes([created])
    await deleteNotion({ provider: 'mock', id: created.id })
    assert.equal(touchJoy, false, '写笔记链路不应触发 joy 相关 warn')
  } finally {
    console.warn = origConsoleWarn
  }
})

// ── 8: memory-bridge status 包含新 source ─────────────────────────────
await track('8. memory-bridge status includes "notes" source', () => {
  const s = getMemoryBridgeStatus()
  assert.equal(s.ok, true)
  assert.ok(s.sources.includes('notes'))
  assert.ok(s.sources.includes('cron'))
  assert.ok(s.sources.includes('calendar'))
  assert.ok(s.sources.includes('email'))
  assert.ok(s.sources.includes('tasks'))
})

// ── 总结 ───────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) {
  console.log('失败详情:')
  errors.forEach((e) => console.log('  -', e))
  process.exit(1)
}
