/**
 * 分析师团队 —— 共享大脑引导 (brain.js)
 *
 * 所有分析师分身共享同一个 Gina 大脑（完美融合版）：
 *   - 同一个 CatsNet 抽象空间 + 同一个 MemoryHub 统一记忆（jarvis.db 真源 + CATS-Net 投影）；
 *   - 复用已植入的危机/投资知识，通过 KnowledgeAdvisor / MarketRegimeAdvisor 提供体系化依据。
 *   - MemoryHub 已把「个人记忆 + 知识记忆 + 抽象空间」合一，实现一套记忆、一个大脑。
 *
 * createSharedBrain() 复用外部传入的 catsNet / memoryManager（MemoryHub），未传入时新建；
 * 知识记忆由导入脚本写入 jarvis.db（event_type='knowledge'），概念网与投影痕迹保存为
 * data/gina-knowledge-brain.json（启动时自动加载）。
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { paths } from '../paths.js'

import { CatsNet } from '@berrysu/gina-core/cats_net'
import { MemoryHub } from '../memory-hub/index.js'
import { KnowledgeAdvisor, MarketRegimeAdvisor } from '../trading/index.js'

export function createSharedBrain({ brain = null, memoryManager = null } = {}) {
  let catsNet = brain
  if (!catsNet) {
    catsNet = new CatsNet({ maxIterations: 200, timeoutMs: 10000 })
    const snapshot = join(paths.dataDir, 'gina-knowledge-brain.json')
    if (existsSync(snapshot)) {
      try { catsNet.load(snapshot) } catch { /* 忽略损坏快照 */ }
    }
  }

  const mm = memoryManager ?? new MemoryHub({ catsNet })
  const knowledgeAdvisor = new KnowledgeAdvisor({ catsNet, memoryManager: mm })
  const regimeAdvisor = new MarketRegimeAdvisor({ catsNet, memoryManager: mm })
  return { catsNet, memoryManager: mm, knowledgeAdvisor, regimeAdvisor }
}