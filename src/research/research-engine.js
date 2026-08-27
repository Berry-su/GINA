/**
 * research-engine.js — 自动化文献研究引擎
 *
 * 核心功能：
 *   1. 文献搜索（arXiv、通用学术搜索、网络搜索）
 *   2. 摘要提取与关键发现识别
 *   3. 引文网络构建
 *   4. 知识缺口识别
 *   5. 研究问题生成
 *   6. 研究成果导出
 *
 * 数据结构：
 *   Paper {
 *     id, title, authors, abstract, summary,
 *     publishedAt, source, url, citations, references,
 *     keyFindings, researchQuestions, knowledgeGaps
 *   }
 */

import fs from 'fs'
import path from 'path'

// ─── 存储路径 ────────────────────────────────────────────────────────────────────

const RESEARCH_DIR = process.env.GINA_HOME
  ? path.join(process.env.GINA_HOME, 'research')
  : path.join(process.env.HOME || '.', '.gina', 'research')

const PAPERS_FILE = path.join(RESEARCH_DIR, 'papers.json')
const CITATION_GRAPH_FILE = path.join(RESEARCH_DIR, 'citation-graph.json')
const KNOWLEDGE_GAPS_FILE = path.join(RESEARCH_DIR, 'knowledge-gaps.json')
const RESEARCH_QUESTIONS_FILE = path.join(RESEARCH_DIR, 'research-questions.json')
const EXPORT_DIR = path.join(RESEARCH_DIR, 'exports')

// ─── 引擎状态 ─────────────────────────────────────────────────────────────────────

const state = {
  initialized: false,
  papers: [],
  citationGraph: { nodes: [], edges: [] },
  knowledgeGaps: [],
  researchQuestions: [],
  config: {
    arxivBaseUrl: 'http://export.arxiv.org/api/query',
    maxResultsPerQuery: 50,
    searchTimeoutMs: 15000,
    minRelevanceScore: 0.3,
  },
}

// ─── 存储管理 ─────────────────────────────────────────────────────────────────────

/**
 * 确保研究目录和存储文件存在
 */
function ensureStorage() {
  try {
    if (!fs.existsSync(RESEARCH_DIR)) {
      fs.mkdirSync(RESEARCH_DIR, { recursive: true })
    }
    if (!fs.existsSync(EXPORT_DIR)) {
      fs.mkdirSync(EXPORT_DIR, { recursive: true })
    }
  } catch (e) {
    console.warn('[研究引擎] 目录创建失败（可能是权限问题），使用内存存储:', e.message)
    state.initialized = true
    return
  }
  
  try {
    if (!fs.existsSync(PAPERS_FILE)) {
      fs.writeFileSync(PAPERS_FILE, '[]', 'utf8')
    }
    if (!fs.existsSync(CITATION_GRAPH_FILE)) {
      fs.writeFileSync(CITATION_GRAPH_FILE, JSON.stringify({ nodes: [], edges: [] }, null, 2), 'utf8')
    }
    if (!fs.existsSync(KNOWLEDGE_GAPS_FILE)) {
      fs.writeFileSync(KNOWLEDGE_GAPS_FILE, '[]', 'utf8')
    }
    if (!fs.existsSync(RESEARCH_QUESTIONS_FILE)) {
      fs.writeFileSync(RESEARCH_QUESTIONS_FILE, '[]', 'utf8')
    }
  } catch (e) {
    console.warn('[研究引擎] 文件创建失败，使用内存存储:', e.message)
  }
}

/**
 * 从磁盘加载已有研究数据
 */
function loadFromDisk() {
  try {
    if (fs.existsSync(PAPERS_FILE)) {
      const raw = fs.readFileSync(PAPERS_FILE, 'utf8')
      state.papers = JSON.parse(raw || '[]')
    }
    if (fs.existsSync(CITATION_GRAPH_FILE)) {
      const raw = fs.readFileSync(CITATION_GRAPH_FILE, 'utf8')
      state.citationGraph = JSON.parse(raw || '{"nodes":[],"edges":[]}')
    }
    if (fs.existsSync(KNOWLEDGE_GAPS_FILE)) {
      const raw = fs.readFileSync(KNOWLEDGE_GAPS_FILE, 'utf8')
      state.knowledgeGaps = JSON.parse(raw || '[]')
    }
    if (fs.existsSync(RESEARCH_QUESTIONS_FILE)) {
      const raw = fs.readFileSync(RESEARCH_QUESTIONS_FILE, 'utf8')
      state.researchQuestions = JSON.parse(raw || '[]')
    }
  } catch (err) {
    console.error('[研究引擎] 加载磁盘数据失败:', err.message)
  }
}

/**
 * 将当前状态持久化到磁盘
 */
