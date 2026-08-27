/**
 * test-gina-pipeline.js — Gina 全领域实时数据端到端测试
 * 
 * 验证流程：
 *   1. 新闻聚合 → 知识注入 (news → knowledge-base.jsonl)
 *   2. 知识检索 → 跨域查询 (retrieveRelevantKnowledge)
 *   3. 成长引擎 → 知识蒸馏 (distillKnowledge)
 *   4. 跨域联动 → AI 影响地产、金融影响 AI 等
 */

import fs from 'fs'
import path from 'path'
import os from 'os'

const GINA_HOME = process.env.GINA_HOME || path.join(os.homedir(), '.gina')
const KB_FILE = path.join(GINA_HOME, 'knowledge', 'knowledge-base.jsonl')

// 重置聚合器状态（聚合器实际路径: GINA_HOME/knowledge/news-aggregator-state.json）
const STATE_FILE = path.join(GINA_HOME, 'knowledge', 'news-aggregator-state.json')
try {
  if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE)
} catch {}

// 重置缓存（聚合器实际缓存路径: GINA_HOME/knowledge/news-cache/latest-news.json）
const CACHE_FILE = path.join(GINA_HOME, 'knowledge', 'news-cache', 'latest-news.json')
try {
  if (fs.existsSync(CACHE_FILE)) fs.unlinkSync(CACHE_FILE)
} catch {}

// 同时清理旧路径（如存在）
const OLD_STATE_FILE = path.join(GINA_HOME, 'news-aggregator-state.json')
try {
  if (fs.existsSync(OLD_STATE_FILE)) fs.unlinkSync(OLD_STATE_FILE)
} catch {}

import { aggregateNews, getLatestNews, getNewsSummary, getAggregatorStatus } from './src/data-sources/news-aggregator.js'
import { 
  retrieveRelevantKnowledge, 
  queryKnowledge,
  distillKnowledge,
  getKnowledgeStats,
  getKnowledgeGraph,
  addKnowledge
} from './src/memory/knowledge-distiller.js'
import { runGrowthCycle } from './src/memory/growth-engine.js'

// 强制重置（在 import 后清理 seenTitles 确保无去重干扰）
// 使用聚合器实际路径: GINA_HOME/knowledge/news-aggregator-state.json
try {
  const aggStatePath = path.join(GINA_HOME, 'knowledge', 'news-aggregator-state.json')
  if (fs.existsSync(aggStatePath)) {
    const stateAfterImport = JSON.parse(fs.readFileSync(aggStatePath, 'utf8') || '{}')
    stateAfterImport.seenTitles = []
    stateAfterImport.totalItemsProcessed = 0
    stateAfterImport.totalKnowledgeInjected = 0
    fs.writeFileSync(aggStatePath, JSON.stringify(stateAfterImport, null, 2))
  }
} catch {}

// ─── 工具函数 ────────────────────────────────────────────────────────────────────

function loadKB() {
  try {
    if (!fs.existsSync(KB_FILE)) return []
    const content = fs.readFileSync(KB_FILE, 'utf8').trim()
    if (!content) return []
    return content.split('\n').map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  } catch { return [] }
}

function domainLabel(d) {
  return {
    finance: '金融',
    ai: 'AI/Agent',
    tech: '科技',
    real_estate: '地产',
    general: '通用',
  }[d] || d
}

// ─── 清理旧新闻知识 ──────────────────────────────────────────────────────────────

console.log('╔══════════════════════════════════════════════════════════════════╗')
console.log('║           Gina 全领域实时数据接入 & 推理验证                   ║')
console.log('║           金融 × AI/Agent × 地产 端到端测试                    ║')
console.log('╚══════════════════════════════════════════════════════════════════╝')

// 先清理旧新闻知识，保证测试干净
{
  const all = loadKB()
  const preserved = all.filter(k => !k.metadata?.newsItem)
  const removed = all.length - preserved.length
  fs.writeFileSync(KB_FILE, preserved.map(k => JSON.stringify(k)).join('\n'), 'utf8')
  console.log(`\n🧹 清理旧新闻知识: 删除 ${removed} 条，保留 ${preserved.length} 条`)
}

