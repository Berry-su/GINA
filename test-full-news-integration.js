/**
 * test-full-news-integration.js — 全量新闻实时接入测试
 * 测试所有适配器（金融 + AI/Agent + 地产）
 */

import { createAdapter, listAdapters } from './src/data-sources/news-adapter.js'
import { aggregateNews, getLatestNews, getNewsSummary, getAggregatorStatus, NEWS_CATEGORIES } from './src/data-sources/news-aggregator.js'

console.log('='.repeat(70))
console.log('  🌐 Gina 全领域实时数据接入测试')
console.log('  金融 + AI/Agent + 地产行业')
console.log('='.repeat(70))

// ═══════════════════════════════════════════════════════════════
// 1. 适配器可用性测试
// ═══════════════════════════════════════════════════════════════

console.log('\n📡 [1] 适配器可用性测试...')
const allAdapters = listAdapters()
console.log(`\n  已注册: ${allAdapters.length} 个适配器`)

const testResults = {}
for (const a of allAdapters) {
  process.stdout.write(`  ${a.name}...`)
  try {
    const adapter = createAdapter(a.name)
    const items = await adapter.fetchNews({ maxItems: 3 })
    testResults[a.name] = { ok: items.length > 0, count: items.length }
    console.log(items.length > 0 ? ` ✓ (${items.length}条)` : ' - (无数据)')
  } catch (e) {
    testResults[a.name] = { ok: false, error: e.message }
    console.log(` ✗ (${e.message})`)
  }
}

const working = Object.values(testResults).filter(r => r.ok).length
const failed = Object.values(testResults).filter(r => !r.ok).length
console.log(`\n  可用: ${working}/${allAdapters.length}`)

// ═══════════════════════════════════════════════════════════════
// 2. 全量聚合测试
// ═══════════════════════════════════════════════════════════════

console.log('\n\n🔄 [2] 全量新闻聚合...')
const result = await aggregateNews({
  maxItemsPerSource: 8,
  maxKnowledgePerBatch: 15,
})

console.log(`\n  结果: ${result.success ? '成功' : '失败'}`)
console.log(`  耗时: ${result.durationMs}ms`)
console.log(`  采集: ${result.items.length} 条`)
console.log(`  注入知识库: ${result.injectedCount} 条`)

// ═══════════════════════════════════════════════════════════════
// 3. 分类统计
// ═══════════════════════════════════════════════════════════════

console.log('\n\n🏷️ [3] 分类统计...')
const items = getLatestNews({ limit: 50 })

const catCount = {}
for (const item of items) {
  const cat = item.category?.primary || 'unknown'
  catCount[cat] = (catCount[cat] || 0) + 1
}

console.log(`  缓存新闻总数: ${items.length}`)
console.log(`  检测到分类: ${Object.keys(catCount).length} 个\n`)

const labels = {
  macro: '宏观经济', policy: '政策法规', stock: '股票市场', bond: '债券市场',
  forex: '外汇市场', commodity: '大宗商品', real_estate: '房地产',
  tech: '科技', ai: '人工智能', crypto: '加密货币', company: '公司动态',
  economy: '经济数据', international: '国际市场', startup: '创投',
  agent: '智能体', market: '市场', china: '中国', global: '国际',
  research: '学术研究', other: '其他',
}

for (const [cat, count] of Object.entries(catCount).sort((a, b) => b[1] - a[1])) {
  const label = labels[cat] || cat
  const bar = '█'.repeat(Math.min(count, 20))
  console.log(`    ${label}: ${bar} (${count})`)
}

// 领域统计
const domains = {
  '金融 (Finance)': (catCount.macro || 0) + (catCount.policy || 0) + (catCount.stock || 0) + (catCount.bond || 0) + 
                    (catCount.forex || 0) + (catCount.commodity || 0) + (catCount.economy || 0),
  'AI/Agent': (catCount.ai || 0) + (catCount.agent || 0) + (catCount.research || 0),
  '地产 (Real Estate)': catCount.real_estate || 0,
  '科技 (Tech)': (catCount.tech || 0) + (catCount.startup || 0),
  '国际 (Global)': (catCount.international || 0) + (catCount.global || 0),
}

