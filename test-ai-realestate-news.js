/**
 * test-ai-realestate-news.js — AI/Agent + 地产行业实时数据接入测试
 *
 * 测试新适配器的数据采集、分类和知识注入
 */

import { createAdapter, listAdapters } from './src/data-sources/news-adapter.js'
import { aggregateNews, getLatestNews, getNewsSummary, getAggregatorStatus, NEWS_CATEGORIES } from './src/data-sources/news-aggregator.js'

console.log('='.repeat(70))
console.log('  🤖 Gina AI/Agent + 地产行业实时数据接入测试')
console.log('='.repeat(70))

// ═══════════════════════════════════════════════════════════════
// 1. 测试新适配器可用性
// ═══════════════════════════════════════════════════════════════

console.log('\n📡 [1] 新适配器数据采集测试...')

const newAdapters = ['kr36', 'infoq', 'techcrunch_ai', 'hackernews', 'zillow_research', 'sina_realestate']
const results = {}

for (const name of newAdapters) {
  process.stdout.write(`\n  📰 测试 ${name}...`)
  try {
    const adapter = createAdapter(name)
    const items = await adapter.fetchNews({ maxItems: 5 })
    results[name] = { success: items.length > 0, count: items.length }
    
    if (items.length > 0) {
      console.log(` ✓ 获取 ${items.length} 条`)
      console.log(`    第一条: ${items[0].title?.slice(0, 60)}`)
      console.log(`    分类: ${items[0].categories?.join(', ') || 'N/A'}`)
    } else {
      console.log(' - 无数据（可能非交易时段或网络问题）')
    }
  } catch (e) {
    results[name] = { success: false, error: e.message }
    console.log(` ✗ 失败: ${e.message}`)
  }
}

// ═══════════════════════════════════════════════════════════════
// 2. 测试适配器注册
// ═══════════════════════════════════════════════════════════════

console.log('\n\n📋 [2] 适配器注册表...')
const allAdapters = listAdapters()
console.log(`  已注册适配器总数: ${allAdapters.length}`)
for (const a of allAdapters) {
  console.log(`    - ${a.name} (${a.categories?.join(', ')})`)
}

// ═══════════════════════════════════════════════════════════════
// 3. 测试完整聚合流程（包含所有新适配器）
// ═══════════════════════════════════════════════════════════════

console.log('\n\n🔄 [3] 全量聚合测试（所有适配器）...')
const aggResult = await aggregateNews({
  adapters: newAdapters, // 只测试新适配器
  maxItemsPerSource: 5,
  maxKnowledgePerBatch: 10,
})

console.log(`\n  聚合结果:`)
console.log(`    成功: ${aggResult.success}`)
console.log(`    耗时: ${aggResult.durationMs}ms`)
console.log(`    新闻总数: ${aggResult.items.length}`)
console.log(`    知识注入: ${aggResult.injectedCount}`)

// ═══════════════════════════════════════════════════════════════
// 4. 测试分类准确性
// ═══════════════════════════════════════════════════════════════

console.log('\n\n🏷️ [4] 分类准确性测试...')
const allItems = getLatestNews({ limit: 30 })

const categoryStats = {}
for (const item of allItems) {
  const cat = item.category?.primary || 'unknown'
  categoryStats[cat] = (categoryStats[cat] || 0) + 1
}

console.log('  分类统计:')
for (const [cat, count] of Object.entries(categoryStats).sort((a, b) => b[1] - a[1])) {
  const label = getCategoryLabel(cat)
  console.log(`    ${label}: ${count} 条`)
}

// AI 类别测试
const aiItems = allItems.filter(i => 
  i.category?.primary === NEWS_CATEGORIES.AI || 
  i.category?.all?.includes(NEWS_CATEGORIES.AI)
)
console.log(`\n  AI/Agent 相关新闻: ${aiItems.length} 条`)
for (const item of aiItems.slice(0, 3)) {
  console.log(`    - ${item.title?.slice(0, 70)}...`)
}

// 地产类别测试
const reItems = allItems.filter(i => 
  i.category?.primary === NEWS_CATEGORIES.REAL_ESTATE || 
  i.category?.all?.includes(NEWS_CATEGORIES.REAL_ESTATE)
)
console.log(`\n  地产相关新闻: ${reItems.length} 条`)
for (const item of reItems.slice(0, 3)) {
  console.log(`    - ${item.title?.slice(0, 70)}...`)
}