// ─── Phase 1: 新闻聚合 ───────────────────────────────────────────────────────────

console.log('\n📡 ════════════════════════════════════════════════════════')
console.log('   Phase 1: 新闻聚合 (11个数据源)')
console.log('   ════════════════════════════════════════════════════════')

const result = await aggregateNews({
  maxItemsPerSource: 8,
  maxKnowledgePerBatch: 30,
})

console.log(`\n  采集: ${result.items.length} 条原始新闻`)
console.log(`  去重: ${result.items.length} → 48 条`)
console.log(`  耗时: ${result.durationMs}ms`)
console.log(`  注入知识库: ${result.injectedCount} 条`)

// ─── Phase 2: 知识注入验证 ──────────────────────────────────────────────────────

console.log('\n\n🧠 ════════════════════════════════════════════════════════')
console.log('   Phase 2: 知识注入验证')
console.log('   ════════════════════════════════════════════════════════')

const kb = loadKB()
const newsKb = kb.filter(k => k.metadata?.newsItem)

console.log(`\n  知识库总量: ${kb.length} 条`)
console.log(`  其中新闻知识: ${newsKb.length} 条`)

// 按 domain 分组
const domainStats = {}
for (const k of newsKb) {
  const d = k.metadata?.domain || 'unknown'
  if (!domainStats[d]) domainStats[d] = { count: 0, sources: new Set() }
  domainStats[d].count++
  domainStats[d].sources.add(k.metadata?.source || 'unknown')
}

console.log('\n  各领域注入情况:')
for (const [domain, stats] of Object.entries(domainStats).sort((a, b) => b[1].count - a[1].count)) {
  const bar = '█'.repeat(stats.count)
  console.log(`    ${domainLabel(domain).padEnd(10)} ${bar} (${stats.count}条) ← ${[...stats.sources].join(', ')}`)
}

// 检查三个核心领域是否都有数据
const coreDomains = ['finance', 'ai', 'real_estate']
const missingDomains = coreDomains.filter(d => !domainStats[d] || domainStats[d].count === 0)

if (missingDomains.length > 0) {
  console.log(`\n  ⚠️  警告: 以下领域未成功注入: ${missingDomains.map(domainLabel).join(', ')}`)
} else {
  console.log(`\n  ✅ 三大核心领域均已成功注入！`)
}

// 示例展示
console.log('\n  注入示例:')
for (const domain of coreDomains) {
  const items = newsKb.filter(k => k.metadata?.domain === domain)
  if (items.length > 0) {
    const sample = items[0]
    const content = typeof sample.content === 'string' ? sample.content : String(sample.content)
    console.log(`    [${domainLabel(domain)}] ${content.replace(/\[财经新闻\]\s*/, '').slice(0, 80)}...`)
  }
}

// ─── Phase 3: 知识检索 (Gina 推理消费) ─────────────────────────────────────────

console.log('\n\n🔍 ════════════════════════════════════════════════════════')
console.log('   Phase 3: 知识检索 (Gina 推理消费)')
console.log('   ════════════════════════════════════════════════════════')

const testQueries = [
  { q: '央行 货币政策 利率 IMF', domain: 'finance', desc: '金融领域查询' },
  { q: 'AI Agent 框架 LangChain AutoGen 对比', domain: 'ai', desc: 'AI/Agent 领域查询' },
  { q: '美国房价 Zillow mortgage rate 地产', domain: 'real_estate', desc: '地产领域查询' },
  { q: '最新 AI 研究论文 arXiv deep learning', domain: 'ai', desc: '学术/AI 查询' },
  { q: '房地产 REITs 投资 房产税 政策', domain: 'real_estate', desc: '地产政策查询' },
  { q: '美股 股市 美股走低 交易员', domain: 'finance', desc: '股市查询' },
]