function persistToDisk() {
  try {
    fs.writeFileSync(PAPERS_FILE, JSON.stringify(state.papers, null, 2), 'utf8')
    fs.writeFileSync(CITATION_GRAPH_FILE, JSON.stringify(state.citationGraph, null, 2), 'utf8')
    fs.writeFileSync(KNOWLEDGE_GAPS_FILE, JSON.stringify(state.knowledgeGaps, null, 2), 'utf8')
    fs.writeFileSync(RESEARCH_QUESTIONS_FILE, JSON.stringify(state.researchQuestions, null, 2), 'utf8')
  } catch (err) {
    console.error('[研究引擎] 持久化数据失败:', err.message)
  }
}

// ─── 工具函数 ─────────────────────────────────────────────────────────────────────

/**
 * 生成唯一标识符
 */
function generateId() {
  return `paper_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

/**
 * 截断文本到指定长度
 */
function truncate(text, maxLength = 300) {
  if (!text) return ''
  return text.length > maxLength ? text.slice(0, maxLength) + '...' : text
}

/**
 * 计算文本相似度（基于词频的简单余弦相似度）
 */
function computeTextSimilarity(textA, textB) {
  if (!textA || !textB) return 0
  const wordsA = new Set(textA.toLowerCase().split(/\s+/).filter(Boolean))
  const wordsB = new Set(textB.toLowerCase().split(/\s+/).filter(Boolean))
  if (wordsA.size === 0 || wordsB.size === 0) return 0
  let intersection = 0
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++
  }
  const union = wordsA.size + wordsB.size - intersection
  return union === 0 ? 0 : intersection / union
}

/**
 * 通用 HTTP 请求（带超时和错误处理）
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    const res = await fetch(url, { signal: ctrl.signal, ...options })
    clearTimeout(timer)
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
}

/**
 * 解析 arXiv XML 响应
 */
function parseArxivXml(xmlText) {
  if (!xmlText) return []
  const papers = []
  try {
    const entries = xmlText.match(/<entry>([\s\S]*?)<\/entry>/g) || []
    for (const entry of entries) {
      const title = (entry.match(/<title>([\s\S]*?)<\/title>/) || [])[1]?.trim() || ''
      const summary = (entry.match(/<summary>([\s\S]*?)<\/summary>/) || [])[1]?.trim() || ''
      const published = (entry.match(/<published>([\s\S]*?)<\/published>/) || [])[1]?.trim() || ''
      const id = (entry.match(/<id>([\s\S]*?)<\/id>/) || [])[1]?.trim() || ''
      const authors = []
      const authorMatches = entry.match(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/g) || []
      for (const am of authorMatches) {
        const name = (am.match(/<name>([\s\S]*?)<\/name>/) || [])[1]?.trim() || ''
        if (name) authors.push(name)
      }
      if (title) {
        papers.push({
          id: generateId(),
          title,
          authors,
          abstract: summary,
          publishedAt: published,
          source: 'arxiv',
          url: id,
          citations: [],
          references: [],
          keyFindings: [],
          researchQuestions: [],
          knowledgeGaps: [],
        })
      }
    }
  } catch (err) {
    console.error('[研究引擎] 解析 arXiv XML 失败:', err.message)
  }
  return papers
}

/**
 * 计算论文相关性评分
 */
function computeRelevanceScore(paper, queryTerms) {
  if (!queryTerms || queryTerms.length === 0) return 1.0
  const titleText = (paper.title || '').toLowerCase()
  const abstractText = (paper.abstract || '').toLowerCase()
  let score = 0
  for (const term of queryTerms) {
    const t = term.toLowerCase()
    if (titleText.includes(t)) score += 0.6
    if (abstractText.includes(t)) score += 0.4
  }
  return Math.min(score / queryTerms.length, 1.0)
}

// ─── 1. 文献搜索 ──────────────────────────────────────────────────────────────────

/**
 * 通过 arXiv API 搜索文献
 */
async function searchArxiv(query, options = {}) {
  const maxResults = options.maxResults || state.config.maxResultsPerQuery
  const searchUrl = `${state.config.arxivBaseUrl}?search_query=all:${encodeURIComponent(query)}&start=0&max_results=${maxResults}`
  console.log(`[研究引擎] arXiv 搜索: "${query}" (最多 ${maxResults} 条)`)
  const xmlText = await fetchWithTimeout(searchUrl, {}, state.config.searchTimeoutMs)
  const papers = parseArxivXml(xmlText)
  const queryTerms = query.split(/\s+/).filter(Boolean)
  return papers
    .map(paper => ({ ...paper, relevanceScore: computeRelevanceScore(paper, queryTerms) }))
    .filter(paper => paper.relevanceScore >= state.config.minRelevanceScore)
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
}

/**
 * 通过通用学术搜索引擎搜索文献
 * 使用公开的学术搜索 API（如 Semantic Scholar 等）
 */
async function searchAcademic(query, options = {}) {
  const maxResults = options.maxResults || state.config.maxResultsPerQuery
  const sources = [
    {
      name: 'semantic-scholar',
      url: `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=${maxResults}&fields=title,authors,abstract,year,citationCount,referenceCount,url`,
      parser: parseSemanticScholarResponse,
    },
  ]
  const allPapers = []
  for (const source of sources) {
    console.log(`[研究引擎] 学术搜索 (${source.name}): "${query}"`)
    const jsonText = await fetchWithTimeout(source.url, {
      headers: { 'Accept': 'application/json' },
    }, state.config.searchTimeoutMs)
    if (jsonText) {
      try {
        const data = JSON.parse(jsonText)
        const papers = source.parser(data)
        allPapers.push(...papers)
      } catch (err) {
        console.warn(`[研究引擎] ${source.name} 响应解析失败:`, err.message)
      }
    }
  }
  return allPapers
}

/**
 * 解析 Semantic Scholar API 响应
 */
function parseSemanticScholarResponse(data) {
  if (!data || !data.data) return []
  return data.data.map(item => ({
    id: generateId(),
    title: item.title || '',
    authors: (item.authors || []).map(a => a.name || ''),
    abstract: item.abstract || '',
    publishedAt: item.year ? String(item.year) : '',
    source: 'semantic-scholar',
    url: item.url || '',
    citationCount: item.citationCount || 0,
    referenceCount: item.referenceCount || 0,
    citations: [],
    references: [],
    keyFindings: [],
    researchQuestions: [],
    knowledgeGaps: [],
  }))
}

/**
 * 通过搜索引擎进行网络搜索（查找相关研究资源）
 */
async function searchWeb(query, options = {}) {
  const maxResults = options.maxResults || 20
  const searchUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1&no_redirect=1`
  console.log(`[研究引擎] 网络搜索: "${query}"`)
  const jsonText = await fetchWithTimeout(searchUrl, {}, state.config.searchTimeoutMs)
  if (!jsonText) return []
  try {
    const data = JSON.parse(jsonText)
    const results = []
    if (data.related_topics) {
      for (const topic of data.related_topics.slice(0, maxResults)) {
        results.push({
          id: generateId(),
          title: topic.text || topic.FirstURL || '',
          abstract: topic.Text || '',
          source: 'web',
          url: topic.FirstURL || '',
          publishedAt: '',
          authors: [],
          citations: [],
          references: [],
          keyFindings: [],
          researchQuestions: [],
          knowledgeGaps: [],
        })
      }
    }
    if (data.abstract_text) {
      results.unshift({
        id: generateId(),
        title: data.heading || query,
        abstract: data.abstract_text,
        source: 'web',
        url: data.abstract_url || '',
        publishedAt: '',
        authors: [],
        citations: [],
        references: [],
        keyFindings: [],
        researchQuestions: [],
        knowledgeGaps: [],
      })
    }
    return results
  } catch (err) {
    console.warn('[研究引擎] 网络搜索响应解析失败:', err.message)
    return []
  }
}

