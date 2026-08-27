/**
 * 诊断知识检索 - 检查地产知识
 */
import { getKnowledgeStats, retrieveRelevantKnowledge } from './src/memory/knowledge-distiller.js'
import fs from 'fs'
import path from 'path'
import os from 'os'

const GINA_HOME = process.env.GINA_HOME || path.join(os.homedir(), '.gina')
const KB_FILE = path.join(GINA_HOME, 'knowledge', 'knowledge-base.jsonl')

// 直接读取知识库文件（JSONL 格式）
let all = []
try {
  if (fs.existsSync(KB_FILE)) {
    const content = fs.readFileSync(KB_FILE, 'utf8').trim()
    if (content) {
      all = content.split('\n').map(line => JSON.parse(line)).filter(Boolean)
    }
  }
} catch (e) {
  console.log(`读取知识库失败: ${e.message}`)
}

console.log(`知识库文件: ${KB_FILE}`)
console.log(`总知识条目: ${all.length}`)

// 按 domain 统计
const byDomain = {}
for (const k of all) {
  const domain = k.metadata?.domain || 'unknown'
  byDomain[domain] = (byDomain[domain] || 0) + 1
}

console.log('\n按 domain 分布:')
for (const [domain, count] of Object.entries(byDomain).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${domain}: ${count}`)
}

// 找 real_estate 相关
const realEstate = all.filter(k => 
  k.metadata?.domain === 'real_estate' || 
  k.tags?.includes('real_estate')
)

console.log(`\nreal_estate 相关知识: ${realEstate.length}`)
for (const k of realEstate.slice(0, 5)) {
  const content = typeof k.content === 'string' ? k.content : String(k.content)
  console.log(`  [${k.metadata?.source}] ${content.slice(0, 120)}...`)
  console.log(`    domain=${k.metadata?.domain}, tags=${k.tags?.join(', ')}`)
  console.log()
}

// 查找 zillow 来源的新闻知识
const zillowItems = all.filter(k => k.metadata?.source === 'zillow_research')
console.log(`\nzillow_research 来源: ${zillowItems.length}`)
for (const k of zillowItems.slice(0, 5)) {
  const content = typeof k.content === 'string' ? k.content : String(k.content)
  console.log(`  ${content.slice(0, 150)}...`)
  console.log(`    domain=${k.metadata?.domain}, importance=${k.metadata?.importance}`)
  console.log()
}

// 查找所有新闻知识按 domain 分布
const newsItems = all.filter(k => k.metadata?.newsItem)
console.log(`\n新闻知识总数: ${newsItems.length}`)
const newsByDomain = {}
for (const k of newsItems) {
  const domain = k.metadata?.domain || 'unknown'
  newsByDomain[domain] = (newsByDomain[domain] || 0) + 1
}
console.log('新闻知识按 domain:')
for (const [domain, count] of Object.entries(newsByDomain).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${domain}: ${count}`)
}

// 查找 real_estate 新闻
const realEstateNews = newsItems.filter(k => k.metadata?.domain === 'real_estate')
console.log(`\nreal_estate 新闻知识: ${realEstateNews.length}`)
for (const k of realEstateNews.slice(0, 5)) {
  const content = typeof k.content === 'string' ? k.content : String(k.content)
  console.log(`  [${k.metadata?.source}] ${content.slice(0, 100)}...`)
}

// 测试检索
console.log('\n=== 测试 retrieveRelevantKnowledge ===')
const queries = [
  '美国房价走势 Zillow',
  '地产 房价',
  'real estate mortgage',
  'AI agent 框架',
]

for (const q of queries) {
  const results = retrieveRelevantKnowledge(q, { maxResults: 3 })
  console.log(`\n"${q}" → ${results.length} 条结果`)
  for (const r of results.slice(0, 2)) {
    const content = typeof r.content === 'string' ? r.content : String(r.content)
    console.log(`  [${r.metadata?.source}/${r.metadata?.domain}] ${content.slice(0, 80)}...`)
  }
}

// 关键词提取函数
function extractKeywords(text) {
  if (!text) return []
  const keywords = []
  const words = text.toLowerCase().split(/[\s,，。.!?？！；：、（）\[\](){}"'`~@#$%^&*+=|\\/<>\n\r\t]+/)
  for (const w of words) {
    if (w.length >= 2) keywords.push(w)
  }
  return keywords
}

console.log('\n=== 关键词提取测试 ===')
for (const q of queries) {
  const kws = extractKeywords(q)
  console.log(`"${q}" → ${JSON.stringify(kws)}`)
}