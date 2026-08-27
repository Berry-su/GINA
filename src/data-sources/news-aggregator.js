/**
 * news-aggregator.js — 新闻聚合器
 *
 * 核心流程：
 *   多源采集 → 去重 → 分类 → 重要性评分 → 知识注入
 *
 * 功能：
 *   1. 从多个新闻源并行采集
 *   2. 基于标题相似度去重
 *   3. 自动分类（财经、科技、地产、政策等）
 *   4. 重要性评分（影响面、时效性、来源权威性）
 *   5. 注入 Gina 知识库
 *   6. 定期更新（可配置间隔）
 */

import fs from 'fs'
import path from 'path'
import { createAdapter, listAdapters, CACHE_DIR, extractStockCodes } from './news-adapter.js'
import { addKnowledge, retrieveRelevantKnowledge } from '../memory/knowledge-distiller.js'

const GINA_HOME = process.env.GINA_HOME
  ? path.join(process.env.GINA_HOME, 'knowledge')
  : path.join(process.env.HOME || '.', '.gina', 'knowledge')

const NEWS_STATE_FILE = path.join(GINA_HOME, 'news-aggregator-state.json')
const NEWS_CACHE_FILE = path.join(CACHE_DIR, 'latest-news.json')
const AGGREGATOR_VERSION = 1
const DEFAULT_CONFIG = {
  adapters: [
    'sina', 'eastmoney', 'cls', 'wallstreetcn',
    'kr36', 'arxiv', 'infoq', 'techcrunch_ai', 'hackernews',
    'zillow_research', 'sina_realestate',
  ],
  maxItemsPerSource: 20,
  dedupWindowMs: 24 * 60 * 60 * 1000,
  importanceThreshold: 0.25,
  injectToKnowledge: true,
  updateIntervalMs: 15 * 60 * 1000,
  maxKnowledgePerBatch: 30,
}

// ─── 分类体系 ────────────────────────────────────────────────────────────────────

const NEWS_CATEGORIES = {
  MACRO: 'macro',
  POLICY: 'policy',
  STOCK: 'stock',
  BOND: 'bond',
  FOREX: 'forex',
  COMMODITY: 'commodity',
  REAL_ESTATE: 'real_estate',
  TECH: 'tech',
  AI: 'ai',
  CRYPTO: 'crypto',
  COMPANY: 'company',
  ECONOMY: 'economy',
  INTERNATIONAL: 'international',
  OTHER: 'other',
}

const CATEGORY_KEYWORDS = {
  [NEWS_CATEGORIES.MACRO]: ['GDP', 'CPI', 'PPI', 'PMI', '央行', '货币政策', '财政政策', '宏观', '经济数据', '经济增长'],
  [NEWS_CATEGORIES.POLICY]: ['政策', '国务院', '发改委', '证监会', '银保监会', '监管', '法规', '规定', '通知', '意见'],
  [NEWS_CATEGORIES.STOCK]: ['股票', '股市', 'A股', '沪指', '深成指', '创业板', '科创板', '涨停', '跌停', '指数', '大盘'],
  [NEWS_CATEGORIES.BOND]: ['债券', '国债', '收益率', '信用债', '可转债', '利率债', '债市'],
  [NEWS_CATEGORIES.FOREX]: ['汇率', '外汇', '美元', '人民币', '欧元', '日元', '英镑', '外汇储备'],
  [NEWS_CATEGORIES.COMMODITY]: ['黄金', '原油', '铜', '铁矿石', '大宗商品', '期货', '农产品'],
  [NEWS_CATEGORIES.REAL_ESTATE]: ['房地产', '房价', '楼市', '土地', '开发商', '限购', '房贷', '公积金', 'REITs', '地产', '住房', '物业', '土拍', '楼面价', '成交量', '去库存', '棚改', '保障房', '二手房', '新房', '商品房', '房产', '地产税', '房产税', 'LPR', '按揭', '抵押贷款', 'housing', 'mortgage', 'rental', 'property', 'real estate', 'home price', 'housing market', 'Zillow', 'Redfin', '房市', '楼市', '金九银十', '小阳春'],
  [NEWS_CATEGORIES.TECH]: ['科技', '芯片', '半导体', '5G', '量子', '生物科技', '互联网', '云计算', 'software', 'hardware', 'processor', 'GPU', 'NPU', '算力'],
  [NEWS_CATEGORIES.AI]: ['AI', '人工智能', '大模型', 'GPT', '机器学习', '深度学习', '神经网络', '智能体', 'Agent', 'LLM', 'RAG', 'Transformer', 'Diffusion', '具身智能', 'AGI', '多模态', '推理', '微调', '训练', '推理引擎', 'LangChain', 'LangGraph', 'AutoGen', 'GPTs', 'Copilot', 'Code', 'Prompt', 'Token', 'Context Window', 'Embedding', 'Vector Database', '知识库', '向量检索', 'Semantic Search', 'Foundation Model', 'Open Source', '开源模型', '闭源模型', 'Benchmark', 'SOTA', 'State of the Art', 'Hacker News', 'Y Combinator', 'TechCrunch', 'InfoQ', '36kr', '机器之心', '量子位'],
  [NEWS_CATEGORIES.CRYPTO]: ['比特币', '以太坊', '加密货币', '区块链', 'Web3', 'DeFi', 'NFT', 'Bitcoin', 'Ethereum', 'crypto'],
  [NEWS_CATEGORIES.COMPANY]: ['公司', '企业', '财报', '业绩', '营收', '利润', '并购', '重组', 'IPO', '上市', 'startup', 'venture', '融资'],
  [NEWS_CATEGORIES.ECONOMY]: ['经济', '贸易', '进出口', '消费', '零售', '就业', '失业', '工资', '收入'],
  [NEWS_CATEGORIES.INTERNATIONAL]: ['国际', '全球', '美联储', '欧央行', '地缘政治', '贸易战', '制裁'],
}