/**
 * 统一文献搜索入口
 *
 * @param {string} query - 搜索查询词
 * @param {Object} options - 搜索选项
 * @param {string[]} options.sources - 数据源选择 ['arxiv', 'academic', 'web']
 * @param {number} options.maxResults - 每个数据源的最大结果数
 * @returns {Promise<Array>} 合并后的论文列表
 */
async function searchLiterature(query, options = {}) {
  const sources = options.sources || ['arxiv', 'academic', 'web']
  const allPapers = []
  const tasks = []

  if (sources.includes('arxiv')) {
    tasks.push(searchArxiv(query, options))
  }
  if (sources.includes('academic')) {
    tasks.push(searchAcademic(query, options))
  }
  if (sources.includes('web')) {
    tasks.push(searchWeb(query, options))
  }

  const results = await Promise.allSettled(tasks)
  for (const result of results) {
    if (result.status === 'fulfilled' && Array.isArray(result.value)) {
      allPapers.push(...result.value)
    }
  }

  const existingIds = new Set(state.papers.map(p => p.id))
  const newPapers = allPapers.filter(p => !existingIds.has(p.id))
  state.papers.push(...newPapers)

  console.log(`[研究引擎] 搜索完成: 新增 ${newPapers.length} 篇论文，总计 ${state.papers.length} 篇`)

  return newPapers
}

// ─── 2. 摘要提取与关键发现识别 ─────────────────────────────────────────────────────

/**
 * 从论文中提取关键发现
 * 基于规则的方法：提取摘要中的核心陈述、结论和数据点
 *
 * @param {Object|Array} paper - 论文对象或论文对象数组
 * @returns {Object|Array} 增强后的论文对象（包含 keyFindings）
 */
