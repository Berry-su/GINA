// BFS 扩散激活 —— 记忆系统缺口 #2
//
// 从种子记忆出发，沿实体 / 概念 / 标签 / 向量相似度四条边做 BFS 扩散，
// 拉出关联记忆，打破"搜一条只出一条"的孤立困境。
//
// 设计要点：
//   - 纯函数，无副作用，不写 DB
//   - 深度上限 2 层，每层分支度 ≤5，总量 ≤20
//   - 向量边用余弦相似度做权重（复用 embedding.js 的 computeEmbedding）
//   - 实体/概念/标签边优先（确定性高、开销小）
//   - 去重：同一条记忆只返回一次，种子记忆本身不重复输出
//
// 接入点：runInjector → 现有 merge 后 → BFS 扩散补充 → selectContextMemories

import { searchByEmbedding, searchMemories } from '../capabilities/db.js'

const DEFAULT_MAX_DEPTH = 2
const DEFAULT_MAX_BRANCHING = 5
const DEFAULT_TOTAL_LIMIT = 20

/**
 * BFS 扩散激活
 * @param {Array} seedMemories  - 种子记忆数组 (MemoryRow[])
 * @param {Object} opts
 * @param {number} opts.maxDepth      - BFS 最大深度，默认 2
 * @param {number} opts.maxBranching   - 每节点展开分支数上限，默认 5
 * @param {number} opts.totalLimit     - 总返回量上限，默认 20
 * @returns {Array} 扩散激活得到的记忆数组（不含种子），去重，按发现顺序排列
 */
export async function bfsSpreadActivation(seedMemories, {
  maxDepth = DEFAULT_MAX_DEPTH,
  maxBranching = DEFAULT_MAX_BRANCHING,
  totalLimit = DEFAULT_TOTAL_LIMIT,
} = {}) {
  if (!Array.isArray(seedMemories) || seedMemories.length === 0) return []

  const visited = new Set(seedMemories.map(m => m.id || m.mem_id).filter(Boolean))
  const results = []
  let frontier = [...seedMemories]

  for (let depth = 0; depth < maxDepth && results.length < totalLimit; depth++) {
    if (frontier.length === 0) break
    const nextFrontier = []
    for (const node of frontier) {
      if (results.length >= totalLimit) break
      const neighbors = await expandOneNode(node, {
        visited,
        maxBranching,
        remaining: totalLimit - results.length,
      })
      for (const n of neighbors) {
        const nid = n.id || n.mem_id
        if (nid && !visited.has(nid)) {
          visited.add(nid)
          results.push(n)
          nextFrontier.push(n)
        }
      }
    }
    frontier = nextFrontier
  }

  return results.slice(0, totalLimit)
}

/**
 * 从单个节点展开邻居
 * 每条边独立 try/catch，单边失败不影响其他边
 */
async function expandOneNode(node, { visited, maxBranching, remaining }) {
  if (remaining <= 0) return []
  const neighbors = []

  // ── 边 1：共享实体 ──
  try {
    const entities = parseArrayField(node.entities)
    for (const entity of entities.slice(0, 3)) {
      if (neighbors.length >= maxBranching) break
      const hits = searchMemories(entity, 2)
      for (const h of hits) {
        const hid = h.id || h.mem_id
        if (!hid || visited.has(hid)) continue
        neighbors.push(h)
        if (neighbors.length >= maxBranching) break
      }
    }
  } catch {
    // 实体边搜索失败，静默跳过
  }

  // ── 边 2：共享概念 ──
  if (neighbors.length < maxBranching) {
    try {
      const concepts = parseArrayField(node.concepts)
      for (const concept of concepts.slice(0, 3)) {
        if (neighbors.length >= maxBranching) break
        const hits = searchMemories(concept, 2)
        for (const h of hits) {
          const hid = h.id || h.mem_id
          if (!hid || visited.has(hid)) continue
          neighbors.push(h)
          if (neighbors.length >= maxBranching) break
        }
      }
    } catch {
      // 概念边搜索失败，静默跳过
    }
  }

  // ── 边 3：共享标签 ──
  if (neighbors.length < maxBranching) {
    try {
      const tags = parseArrayField(node.tags)
      for (const tag of tags.slice(0, 3)) {
        if (neighbors.length >= maxBranching) break
        const hits = searchMemories(tag, 2)
        for (const h of hits) {
          const hid = h.id || h.mem_id
          if (!hid || visited.has(hid)) continue
          neighbors.push(h)
          if (neighbors.length >= maxBranching) break
        }
      }
    } catch {
      // 标签边搜索失败，静默跳过
    }
  }

  // ── 边 4：向量相似度（仅当节点有 embedding 且还有配额） ──
  if (neighbors.length < maxBranching && node.embedding) {
    try {
      const vecNeighbors = searchByEmbedding(node.embedding, maxBranching - neighbors.length)
      for (const vn of vecNeighbors) {
        const vid = vn.id || vn.mem_id
        if (!vid || visited.has(vid)) continue
        // 阈值：_vecScore > 0.6 才视为有关联（比注入器的 0.3 更严格，避免噪声扩散）
        if ((vn._vecScore || 0) < 0.6) continue
        neighbors.push(vn)
        if (neighbors.length >= maxBranching) break
      }
    } catch {
      // 向量搜索失败静默吞掉，不影响其他边
    }
  }

  return neighbors.slice(0, maxBranching)
}

function parseArrayField(field) {
  if (Array.isArray(field)) return field
  if (!field) return []
  try {
    const parsed = JSON.parse(field)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    // 逗号分隔的字符串也算
    return String(field).split(',').map(s => s.trim()).filter(Boolean)
  }
}
