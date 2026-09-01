// src/knowledge/ingestion/grapher.js —— 图谱化（facts → CATS-Net 节点 + 边）
//
// 节点：每条 fact 一个 semantic-level 节点
// 边：concepts 共现 → 边（weight = 共现次数）
//
// 关联 ADR-004 §3.2.3

const CONCEPT_EDGE_THRESHOLD = 2  // 共现 ≥ 2 次才建边（避免噪声）

/**
 * facts → CATS-Net 节点 + 边
 * @param {Array<{chunkIndex, facts: [{text, importance}], concepts: string[]}>} distilled
 * @param {object} [opts]
 * @param {string} [opts.topic=null] 主题（direction 对齐用）
 * @param {number} [opts.directionBoost=0] direction 命中时的 confidence 提升
 * @returns {{nodes: Array, relations: Array}}
 */
export function graphFromFacts(distilled, { topic = null, directionBoost = 0 } = {}) {
  const nodes = []
  const relations = []
  // concept → [factId] 共现追踪
  const conceptOccurrences = new Map()

  for (const d of distilled) {
    if (d.error || !Array.isArray(d.facts)) continue
    for (let j = 0; j < d.facts.length; j++) {
      const f = d.facts[j]
      const factId = `fact_${d.chunkIndex}_${j}`
      const conf = Math.max(0, Math.min(1, (f.importance || 0.5) + directionBoost))
      nodes.push({
        id: factId,
        type: 'abstract',
        level: 'semantic',
        confidence: conf,
        attributes: {
          text: f.text,
          source: 'ingestion',
          chunkIndex: d.chunkIndex,
          topic: topic || null,
        },
      })
    }
    // 记录 concept 共现
    const concepts = Array.isArray(d.concepts) ? d.concepts : []
    for (const c of concepts) {
      if (!conceptOccurrences.has(c)) conceptOccurrences.set(c, [])
      conceptOccurrences.get(c).push({ chunkIndex: d.chunkIndex, factCount: d.facts.length })
    }
  }

  // 建 concept 节点 + 边
  for (const [concept, occurrences] of conceptOccurrences.entries()) {
    const conceptId = `concept_${_slug(concept)}`
    nodes.push({
      id: conceptId,
      type: 'abstract',
      level: 'semantic',
      confidence: 0.6 + directionBoost,
      attributes: {
        text: concept,
        source: 'ingestion_concept',
        topic: topic || null,
        occurrenceCount: occurrences.length,
      },
    })
    // 节点 fact 间 concept 共现 → 建边
    if (occurrences.length >= CONCEPT_EDGE_THRESHOLD) {
      // 同一 concept 跨多个 chunk 出现 → 建一条 self-loop 或连接到该 concept 节点
      relations.push({
        from: conceptId,
        to: conceptId,  // 自连接作为"高频出现"信号
        type: 'co_occurs',
        weight: occurrences.length,
      })
    }
  }

  return { nodes, relations }
}

function _slug(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'unnamed'
}