function extractKeyFindings(paper) {
  // 支持数组输入
  if (Array.isArray(paper)) {
    return paper.map(p => extractKeyFindings(p))
  }
  
  if (!paper.abstract && !paper.title) {
    return { ...paper, keyFindings: [], summary: '' }
  }

  const keyFindings = []
  const summary = paper.abstract || paper.title

  const sentences = summary
    .split(/(?<=[.!?。！？])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 10)

  const findingPatterns = [
    /(?:show|demonstrate|find|discover|reveal|indicate|suggest|prove|证实|表明|发现|揭示|证明)[^.!?。！？]{10,}/i,
    /(?:significant|important|novel|new|key|major|significant|重要|关键|新颖|主要)[^.!?。！？]{5,}/i,
    /\d+[\s%]*(?:%|percent|倍|%)/i,
    /(?:improve|increase|decrease|reduce|achieve|obtain|gain|提升|提高|降低|达到|获得)[^.!?。！？]{5,}/i,
  ]

  for (const sentence of sentences) {
    for (const pattern of findingPatterns) {
      const match = sentence.match(pattern)
      if (match) {
        keyFindings.push({
          text: sentence,
          type: classifyFindingType(sentence),
          confidence: 0.7,
        })
        break
      }
    }
  }

  if (keyFindings.length === 0 && sentences.length > 0) {
    const midIndex = Math.floor(sentences.length / 2)
    keyFindings.push({
      text: sentences[midIndex] || sentences[0],
      type: 'general',
      confidence: 0.4,
    })
  }

  const enrichedPaper = {
    ...paper,
    keyFindings,
    summary: truncate(summary, 500),
  }

  return enrichedPaper
}

/**
 * 分类关键发现的类型
 */
function classifyFindingType(sentence) {
  const lower = sentence.toLowerCase()
  if (/\d+/.test(sentence) && /(%|percent|倍|%)/.test(lower)) return 'quantitative'
  if (/(show|demonstrate|find|discover|reveal|证实|表明|发现|揭示)/i.test(lower)) return 'empirical'
  if (/(propose|suggest|introduce|present|提出|建议|介绍)/i.test(lower)) return 'theoretical'
  if (/(improve|increase|decrease|reduce|提升|提高|降低)/i.test(lower)) return 'performance'
  return 'general'
}

/**
 * 批量提取所有论文的关键发现
 */
function extractAllKeyFindings() {
  let updated = 0
  state.papers = state.papers.map(paper => {
    if (!paper.keyFindings || paper.keyFindings.length === 0) {
      updated++
      return extractKeyFindings(paper)
    }
    return paper
  })
  persistToDisk()
  console.log(`[研究引擎] 关键发现提取完成: 更新 ${updated} 篇论文`)
  return state.papers
}

// ─── 3. 引文网络构建 ──────────────────────────────────────────────────────────────

/**
 * 构建引文网络
 * 根据论文之间的引用关系构建有向图
 *
 * @returns {Object} 引文网络 { nodes: [], edges: [] }
 */
function buildCitationNetwork() {
  const nodes = []
  const edges = []
  const paperIds = new Set(state.papers.map(p => p.id))

  for (const paper of state.papers) {
    nodes.push({
      id: paper.id,
      title: truncate(paper.title, 100),
      year: paper.publishedAt,
      source: paper.source,
      citationCount: paper.citationCount || 0,
    })

    if (paper.references && Array.isArray(paper.references)) {
      for (const refId of paper.references) {
        if (paperIds.has(refId)) {
          edges.push({
            source: paper.id,
            target: refId,
            type: 'reference',
          })
        }
      }
    }

    if (paper.citations && Array.isArray(paper.citations)) {
      for (const citId of paper.citations) {
        if (paperIds.has(citId)) {
          edges.push({
            source: citId,
            target: paper.id,
            type: 'citation',
          })
        }
      }
    }
  }

  state.citationGraph = { nodes, edges }
  persistToDisk()

  console.log(`[研究引擎] 引文网络构建完成: ${nodes.length} 个节点，${edges.length} 条边`)
  return state.citationGraph
}

/**
 * 分析引文网络中的关键节点
 * 识别高被引论文和桥接论文
 */
