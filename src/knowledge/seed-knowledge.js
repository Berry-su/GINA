/**
 * 知识首启自动播种 (seed-knowledge.js)
 *
 * 打包/生产环境首次启动时，把随包分发的知识源（市场危机案例 + 投资书籍/技术/股神案例）
 * 落库并投影，确保生产环境也有知识，而无需用户手动跑脚本。
 *
 *   - 知识源：src/seed-data/{market-crises.json, investment-knowledge.json}（随 src/** 一起分发）
 *   - 落库 1：jarvis.db memories 表（event_type='knowledge'，mem_id=kn_xxx）
 *   - 落库 2：CATS-Net 抽象空间投影 + 快照 data/gina-knowledge-brain.json
 *
 * 幂等：配置标记 knowledge_seeded + 逐条 memoryExistsByMemId 双重保护，重复启动绝不产生重复记录。
 */

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { paths } from '../paths.js'
import { CatsNet, ConceptNode } from '../cats_net/index.js'
import { insertMemory, memoryExistsByMemId, getConfig, setConfig } from '../capabilities/db.js'

const SEED_FLAG = 'knowledge_seeded'

function loadJson(path) {
  if (!existsSync(path)) return null
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return null }
}

function seedItem(brain, { id, name, content, concepts, tags }, counters) {
  const memId = `kn_${id}`
  // 幂等：已存在则跳过，避免重复插入
  try {
    if (memoryExistsByMemId(memId)) return
  } catch { /* 数据库不可用时降级，交给下方 insertMemory 的 try/catch */ }

  // CATS-Net 记忆痕迹（抽象空间召回）
  try {
    brain.projectMemory({ id: memId, label: name, content, concepts, strength: 0.95 })
    counters.projected++
  } catch { /* 忽略投影失败 */ }

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
    counters.inserted++
  } catch (err) {
    console.log(`[seed] 写入 jarvis.db 失败(降级): ${err.message}`)
  }
}

/**
 * 首启播种知识（幂等）。
 * @param {object} [options]
 * @param {boolean} [options.force] 忽略已播种标记，强制重新播种
 * @returns {{seeded:boolean, reason?:string, conceptCount?:number, linkCount?:number, inserted?:number, projected?:number}}
 */
export function seedKnowledgeOnce({ force = false } = {}) {
  try {
    // 幂等门 1：配置标记
    if (!force) {
      try {
        if (getConfig(SEED_FLAG) === 'true') {
          return { seeded: false, reason: 'already-seeded' }
        }
      } catch { /* 数据库不可用则继续尝试 */ }
    }

    const crisis = loadJson(join(paths.resourcesDir, 'src', 'seed-data', 'market-crises.json'))
    const invest = loadJson(join(paths.resourcesDir, 'src', 'seed-data', 'investment-knowledge.json'))
    if (!crisis && !invest) {
      return { seeded: false, reason: 'no-seed-data' }
    }

    const brain = new CatsNet({ maxIterations: 200, timeoutMs: 10000 })
    const counters = { conceptCount: 0, linkCount: 0, inserted: 0, projected: 0 }

    // 1) 注册概念节点 + 连接（两个文件合并）
    for (const file of [crisis, invest]) {
      if (!file) continue
      for (const c of file.concepts ?? []) {
        if (!c?.id || brain.hasNode(c.id)) continue
        brain.addNode(new ConceptNode(c))
        counters.conceptCount++
      }
    }
    for (const file of [crisis, invest]) {
      if (!file) continue
      for (const l of file.connections ?? []) {
        const from = brain.getNode(l.from)
        const to = brain.getNode(l.to)
        if (!from || !to) continue
        from.connect(l.to, l.weight ?? 1, l.type ?? 'association', true)
        counters.linkCount++
      }
    }

    // 2) 写入统一记忆（jarvis.db knowledge 行）+ 投影 CATS-Net
    for (const c of crisis?.cases ?? []) {
      seedItem(brain, {
        id: c.id,
        name: `[市场案例] ${c.name}`,
        content: `[市场案例] ${c.name}（${c.year}年，${c.market}）｜分类：${c.category}｜触发：${c.trigger}｜影响：${c.impact}｜教训：${c.lesson}`,
        concepts: c.concepts ?? [],
        tags: [c.category ?? '', c.region ?? ''],
      }, counters)
    }
    for (const k of invest?.knowledge ?? []) {
      const prefix = k.type === 'book' ? '[书籍]' : k.type === 'technique' ? '[交易技术]' : '[股神案例]'
      const person = k.author ? `作者：${k.author}` : k.person ? `人物：${k.person}` : ''
      const points = (k.keyPoints ?? []).join('；')
      seedItem(brain, {
        id: k.id,
        name: `${prefix} ${k.name}`,
        content: `${prefix} ${k.name}｜${person}｜${k.summary ?? ''}｜要点：${points}`,
        concepts: k.concepts ?? [],
        tags: [k.category ?? '', '投资知识'],
      }, counters)
    }

    // 3) 保存 CATS-Net 快照（仅在确实新增知识时，避免覆盖已有快照）
    let snapshotPath = ''
    if (counters.inserted > 0) {
      try {
        snapshotPath = join(paths.dataDir, 'gina-knowledge-brain.json')
        brain.save(snapshotPath)
      } catch (err) {
        console.log(`[seed] 保存 CATS-Net 快照失败(降级): ${err.message}`)
      }
    }

    // 4) 标记已播种
    try { setConfig(SEED_FLAG, 'true') } catch { /* 忽略 */ }

    console.log(`[seed] 知识播种完成: concepts=${counters.conceptCount} links=${counters.linkCount} projected=${counters.projected} inserted=${counters.inserted}`)
    return { seeded: true, snapshotPath, ...counters }
  } catch (err) {
    console.warn(`[seed] 知识播种失败(降级): ${err.message}`)
    return { seeded: false, reason: 'error', error: err.message }
  }
}