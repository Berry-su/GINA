// 记忆重放巩固 —— 记忆系统缺口 #1
//
// 定期翻出当天高重要性记忆，通过向量相似度找关联记忆，
// 反复激活强化，防止重要记忆随新信息涌入而淡忘。
//
// 机制：
//   1. 每 2 小时跑一次
//   2. 取出当天 salience ≥ 4 的记忆（或最近 24h 的 fact/knowledge）
//   3. 对每条种子记忆：
//      a. 用其 embedding 搜全库 top-K 语义相似记忆
//      b. 创建 consolidation_event 记录关联（种子↔关联）
//      c. 种子记忆 salience 微幅 +1（上限 5）
//   4. 状态持久化到 config key `memory_replay_state_v1`
//
// 约束：每轮最多加工 10 条，每条种子最多拉 3 条关联。
// 失败静默吞掉，不影响主流程。

import {
  getMemoriesByDateRange,
  searchByEmbedding,
  upsertMemoryByMemId,
  insertMemory,
  getConfig,
  setConfig,
} from '../capabilities/db.js'

const STATE_KEY = 'memory_replay_state_v1'
const RUN_INTERVAL_MS = 2 * 60 * 60 * 1000 // 2 小时
const BATCH_SIZE = 10
const MIN_SALIENCE = 4
const MAX_SALIENCE = 5
const MAX_ASSOC_PER_SEED = 3
const LOOKBACK_HOURS = 24

function defaultState() {
  return {
    version: 1,
    totalReplays: 0,
    lastRunAt: null,
    lastBatchSize: 0,
  }
}

function loadState() {
  try {
    const raw = getConfig(STATE_KEY)
    if (!raw) return defaultState()
    const parsed = typeof raw === 'object' ? raw : JSON.parse(raw)
    return { ...defaultState(), ...parsed }
  } catch {
    return defaultState()
  }
}

function saveState(state) {
  setConfig(STATE_KEY, JSON.stringify(state))
}

async function tick() {
  const state = loadState()
  const now = new Date()

  try {
    // 取当天 00:00 到现在
    const todayStart = new Date(now)
    todayStart.setHours(0, 0, 0, 0)
    const from = todayStart.toISOString()
    const to = now.toISOString()

    // 第一条路：今天 salience ≥ MIN_SALIENCE 的
    let seeds = getMemoriesByDateRange(from, to, {
      limit: BATCH_SIZE,
      orderBy: 'COALESCE(salience, 3) DESC, timestamp DESC',
    })

    // 如果今天的高 salience 记忆不够，补最近 24h 的 fact/knowledge
    if (seeds.length < BATCH_SIZE) {
      const yesterdayStart = new Date(now.getTime() - LOOKBACK_HOURS * 3600 * 1000)
      const extraFrom = yesterdayStart.toISOString()
      const extraSeeds = getMemoriesByDateRange(extraFrom, to, {
        types: ['fact', 'knowledge'],
        limit: BATCH_SIZE - seeds.length,
        orderBy: 'timestamp DESC',
      })
      const seedIds = new Set(seeds.map(m => m.id))
      for (const m of extraSeeds) {
        if (!seedIds.has(m.id)) seeds.push(m)
      }
    }

    // 过滤：salience ≥ MIN_SALIENCE 或 embedding 非空
    seeds = seeds.filter(m => {
      const sal = Number(m.salience) || 3
      return sal >= MIN_SALIENCE || (m.embedding != null)
    }).slice(0, BATCH_SIZE)

    if (seeds.length === 0) {
      console.log('[记忆重放] 无候选记忆，跳过')
      return
    }

    console.log(`[记忆重放] 开始重放 ${seeds.length} 条种子记忆`)
    let replayed = 0

    for (const seed of seeds) {
      try {
        // 用种子 embedding 搜全库相似记忆
        let assoc = []
        if (seed.embedding) {
          assoc = searchByEmbedding(seed.embedding, MAX_ASSOC_PER_SEED + 1)
            .filter(m => (m.id || m.mem_id) !== (seed.id || seed.mem_id))
            .filter(m => (m._vecScore || 0) > 0.5)
            .slice(0, MAX_ASSOC_PER_SEED)
        }

        // 种子 salience 微幅提升
        const currentSal = Number(seed.salience) || 3
        if (currentSal < MAX_SALIENCE) {
          upsertMemoryByMemId({
            mem_id: seed.mem_id,
            event_type: seed.event_type,
            content: seed.content,
            title: seed.title,
            entities: seed.entities,
            concepts: seed.concepts,
            tags: seed.tags,
            salience: Math.min(currentSal + 1, MAX_SALIENCE),
            timestamp: seed.timestamp,
          })
        }

        // 为每条关联创建 consolidation_event
        for (const a of assoc) {
          try {
            insertMemory({
              event_type: 'consolidation_event',
              content: `重放关联: "${(seed.title || seed.content || '').slice(0, 60)}" ↔ "${(a.title || a.content || '').slice(0, 60)}"`,
              title: `replay_assoc_${Date.now()}`,
              entities: parseArrayField(seed.entities),
              concepts: parseArrayField(seed.concepts),
              tags: ['replay', 'auto_consolidation'],
              timestamp: now.toISOString(),
              parent_ref: seed.mem_id,
              salience: 2,
              links: [
                { target_id: seed.mem_id || seed.id, relation: 'replay_source' },
                { target_id: a.mem_id || a.id, relation: 'replay_target' },
              ],
            })
          } catch {
            // 单条关联写入失败不中断整批
          }
        }

        replayed++
      } catch {
        // 单条种子失败不中断整批
      }
    }

    state.totalReplays += replayed
    state.lastRunAt = now.toISOString()
    state.lastBatchSize = seeds.length
    saveState(state)

    console.log(`[记忆重放] 完成，实际重放 ${replayed} 条`)
  } catch (err) {
    console.error('[记忆重放] 失败:', err)
  }
}

function parseArrayField(field) {
  if (Array.isArray(field)) return field
  if (!field) return []
  try {
    const parsed = JSON.parse(field)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return String(field).split(',').map(s => s.trim()).filter(Boolean)
  }
}

// ── 循环控制 ──

let started = false
let timer = null

export function startMemoryReplayLoop() {
  if (started) return
  started = true
  // 启动后等 10 分钟再跑第一次，避开启动密集期
  setTimeout(() => {
    tick()
    timer = setInterval(tick, RUN_INTERVAL_MS)
  }, 10 * 60 * 1000)
  console.log(`[记忆重放] 已注册，10 分钟后首次运行，之后每 ${RUN_INTERVAL_MS / 3600000} 小时一次`)
}

export function stopMemoryReplayLoop() {
  if (timer) { clearInterval(timer); timer = null }
  started = false
}

// 导出 tick 供测试用
export { tick as _tick }