function analyzeCitationNetwork() {
  const { nodes, edges } = state.citationGraph
  if (nodes.length === 0) return { keyNodes: [], bridges: [] }

  const inDegree = {}
  const outDegree = {}
  const adjacency = {}

  for (const node of nodes) {
    inDegree[node.id] = 0
    outDegree[node.id] = 0
    adjacency[node.id] = new Set()
  }

  for (const edge of edges) {
    outDegree[edge.source] = (outDegree[edge.source] || 0) + 1
    inDegree[edge.target] = (inDegree[edge.target] || 0) + 1
    adjacency[edge.source]?.add(edge.target)
    adjacency[edge.target]?.add(edge.source)
  }

  const keyNodes = nodes
    .map(node => ({
      ...node,
      inDegree: inDegree[node.id] || 0,
      outDegree: outDegree[node.id] || 0,
      totalDegree: (inDegree[node.id] || 0) + (outDegree[node.id] || 0),
    }))
    .sort((a, b) => b.inDegree - a.inDegree)
    .slice(0, 10)

  const bridges = nodes.filter(node => {
    const degree = (inDegree[node.id] || 0) + (outDegree[node.id] || 0)
    return degree >= 3 && (inDegree[node.id] || 0) > 0 && (outDegree[node.id] || 0) > 0
  })

  return { keyNodes, bridges }
}

// ─── 4. 知识缺口识别 ─────────────────────────────────────────────────────────────

/**
 * 识别研究领域中的知识缺口
 * 基于论文分析、引文网络和时间趋势
 *
 * @returns {Array} 知识缺口列表
 */
function identifyKnowledgeGaps() {
  const gaps = []

  // ── 4a. 时间维度：识别过时研究领域中缺乏新进展的主题 ──
  const papersByYear = {}
  for (const paper of state.papers) {
    const year = paper.publishedAt ? (paper.publishedAt.match(/\d{4}/) || ['0'])[0] : '0'
    if (!papersByYear[year]) papersByYear[year] = []
    papersByYear[year].push(paper)
  }

  const years = Object.keys(papersByYear).filter(y => y !== '0').sort()
  if (years.length >= 2) {
    const recentYear = years[years.length - 1]
    const prevYear = years[years.length - 2]
    const recentCount = papersByYear[recentYear]?.length || 0
    const prevCount = papersByYear[prevYear]?.length || 0
    if (prevCount > 0 && recentCount / prevCount < 0.5) {
      gaps.push({
        id: generateId(),
        type: 'temporal',
        title: `研究产出下降: ${prevYear}年(${prevCount}篇) → ${recentYear}年(${recentCount}篇)`,
        description: `${recentYear}年该领域论文发表量较${prevYear}年显著下降，可能表明研究热度降低或面临技术瓶颈`,
        severity: 'medium',
        relatedPapers: papersByYear[prevYear]?.slice(0, 3).map(p => p.id) || [],
      })
    }
  }

  // ── 4b. 内容维度：识别低覆盖的子主题 ──
  const allKeyFindings = []
  for (const paper of state.papers) {
    for (const finding of (paper.keyFindings || [])) {
      allKeyFindings.push({ ...finding, paperId: paper.id })
    }
  }

  const findingTypes = {}
  for (const finding of allKeyFindings) {
    const type = finding.type || 'general'
    findingTypes[type] = (findingTypes[type] || 0) + 1
  }

  const expectedTypes = ['quantitative', 'empirical', 'theoretical', 'performance']
  for (const type of expectedTypes) {
    const count = findingTypes[type] || 0
    if (count === 0 && state.papers.length >= 5) {
      gaps.push({
        id: generateId(),
        type: 'coverage',
        title: `缺少${type}类型的研究发现`,
        description: `当前文献中未发现${type}类型的关键发现，该方向可能存在研究空白`,
        severity: 'high',
        relatedPapers: [],
      })
    }
  }

  // ── 4c. 引文维度：识别孤立的研究领域 ──
  const { nodes, edges } = state.citationGraph
  if (nodes.length > 0) {
    const connectedNodes = new Set()
    for (const edge of edges) {
      connectedNodes.add(edge.source)
      connectedNodes.add(edge.target)
    }
    const isolatedNodes = nodes.filter(n => !connectedNodes.has(n.id))
    if (isolatedNodes.length > nodes.length * 0.3) {
      gaps.push({
        id: generateId(),
        type: 'network',
        title: `引文网络碎片化: ${isolatedNodes.length}/${nodes.length} 个节点孤立`,
        description: `超过30%的论文在引文网络中无连接，可能存在多个不相关的研究子领域或引用数据不足`,
        severity: 'low',
        relatedPapers: isolatedNodes.slice(0, 5).map(n => n.id),
      })
    }
  }

  state.knowledgeGaps = gaps
  persistToDisk()

  console.log(`[研究引擎] 知识缺口识别完成: 发现 ${gaps.length} 个缺口`)
  return gaps
}

// ─── 5. 研究问题生成 ─────────────────────────────────────────────────────────────

/**
 * 基于已有文献和知识缺口生成研究问题
 *
 * @param {Object} options - 生成选项
 * @param {number} options.count - 生成的问题数量
 * @param {string} options.focusArea - 聚焦领域
 * @returns {Array} 研究问题列表
 */
