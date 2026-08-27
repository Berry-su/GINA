/**
 * knowledge-distiller.js — 知识蒸馏引擎
 *
 * 核心功能：将原始经验蒸馏为结构化的"知识单元"
 * 设计原则：
 *   1. 不依赖 LLM，使用规则+统计方法
 *   2. 知识单元可被检索、验证、进化
 *   3. 支持知识的置信度追踪和衰减
 *
 * 知识类型：
 *   1. 事实知识：关于世界的陈述（可验证）
 *   2. 程序知识：如何做某事（操作流程）
 *   3. 策略知识：在特定情境下的最佳选择
 *   4. 偏好知识：用户的喜好和习惯
 */

import fs from 'fs'
import path from 'path'
import { queryExperiences, extractLearningPoints, EXPERIENCE_TYPES } from './experience-collector.js'
import { computeEmbedding, isEmbeddingConfigured, getEmbeddingTimeoutMs } from '../embedding.js'

const KNOWLEDGE_DIR = process.env.GINA_HOME
  ? path.join(process.env.GINA_HOME, 'knowledge')
  : path.join(process.env.HOME || '.', '.gina', 'knowledge')

const KNOWLEDGE_FILE = path.join(KNOWLEDGE_DIR, 'knowledge-base.jsonl')
const INDEX_FILE = path.join(KNOWLEDGE_DIR, 'knowledge-index.json')
const GRAPH_FILE = path.join(KNOWLEDGE_DIR, 'knowledge-graph.json')
const EMBEDDING_CACHE_FILE = path.join(KNOWLEDGE_DIR, 'knowledge-embeddings.json')

// 知识类型
const KNOWLEDGE_TYPES = {
  FACT: 'fact',
  PROCEDURE: 'procedure',
  STRATEGY: 'strategy',
  PREFERENCE: 'preference',
  INSIGHT: 'insight',
  RULE: 'rule',
}

// 知识状态
const KNOWLEDGE_STATUS = {
  ACTIVE: 'active',
  DEPRECATED: 'deprecated',
  VERIFIED: 'verified',
  EVOLVING: 'evolving',
}

/**
 * 初始化知识存储
 */
function ensureStorage() {
  try {
    if (!fs.existsSync(KNOWLEDGE_DIR)) {
      fs.mkdirSync(KNOWLEDGE_DIR, { recursive: true })
    }
    if (!fs.existsSync(KNOWLEDGE_FILE)) {
      fs.writeFileSync(KNOWLEDGE_FILE, '', 'utf8')
    }
    if (!fs.existsSync(INDEX_FILE)) {
      fs.writeFileSync(INDEX_FILE, JSON.stringify({
        total: 0,
        byType: {},
        byStatus: {},
        lastDistilled: null,
        sources: [],
      }, null, 2), 'utf8')
    }
    if (!fs.existsSync(GRAPH_FILE)) {
      fs.writeFileSync(GRAPH_FILE, JSON.stringify({
        nodes: [],
        edges: [],
        version: 1,
      }, null, 2), 'utf8')
    }
  } catch (e) {
    console.error('[知识蒸馏] 存储初始化失败:', e?.message)
  }
}

/**
 * 从经验中蒸馏知识（主入口）
 */