// ─── 重要性评分 ─────────────────────────────────────────────────────────────────

const IMPORTANCE_SIGNALS = {
  // 高重要性关键词
  high: ['紧急', '突发', '重磅', '重大', '历史性', '破纪录', '创纪录', '首次', '罕见', '暴跌', '暴涨', '崩盘', '危机', '加息', '降息', '降准', '央行', '美联储', '利率决议', 'FOMC', '非农', 'CPI', 'GDP'],
  // 中等重要性关键词
  medium: ['上涨', '下跌', '调整', '波动', '增长', '下降', '发布', '公布', '预测', '预期', '数据', '收益', '利润', '营收', '并购', '收购', 'IPO', '上市', '业绩', '财报', '政策', '监管'],
  // 来源权重
  sourceWeight: {
    sina_finance: 0.7,
    eastmoney: 0.7,
    cls_telegraph: 0.85,
    wallstreetcn: 0.8,
    kr36: 0.75,
    arxiv: 0.85,
    infoq: 0.75,
    techcrunch_ai: 0.8,
    hackernews: 0.7,
    zillow_research: 0.8,
    sina_realestate: 0.7,
  },
}

// ─── 状态管理 ────────────────────────────────────────────────────────────────────

function loadState() {
  try {
    if (fs.existsSync(NEWS_STATE_FILE)) {
      return JSON.parse(fs.readFileSync(NEWS_STATE_FILE, 'utf8'))
    }
  } catch {}
  return {
    version: AGGREGATOR_VERSION,
    lastUpdateAt: 0,
    totalItemsProcessed: 0,
    totalKnowledgeInjected: 0,
    seenTitles: [],
    adapters: {},
  }
}

function saveState(state) {
  try {
    const dir = path.dirname(NEWS_STATE_FILE)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(NEWS_STATE_FILE, JSON.stringify(state, null, 2), 'utf8')
  } catch {}
}

function loadCache() {
  try {
    if (fs.existsSync(NEWS_CACHE_FILE)) {
      return JSON.parse(fs.readFileSync(NEWS_CACHE_FILE, 'utf8'))
    }
  } catch {}
  return { items: [], updatedAt: 0 }
}

function saveCache(data) {
  try {
    const dir = path.dirname(NEWS_CACHE_FILE)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(NEWS_CACHE_FILE, JSON.stringify({ ...data, updatedAt: Date.now() }, null, 2), 'utf8')
  } catch {}
}

// ─── 分类引擎 ───────────────────────────────────────────────────────────────────

const SOURCE_CATEGORY_BIAS = {
  zillow_research: 'real_estate',
  sina_realestate: 'real_estate',
  arxiv: 'ai',
  infoq: 'ai',
  techcrunch_ai: 'ai',
  hackernews: 'tech',
  kr36: 'ai',
}

