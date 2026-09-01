/**
 * 知识落库脚本（迁移集成 · 3b）
 *
 * 把新 Gina 的两套知识（市场危机案例 + 投资书籍/技术/股神案例）导入：
 *   1) jarvis.db `memories` 表 —— event_type='knowledge'，只增量写入（mem_id 幂等），绝不 UPDATE/DELETE 已有记忆；
 *   2) CATS-Net 抽象空间 —— 注册概念节点与连接，并把每条知识投影为记忆痕迹；
 *   3) 保存 CATS-Net 快照到 data/gina-knowledge-brain.json（供 brain.js 启动时加载）。
 *
 * 运行方式（需在 Electron 环境下，因为 better-sqlite3 为 Electron ABI）：
 *   ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/seed-knowledge.js [数据目录]
 * 缺省数据目录 = 新 Gina 的 data 目录。
 */

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

import { CatsNet, ConceptNode } from '@berrysu/gina-core/cats_net'
import { insertMemory } from '../src/capabilities/db.js'

const DEFAULT_DATA_DIR = '/Users/ahs/Desktop/gina增加计划登记/data'
const DATA_DIR = process.argv[2] || DEFAULT_DATA_DIR

function loadJson(path) {
  if (!existsSync(path)) return null
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return null }
}

const crisis = loadJson(join(DATA_DIR, 'market-crises.json'))
const invest = loadJson(join(DATA_DIR, 'investment-knowledge.json'))

const brain = new CatsNet({ maxIterations: 200, timeoutMs: 10000 })

let conceptCount = 0
let linkCount = 0
let inserted = 0
let projected = 0

// 1) 注册概念节点 + 连接（两个文件合并）
for (const file of [crisis, invest]) {
  if (!file) continue
  for (const c of file.concepts ?? []) {
    if (!c?.id || brain.hasNode(c.id)) continue
    brain.addNode(new ConceptNode(c))
    conceptCount++
  }
}
for (const file of [crisis, invest]) {
  if (!file) continue
  for (const l of file.connections ?? []) {
    const from = brain.getNode(l.from)
    const to = brain.getNode(l.to)
    if (!from || !to) continue
    from.connect(l.to, l.weight ?? 1, l.type ?? 'association', true)
    linkCount++
  }
}

// 2) 写入统一记忆（jarvis.db knowledge 行）+ 投影 CATS-Net
function seedItem({ id, name, content, concepts, tags }) {
  const memId = `kn_${id}`
  // CATS-Net 记忆痕迹（抽象空间召回）
  try {
    brain.projectMemory({ id: memId, label: name, content, concepts, strength: 0.95 })
    projected++
  } catch { /* 忽略 */ }
  // jarvis.db 统一记忆（唯一持久化真源）
  try {
    insertMemory({
      event_type: 'knowledge',
      content,
      detail: '',
      title: name.slice(0, 60),
      mem_id: memId,
      concepts: concepts ?? [],
      tags: ['知识', ...(tags ?? [])],
      salience: 5,
      timestamp: new Date().toISOString(),
    })
    inserted++
  } catch (err) {
    console.log(`[seed] 写入 jarvis.db 失败(降级，可能非 Electron 环境): ${err.message}`)
  }
}

for (const c of crisis?.cases ?? []) {
  seedItem({
    id: c.id,
    name: `[市场案例] ${c.name}`,
    content: `[市场案例] ${c.name}（${c.year}年，${c.market}）｜分类：${c.category}｜触发：${c.trigger}｜影响：${c.impact}｜教训：${c.lesson}`,
    concepts: c.concepts ?? [],
    tags: [c.category ?? '', c.region ?? ''],
  })
}

for (const k of invest?.knowledge ?? []) {
  const prefix = k.type === 'book' ? '[书籍]' : k.type === 'technique' ? '[交易技术]' : '[股神案例]'
  const person = k.author ? `作者：${k.author}` : k.person ? `人物：${k.person}` : ''
  const points = (k.keyPoints ?? []).join('；')
  seedItem({
    id: k.id,
    name: `${prefix} ${k.name}`,
    content: `${prefix} ${k.name}｜${person}｜${k.summary ?? ''}｜要点：${points}`,
    concepts: k.concepts ?? [],
    tags: [k.category ?? '', '投资知识'],
  })
}

// 3) 保存 CATS-Net 快照
let snapshotPath = ''
try {
  snapshotPath = join(process.cwd(), 'data', 'gina-knowledge-brain.json')
  brain.save(snapshotPath)
} catch (err) {
  console.log(`[seed] 保存 CATS-Net 快照失败(降级): ${err.message}`)
}

console.log('SEED_DONE')
console.log(`concepts=${conceptCount} links=${linkCount}`)
console.log(`projected=${projected} jarb_db_inserted=${inserted}`)
console.log(`snapshot=${snapshotPath}`)