function generateResearchQuestions(options = {}) {
  const count = options.count || 5
  const focusArea = options.focusArea || ''
  const questions = []

  // ── 5a. 基于知识缺口生成 ──
  for (const gap of state.knowledgeGaps) {
    if (questions.length >= count) break
    const question = deriveQuestionFromGap(gap)
    if (question) questions.push(question)
  }

  // ── 5b. 基于关键发现生成延伸问题 ──
  const allFindings = []
  for (const paper of state.papers) {
    for (const finding of (paper.keyFindings || [])) {
      allFindings.push({ ...finding, paper })
    }
  }

  const shuffled = allFindings.sort(() => Math.random() - 0.5)
  for (const finding of shuffled) {
    if (questions.length >= count) break
    const question = deriveQuestionFromFinding(finding, focusArea)
    if (question) questions.push(question)
  }

  // ── 5c. 基于文献元数据生成趋势问题 ──
  if (questions.length < count && state.papers.length > 0) {
    const metaQuestions = generateMetaQuestions(focusArea)
    for (const q of metaQuestions) {
      if (questions.length >= count) break
      questions.push(q)
    }
  }

  state.researchQuestions = questions
  persistToDisk()

  console.log(`[研究引擎] 研究问题生成完成: ${questions.length} 个问题`)
  return questions
}

/**
 * 从知识缺口推导研究问题
 */
function deriveQuestionFromGap(gap) {
  const templates = {
    temporal: '近年来{domain}领域的研究进展是否遇到了瓶颈？可能的突破方向是什么？',
    coverage: '{domain}领域中{aspect}方面的研究现状如何？是否存在未被充分探索的方向？',
    network: '{domain}领域的不同研究子领域之间是否存在关联性？如何促进跨领域合作？',
  }
  const template = templates[gap.type] || '关于{domain}的进一步研究应该关注哪些方面？'
  const domain = extractDomainFromContext()
  return {
    id: generateId(),
    question: template.replace('{domain}', domain).replace('{aspect}', gap.title),
    source: `knowledge-gap:${gap.type}`,
    gapId: gap.id,
    priority: gap.severity === 'high' ? 'high' : gap.severity === 'medium' ? 'medium' : 'low',
    rationale: gap.description,
  }
}

/**
 * 从关键发现推导研究问题
 */
function deriveQuestionFromFinding(finding, focusArea) {
  const text = finding.text || ''
  const templates = [
    '在{context}的基础上，如何进一步{action}？',
    '{context}的结论在{domain}场景下是否依然成立？',
    '哪些因素可能影响{context}中描述的结果？',
    '能否通过{method}来验证{context}的普适性？',
  ]
  const template = templates[Math.floor(Math.random() * templates.length)]
  const domain = extractDomainFromContext(focusArea)
  const context = truncate(text, 80)
  const actions = ['提升效果', '扩展应用', '降低成本', '提高效率', '简化流程']
  const methods = ['对比实验', '元分析', '系统综述', '大数据验证']
  const action = actions[Math.floor(Math.random() * actions.length)]
  const method = methods[Math.floor(Math.random() * methods.length)]

  return {
    id: generateId(),
    question: template
      .replace('{context}', context)
      .replace('{domain}', domain)
      .replace('{action}', action)
      .replace('{method}', method),
    source: `finding:${finding.type}`,
    paperId: finding.paper?.id,
    priority: 'medium',
    rationale: `基于发现: ${truncate(text, 100)}`,
  }
}

/**
 * 生成基于元数据的趋势研究问题
 */
function generateMetaQuestions(focusArea) {
  const domain = extractDomainFromContext(focusArea)
  const questions = [
    {
      id: generateId(),
      question: `${domain}领域的研究热点在过去五年中发生了怎样的变化？`,
      source: 'meta:trend',
      priority: 'medium',
      rationale: '基于文献元数据的时间趋势分析',
    },
    {
      id: generateId(),
      question: `${domain}领域中哪些研究主题的影响力在上升？哪些在下降？`,
      source: 'meta:impact',
      priority: 'medium',
      rationale: '基于引文网络的影响力分析',
    },
    {
      id: generateId(),
      question: `新兴技术如何改变${domain}领域的研究范式？`,
      source: 'meta:emerging',
      priority: 'high',
      rationale: '基于技术演进的趋势预测',
    },
  ]
  return questions
}

/**
 * 从上下文提取研究领域
 */
function extractDomainFromContext(focusArea) {
  if (focusArea) return focusArea
  if (state.papers.length === 0) return '当前'
  const sources = {}
  for (const paper of state.papers) {
    sources[paper.source] = (sources[paper.source] || 0) + 1
  }
  const dominantSource = Object.entries(sources).sort((a, b) => b[1] - a[1])[0]
  return dominantSource ? `${dominantSource[0]}相关` : '当前'
}

// ─── 6. 研究成果导出 ─────────────────────────────────────────────────────────────