function classifyNews(item) {
  const text = (item.title + ' ' + (item.summary || '')).toLowerCase()
  const scores = {}

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    let score = 0
    for (const kw of keywords) {
      if (text.includes(kw.toLowerCase())) {
        score += 1
      }
    }
    if (score > 0) {
      scores[category] = score
    }
  }

  // 来源分类偏好：特定来源给予额外加权
  const biasCategory = SOURCE_CATEGORY_BIAS[item.source]
  if (biasCategory) {
    scores[biasCategory] = (scores[biasCategory] || 0) + 2
  }

  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1])
  const primary = sorted[0]?.[0] || NEWS_CATEGORIES.OTHER
  const all = sorted.map(([cat]) => cat)

  return { primary, all }
}

// ─── 重要性评分引擎 ─────────────────────────────────────────────────────────────

function scoreImportance(item) {
  const text = (item.title + ' ' + (item.summary || '')).toLowerCase()
  let score = 0.45 // 基础分

  // 高重要性关键词 +0.15 each
  for (const kw of IMPORTANCE_SIGNALS.high) {
    if (text.includes(kw.toLowerCase())) {
      score += 0.15
    }
  }

  // 中等重要性关键词 +0.06 each
  for (const kw of IMPORTANCE_SIGNALS.medium) {
    if (text.includes(kw.toLowerCase())) {
      score += 0.06
    }
  }

  // 来源权重（加法调整）
  const sourceWeight = IMPORTANCE_SIGNALS.sourceWeight[item.source] || 0.7
  score += (sourceWeight - 0.7) * 0.3 // 基于0.7的偏差调整

  // 时效性（加法调整）
  const ageMs = Date.now() - (item.timestamp || Date.now())
  if (ageMs < 30 * 60 * 1000) score += 0.15 // 30分钟内
  else if (ageMs < 60 * 60 * 1000) score += 0.10 // 1小时内
  else if (ageMs < 4 * 60 * 60 * 1000) score += 0.05 // 4小时内
  else if (ageMs > 24 * 60 * 60 * 1000) score -= 0.15 // 超过24小时

  // 有关联股票代码 +0.08
  if (item.symbols && item.symbols.length > 0) {
    score += 0.08
  }

  // 有关键分类标签加分
  if (item.category?.primary) {
    const highImpactCategories = ['macro', 'policy', 'stock', 'international', 'ai', 'real_estate']
    if (highImpactCategories.includes(item.category.primary)) {
      score += 0.1
    }
  }

  return Math.max(0, Math.min(1, score))
}

// ─── 去重引擎 ───────────────────────────────────────────────────────────────────

function isDuplicate(item, state, dedupWindowMs) {
  const title = normalizeTitle(item.title)
  
  // 检查近期已见标题
  const now = Date.now()
  const recentTitles = state.seenTitles.filter(t => now - t.timestamp < dedupWindowMs)
  
  for (const seen of recentTitles) {
    if (titleSimilarity(title, seen.title) > 0.8) {
      return true
    }
  }
  
  return false
}

function normalizeTitle(title) {
  if (!title) return ''
  return title
    .toLowerCase()
    .replace(/[^\u4e00-\u9fa5a-z0-9]/g, '')
    .slice(0, 100)
}

function titleSimilarity(a, b) {
  if (!a || !b) return 0
  const setA = new Set(a.split(''))
  const setB = new Set(b.split(''))
  let common = 0
  for (const char of setA) {
    if (setB.has(char)) common++
  }
  const union = new Set([...setA, ...setB]).size
  return union > 0 ? common / union : 0
}

// ─── 知识注入 ───────────────────────────────────────────────────────────────────

function injectToKnowledge(newsItem, category, importance) {
  if (importance < 0.3) return null

  const domainMap = {
    real_estate: 'real_estate',
    ai: 'ai',
    agent: 'ai',
    tech: 'tech',
    startup: 'tech',
    research: 'tech',
    macro: 'finance',
    policy: 'finance',
    stock: 'finance',
    bond: 'finance',
    forex: 'finance',
    commodity: 'finance',
    crypto: 'finance',
    company: 'finance',
    economy: 'finance',
    international: 'finance',
    china: 'finance',
  }

  const domain = domainMap[category.primary] || 'general'

  try {
    const knowledge = addKnowledge({
      type: 'fact',
      content: `[财经新闻] ${newsItem.title}\n摘要: ${newsItem.summary || '无'}\n来源: ${newsItem.source}\n时间: ${new Date(newsItem.timestamp).toISOString()}`,
      confidence: Math.min(0.95, 0.6 + importance * 0.4),
      sources: [newsItem.source, newsItem.url].filter(Boolean),
      tags: ['finance', 'news', domain, category.primary, ...category.all],
      metadata: {
        domain,
        newsItem: true,
        importance,
        symbols: newsItem.symbols,
        categories: category.all,
        source: newsItem.source,
      },
    })
    return knowledge
  } catch (e) {
    return null
  }
}

