/**
 * 诊断测试 - 检查 Zillow 新闻分类
 */
import { getLatestNews } from './src/data-sources/news-aggregator.js'

const items = getLatestNews({ limit: 50 })

// 按来源分组
const bySource = {}
for (const item of items) {
  const src = item.source || 'unknown'
  if (!bySource[src]) bySource[src] = []
  bySource[src].push(item)
}

for (const [src, sitems] of Object.entries(bySource)) {
  console.log(`\n=== ${src} (${sitems.length}条) ===`)
  for (const item of sitems.slice(0, 3)) {
    console.log(`  标题: ${item.title.slice(0, 80)}`)
    console.log(`  分类: primary=${item.category?.primary}, secondary=${JSON.stringify(item.category?.secondary)}`)
    console.log(`  重要性: ${item.importance}`)
    console.log(`  注入: ${item.injectedToKnowledge ? '是' : '否'}`)
    console.log()
  }
}

// 检查 Zillow 新闻的具体分类
console.log('\n=== Zillow Research 详细 ===')
const zillowItems = items.filter(i => i.source === 'zillow_research')
for (const item of zillowItems) {
  console.log(`  标题: ${item.title.slice(0, 100)}`)
  console.log(`  分类: ${JSON.stringify(item.category)}`)
  console.log(`  摘要: ${item.summary?.slice(0, 100)}`)
  console.log()
}

// 检查地产分类的新闻
console.log('\n=== real_estate 分类新闻 ===')
const realEstateItems = items.filter(i => i.category?.primary === 'real_estate')
for (const item of realEstateItems) {
  console.log(`  [${item.source}] ${item.title.slice(0, 80)}`)
  console.log(`  重要性: ${item.importance}, 注入: ${item.injectedToKnowledge ? '是' : '否'}`)
}