/**
 * 将研究成果导出为指定格式
 *
 * @param {Object} options - 导出选项
 * @param {string} options.format - 导出格式 ('json' | 'markdown' | 'csv')
 * @param {string} options.filename - 导出文件名（不含扩展名）
 * @param {boolean} options.includePapers - 是否包含论文详情
 * @param {boolean} options.includeGraph - 是否包含引文网络
 * @param {boolean} options.includeGaps - 是否包含知识缺口
 * @param {boolean} options.includeQuestions - 是否包含研究问题
 * @returns {Promise<string>} 导出文件的路径
 */
async function exportResearchFindings(options = {}) {
  const format = options.format || 'json'
  const filename = options.filename || `research-export-${Date.now()}`
  const includePapers = options.includePapers !== false
  const includeGraph = options.includeGraph !== false
  const includeGaps = options.includeGaps !== false
  const includeQuestions = options.includeQuestions !== false

  const exportData = {
    exportedAt: new Date().toISOString(),
    summary: {
      totalPapers: state.papers.length,
      totalCitations: state.citationGraph.edges.length,
      knowledgeGaps: state.knowledgeGaps.length,
      researchQuestions: state.researchQuestions.length,
    },
  }

  if (includePapers) {
    exportData.papers = state.papers.map(paper => ({
      id: paper.id,
      title: paper.title,
      authors: paper.authors,
      abstract: truncate(paper.abstract, 300),
      publishedAt: paper.publishedAt,
      source: paper.source,
      url: paper.url,
      keyFindings: paper.keyFindings?.map(f => ({
        text: truncate(f.text, 200),
        type: f.type,
      })) || [],
    }))
  }

  if (includeGraph) {
    exportData.citationGraph = state.citationGraph
  }

  if (includeGaps) {
    exportData.knowledgeGaps = state.knowledgeGaps
  }

  if (includeQuestions) {
    exportData.researchQuestions = state.researchQuestions
  }

  let content = ''
  let extension = ''

  switch (format) {
    case 'json':
      content = JSON.stringify(exportData, null, 2)
      extension = '.json'
      break
    case 'markdown':
      content = renderMarkdownExport(exportData)
      extension = '.md'
      break
    case 'csv':
      content = renderCsvExport(exportData)
      extension = '.csv'
      break
    default:
      content = JSON.stringify(exportData, null, 2)
      extension = '.json'
  }

  const filePath = path.join(EXPORT_DIR, `${filename}${extension}`)
  fs.writeFileSync(filePath, content, 'utf8')
  console.log(`[研究引擎] 导出完成: ${filePath}`)

  return filePath
}

/**
 * 渲染 Markdown 格式导出
 */
function renderMarkdownExport(data) {
  const sections = []
  sections.push(`# 研究成果导出报告`)
  sections.push(``)
  sections.push(`> 导出时间: ${data.exportedAt}`)
  sections.push(``)
  sections.push(`## 📊 研究概览`)
  sections.push(``)
  sections.push(`| 指标 | 数量 |`)
  sections.push(`|------|------|`)
  sections.push(`| 论文总数 | ${data.summary.totalPapers} |`)
  sections.push(`| 引文关系数 | ${data.summary.totalCitations} |`)
  sections.push(`| 知识缺口数 | ${data.summary.knowledgeGaps} |`)
  sections.push(`| 研究问题数 | ${data.summary.researchQuestions} |`)
  sections.push(``)

  if (data.papers && data.papers.length > 0) {
    sections.push(`## 📚 文献列表`)
    sections.push(``)
    for (const paper of data.papers) {
      sections.push(`### ${paper.title}`)
      sections.push(`- **作者**: ${(paper.authors || []).join(', ') || '未知'}`)
      sections.push(`- **来源**: ${paper.source}`)
      sections.push(`- **时间**: ${paper.publishedAt || '未知'}`)
      sections.push(`- **链接**: ${paper.url || 'N/A'}`)
      if (paper.abstract) {
        sections.push(`- **摘要**: ${paper.abstract}`)
      }
      if (paper.keyFindings && paper.keyFindings.length > 0) {
        sections.push(`- **关键发现**:`)
        for (const f of paper.keyFindings) {
          sections.push(`  - [${f.type}] ${f.text}`)
        }
      }
      sections.push(``)
    }
  }

  if (data.knowledgeGaps && data.knowledgeGaps.length > 0) {
    sections.push(`## 🔍 知识缺口`)
    sections.push(``)
    for (const gap of data.knowledgeGaps) {
      sections.push(`### ${gap.title}`)
      sections.push(`- **类型**: ${gap.type}`)
      sections.push(`- **严重程度**: ${gap.severity}`)
      sections.push(`- **描述**: ${gap.description}`)
      sections.push(``)
    }
  }

  if (data.researchQuestions && data.researchQuestions.length > 0) {
    sections.push(`## ❓ 研究问题`)
    sections.push(``)
    for (const q of data.researchQuestions) {
      sections.push(`### ${q.question}`)
      sections.push(`- **来源**: ${q.source}`)
      sections.push(`- **优先级**: ${q.priority}`)
      sections.push(`- **理由**: ${q.rationale || 'N/A'}`)
      sections.push(``)
    }
  }

  if (data.citationGraph) {
    sections.push(`## 🔗 引文网络`)
    sections.push(``)
    sections.push(`- **节点数**: ${data.citationGraph.nodes.length}`)
    sections.push(`- **边数**: ${data.citationGraph.edges.length}`)
    sections.push(``)
  }

  return sections.join('\n')
}