// ═══════════════════════════════════════════════════════════════
// 5. 测试重要性评分
// ═══════════════════════════════════════════════════════════════

console.log('\n\n📊 [5] 重要性评分分布...')
const scoreRanges = { '0-20%': 0, '20-40%': 0, '40-60%': 0, '60-80%': 0, '80-100%': 0 }
for (const item of allItems) {
  const score = (item.importance || 0) * 100
  if (score < 20) scoreRanges['0-20%']++
  else if (score < 40) scoreRanges['20-40%']++
  else if (score < 60) scoreRanges['40-60%']++
  else if (score < 80) scoreRanges['60-80%']++
  else scoreRanges['80-100%']++
}

for (const [range, count] of Object.entries(scoreRanges)) {
  const bar = '█'.repeat(count)
  console.log(`    ${range}: ${bar} (${count})`)
}

// 高分新闻
const highImportance = allItems.filter(i => (i.importance || 0) >= 0.5)
console.log(`\n  高重要性新闻 (≥50%): ${highImportance.length} 条`)
for (const item of highImportance.slice(0, 5)) {
  const score = ((item.importance || 0) * 100).toFixed(0)
  console.log(`    [${score}%] ${item.title?.slice(0, 60)}`)
}

// ═══════════════════════════════════════════════════════════════
// 6. 测试新闻摘要
// ═══════════════════════════════════════════════════════════════

console.log('\n\n📝 [6] 新闻摘要测试...')
const summary = getNewsSummary({ maxItems: 8 })
if (summary) {
  console.log(summary)
} else {
  console.log('  暂无摘要')
}

// ═══════════════════════════════════════════════════════════════
// 总结
// ═══════════════════════════════════════════════════════════════

const successCount = Object.values(results).filter(r => r.success).length
const failCount = Object.values(results).filter(r => !r.success).length

console.log('\n' + '='.repeat(70))
console.log('  📊 测试总结')
console.log('='.repeat(70))

console.log(`\n  新适配器采集:`)
console.log(`    成功: ${successCount}/${newAdapters.length}`)
console.log(`    失败: ${failCount}/${newAdapters.length}`)
for (const [name, result] of Object.entries(results)) {
  console.log(`      ${name}: ${result.success ? '✓' : '✗'} ${result.count || result.error || ''}`)
}

console.log(`\n  分类覆盖:`)
console.log(`    已检测类别: ${Object.keys(categoryStats).length} 个`)
console.log(`    AI/Agent 新闻: ${aiItems.length} 条`)
console.log(`    地产新闻: ${reItems.length} 条`)

console.log(`\n  聚合器状态:`)
const status = getAggregatorStatus()
console.log(`    缓存条数: ${status.cachedItems}`)
console.log(`    总处理数: ${status.totalProcessed}`)
console.log(`    总注入数: ${status.totalInjected}`)

console.log('\n' + '='.repeat(70))
console.log('  🎉 AI/Agent + 地产行业实时数据接入测试完成！')
console.log('='.repeat(70))

console.log('\n💡 Gina 现在可以:')
console.log('   1. 实时采集 36kr、InfoQ、TechCrunch 等 AI/Agent 媒体')
console.log('   2. 监听 Hacker News 技术社区热门讨论')
console.log('   3. 获取 Zillow 美国地产市场研究数据')
console.log('   4. 追踪新浪地产中国行业动态')
console.log('   5. 自动分类和评分重要性')
console.log('   6. 将重要新闻注入知识库供智能问答检索')

function getCategoryLabel(key) {
  const labels = {
    macro: '宏观经济', policy: '政策法规', stock: '股票市场',
    bond: '债券市场', forex: '外汇市场', commodity: '大宗商品',
    real_estate: '房地产', tech: '科技', ai: '人工智能',
    crypto: '加密货币', company: '公司动态', economy: '经济数据',
    international: '国际市场', startup: '创投', agent: '智能体',
    market: '市场', china: '中国', global: '国际', other: '其他',
  }
  return labels[key] || key
}