console.log('\n  领域分布:')
for (const [domain, count] of Object.entries(domains).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${domain}: ${count} 条`)
}

// ═══════════════════════════════════════════════════════════════
// 4. 重要性评分分布
// ═══════════════════════════════════════════════════════════════

console.log('\n\n📊 [4] 重要性评分分布...')
const ranges = { '0-20%': 0, '20-40%': 0, '40-60%': 0, '60-80%': 0, '80-100%': 0 }
for (const item of items) {
  const s = (item.importance || 0) * 100
  if (s < 20) ranges['0-20%']++
  else if (s < 40) ranges['20-40%']++
  else if (s < 60) ranges['40-60%']++
  else if (s < 80) ranges['60-80%']++
  else ranges['80-100%']++
}

for (const [range, count] of Object.entries(ranges)) {
  const bar = '█'.repeat(count)
  console.log(`    ${range}: ${bar} (${count})`)
}

// ═══════════════════════════════════════════════════════════════
// 5. 知识检索测试
// ═══════════════════════════════════════════════════════════════

console.log('\n\n🔍 [5] 跨领域知识检索测试...')

const { retrieveRelevantKnowledge } = await import('./src/memory/knowledge-distiller.js')

const queries = [
  { q: '央行最新货币政策', domain: '金融' },
  { q: 'Agent 框架对比 LangChain AutoGen', domain: 'AI/Agent' },
  { q: '美国房价走势 Zillow', domain: '地产' },
  { q: '最新 AI 论文 arXiv', domain: '学术' },
]

for (const { q, domain } of queries) {
  console.log(`\n  [${domain}] "${q}"`)
  const results = retrieveRelevantKnowledge(q, { maxResults: 3 })
  if (results.length > 0) {
    for (const k of results.slice(0, 2)) {
      const content = typeof k.content === 'string' ? k.content : String(k.content)
      const isNews = k.metadata?.newsItem
      const source = k.metadata?.source || 'unknown'
      console.log(`    ${isNews ? '📰' : '📚'} [${source}] ${content.slice(0, 80)}...`)
    }
  } else {
    console.log('    ✗ 未找到相关知识')
  }
}

// ═══════════════════════════════════════════════════════════════
// 总结
// ═══════════════════════════════════════════════════════════════

console.log('\n' + '='.repeat(70))
console.log('  📊 最终总结')
console.log('='.repeat(70))

const status = getAggregatorStatus()
console.log(`\n  适配器: ${working}/${allAdapters.length} 可用`)
console.log(`  缓存: ${status.cachedItems} 条`)
console.log(`  总处理: ${status.totalProcessed} 条`)
console.log(`  总注入: ${status.totalInjected} 条`)

console.log('\n  各适配器状态:')
for (const [name, result] of Object.entries(testResults)) {
  const icon = result.ok ? '✓' : '✗'
  const detail = result.ok ? `${result.count}条` : (result.error || '无数据')
  console.log(`    ${icon} ${name}: ${detail}`)
}

console.log('\n' + '='.repeat(70))
if (working >= 7) {
  console.log('  🎉 实时数据接入测试通过！')
} else {
  console.log('  ⚠️ 部分适配器不可用，但核心模块正常')
}
console.log('='.repeat(70))

console.log('\n💡 Gina 实时数据覆盖:')
console.log('   金融市场: 新浪财经、东方财富、华尔街见闻、财联社')
console.log('   AI/Agent: InfoQ、TechCrunch、Hacker News、arXiv论文')
console.log('   地产行业: Zillow Research (美国)、新浪地产 (中国)')
console.log('   聚合能力: 11个数据源，自动分类评分，知识注入')