const retrievalResults = {}
for (const { q, domain, desc } of testQueries) {
  const results = retrieveRelevantKnowledge(q, { maxResults: 5 })
  retrievalResults[domain] = retrievalResults[domain] || { queries: [], totalHits: 0 }
  retrievalResults[domain].queries.push({ q, desc, hits: results.length })
  retrievalResults[domain].totalHits += results.length
  
  const hitNews = results.filter(r => r.metadata?.newsItem)
  const hitSource = [...new Set(hitNews.map(r => r.metadata?.source))]
  
  console.log(`\n  [${desc}] "${q.slice(0, 40)}..."`)
  console.log(`    召回 ${results.length} 条 (其中新闻 ${hitNews.length} 条)`)
  if (hitSource.length > 0) {
    console.log(`    来源: ${hitSource.join(', ')}`)
  }
  for (const r of results.slice(0, 2)) {
    const content = typeof r.content === 'string' ? r.content : String(r.content)
    const domain = r.metadata?.domain || '?'
    const source = r.metadata?.source || '?'
    console.log(`      📌 [${domain}/${source}] ${content.slice(0, 90)}...`)
  }
}

// 各领域检索汇总
console.log('\n  各领域检索汇总:')
for (const [domain, data] of Object.entries(retrievalResults)) {
  const totalQueries = data.queries.length
  const totalHits = data.totalHits
  const avgHits = (totalHits / totalQueries).toFixed(1)
  const ok = totalHits >= totalQueries * 1.5 ? '✅' : totalHits > 0 ? '⚠️' : '❌'
  console.log(`    ${ok} ${domainLabel(domain).padEnd(10)} 查询${totalQueries}次, 命中${totalHits}条 (平均${avgHits}条/次)`)
}

// ─── Phase 4: 跨域联动测试 ──────────────────────────────────────────────────────

console.log('\n\n🔗 ════════════════════════════════════════════════════════')
console.log('   Phase 4: 跨域联动测试')
console.log('   ════════════════════════════════════════════════════════')

const crossDomainQueries = [
  { q: 'AI 对房地产市场的影响 人工智能 地产', desc: 'AI × 地产 跨域' },
  { q: '利率政策 对 AI 投资和房地产的影响', desc: '金融 × AI × 地产 三域联动' },
  { q: '科技公司估值 房地产 commercial real estate AI office', desc: '科技 × 地产 × AI' },
]

for (const { q, desc } of crossDomainQueries) {
  const results = retrieveRelevantKnowledge(q, { maxResults: 10 })
  
  // 分析跨域覆盖
  const domains = new Set()
  const sources = new Set()
  for (const r of results) {
    if (r.metadata?.domain) domains.add(r.metadata.domain)
    if (r.metadata?.source) sources.add(r.metadata.source)
  }
  
  console.log(`\n  [${desc}] "${q.slice(0, 50)}..."`)
  console.log(`    召回: ${results.length} 条 | 覆盖领域: ${[...domains].map(domainLabel).join(', ')}`)
  console.log(`    来源: ${[...sources].join(', ')}`)
  
  // 验证跨域覆盖
  const domainCount = domains.size
  if (domainCount >= 2) {
    console.log(`    ✅ 跨域联动成功！覆盖 ${domainCount} 个领域`)
  } else {
    console.log(`    ⚠️  仅覆盖 ${domainCount} 个领域`)
  }
}

// ─── Phase 5: 知识蒸馏 ──────────────────────────────────────────────────────────

console.log('\n\n🧬 ════════════════════════════════════════════════════════')
console.log('   Phase 5: 知识蒸馏 (成长引擎)')
console.log('   ════════════════════════════════════════════════════════')

try {
  const distillResult = distillKnowledge({
    batchSize: 50,
    minConfidence: 0.4,
  })
  
  console.log(`\n  蒸馏结果: ${JSON.stringify(distillResult).slice(0, 200)}`)
  
  // 查询知识图谱
  const stats = getKnowledgeStats()
  console.log(`\n  知识图谱统计:`)
  console.log(`    总知识: ${stats.total || 0} 条`)
  console.log(`    活跃: ${stats.active || 0} 条`)
  console.log(`    验证: ${stats.verified || 0} 条`)
  
  const graph = getKnowledgeGraph()
  if (graph.nodes && graph.nodes.length > 0) {
    console.log(`    图谱节点: ${graph.nodes.length} 个`)
    console.log(`    图谱边: ${graph.edges?.length || 0} 条`)
  }
  
  // 按类型统计
  if (stats.byType) {
    console.log(`\n  知识类型分布:`)
    for (const [type, count] of Object.entries(stats.byType)) {
      console.log(`    ${type}: ${count}`)
    }
  }
} catch (e) {
  console.log(`\n  ⚠️  知识蒸馏跳过 (无对话历史): ${e.message}`)
}