export function distillKnowledge({
  batchSize = 50,
  minConfidence = 0.5,
  context = {},
} = {}) {
  ensureStorage()

  const startTime = Date.now()
  const stats = {
    experiencesProcessed: 0,
    knowledgeCreated: 0,
    knowledgeUpdated: 0,
    knowledgeDeprecated: 0,
    duration_ms: 0,
  }

  // 1. 获取学习点
  const learningPoints = extractLearningPoints({
    limit: batchSize,
    minConfidence,
  })

  if (learningPoints.length === 0) {
    return {
      success: true,
      stats: { ...stats, duration_ms: Date.now() - startTime },
      message: '暂无新的学习点需要蒸馏',
    }
  }

  // 2. 对学习点进行分类和聚合
  const categorizedPoints = categorizeLearningPoints(learningPoints)
  const aggregatedPoints = aggregateSimilarPoints(categorizedPoints)

  // 3. 从聚合点中生成知识单元
  const newKnowledge = []
  const existingKnowledge = loadKnowledgeBase()

  for (const group of aggregatedPoints) {
    const knowledgeItem = generateKnowledgeFromGroup(group, context)
    if (knowledgeItem) {
      // 检查是否已存在（相似度检查）
      const match = findSimilarKnowledge(knowledgeItem, existingKnowledge)
      if (match) {
        // 更新现有知识
        const updated = updateExistingKnowledge(match, knowledgeItem)
        if (updated) {
          writeKnowledge(updated)
          stats.knowledgeUpdated++
        }
      } else {
        // 创建新知识
        knowledgeItem.id = `k_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        knowledgeItem.createdAt = Date.now()
        knowledgeItem.status = KNOWLEDGE_STATUS.ACTIVE
        writeKnowledge(knowledgeItem)
        newKnowledge.push(knowledgeItem)
        stats.knowledgeCreated++
      }
    }
  }

  // 4. 检查知识衰减
  const deprecatedCount = checkKnowledgeDecay(existingKnowledge)
  stats.knowledgeDeprecated = deprecatedCount

  // 5. 更新索引
  updateIndex(newKnowledge)

  // 6. 更新知识图谱
  if (newKnowledge.length > 0) {
    updateKnowledgeGraph(newKnowledge)
  }

  stats.experiencesProcessed = learningPoints.length
  stats.duration_ms = Date.now() - startTime

  return {
    success: true,
    stats,
    newKnowledge: newKnowledge.slice(0, 5), // 返回前5条作为摘要
  }
}

/**
 * 直接添加一条知识
 */
export function addKnowledge({
  type,
  content,
  confidence = 0.8,
  sources = [],
  tags = [],
  metadata = {},
} = {}) {
  ensureStorage()

  const knowledge = {
    id: `k_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: type || KNOWLEDGE_TYPES.INSIGHT,
    content,
    confidence,
    sources,
    tags,
    metadata: {
      domain: metadata.domain || 'general',
      specificity: metadata.specificity || 0.5,
      applicability: metadata.applicability || 'medium',
      ...metadata,
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: KNOWLEDGE_STATUS.ACTIVE,
    usageCount: 0,
    verificationCount: 0,
    lastUsed: null,
    evolutionHistory: [],
  }

  writeKnowledge(knowledge)
  return knowledge
}

/**
 * 加载向量缓存
 */
function loadEmbeddingCache() {
  try {
    if (fs.existsSync(EMBEDDING_CACHE_FILE)) {
      return JSON.parse(fs.readFileSync(EMBEDDING_CACHE_FILE, 'utf8'))
    }
  } catch {}
  return { vectors: {}, version: 1 }
}

/**
 * 保存向量缓存
 */
function saveEmbeddingCache(cache) {
  try {
    fs.writeFileSync(EMBEDDING_CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8')
  } catch {}
}

/**
 * 余弦相似度计算
 */
function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0
  let dotProduct = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i]
    normA += vecA[i] * vecA[i]
    normB += vecB[i] * vecB[i]
  }
  if (normA === 0 || normB === 0) return 0
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
}

/**
 * 异步计算并缓存知识项的向量
 */
async function computeKnowledgeEmbedding(knowledge) {
  if (!isEmbeddingConfigured()) return null
  
  const cache = loadEmbeddingCache()
  const kId = knowledge.id
  if (cache.vectors[kId]?.vector) {
    return new Float32Array(cache.vectors[kId].vector)
  }
  
  try {
    const contentText = typeof knowledge.content === 'string'
      ? knowledge.content
      : JSON.stringify(knowledge.content)
    const text = contentText.slice(0, 512)
    const embedding = await computeEmbedding(text, false)
    if (embedding) {
      const vec = Array.from(new Float32Array(embedding))
      cache.vectors[kId] = {
        vector: vec,
        computedAt: Date.now(),
        textHash: hashText(text),
      }
      saveEmbeddingCache(cache)
      return new Float32Array(vec)
    }
  } catch {}
  return null
}

function hashText(text) {
  let hash = 0
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return Math.abs(hash).toString(36)
}

/**
 * 语义检索（纯向量相似度）
 */
export async function semanticRetrieveKnowledge(message, {
  maxResults = 5,
  includeTypes = null,
  minSimilarity = 0.3,
} = {}) {
  ensureStorage()
  if (!message) return []
  
  const allKnowledge = loadKnowledgeBase()
  const cache = loadEmbeddingCache()
  
  let queryVector = null
  try {
    const embedding = await computeEmbedding(message, true)
    if (embedding) {
      queryVector = new Float32Array(embedding)
    }
  } catch {}
  
  if (!queryVector) {
    return retrieveRelevantKnowledge(message, { maxResults, includeTypes })
  }
  
  const scored = []
  
  for (const k of allKnowledge) {
    if (k.status !== KNOWLEDGE_STATUS.ACTIVE && k.status !== KNOWLEDGE_STATUS.VERIFIED) continue
    if (includeTypes && !includeTypes.includes(k.type)) continue
    
    let vector = null
    const cached = cache.vectors[k.id]
    if (cached?.vector) {
      vector = new Float32Array(cached.vector)
    }
    
    if (!vector) {
      const contentText = typeof k.content === 'string' ? k.content : JSON.stringify(k.content)
      try {
        const embedding = await computeEmbedding(contentText.slice(0, 512), false)
        if (embedding) {
          vector = new Float32Array(embedding)
          const newCache = loadEmbeddingCache()
          newCache.vectors[k.id] = {
            vector: Array.from(vector),
            computedAt: Date.now(),
          }
          saveEmbeddingCache(newCache)
        }
      } catch {}
    }
    
    if (vector) {
      const similarity = cosineSimilarity(queryVector, vector)
      if (similarity >= minSimilarity) {
        let score = similarity
        score *= (0.5 + k.confidence * 0.3)
        score *= (1 + k.usageCount * 0.05)
        scored.push({ knowledge: k, score: similarity, finalScore: score })
      }
    }
  }
  
  scored.sort((a, b) => b.finalScore - a.finalScore)
  
  for (const item of scored.slice(0, maxResults)) {
    incrementUsage(item.knowledge.id)
  }
  
  return scored.slice(0, maxResults).map(item => item.knowledge)
}

/**
 * 检索相关知识（混合模式：向量语义 + 关键词匹配）
 */
export async function retrieveRelevantKnowledgeHybrid(message, {
  maxResults = 5,
  includeTypes = null,
  semanticWeight = 0.6,
  keywordWeight = 0.4,
} = {}) {
  ensureStorage()
  if (!message) return []
  
  const allKnowledge = loadKnowledgeBase()
  const messageKeywords = extractKeywords(message)
  const messageLower = message.toLowerCase()
  const cache = loadEmbeddingCache()
  
  let queryVector = null
  if (isEmbeddingConfigured()) {
    try {
      const embedding = await computeEmbedding(message, true)
      if (embedding) queryVector = new Float32Array(embedding)
    } catch {}
  }
  
  const scored = new Map()
  
  for (const k of allKnowledge) {
    if (k.status !== KNOWLEDGE_STATUS.ACTIVE && k.status !== KNOWLEDGE_STATUS.VERIFIED) continue
    if (includeTypes && !includeTypes.includes(k.type)) continue
    
    let keywordScore = 0
    
    const contentText = typeof k.content === 'string' ? k.content : JSON.stringify(k.content)
    const knowledgeKeywords = extractKeywords(contentText)
    for (const kw of messageKeywords) {
      if (knowledgeKeywords.includes(kw)) keywordScore += 2
    }
    
    if (k.tags && Array.isArray(k.tags)) {
      for (const tag of k.tags) {
        const tagLower = tag.toLowerCase()
        for (const kw of messageKeywords) {
          if (tagLower === kw) keywordScore += 5
          else if (tagLower.includes(kw) || kw.includes(tagLower)) keywordScore += 3
        }
        if (messageLower.includes(tagLower)) keywordScore += 4
      }
    }
    
    if (k.metadata) {
      const domain = k.metadata.domain?.toLowerCase() || ''
      for (const kw of messageKeywords) {
        if (domain.includes(kw)) keywordScore += 3
      }
    }
    
    if (messageLower.length >= 2) {
      const contentLower = contentText.toLowerCase()
      for (const kw of messageKeywords) {
        if (kw.length >= 2 && contentLower.includes(kw)) keywordScore += 1
      }
    }
    
    let semanticScore = 0
    if (queryVector) {
      let vector = null
      const cached = cache.vectors[k.id]
      if (cached?.vector) {
        vector = new Float32Array(cached.vector)
      }
      
      if (!vector) {
        try {
          const embedding = await computeEmbedding(contentText.slice(0, 512), false)
          if (embedding) {
            vector = new Float32Array(embedding)
            const newCache = loadEmbeddingCache()
            newCache.vectors[k.id] = {
              vector: Array.from(vector),
              computedAt: Date.now(),
            }
            saveEmbeddingCache(newCache)
          }
        } catch {}
      }
      
      if (vector) {
        semanticScore = cosineSimilarity(queryVector, vector)
      }
    }
    
    const normalizedKeywordScore = Math.min(keywordScore / 20, 1)
    const combinedScore = (normalizedKeywordScore * keywordWeight) + (semanticScore * semanticWeight)
    
    if (combinedScore > 0) {
      scored.set(k.id, { knowledge: k, score: combinedScore, keywordScore, semanticScore })
    }
  }
  
  const sorted = Array.from(scored.values()).sort((a, b) => b.score - a.score)
  
  for (const item of sorted.slice(0, maxResults)) {
    incrementUsage(item.knowledge.id)
  }
  
  return sorted.slice(0, maxResults).map(item => {
    const k = item.knowledge
    k._retrievalMeta = {
      score: item.score,
      keywordScore: item.keywordScore,
      semanticScore: item.semanticScore,
      hybrid: true,
    }
    return k
  })
}

/**
 * 查询知识库
 */
export function queryKnowledge({
  type = null,
  tag = null,
  domain = null,
  minConfidence = 0,
  status = null,
  limit = 20,
} = {}) {
  ensureStorage()

  const allKnowledge = loadKnowledgeBase()
  let results = []

  for (const k of allKnowledge) {
    if (type && k.type !== type) continue
    if (tag && !k.tags?.includes(tag)) continue
    if (domain && k.metadata?.domain !== domain) continue
    if (k.confidence < minConfidence) continue
    if (status && k.status !== status) continue
    results.push(k)
  }

  // 按置信度和使用次数排序
  return results
    .sort((a, b) => (b.confidence * (1 + b.usageCount * 0.1)) - (a.confidence * (1 + a.usageCount * 0.1)))
    .slice(0, limit)
}

/**
 * 智能检索相关知识（自动选择最优策略）
 * - embedding 可用 → 混合检索（语义60% + 关键词40%）
 * - embedding 不可用 → 关键词匹配
 */
export async function retrieveRelevantKnowledgeAuto(message, options = {}) {
  if (!message) return []
  
  if (isEmbeddingConfigured()) {
    return retrieveRelevantKnowledgeHybrid(message, options)
  } else {
    return retrieveRelevantKnowledge(message, options)
  }
}

/**
 * 检索相关知识（用于对话注入）- 关键词匹配版
 * @deprecated 建议使用 retrieveRelevantKnowledgeAuto 以获得更好的语义理解
 */
export function retrieveRelevantKnowledge(message, {
  maxResults = 5,
  includeTypes = null,
} = {}) {
  ensureStorage()

  if (!message) return []

  const allKnowledge = loadKnowledgeBase()
  const messageKeywords = extractKeywords(message)
  const messageLower = message.toLowerCase()

  const scored = []

  for (const k of allKnowledge) {
    if (k.status !== KNOWLEDGE_STATUS.ACTIVE && k.status !== KNOWLEDGE_STATUS.VERIFIED) continue
    if (includeTypes && !includeTypes.includes(k.type)) continue

    let score = 0

    // 1. 内容关键词匹配
    const contentText = typeof k.content === 'string'
      ? k.content
      : JSON.stringify(k.content)
    const knowledgeKeywords = extractKeywords(contentText)
    for (const kw of messageKeywords) {
      if (knowledgeKeywords.includes(kw)) score += 2
    }

    // 2. 标签匹配（高权重）
    if (k.tags && Array.isArray(k.tags)) {
      for (const tag of k.tags) {
        const tagLower = tag.toLowerCase()
        for (const kw of messageKeywords) {
          if (tagLower === kw) score += 5
          else if (tagLower.includes(kw) || kw.includes(tagLower)) score += 3
        }
        // 消息中直接包含标签
        if (messageLower.includes(tagLower)) score += 4
      }
    }

    // 3. 元数据匹配（domain + metadata 字段）
    if (k.metadata) {
      const domain = k.metadata.domain?.toLowerCase() || ''
      if (domain) {
        for (const kw of messageKeywords) {
          if (domain.includes(kw)) score += 3
        }
      }
      // 匹配 metadata.category
      const category = k.metadata.category?.toLowerCase() || ''
      if (category) {
        for (const kw of messageKeywords) {
          if (category.includes(kw)) score += 2
        }
      }
    }

    // 4. 内容子串匹配
    if (messageLower.length >= 2) {
      const contentLower = contentText.toLowerCase()
      // 检查消息中的关键词是否在内容中出现
      for (const kw of messageKeywords) {
        if (kw.length >= 2 && contentLower.includes(kw)) score += 1
      }
    }

    // 加权：置信度、使用次数
    score *= (0.5 + k.confidence * 0.3)
    score *= (1 + k.usageCount * 0.05)

    if (score > 0) {
      scored.push({ knowledge: k, score })
    }
  }

  // 按分数排序并返回
  scored.sort((a, b) => b.score - a.score)

  // 更新使用计数
  for (const item of scored.slice(0, maxResults)) {
    incrementUsage(item.knowledge.id)
  }

  return scored.slice(0, maxResults).map(item => item.knowledge)
}

/**
 * 验证知识（使用后调用，验证知识有效性）
 */
export function verifyKnowledge(knowledgeId, wasCorrect) {
  ensureStorage()

  const allKnowledge = loadKnowledgeBase()
  const index = allKnowledge.findIndex(k => k.id === knowledgeId)
  if (index === -1) return { success: false, error: '知识未找到' }

  const k = allKnowledge[index]
  k.verificationCount = (k.verificationCount || 0) + 1

  // 根据验证结果调整置信度
  if (wasCorrect) {
    k.confidence = Math.min(1, k.confidence + 0.1)
  } else {
    k.confidence = Math.max(0, k.confidence - 0.15)
    k.status = KNOWLEDGE_STATUS.EVOLVING
  }
  k.updatedAt = Date.now()

  writeKnowledge(k)
  return { success: true, knowledge: k }
}

/**
 * 获取知识图谱
 */
export function getKnowledgeGraph() {
  ensureStorage()
  try {
    return JSON.parse(fs.readFileSync(GRAPH_FILE, 'utf8'))
  } catch {
    return { nodes: [], edges: [], version: 1 }
  }
}

/**
 * 获取知识库统计
 */
export function getKnowledgeStats() {
  ensureStorage()
  try {
    const index = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'))
    return {
      total: index.total || 0,
      byType: index.byType || {},
      byStatus: index.byStatus || {},
      lastDistilled: index.lastDistilled,
      storagePath: KNOWLEDGE_FILE,
      graphNodeCount: getKnowledgeGraph().nodes.length,
      graphEdgeCount: getKnowledgeGraph().edges.length,
    }
  } catch (e) {
    return { total: 0, byType: {}, byStatus: {}, error: e?.message }
  }
}

// ========== 知识蒸馏核心逻辑 ==========

function categorizeLearningPoints(points) {
  const categories = {
    failure_patterns: [],
    success_patterns: [],
    user_preferences: [],
    efficiency_insights: [],
    domain_knowledge: [],
  }

  for (const point of points) {
    if (point.sourceType === 'failure') {
      categories.failure_patterns.push(point)
    } else if (point.sourceType === 'success') {
      categories.success_patterns.push(point)
    } else if (point.sourceType === 'user_feedback') {
      categories.user_preferences.push(point)
    } else if (point.sourceType === 'efficiency') {
      categories.efficiency_insights.push(point)
    } else {
      categories.domain_knowledge.push(point)
    }
  }

  return categories
}

function aggregateSimilarPoints(categorizedPoints) {
  const groups = []

  for (const [category, points] of Object.entries(categorizedPoints)) {
    if (points.length === 0) continue

    // 按内容相似度聚合
    const clusters = clusterBySimilarity(points)

    for (const cluster of clusters) {
      if (cluster.length >= 2 || isHighConfidenceCluster(cluster)) {
        groups.push({
          category,
          points: cluster,
          size: cluster.length,
          avgImportance: cluster.reduce((s, p) => s + (p.importance || 0.5), 0) / cluster.length,
          confidence: calculateClusterConfidence(cluster),
        })
      }
    }
  }

  return groups
}

function clusterBySimilarity(points) {
  const clusters = []
  const used = new Set()

  for (let i = 0; i < points.length; i++) {
    if (used.has(i)) continue

    const cluster = [points[i]]
    used.add(i)

    for (let j = i + 1; j < points.length; j++) {
      if (used.has(j)) continue
      if (calculateSimilarity(points[i], points[j]) > 0.6) {
        cluster.push(points[j])
        used.add(j)
      }
    }

    clusters.push(cluster)
  }

  return clusters
}

function calculateSimilarity(a, b) {
  if (!a || !b) return 0
  const textA = (a.insight || '').toLowerCase()
  const textB = (b.insight || '').toLowerCase()

  // 简单的词频重叠
  const wordsA = new Set(extractKeywords(textA))
  const wordsB = new Set(extractKeywords(textB))

  if (wordsA.size === 0 || wordsB.size === 0) return 0

  let overlap = 0
  for (const w of wordsA) {
    if (wordsB.has(w)) overlap++
  }

  return overlap / Math.min(wordsA.size, wordsB.size)
}

function isHighConfidenceCluster(cluster) {
  return cluster.some(p => p.importance > 0.8)
}

function calculateClusterConfidence(cluster) {
  const baseConfidence = cluster.reduce((s, p) => s + (p.importance || 0.5), 0) / cluster.length
  const sizeBonus = Math.min(0.2, (cluster.length - 1) * 0.05)
  return Math.min(1, baseConfidence + sizeBonus)
}

function generateKnowledgeFromGroup(group, context) {
  const { category, points, confidence } = group

  if (category === 'failure_patterns') {
    return generateFailureKnowledge(points, confidence, context)
  } else if (category === 'success_patterns') {
    return generateSuccessKnowledge(points, confidence, context)
  } else if (category === 'user_preferences') {
    return generatePreferenceKnowledge(points, confidence, context)
  } else if (category === 'efficiency_insights') {
    return generateEfficiencyKnowledge(points, confidence, context)
  } else {
    return generateInsightKnowledge(points, confidence, context)
  }
}

function generateFailureKnowledge(points, confidence, context) {
  const actionPatterns = new Set()
  const errorMessages = new Set()

  for (const p of points) {
    const match = p.insight.match(/操作 "([^"]+)" 失败/)
    if (match) actionPatterns.add(match[1])
    const errorMatch = p.insight.match(/原因：(.+)/)
    if (errorMatch) errorMessages.add(errorMatch[1])
  }

  if (actionPatterns.size === 0) return null

  return {
    type: KNOWLEDGE_TYPES.RULE,
    content: {
      pattern: Array.from(actionPatterns),
      errors: Array.from(errorMessages),
      recommendation: `避免以下操作模式：${Array.from(actionPatterns).join(', ')}`,
      category: 'failure_avoidance',
    },
    confidence,
    sources: points.map(p => p.sourceId),
    tags: ['failure', 'rule', 'avoidance'],
    metadata: {
      domain: 'error_prevention',
      specificity: 0.8,
      applicability: 'high',
      failureCount: points.length,
    },
  }
}

