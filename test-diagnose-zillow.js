/**
 * 诊断 Zillow 新闻评分和分类
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

// 检查 Zillow
console.log('=== Zillow Research 新闻详情 ===')
const zillow = bySource['zillow_research'] || []
for (const item of zillow) {
  console.log(`标题: ${item.title}`)
  console.log(`分类: ${JSON.stringify(item.category)}`)
  console.log(`重要性: ${item.importance}`)
  console.log(`摘要: ${(item.summary || '无').slice(0, 100)}`)
  console.log(`时间: ${new Date(item.timestamp).toISOString()}`)
  console.log()
}

// 检查所有新闻的重要性分数分布
console.log('\n=== 所有新闻重要性分布 ===')
const ranges = { '<0.25 (被过滤)': 0, '0.25-0.40': 0, '0.40-0.60': 0, '0.60-0.80': 0, '>0.80': 0 }
for (const item of items) {
  const s = item.importance || 0
  if (s < 0.25) ranges['<0.25 (被过滤)']++
  else if (s < 0.40) ranges['0.25-0.40']++
  else if (s < 0.60) ranges['0.40-0.60']++
  else if (s < 0.80) ranges['0.60-0.80']++
  else ranges['>0.80']++
}
for (const [range, count] of Object.entries(ranges)) {
  console.log(`  ${range}: ${count}`)
}

// 检查地产新闻的重要性
console.log('\n=== 地产相关新闻的重要性 ===')
const realEstate = items.filter(i => i.category?.primary === 'real_estate' || 
  (i.category?.all && i.category.all.includes('real_estate')))
for (const item of realEstate) {
  console.log(`  [${item.source}] ${item.title.slice(0, 80)} → importance: ${item.importance}`)
}

// 检查 importance 计算的因素
console.log('\n=== Zillow 新闻 importance 计算因素 ===')
for (const item of zillow.slice(0, 3)) {
  const text = (item.title + ' ' + (item.summary || '')).toLowerCase()
  console.log(`\n  "${item.title.slice(0, 60)}"`)
  console.log(`  基础分: 0.45`)
  console.log(`  sourceWeight: zillow_research → 0.85 → 加分 ${(0.85 - 0.7) * 0.3}`)
  
  // 高重要性关键词
  const highKws = ['紧急', '突发', '重磅', '重大', '历史性', '破纪录', '创纪录', '首次', '罕见', '暴跌', '暴涨', '崩盘', '危机', '加息', '降息', '降准', '央行', '美联储', '利率决议', 'FOMC', '非农', 'CPI', 'GDP']
  for (const kw of highKws) {
    if (text.includes(kw.toLowerCase())) {
      console.log(`    高重要关键词匹配: "${kw}" → +0.15`)
    }
  }
  
  // 分类加分
  if (item.category?.primary && ['macro', 'policy', 'stock', 'international', 'ai', 'real_estate'].includes(item.category.primary)) {
    console.log(`    关键分类加分: ${item.category.primary} → +0.1`)
  }
  
  console.log(`  最终: ${item.importance}`)
}