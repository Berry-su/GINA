/**
 * debug-patterns.js — 调试思考模式匹配
 */

import fs from 'fs'
import path from 'path'

const GINA_HOME = process.env.GINA_HOME || path.join(process.env.HOME || '.', '.gina')
const thinkingFile = path.join(GINA_HOME, 'thinking_patterns.jsonl')

function readJsonlFile(filePath) {
  if (!fs.existsSync(filePath)) return []
  const content = fs.readFileSync(filePath, 'utf-8')
  return content.trim().split('\n').filter(Boolean).map(line => {
    try { return JSON.parse(line) } catch { return null }
  }).filter(Boolean)
}

const patterns = readJsonlFile(thinkingFile)
console.log(`总模式数: ${patterns.length}`)

// 找到包含"加仓"或"减仓"的模式
const buySellPatterns = patterns.filter(p => {
  const trigger = JSON.stringify(p.trigger || '').toLowerCase()
  return trigger.includes('加仓') || trigger.includes('减仓')
})

console.log(`\n包含"加仓/减仓"的模式数: ${buySellPatterns.length}`)
for (const p of buySellPatterns) {
  console.log(`  - ${p.name}: trigger="${p.trigger}"`)
  console.log(`    domain: ${p.domain}`)
  console.log(`    quality: ${p.quality}, successRate: ${p.successRate}`)
}

// 模拟匹配过程
function extractKeywordsSimple(text) {
  if (!text) return []
  const lower = text.toLowerCase()
  const result = []

  const words = lower.split(/[\s,，。.!！?？;；:："'""''()（）\[\]【】、]+/)
  for (const w of words) {
    if (w.length >= 2) result.push(w)
  }

  const chineseSegments = lower.match(/[\u4e00-\u9fa5]+/g) || []
  for (const seg of chineseSegments) {
    for (let len = 2; len <= Math.min(4, seg.length); len++) {
      for (let i = 0; i <= seg.length - len; i++) {
        result.push(seg.substring(i, i + len))
      }
    }
  }

  return [...new Set(result)]
}

const testInput = '应该加仓还是减仓'
const problemLower = testInput.toLowerCase()
const problemKeywords = extractKeywordsSimple(problemLower)

console.log(`\n测试输入: "${testInput}"`)
console.log(`提取的关键词 (前10个): ${problemKeywords.slice(0, 10)}`)

// 计算每个模式的匹配分数
const scoredPatterns = patterns.map(p => {
  if (!p.trigger) return null
  const triggerStr = typeof p.trigger === 'string' ? p.trigger : JSON.stringify(p.trigger)
  const triggerLower = triggerStr.toLowerCase()
  const triggerKeywords = extractKeywordsSimple(triggerLower)

  let matchScore = 0

  // 问题关键词在触发词中出现
  for (const kw of problemKeywords) {
    if (kw.length < 2) continue
    if (triggerLower.includes(kw)) matchScore += 3
  }

  // 触发词关键词在问题中出现
  for (const kw of triggerKeywords) {
    if (kw.length < 2) continue
    if (problemLower.includes(kw)) matchScore += 3
  }
  
  // 领域检测
  const financeKeywords = ['加仓', '减仓', '股票', '投资', '估值']
  let domainMatch = false
  for (const kw of financeKeywords) {
    if (problemLower.includes(kw)) { domainMatch = true; break }
  }
  if (domainMatch && p.domain && p.domain.includes('finance')) {
    matchScore += 15
  }

  if (matchScore > 0) {
    const finalScore = matchScore * (p.quality || 1) * (p.successRate || 0.5)
    return { pattern: p, matchScore, finalScore }
  }
  return null
}).filter(Boolean)

scoredPatterns.sort((a, b) => b.finalScore - a.finalScore)

console.log(`\n匹配的模式 (top 5):`)
for (let i = 0; i < Math.min(5, scoredPatterns.length); i++) {
  const s = scoredPatterns[i]
  console.log(`  ${i+1}. ${s.pattern.name}`)
  console.log(`     trigger: ${s.pattern.trigger}`)
  console.log(`     matchScore: ${s.matchScore}, finalScore: ${s.finalScore.toFixed(2)}`)
  console.log(`     domain: ${s.pattern.domain}`)
}