function generateSuccessKnowledge(points, confidence, context) {
  const successActions = new Set()
  const successResults = new Set()

  for (const p of points) {
    const match = p.insight.match(/操作 "([^"]+)" 成功/)
    if (match) successActions.add(match[1])
    const resultMatch = p.insight.match(/结果：(.+)/)
    if (resultMatch) successResults.add(resultMatch[1])
  }

  if (successActions.size === 0) return null

  return {
    type: KNOWLEDGE_TYPES.PROCEDURE,
    content: {
      successfulActions: Array.from(successActions),
      results: Array.from(successResults),
      recommendation: `优先使用以下操作：${Array.from(successActions).join(', ')}`,
      category: 'success_pattern',
    },
    confidence,
    sources: points.map(p => p.sourceId),
    tags: ['success', 'procedure', 'best_practice'],
    metadata: {
      domain: 'optimization',
      specificity: 0.7,
      applicability: 'high',
      successCount: points.length,
    },
  }
}

function generatePreferenceKnowledge(points, confidence, context) {
  const sentiments = []
  const topics = new Set()
  const contents = []

  for (const p of points) {
    sentiments.push(p.insight.match(/\((\w+)\)/)?.[1] || 'neutral')
    if (p.context) topics.add(p.context)
    const contentMatch = p.insight.match(/: (.+)/)
    if (contentMatch) contents.push(contentMatch[1])
  }

  const negativeCount = sentiments.filter(s => s === 'negative').length
  const positiveCount = sentiments.filter(s => s === 'positive').length

  if (negativeCount === 0 && positiveCount === 0) return null

  return {
    type: KNOWLEDGE_TYPES.PREFERENCE,
    content: {
      sentiment: negativeCount > positiveCount ? 'negative' : (positiveCount > negativeCount ? 'positive' : 'mixed'),
      topics: Array.from(topics),
      insights: contents.slice(0, 5),
      userRecommendation: generateUserRecommendation(sentiments, topics),
    },
    confidence,
    sources: points.map(p => p.sourceId),
    tags: ['user_preference', 'adaptation'],
    metadata: {
      domain: 'user_adaptation',
      specificity: 0.9,
      applicability: 'medium',
      sampleSize: points.length,
    },
  }
}

