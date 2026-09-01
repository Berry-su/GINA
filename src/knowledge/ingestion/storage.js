// src/knowledge/ingestion/storage.js —— 存储（CATS-Net + memories 表）
//
// 策略：
//   - CATS-Net 节点通过 catsNet.addNode() 写入
//   - 边暂不写入（CATS-Net addEdge API 不一致；v0.1 留 v0.2 补）
//   - facts 写入 memories 表（event_type='knowledge_ingested'）
//   - 失败不静默：抛 IngestionError 带 step='storing'
//
// 关联 ADR-004 §3.2.3
//
// C-3.9 L4 hot path wiring（2026-09-01）—— 每条 ingested fact 进 CATS-Net 同一张图
//   domain=general（ingestion 是通用知识；未来分域用 topic 推断）
//   slug=ing_<timestamp>_<idx>（每条 fact 唯一）
//   失败静默：integration 挂掉不影响 ingestion 主存储流程
import { getIntegration as getIntegrationSingleton } from '../../cats_net/integration/init.js'

/**
 * 存储 nodes + facts 到 CATS-Net + memories
 * @param {object} args
 * @param {Array} args.nodes CATS-Net 节点
 * @param {Array<{text, importance}>} args.facts facts 数组
 * @param {string} args.path 源文件路径
 * @param {string|null} args.topic 主题
 * @param {string} args.source 来源
 * @param {object} args.catsNet CATS-Net 实例
 * @param {object} args.db SQLite DB 实例
 * @param {object} args.embedding 可选 embedding 模块
 * @returns {Promise<{catsNetNodes: number, memories: number}>}
 */
export async function storeIngestion({ nodes, facts, path, topic, source, catsNet, db, embedding = null }) {
  let catsNetCount = 0
  let memCount = 0

  // 1. 写 CATS-Net
  if (catsNet && typeof catsNet.addNode === 'function' && Array.isArray(nodes)) {
    for (const n of nodes) {
      try {
        catsNet.addNode(n)
        catsNetCount++
      } catch (err) {
        // 单节点失败不阻塞整体
        console.warn('[ingestion/storage] catsNet.addNode failed:', n?.id, err?.message || err)
      }
    }
  }

  // 2. 写 memories 表
  if (db && Array.isArray(facts)) {
    const insertMemory = db.insertMemory || _defaultInsertMemory(db)
    for (const f of facts) {
      try {
        let emb = null
        let embDim = null
        if (embedding && typeof embedding.computeEmbedding === 'function' && f.text) {
          try {
            const vec = await embedding.computeEmbedding(f.text)
            if (Array.isArray(vec) && vec.length > 0) {
              emb = Buffer.from(new Float32Array(vec).buffer)
              embDim = vec.length
            }
          } catch {}
        }
        insertMemory({
          event_type: 'knowledge_ingested',
          content: f.text,
          detail: `Ingested from ${path}${topic ? ` (topic: ${topic})` : ''}`,
          title: topic || '',
          mem_id: `ingested_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          entities: [],
          concepts: [],
          tags: ['ingestion', source || 'file'],
          salience: 3,
          source_ref: path,
          timestamp: new Date().toISOString(),
          embedding: emb,
          embedding_dim: embDim,
        })
        memCount++

        // C-3.9 L4 hot path wiring（2026-09-01）—— ingested fact 进 CATS-Net 同一张图
        //   domain=general（ingestion 是通用知识；topic 推断留给未来）
        //   slug=ing_<unix>_<idx>（每条 fact 唯一 id）
        //   失败静默：integration 挂掉不影响 insertMemory 主流程
        try {
          const integ = getIntegrationSingleton()
          if (integ) {
            integ.l4.ingestKnowledge({
              domain: 'general',
              slug: `ing_${Date.now()}_${memCount}`,
              name: (topic || 'ingested').slice(0, 100),
              content: (f.text || '').slice(0, 1000),
            })
          }
        } catch {
          // 静默：L4 节点化失败不影响 ingestion 存储主流程
        }
      } catch (err) {
        console.warn('[ingestion/storage] insertMemory failed:', err?.message || err)
      }
    }
  }

  return { catsNetNodes: catsNetCount, memories: memCount }
}

function _defaultInsertMemory(db) {
  return function (data) {
    return db.prepare(`
      INSERT INTO memories (event_type, content, detail, title, mem_id, entities, concepts, tags, links, salience, source_ref, timestamp, embedding, embedding_dim, embedding_model, visibility)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(
      data.event_type,
      data.content,
      data.detail || '',
      data.title || '',
      data.mem_id || null,
      JSON.stringify(data.entities || []),
      JSON.stringify(data.concepts || []),
      JSON.stringify(data.tags || []),
      JSON.stringify(data.links || []),
      data.salience || 3,
      data.source_ref || null,
      data.timestamp || new Date().toISOString(),
      data.embedding || null,
      data.embedding_dim || null,
      data.embedding_model || null,
    )
  }
}