// ─── 新闻聚合（主流程） ───────────────────────────────────────────────────────────

export async function aggregateNews(config = {}) {
  const opts = { ...DEFAULT_CONFIG, ...config }
  const state = loadState()
  
  console.log('\n📡 [新闻聚合] 开始采集...')
  const startTime = Date.now()
  
  // 1. 从所有适配器并行采集
  const adapterInstances = opts.adapters.map(name => {
    try {
      return createAdapter(name)
    } catch {
      return null
    }
  }).filter(Boolean)
  
  const allItems = []
  
  for (const adapter of adapterInstances) {
    try {
      console.log(`  📰 采集 ${adapter.name}...`)
      const items = await adapter.fetchNews({ maxItems: opts.maxItemsPerSource })
      if (items && items.length > 0) {
        allItems.push(...items)
        console.log(`    ✓ 获取 ${items.length} 条`)
      } else {
        console.log(`    - 无数据`)
      }
    } catch (e) {
      console.log(`    ✗ 失败: ${e.message}`)
    }
  }
  
  console.log(`\n  📊 共采集 ${allItems.length} 条原始新闻`)
  
  // 2. 去重
  const uniqueItems = []
  const dedupCount = state.seenTitles.length
  const now = Date.now()
  
  for (const item of allItems) {
    if (!isDuplicate(item, state, opts.dedupWindowMs)) {
      uniqueItems.push(item)
      state.seenTitles.push({
        title: normalizeTitle(item.title),
        timestamp: now,
      })
    }
  }
  
  // 清理过期标题记录
  state.seenTitles = state.seenTitles.filter(t => now - t.timestamp < opts.dedupWindowMs)
  
  console.log(`  🔍 去重后: ${uniqueItems.length} 条 (移除 ${allItems.length - uniqueItems.length} 条重复)`)
  
  // 3. 分类和评分
  const enrichedItems = uniqueItems.map(item => {
    const category = classifyNews(item)
    const importance = scoreImportance(item)
    return {
      ...item,
      category,
      importance,
    }
  })
  
  // 4. 按重要性排序
  const sortedItems = enrichedItems.sort((a, b) => b.importance - a.importance)
  
  // 5. 缓存最新新闻（保存所有已分类/评分的新闻）
  // 合并旧缓存（保留未过期的旧新闻）
  const oldCache = loadCache()
  const existingTitles = new Set((oldCache.items || []).map(i => normalizeTitle(i.title)))
  
  // 用新的sortedItems作为基础（已分类/评分）
  const mergedItems = [...sortedItems]
  
  // 添加旧缓存中未过期的新闻
  for (const oldItem of (oldCache.items || [])) {
    if (!existingTitles.has(normalizeTitle(oldItem.title))) {
      const ageMs = Date.now() - (oldItem.timestamp || 0)
      if (ageMs < 4 * 60 * 60 * 1000) { // 保留4小时内的旧新闻
        mergedItems.push(oldItem)
      }
    }
  }
  
  mergedItems.sort((a, b) => (b.importance || 0) - (a.importance || 0))
  
  saveCache({
    items: mergedItems.slice(0, 50),
    adapters: opts.adapters,
    totalItems: mergedItems.length,
  })
  
  // 6. 注入知识库（按领域配额策略）
  let injectedCount = 0
  if (opts.injectToKnowledge) {
    const eligibleItems = sortedItems.filter(item => item.importance >= opts.importanceThreshold)
    
    // 6a. 按领域分组，分配基础配额
    const DOMAIN_QUOTA = 3
    const domainMap = {}
    for (const item of eligibleItems) {
      const domain = item.category?.primary || 'other'
      if (!domainMap[domain]) domainMap[domain] = []
      domainMap[domain].push(item)
    }
    
    // 每个领域取 top-DOMAIN_QUOTA 条
    const selectedByDomain = new Set()
    const domainCounts = {}
    for (const [domain, items] of Object.entries(domainMap)) {
      domainCounts[domain] = 0
      for (const item of items.slice(0, DOMAIN_QUOTA)) {
        selectedByDomain.add(item)
        domainCounts[domain]++
      }
    }
    
    // 6b. 剩余名额按全局重要性补充
    const totalQuota = opts.maxKnowledgePerBatch
    let remaining = totalQuota - selectedByDomain.size
    
    if (remaining > 0) {
      for (const item of eligibleItems) {
        if (remaining <= 0) break
        if (!selectedByDomain.has(item)) {
          selectedByDomain.add(item)
          remaining--
        }
      }
    }
    
    // 按重要性排序后注入
    const toInject = [...selectedByDomain].sort((a, b) => b.importance - a.importance)
    
    for (const item of toInject) {
      const knowledge = injectToKnowledge(item, item.category, item.importance)
      if (knowledge) injectedCount++
    }
    
    const domainSummary = Object.entries(domainCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([d, c]) => `${d}:${c}`)
      .join(', ')
    console.log(`  🧠 注入知识库: ${injectedCount} 条 (${domainSummary})`)
  }
  
  // 7. 更新状态
  state.lastUpdateAt = Date.now()
  state.totalItemsProcessed += sortedItems.length
  state.totalKnowledgeInjected += injectedCount
  saveState(state)
  
  const duration = Date.now() - startTime
  console.log(`\n✅ [新闻聚合] 完成 (耗时 ${duration}ms)`)
  console.log(`   处理新闻: ${sortedItems.length} 条`)
  console.log(`   重要新闻: ${sortedItems.filter(i => i.importance >= 0.5).length} 条`)
  console.log(`   知识注入: ${injectedCount} 条`)
  
  return {
    success: true,
    items: sortedItems,
    injectedCount,
    durationMs: duration,
    totalProcessed: state.totalItemsProcessed,
  }
}