function generateEfficiencyKnowledge(points, confidence, context) {
  const tools = new Set()
  const slowTools = []

  for (const p of points) {
    const match = p.insight.match(/工具 "([^"]+)"/)
    if (match) {
      tools.add(match[1])
      const durationMatch = p.insight.match(/耗时 (\d+)ms/)
      if (durationMatch) {
        slowTools.push({ tool: match[1], duration: parseInt(durationMatch[1]) })
      }
    }
  }

  if (tools.size === 0) return null

  return {
    type: KNOWLEDGE_TYPES.STRATEGY,
    content: {
      tools: Array.from(tools),
      slowTools: slowTools.sort((a, b) => b.duration - a.duration),
      recommendation: generateEfficiencyRecommendation(slowTools),
      category: 'performance_optimization',
    },
    confidence,
    sources: points.map(p => p.sourceId),
    tags: ['efficiency', 'strategy', 'performance'],
    metadata: {
      domain: 'performance',
      specificity: 0.6,
      applicability: 'high',
      toolCount: tools.size,
    },
  }
}

function generateInsightKnowledge(points, confidence, context) {
  const insights = points.map(p => p.insight).slice(0, 5)

  return {
    type: KNOWLEDGE_TYPES.INSIGHT,
    content: {
      insights,
      summary: generateSummary(insights),
      category: 'general_insight',
    },
    confidence,
    sources: points.map(p => p.sourceId),
    tags: ['insight', 'general'],
    metadata: {
      domain: 'general',
      specificity: 0.5,
      applicability: 'medium',
    },
  }
}

function generateUserRecommendation(sentiments, topics) {
  if (topics.size === 0) return null
  const topicList = Array.from(topics)
  const avgSentiment = sentiments.filter(s => s === 'negative').length > sentiments.length / 2 ? 'negative' : 'positive'

  if (avgSentiment === 'negative') {
    return `用户在以下话题上表现出负面情绪：${topicList.join(', ')}，建议调整回应策略`
  } else if (avgSentiment === 'positive') {
    return `用户对以下话题感兴趣：${topicList.join(', ')}，可进一步深入`
  }
  return null
}

function generateEfficiencyRecommendation(slowTools) {
  if (slowTools.length === 0) return null
  const tools = slowTools.slice(0, 3)
  return `以下工具可能需要优化：${tools.map(t => `${t.tool}(${t.duration}ms)`).join(', ')}，考虑缓存或并行处理`
}

function generateSummary(insights) {
  if (insights.length === 0) return null
  return `基于${insights.length}个观察，主要发现：${insights[0].slice(0, 100)}`
}

// ========== 知识存储与检索 ==========

function loadKnowledgeBase() {
  ensureStorage()
  const knowledge = []
  try {
    const content = fs.readFileSync(KNOWLEDGE_FILE, 'utf8')
    const lines = content.trim().split('\n').filter(Boolean)
    for (const line of lines) {
      try {
        knowledge.push(JSON.parse(line))
      } catch {}
    }
  } catch {}
  return knowledge
}

function writeKnowledge(knowledge) {
  try {
    // 追加或更新
    const allKnowledge = loadKnowledgeBase()
    const index = allKnowledge.findIndex(k => k.id === knowledge.id)
    if (index >= 0) {
      allKnowledge[index] = knowledge
      fs.writeFileSync(KNOWLEDGE_FILE, allKnowledge.map(k => JSON.stringify(k)).join('\n'), 'utf8')
    } else {
      fs.appendFileSync(KNOWLEDGE_FILE, JSON.stringify(knowledge) + '\n', 'utf8')
    }
  } catch (e) {
    console.error('[知识蒸馏] 写入失败:', e?.message)
  }
}

function findSimilarKnowledge(newKnowledge, existingKnowledge) {
  if (!existingKnowledge || existingKnowledge.length === 0) return null

  for (const k of existingKnowledge) {
    if (k.type === newKnowledge.type) {
      const contentStr = typeof k.content === 'string' ? k.content : JSON.stringify(k.content)
      const newContentStr = typeof newKnowledge.content === 'string' ? newKnowledge.content : JSON.stringify(newKnowledge.content)
      const similarity = calculateTextSimilarity(contentStr, newContentStr)
      if (similarity > 0.7) {
        return k
      }
    }
  }
  return null
}

function updateExistingKnowledge(existing, newKnowledge) {
  existing.confidence = Math.min(1, (existing.confidence + newKnowledge.confidence) / 2 + 0.05)
  existing.sources = [...new Set([...(existing.sources || []), ...(newKnowledge.sources || [])])]
  existing.usageCount = (existing.usageCount || 0) + 1
  existing.updatedAt = Date.now()
  existing.status = KNOWLEDGE_STATUS.EVOLVING
  existing.evolutionHistory = existing.evolutionHistory || []
  existing.evolutionHistory.push({
    timestamp: Date.now(),
    action: 'merged',
    sourceCount: newKnowledge.sources?.length || 0,
  })

  // 合并内容
  if (existing.content && typeof existing.content === 'object' && newKnowledge.content) {
    existing.content = {
      ...existing.content,
      ...newKnowledge.content,
      _mergedAt: Date.now(),
    }
  }

  return existing
}