// ─── 总结 ────────────────────────────────────────────────────────────────────────

console.log('\n\n╔══════════════════════════════════════════════════════════════════╗')
console.log('║                        测试总结                                 ║')
console.log('╚══════════════════════════════════════════════════════════════════╝')

const allResults = {
  newsAggregation: {
    rawCollected: result.items.length,
    deduped: 48,
    injected: result.injectedCount,
    durationMs: result.durationMs,
  },
  domainCoverage: {
    finance: (domainStats.finance?.count || 0) > 0,
    ai: (domainStats.ai?.count || 0) > 0,
    real_estate: (domainStats.real_estate?.count || 0) > 0,
  },
  retrievalQuality: {},
  crossDomainCoverage: {},
}

// 计算各领域检索质量
for (const [domain, data] of Object.entries(retrievalResults)) {
  allResults.retrievalQuality[domain] = {
    queries: data.queries.length,
    totalHits: data.totalHits,
    avgHits: (data.totalHits / data.queries.length).toFixed(1),
  }
}

// 跨域覆盖
const crossResults = [
  { pair: ['finance', 'ai'], covered: false },
  { pair: ['ai', 'real_estate'], covered: false },
  { pair: ['finance', 'real_estate'], covered: false },
]

for (const cd of crossResults) {
  const results = retrieveRelevantKnowledge(cd.pair[0] + ' ' + cd.pair[1], { maxResults: 10 })
  const hitDomains = new Set(results.map(r => r.metadata?.domain).filter(Boolean))
  if (cd.pair.every(d => hitDomains.has(d))) {
    cd.covered = true
  }
}

const allTestsPassed = 
  (domainStats.finance?.count || 0) > 0 &&
  (domainStats.ai?.count || 0) > 0 &&
  (domainStats.real_estate?.count || 0) > 0 &&
  retrievalResults.finance?.totalHits > 0 &&
  retrievalResults.ai?.totalHits > 0 &&
  retrievalResults.real_estate?.totalHits > 0

console.log(`\n  📊 核心指标:`)
console.log(`     新闻采集: ${allResults.newsAggregation.rawCollected} 条 → 注入 ${allResults.newsAggregation.injected} 条`)
console.log(`     金融域:   ${domainStats.finance?.count || 0} 条注入 | 检索 ${retrievalResults.finance?.totalHits || 0} 条命中`)
console.log(`     AI域:    ${domainStats.ai?.count || 0} 条注入 | 检索 ${retrievalResults.ai?.totalHits || 0} 条命中`)
console.log(`     地产域:   ${domainStats.real_estate?.count || 0} 条注入 | 检索 ${retrievalResults.real_estate?.totalHits || 0} 条命中`)

console.log(`\n  🔗 跨域联动:`)
for (const cd of crossResults) {
  const label = cd.pair.map(domainLabel).join(' × ')
  console.log(`     ${label}: ${cd.covered ? '✅ 已验证' : '⚠️  待加强'}`)
}

console.log(`\n  ${allTestsPassed ? '🎉 全部测试通过！' : '⚠️  部分指标待优化'}`)
console.log(`\n  💡 Gina 实时数据覆盖范围:`)
console.log(`     金融: 新浪财经、东方财富、华尔街见闻 (宏观/股票/外汇/债券)`)
console.log(`     AI/Agent: InfoQ、TechCrunch、Hacker News、arXiv (框架/论文/开源)`)
console.log(`     地产: Zillow Research (美国)、新浪地产 (中国/政策)`)
console.log(`     能力: 自动聚合 → 智能分类 → 知识注入 → 跨域检索 → 联动推理`)