// ─── 获取最新新闻（缓存） ─────────────────────────────────────────────────────────

export function getLatestNews({ limit = 20, category = null, minImportance = 0 } = {}) {
  const cache = loadCache()
  let items = cache.items || []
  
  if (category) {
    items = items.filter(item => 
      item.category?.primary === category || item.category?.all?.includes(category)
    )
  }
  
  if (minImportance > 0) {
    items = items.filter(item => (item.importance || 0) >= minImportance)
  }
  
  return items.slice(0, limit)
}

// ─── 获取新闻摘要文本（用于prompt注入） ───────────────────────────────────────────

export function getNewsSummary({ maxItems = 10, minImportance = 0.25 } = {}) {
  const items = getLatestNews({ limit: maxItems, minImportance })
  
  if (items.length === 0) {
    return ''
  }
  
  const lines = ['📰 最新财经新闻:']
  for (const item of items) {
    const time = new Date(item.timestamp).toLocaleString('zh-CN', { 
      hour: '2-digit', 
      minute: '2-digit' 
    })
    lines.push(`  [${time}] ${item.title} (重要性: ${(item.importance * 100).toFixed(0)}%)`)
  }
  
  return lines.join('\n')
}

// ─── 按类别获取新闻 ───────────────────────────────────────────────────────────────

export function getNewsByCategory(category, { limit = 10 } = {}) {
  return getLatestNews({ limit, category })
}

// ─── 获取聚合状态 ─────────────────────────────────────────────────────────────────

export function getAggregatorStatus() {
  const state = loadState()
  const cache = loadCache()
  
  return {
    version: AGGREGATOR_VERSION,
    lastUpdate: state.lastUpdateAt ? new Date(state.lastUpdateAt).toISOString() : 'never',
    lastUpdateAgo: state.lastUpdateAt ? `${Math.floor((Date.now() - state.lastUpdateAt) / 60000)} 分钟前` : 'N/A',
    totalProcessed: state.totalItemsProcessed,
    totalInjected: state.totalKnowledgeInjected,
    cachedItems: cache.items?.length || 0,
    adapters: listAdapters(),
    categories: Object.values(NEWS_CATEGORIES),
  }
}

// ─── 手动触发更新 ─────────────────────────────────────────────────────────────────

export async function forceUpdate(config = {}) {
  return await aggregateNews(config)
}

export {
  NEWS_CATEGORIES,
  DEFAULT_CONFIG,
}