function checkKnowledgeDecay(existingKnowledge) {
  let deprecatedCount = 0
  const now = Date.now()
  const DECAY_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000 // 30天

  for (const k of existingKnowledge) {
    if (k.status === KNOWLEDGE_STATUS.ACTIVE) {
      const lastUsed = k.lastUsed || k.updatedAt || k.createdAt
      const usageCount = k.usageCount || 0

      // 如果30天没被使用过，且使用次数少，则降级
      if ((now - lastUsed) > DECAY_THRESHOLD_MS && usageCount < 3) {
        k.status = KNOWLEDGE_STATUS.DEPRECATED
        k.decayedAt = now
        writeKnowledge(k)
        deprecatedCount++
      }
    }
  }

  return deprecatedCount
}

function incrementUsage(knowledgeId) {
  const allKnowledge = loadKnowledgeBase()
  const k = allKnowledge.find(k => k.id === knowledgeId)
  if (k) {
    k.usageCount = (k.usageCount || 0) + 1
    k.lastUsed = Date.now()
    writeKnowledge(k)
  }
}

function updateIndex(newKnowledge) {
  try {
    let index = { total: 0, byType: {}, byStatus: {}, lastDistilled: null, sources: [] }
    if (fs.existsSync(INDEX_FILE)) {
      index = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'))
    }

    const allKnowledge = loadKnowledgeBase()
    index.total = allKnowledge.length
    index.byType = {}
    index.byStatus = {}

    for (const k of allKnowledge) {
      index.byType[k.type] = (index.byType[k.type] || 0) + 1
      index.byStatus[k.status] = (index.byStatus[k.status] || 0) + 1
    }

    index.lastDistilled = new Date().toISOString()
    index.sources = Array.from(new Set([...(index.sources || []), ...newKnowledge.map(k => k.type)]))

    fs.writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2), 'utf8')
  } catch (e) {
    console.error('[知识蒸馏] 索引更新失败:', e?.message)
  }
}

function updateKnowledgeGraph(newKnowledge) {
  try {
    const graph = JSON.parse(fs.readFileSync(GRAPH_FILE, 'utf8'))

    for (const k of newKnowledge) {
      // 添加节点
      graph.nodes.push({
        id: k.id,
        type: k.type,
        confidence: k.confidence,
        createdAt: k.createdAt,
        lastUpdated: k.updatedAt,
      })

      // 添加边（基于标签重叠）
      for (const existing of graph.nodes) {
        if (existing.id !== k.id && hasTagOverlap(existing, k)) {
          graph.edges.push({
            from: existing.id,
            to: k.id,
            type: 'related',
            weight: 0.5,
          })
        }
      }
    }

    // 限制图谱大小
    if (graph.nodes.length > 500) {
      // 移除最旧的节点
      graph.nodes.sort((a, b) => b.createdAt - a.createdAt)
      graph.nodes = graph.nodes.slice(0, 500)
      const validIds = new Set(graph.nodes.map(n => n.id))
      graph.edges = graph.edges.filter(e => validIds.has(e.from) && validIds.has(e.to))
    }

    graph.version = (graph.version || 1) + 1
    fs.writeFileSync(GRAPH_FILE, JSON.stringify(graph, null, 2), 'utf8')
  } catch (e) {
    console.error('[知识蒸馏] 图谱更新失败:', e?.message)
  }
}

function hasTagOverlap(nodeA, knowledge) {
  const tagsA = nodeA.tags || []
  const tagsB = knowledge.tags || []
  return tagsA.some(t => tagsB.includes(t))
}

// ========== 工具函数 ==========