/**
 * 渲染 CSV 格式导出
 */
function renderCsvExport(data) {
  const lines = []
  lines.push('type,id,title,authors,source,year,url,details')

  if (data.papers) {
    for (const p of data.papers) {
      lines.push([
        'paper',
        p.id,
        `"${(p.title || '').replace(/"/g, '""')}"`,
        `"${(p.authors || []).join('; ').replace(/"/g, '""')}"`,
        p.source,
        p.publishedAt || '',
        `"${(p.url || '').replace(/"/g, '""')}"`,
        `"${(p.abstract || '').replace(/"/g, '""').slice(0, 200)}"`,
      ].join(','))
    }
  }

  if (data.knowledgeGaps) {
    for (const g of data.knowledgeGaps) {
      lines.push([
        'gap',
        g.id,
        `"${(g.title || '').replace(/"/g, '""')}"`,
        '',
        `gap:${g.type}`,
        '',
        '',
        `"${(g.description || '').replace(/"/g, '""')}"`,
      ].join(','))
    }
  }

  if (data.researchQuestions) {
    for (const q of data.researchQuestions) {
      lines.push([
        'question',
        q.id,
        `"${(q.question || '').replace(/"/g, '""')}"`,
        '',
        q.source,
        '',
        '',
        `"${(q.rationale || '').replace(/"/g, '""')}"`,
      ].join(','))
    }
  }

  return lines.join('\n')
}

// ─── 状态查询 ─────────────────────────────────────────────────────────────────────

/**
 * 获取研究引擎的当前状态
 *
 * @returns {Object} 状态信息
 */
function getResearchStatus() {
  return {
    initialized: state.initialized,
    statistics: {
      totalPapers: state.papers.length,
      papersBySource: countByField(state.papers, 'source'),
      papersByYear: countByField(state.papers, 'publishedAt'),
      totalCitations: state.citationGraph.edges.length,
      citationNodes: state.citationGraph.nodes.length,
      knowledgeGaps: state.knowledgeGaps.length,
      researchQuestions: state.researchQuestions.length,
      keyFindingsTotal: state.papers.reduce((sum, p) => sum + (p.keyFindings?.length || 0), 0),
    },
    config: { ...state.config },
    lastUpdated: new Date().toISOString(),
  }
}

/**
 * 统计字段值分布
 */
function countByField(items, field) {
  const counts = {}
  for (const item of items) {
    const val = item[field] || 'unknown'
    counts[val] = (counts[val] || 0) + 1
  }
  return counts
}

// ─── 初始化 ───────────────────────────────────────────────────────────────────────

/**
 * 初始化研究引擎
 * 创建存储目录，加载历史数据
 *
 * @param {Object} options - 配置选项
 * @param {number} options.maxResultsPerQuery - 每次搜索最大结果数
 * @param {number} options.searchTimeoutMs - 搜索超时时间（毫秒）
 * @param {number} options.minRelevanceScore - 最小相关性评分
 */
function initResearchEngine(options = {}) {
  if (state.initialized) {
    console.warn('[研究引擎] 已初始化，跳过重复初始化')
    return state
  }

  if (options.maxResultsPerQuery) {
    state.config.maxResultsPerQuery = options.maxResultsPerQuery
  }
  if (options.searchTimeoutMs) {
    state.config.searchTimeoutMs = options.searchTimeoutMs
  }
  if (options.minRelevanceScore !== undefined) {
    state.config.minRelevanceScore = options.minRelevanceScore
  }

  ensureStorage()
  loadFromDisk()

  state.initialized = true
  console.log(`[研究引擎] 初始化完成: ${state.papers.length} 篇论文，${state.knowledgeGaps.length} 个知识缺口`)

  return state
}

// ─── 导出接口 ─────────────────────────────────────────────────────────────────────

export {
  initResearchEngine,
  searchLiterature,
  extractKeyFindings,
  buildCitationNetwork,
  identifyKnowledgeGaps,
  generateResearchQuestions,
  getResearchStatus,
  exportResearchFindings,
}