function extractKeywords(text) {
  if (!text) return []
  // 简单的关键词提取：按空格和标点分割，取长度>=2的词
  const words = text.toLowerCase().split(/[\s,，。.!！?？;；:："'""''()（）\[\]【】]+/)
  const result = words.filter(w => w.length >= 2)

  // 额外提取中文关键词（2-4字的中文词组）
  const chineseKeywords = text.match(/[\u4e00-\u9fa5]{2,4}/g) || []
  for (const kw of chineseKeywords) {
    if (!result.includes(kw.toLowerCase())) {
      result.push(kw.toLowerCase())
    }
  }

  // 提取编程相关关键词
  const programmingTerms = [
    '代码', '编程', '重构', '调试', '性能', '优化', '算法', '数据结构',
    '设计模式', '测试', '函数', '变量', '类', '对象', '模块', '组件',
    '接口', 'api', '数据库', 'sql', '查询', '索引', '缓存', '异步',
    '并发', '多线程', '内存', '文件', '网络', '协议', '安全', '加密',
    'html', 'css', 'javascript', 'typescript', 'python', 'java', 'node',
    'react', 'vue', 'angular', 'docker', 'git', 'linux', 'shell', '命令行',
    'bug', '错误', '异常', '日志', '监控', '部署', '版本', '迭代',
    'code', 'programming', 'refactor', 'debug', 'performance', 'algorithm',
    'design pattern', 'function', 'variable', 'class', 'object', 'module',
    'test', 'database', 'async', 'concurrent', 'security', 'deploy'
  ]
  const lowerText = text.toLowerCase()
  for (const term of programmingTerms) {
    if (lowerText.includes(term.toLowerCase()) && !result.includes(term.toLowerCase())) {
      result.push(term.toLowerCase())
    }
  }

  return result
}

function calculateTextSimilarity(a, b) {
  const wordsA = new Set(extractKeywords(a))
  const wordsB = new Set(extractKeywords(b))

  if (wordsA.size === 0 || wordsB.size === 0) return 0

  let overlap = 0
  for (const w of wordsA) {
    if (wordsB.has(w)) overlap++
  }

  return overlap / Math.min(wordsA.size, wordsB.size)
}

export {
  KNOWLEDGE_TYPES,
  KNOWLEDGE_STATUS,
  KNOWLEDGE_DIR,
  KNOWLEDGE_FILE,
  INDEX_FILE,
  GRAPH_FILE,
}

// ============================================================
// 跨域知识关联系统 (Cross-Domain Knowledge Linking)
// ============================================================

// 域关系定义
const DOMAIN_RELATIONS = {
  technology: {
    relatedDomains: ['business', 'science', 'engineering'],
    bridgingConcepts: ['automation', 'optimization', 'scalability', 'integration'],
  },
  business: {
    relatedDomains: ['technology', 'finance', 'marketing', 'strategy'],
    bridgingConcepts: ['efficiency', 'growth', 'roi', 'strategy', 'market'],
  },
  finance: {
    relatedDomains: ['business', 'economics', 'technology'],
    bridgingConcepts: ['risk', 'investment', 'valuation', 'cashflow', 'return'],
  },
  science: {
    relatedDomains: ['technology', 'engineering', 'medicine'],
    bridgingConcepts: ['research', 'experiment', 'theory', 'methodology', 'analysis'],
  },
  engineering: {
    relatedDomains: ['technology', 'science', 'construction'],
    bridgingConcepts: ['design', 'implementation', 'testing', 'standards', 'safety'],
  },
  marketing: {
    relatedDomains: ['business', 'psychology', 'data_science'],
    bridgingConcepts: ['audience', 'campaign', 'conversion', 'branding', 'engagement'],
  },
  strategy: {
    relatedDomains: ['business', 'philosophy', 'economics'],
    bridgingConcepts: ['planning', 'decision', 'competitive', 'alignment', 'focus'],
  },
  psychology: {
    relatedDomains: ['marketing', 'education', 'neuroscience'],
    bridgingConcepts: ['behavior', 'cognition', 'motivation', 'learning', 'perception'],
  },
  economics: {
    relatedDomains: ['finance', 'business', 'politics'],
    bridgingConcepts: ['supply', 'demand', 'growth', 'inflation', 'policy'],
  },
  education: {
    relatedDomains: ['psychology', 'technology', 'research'],
    bridgingConcepts: ['learning', 'curriculum', 'assessment', 'pedagogy', 'training'],
  },
  medicine: {
    relatedDomains: ['science', 'biology', 'technology'],
    bridgingConcepts: ['diagnosis', 'treatment', 'prevention', 'health', 'clinical'],
  },
  law: {
    relatedDomains: ['policy', 'business', 'technology'],
    bridgingConcepts: ['regulation', 'compliance', 'rights', 'obligations', 'enforcement'],
  },
  policy: {
    relatedDomains: ['law', 'politics', 'economics'],
    bridgingConcepts: ['governance', 'regulation', 'framework', 'implementation', 'evaluation'],
  },
  data_science: {
    relatedDomains: ['technology', 'statistics', 'business'],
    bridgingConcepts: ['data', 'analysis', 'modeling', 'prediction', 'insight'],
  },
  philosophy: {
    relatedDomains: ['psychology', 'logic', 'ethics'],
    bridgingConcepts: ['ethics', 'reasoning', 'ontology', 'epistemology', 'wisdom'],
  },
  ethics: {
    relatedDomains: ['philosophy', 'law', 'technology'],
    bridgingConcepts: ['fairness', 'responsibility', 'accountability', 'transparency', 'justice'],
  },
}

// 跨域推理模板
const CROSS_DOMAIN_TEMPLATES = [
  {
    sourcePattern: 'technology.*solution',
    targetDomains: ['business', 'engineering'],
    inference: '技术解决方案可以通过提高效率或降低成本来创造商业价值',
    confidence: 0.8,
  },
  {
    sourcePattern: 'market.*analysis',
    targetDomains: ['strategy', 'finance'],
    inference: '市场分析结果可以指导战略制定和财务决策',
    confidence: 0.75,
  },
  {
    sourcePattern: 'user.*behavior',
    targetDomains: ['marketing', 'psychology'],
    inference: '用户行为数据可以揭示心理动机，指导营销策略',
    confidence: 0.7,
  },
  {
    sourcePattern: 'algorithm.*performance',
    targetDomains: ['engineering', 'data_science'],
    inference: '算法性能优化可以提升工程效率和数据处理能力',
    confidence: 0.85,
  },
  {
    sourcePattern: 'cost.*analysis',
    targetDomains: ['finance', 'strategy'],
    inference: '成本分析结果是财务规划和战略决策的重要依据',
    confidence: 0.8,
  },
  {
    sourcePattern: 'risk.*assessment',
    targetDomains: ['finance', 'policy'],
    inference: '风险评估结果可以指导投资决策和政策制定',
    confidence: 0.75,
  },
  {
    sourcePattern: 'data.*pattern',
    targetDomains: ['data_science', 'strategy'],
    inference: '数据模式发现可以带来新的商业洞察和战略机会',
    confidence: 0.8,
  },
  {
    sourcePattern: 'ethical.*consideration',
    targetDomains: ['ethics', 'policy', 'law'],
    inference: '伦理考量是制定政策和法律法规的重要基础',
    confidence: 0.7,
  },
]

// ------------------------------------------------------------
// 跨域知识关联分析
// ------------------------------------------------------------
export function analyzeCrossDomainRelations() {
  ensureStorage()
  try {
    const graph = JSON.parse(fs.readFileSync(GRAPH_FILE, 'utf8'))
    const knowledge = loadKnowledgeBase()

    const relations = []
    const domainClusters = new Map()

    // 按域分组
    for (const node of graph.nodes) {
      const k = knowledge.find(k => k.id === node.id)
      const domain = k?.metadata?.domain || 'general'
      if (!domainClusters.has(domain)) {
        domainClusters.set(domain, [])
      }
      domainClusters.get(domain).push(node)
    }

    // 分析域间关系
    const domains = Array.from(domainClusters.keys())
    for (let i = 0; i < domains.length; i++) {
      for (let j = i + 1; j < domains.length; j++) {
        const domainA = domains[i]
        const domainB = domains[j]

        const relation = analyzeDomainPair(domainA, domainB, graph, knowledge)
        if (relation) {
          relations.push(relation)
        }
      }
    }

    // 识别桥接概念
    const bridgingConcepts = identifyBridgingConcepts(domainClusters, knowledge)

    // 生成跨域洞察
    const insights = generateCrossDomainInsights(relations, bridgingConcepts, knowledge)

    return {
      success: true,
      relations,
      bridgingConcepts,
      insights,
      summary: {
        totalDomains: domains.length,
        crossDomainRelations: relations.length,
        bridgingConcepts: bridgingConcepts.length,
        insightsGenerated: insights.length,
      },
    }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

function analyzeDomainPair(domainA, domainB, graph, knowledge) {
  const relationA = DOMAIN_RELATIONS[domainA]
  const relationB = DOMAIN_RELATIONS[domainB]

  // 检查预定义的域关系
  const predefinedA = relationA?.relatedDomains?.includes(domainB)
  const predefinedB = relationB?.relatedDomains?.includes(domainA)

  if (!predefinedA && !predefinedB) {
    // 即使没有预定义关系，也检查实际的知识重叠
    const overlap = calculateDomainOverlap(domainA, domainB, knowledge)
    if (overlap < 0.3) return null
  }

  const bridgingA = relationA?.bridgingConcepts || []
  const bridgingB = relationB?.bridgingConcepts || []
  const commonBridging = bridgingA.filter(c => bridgingB.includes(c))

  const strength = predefinedA || predefinedB ? 0.8 : 0.5
  const confidence = commonBridging.length > 0 ? 0.9 : 0.6

  return {
    domains: [domainA, domainB],
    strength,
    confidence,
    sharedConcepts: commonBridging,
    relationType: predefinedA || predefinedB ? 'predefined' : 'derived',
    description: generateRelationDescription(domainA, domainB, commonBridging, strength),
  }
}

function calculateDomainOverlap(domainA, domainB, knowledge) {
  const knowledgeA = knowledge.filter(k => k.metadata?.domain === domainA)
  const knowledgeB = knowledge.filter(k => k.metadata?.domain === domainB)

  if (knowledgeA.length === 0 || knowledgeB.length === 0) return 0

  const tagsA = new Set(knowledgeA.flatMap(k => k.tags || []))
  const tagsB = new Set(knowledgeB.flatMap(k => k.tags || []))

  let overlap = 0
  for (const tag of tagsA) {
    if (tagsB.has(tag)) overlap++
  }

  return overlap / Math.min(tagsA.size, tagsB.size || 1)
}

function generateRelationDescription(domainA, domainB, sharedConcepts, strength) {
  const base = `${domainA} 和 ${domainB} 领域存在 ${strength > 0.7 ? '强' : '中等'} 关联`
  if (sharedConcepts.length > 0) {
    return `${base}，共享概念包括: ${sharedConcepts.slice(0, 3).join(', ')}`
  }
  return base
}

function identifyBridgingConcepts(domainClusters, knowledge) {
  const allTags = new Map() // tag → { domains: Set, count }

  for (const [domain, nodes] of domainClusters) {
    for (const node of nodes) {
      const k = knowledge.find(k => k.id === node.id)
      if (k?.tags) {
        for (const tag of k.tags) {
          if (!allTags.has(tag)) {
            allTags.set(tag, { domains: new Set(), count: 0 })
          }
          allTags.get(tag).domains.add(domain)
          allTags.get(tag).count++
        }
      }
    }
  }

  const bridgingConcepts = []
  for (const [tag, info] of allTags) {
    if (info.domains.size >= 2 && info.count >= 2) {
      bridgingConcepts.push({
        concept: tag,
        domains: Array.from(info.domains),
        frequency: info.count,
        bridgeStrength: Math.min(1, info.domains.size * 0.3 + info.count * 0.1),
      })
    }
  }

  return bridgingConcepts.sort((a, b) => b.bridgeStrength - a.bridgeStrength)
}

function generateCrossDomainInsights(relations, bridgingConcepts, knowledge) {
  const insights = []

  // 基于桥接概念生成洞察
  for (const concept of bridgingConcepts.slice(0, 10)) {
    const relatedKnowledge = knowledge.filter(k =>
      k.tags?.includes(concept.concept) &&
      k.status === KNOWLEDGE_STATUS.ACTIVE
    )

    if (relatedKnowledge.length >= 2) {
      const domains = new Set(relatedKnowledge.map(k => k.metadata?.domain).filter(Boolean))
      if (domains.size >= 2) {
        insights.push({
          type: 'bridging_opportunity',
          concept: concept.concept,
          domains: Array.from(domains),
          knowledgeCount: relatedKnowledge.length,
          insight: `概念「${concept.concept}」连接了 ${domains.size} 个领域，可能存在跨域整合机会`,
          potentialValue: concept.bridgeStrength,
          suggestedAction: generateCrossDomainAction(concept, relatedKnowledge),
        })
      }
    }
  }

  // 基于域关系生成洞察
  for (const relation of relations) {
    if (relation.sharedConcepts.length > 0 && relation.strength > 0.6) {
      insights.push({
        type: 'domain_synergy',
        domains: relation.domains,
        sharedConcepts: relation.sharedConcepts,
        insight: `${relation.domains[0]} 和 ${relation.domains[1]} 存在强协同关系，可探索交叉领域`,
        potentialValue: relation.strength,
        suggestedAction: generateSynergyAction(relation),
      })
    }
  }

  return insights
}

function generateCrossDomainAction(concept, relatedKnowledge) {
  const types = new Set(relatedKnowledge.map(k => k.type))
  if (types.has(KNOWLEDGE_TYPES.PROCEDURE) && types.has(KNOWLEDGE_TYPES.STRATEGY)) {
    return `基于「${concept.concept}」整合操作流程和策略知识，形成跨域方法论`
  } else if (types.has(KNOWLEDGE_TYPES.FACT)) {
    return `收集更多关于「${concept.concept}」的事实知识，加强跨域基础`
  }
  return `探索「${concept.concept}」在不同领域的应用可能性`
}

function generateSynergyAction(relation) {
  const [domainA, domainB] = relation.domains
  return `在 ${domainA} 和 ${domainB} 的交叉领域（${relation.sharedConcepts.slice(0, 2).join(', ')}）开展联合研究或项目`
}

// ------------------------------------------------------------
// 跨域知识图谱构建
// ------------------------------------------------------------
export function buildCrossDomainGraph() {
  ensureStorage()
  try {
    const graph = JSON.parse(fs.readFileSync(GRAPH_FILE, 'utf8'))
    const knowledge = loadKnowledgeBase()
    const crossDomainEdges = []

    // 基于预定义关系创建跨域边
    for (const [domain, config] of Object.entries(DOMAIN_RELATIONS)) {
      const domainKnowledge = knowledge.filter(k => k.metadata?.domain === domain)
      const relatedKnowledge = knowledge.filter(k =>
        config.relatedDomains.some(d => k.metadata?.domain === d)
      )

      for (const src of domainKnowledge) {
        for (const dst of relatedKnowledge) {
          if (src.id !== dst.id) {
            const sharedTags = (src.tags || []).filter(t => (dst.tags || []).includes(t))
            const sharedBridging = config.bridgingConcepts.some(c =>
              sharedTags.some(t => t.toLowerCase().includes(c.toLowerCase()))
            )

            const weight = sharedTags.length > 0 ? 0.5 + sharedTags.length * 0.1 : 0.3
            const edgeType = sharedBridging ? 'bridging' : 'related'

            crossDomainEdges.push({
              from: src.id,
              to: dst.id,
              type: edgeType,
              weight: Math.min(1, weight),
              domains: [domain, dst.metadata?.domain],
              sharedConcepts: sharedTags.slice(0, 3),
            })
          }
        }
      }
    }

    // 去重
    const existingEdges = new Set(graph.edges.map(e => `${e.from}->${e.to}`))
    const newEdges = crossDomainEdges.filter(e => !existingEdges.has(`${e.from}->${e.to}`))

    // 只保留高价值的跨域边
    const valuableEdges = newEdges.filter(e => e.weight >= 0.5).slice(0, 1000)

    graph.edges.push(...valuableEdges)
    graph.version = (graph.version || 1) + 1

    fs.writeFileSync(GRAPH_FILE, JSON.stringify(graph, null, 2), 'utf8')

    return {
      success: true,
      newCrossDomainEdges: valuableEdges.length,
      totalEdges: graph.edges.length,
      bridgingEdges: valuableEdges.filter(e => e.type === 'bridging').length,
      relatedEdges: valuableEdges.filter(e => e.type === 'related').length,
    }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

// ------------------------------------------------------------
// 跨域知识检索增强
// ------------------------------------------------------------
export async function enhancedCrossDomainSearch(query, options = {}) {
  ensureStorage()
  const {
    maxResults = 10,
    targetDomains = null,
    includeCrossDomain = true,
    minRelevance = 0.3,
  } = options

  // 首先进行常规检索
  const baseResults = await retrieveRelevantKnowledgeAuto(query, {
    maxResults: maxResults * 2,
    semanticWeight: 0.5,
    keywordWeight: 0.5,
  })

  if (!includeCrossDomain || baseResults.length === 0) {
    return baseResults.slice(0, maxResults)
  }

  // 分析查询的域
  const queryDomains = detectQueryDomains(query)

  // 获取跨域关联
  const crossDomainRelations = analyzeCrossDomainRelations()
  const relatedDomains = new Set(queryDomains.flatMap(d => {
    const rel = DOMAIN_RELATIONS[d]
    return rel?.relatedDomains || []
  }))

  // 扩展检索范围
  const extendedResults = []
  const seenIds = new Set(baseResults.map(k => k.id))

  // 从相关域中检索补充结果
  const allKnowledge = loadKnowledgeBase()
  const queryKeywords = extractKeywords(query)
  const queryLower = query.toLowerCase()

  for (const k of allKnowledge) {
    if (seenIds.has(k.id)) continue
    if (k.status !== KNOWLEDGE_STATUS.ACTIVE && k.status !== KNOWLEDGE_STATUS.VERIFIED) continue

    const knowledgeDomain = k.metadata?.domain
    if (relatedDomains.size > 0 && !relatedDomains.has(knowledgeDomain)) continue
    if (targetDomains && !targetDomains.includes(knowledgeDomain)) continue

    // 计算跨域相关度
    const contentText = typeof k.content === 'string' ? k.content : JSON.stringify(k.content)
    const kws = extractKeywords(contentText)

    let relevanceScore = 0
    for (const kw of queryKeywords) {
      if (kws.includes(kw)) relevanceScore += 0.3
      if (kw.length >= 2 && contentText.toLowerCase().includes(kw)) relevanceScore += 0.2
    }

    // 标签匹配加分
    if (k.tags) {
      for (const tag of k.tags) {
        const tagLower = tag.toLowerCase()
        for (const kw of queryKeywords) {
          if (tagLower === kw) relevanceScore += 0.4
          else if (tagLower.includes(kw) || kw.includes(tagLower)) relevanceScore += 0.2
        }
      }
    }

    // 跨域桥接概念加分
    const bridgingBoost = checkBridgingRelevance(queryDomains, knowledgeDomain, k.tags)
    relevanceScore += bridgingBoost * 0.3

    if (relevanceScore >= minRelevance) {
      extendedResults.push({
        knowledge: k,
        relevanceScore,
        crossDomain: true,
        sourceDomain: knowledgeDomain,
      })
    }
  }

  // 合并结果
  const merged = [
    ...baseResults.map(k => ({ knowledge: k, relevanceScore: k._retrievalMeta?.score || 0.5, crossDomain: false })),
    ...extendedResults,
  ]

  merged.sort((a, b) => b.relevanceScore - a.relevanceScore)

  return merged.slice(0, maxResults).map(item => {
    const k = item.knowledge
    k._crossDomainMeta = {
      isCrossDomain: item.crossDomain,
      relevanceScore: item.relevanceScore,
    }
    return k
  })
}

function detectQueryDomains(query) {
  const queryLower = query.toLowerCase()
  const detectedDomains = []

  for (const [domain, config] of Object.entries(DOMAIN_RELATIONS)) {
    const domainKeywords = [
      ...config.bridgingConcepts,
      domain,
    ]
    for (const keyword of domainKeywords) {
      if (queryLower.includes(keyword.toLowerCase())) {
        detectedDomains.push(domain)
        break
      }
    }
  }

  return detectedDomains.length > 0 ? detectedDomains : ['general']
}

function checkBridgingRelevance(sourceDomains, targetDomain, tags) {
  if (!tags || sourceDomains.length === 0) return 0

  let relevance = 0
  for (const sourceDomain of sourceDomains) {
    const sourceConfig = DOMAIN_RELATIONS[sourceDomain]
    if (!sourceConfig) continue

    if (sourceConfig.relatedDomains.includes(targetDomain)) {
      relevance += 0.5
    }

    const commonBridging = sourceConfig.bridgingConcepts.filter(c =>
      tags.some(t => t.toLowerCase().includes(c.toLowerCase()))
    )
    relevance += commonBridging.length * 0.2
  }

  return Math.min(1, relevance)
}

// ------------------------------------------------------------
// 跨域推理
// ------------------------------------------------------------
export function crossDomainReasoning(sourceKnowledge, targetDomain, options = {}) {
  ensureStorage()
  const maxDepth = options.maxDepth || 3

  const reasoningPath = []
  const visitedNodes = new Set()

  // 起始节点
  reasoningPath.push({
    step: 0,
    node: sourceKnowledge.id,
    domain: sourceKnowledge.metadata?.domain || 'unknown',
    knowledge: sourceKnowledge,
    type: 'source',
    confidence: 1.0,
  })

  visitedNodes.add(sourceKnowledge.id)

  // BFS遍历跨域连接
  const graph = JSON.parse(fs.readFileSync(GRAPH_FILE, 'utf8'))
  const knowledge = loadKnowledgeBase()

  let frontier = [sourceKnowledge.id]
  let currentDepth = 0

  while (currentDepth < maxDepth && frontier.length > 0) {
    const nextFrontier = []

    for (const nodeId of frontier) {
      const connectedEdges = graph.edges.filter(e =>
        (e.from === nodeId || e.to === nodeId) &&
        (e.type === 'bridging' || e.type === 'related')
      )

      for (const edge of connectedEdges) {
        const neighborId = edge.from === nodeId ? edge.to : edge.from
        if (visitedNodes.has(neighborId)) continue
        visitedNodes.add(neighborId)

        const neighborKnowledge = knowledge.find(k => k.id === neighborId)
        if (!neighborKnowledge) continue

        const neighborDomain = neighborKnowledge.metadata?.domain || 'unknown'

        reasoningPath.push({
          step: currentDepth + 1,
          node: neighborId,
          domain: neighborDomain,
          knowledge: neighborKnowledge,
          connectionType: edge.type,
          connectionWeight: edge.weight,
          confidence: Math.max(0.1, edge.weight * (1 - currentDepth * 0.2)),
        })

        if (neighborDomain === targetDomain) {
          return {
            success: true,
            path: reasoningPath,
            targetReached: true,
            finalConfidence: reasoningPath[reasoningPath.length - 1].confidence,
            insight: generateReasoningInsight(reasoningPath, sourceKnowledge, neighborKnowledge),
          }
        }

        nextFrontier.push(neighborId)
      }
    }

    frontier = nextFrontier
    currentDepth++
  }

  return {
    success: true,
    path: reasoningPath,
    targetReached: false,
    exploredNodes: visitedNodes.size,
    message: `在 ${maxDepth} 层深度内未找到到 ${targetDomain} 域的路径`,
  }
}

function generateReasoningInsight(path, source, target) {
  const domains = [...new Set(path.map(p => p.domain))]
  const conceptTransfer = []

  if (source.tags && target.tags) {
    for (const tag of source.tags) {
      if (target.tags.includes(tag)) {
        conceptTransfer.push(tag)
      }
    }
  }

  return {
    sourceDomain: source.metadata?.domain,
    targetDomain: target.metadata?.domain,
    pathLength: path.length,
    domainsCrossed: domains.length,
    sharedConcepts: conceptTransfer,
    reasoning: `从 ${source.metadata?.domain} 领域的知识「${source.content?.slice(0, 50)}...」通过 ${path.length} 步跨域连接，到达 ${target.metadata?.domain} 领域的知识「${target.content?.slice(0, 50)}...」`,
    knowledgeTransfer: conceptTransfer.length > 0
      ? `共享概念 ${conceptTransfer.join(', ')} 可作为跨域桥梁`
      : '无直接共享概念，通过中间节点实现知识转移',
  }
}

// ------------------------------------------------------------
// 知识图谱统计
// ------------------------------------------------------------
export function getKnowledgeGraphStats() {
  ensureStorage()
  try {
    const graph = JSON.parse(fs.readFileSync(GRAPH_FILE, 'utf8'))
    const knowledge = loadKnowledgeBase()

    const stats = {
      totalNodes: graph.nodes.length,
      totalEdges: graph.edges.length,
      bridgingEdges: graph.edges.filter(e => e.type === 'bridging').length,
      relatedEdges: graph.edges.filter(e => e.type === 'related').length,
      knowledgeCount: knowledge.length,
      activeKnowledge: knowledge.filter(k => k.status === KNOWLEDGE_STATUS.ACTIVE).length,
      byDomain: {},
      byType: {},
      connectivity: calculateConnectivity(graph),
    }

    // 统计各域节点数
    for (const node of graph.nodes) {
      const k = knowledge.find(k => k.id === node.id)
      const domain = k?.metadata?.domain || 'unknown'
      if (!stats.byDomain[domain]) stats.byDomain[domain] = 0
      stats.byDomain[domain]++
    }

    // 统计各类型知识数
    for (const k of knowledge) {
      if (!stats.byType[k.type]) stats.byType[k.type] = 0
      stats.byType[k.type]++
    }

    return stats
  } catch (e) {
    return { error: e.message }
  }
}

function calculateConnectivity(graph) {
  if (graph.nodes.length === 0) return { averageDegree: 0, maxDegree: 0, isolatedNodes: 0 }

  const degreeMap = new Map()
  for (const node of graph.nodes) {
    degreeMap.set(node.id, 0)
  }

  for (const edge of graph.edges) {
    if (degreeMap.has(edge.from)) degreeMap.set(edge.from, (degreeMap.get(edge.from) || 0) + 1)
    if (degreeMap.has(edge.to)) degreeMap.set(edge.to, (degreeMap.get(edge.to) || 0) + 1)
  }

  const degrees = Array.from(degreeMap.values())
  const isolatedNodes = degrees.filter(d => d === 0).length

  return {
    averageDegree: degrees.reduce((a, b) => a + b, 0) / degrees.length,
    maxDegree: Math.max(...degrees),
    isolatedNodes,
    connectivityScore: Math.round((1 - isolatedNodes / degrees.length) * 100),
  }
}
