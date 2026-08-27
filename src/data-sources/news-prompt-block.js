/**
 * news-prompt-block.js — 新闻提示词注入器
 *
 * 将最新财经新闻格式化为 system prompt 块，注入 Gina 的回答上下文
 *
 * 用法：
 *   import { getNewsPromptBlock } from './news-prompt-block.js'
 *   const block = getNewsPromptBlock()
 *   // 注入到 system prompt 中
 */

import { getNewsSummary, getLatestNews } from './news-aggregator.js'

export function getNewsPromptBlock(options = {}) {
  const {
    maxItems = 8,
    minImportance = 0.25,
    includeCategories = true,
    includeTimestamp = true,
  } = options

  const items = getLatestNews({ limit: maxItems, minImportance })

  if (items.length === 0) {
    return ''
  }

  const parts = ['## 📰 最新财经动态']
  
  // 按类别分组
  const byCategory = {}
  for (const item of items) {
    const cat = item.category?.primary || 'other'
    if (!byCategory[cat]) byCategory[cat] = []
    byCategory[cat].push(item)
  }

  // 类别中文名映射
  const catNames = {
    macro: '宏观经济',
    policy: '政策法规',
    stock: '股票市场',
    bond: '债券市场',
    forex: '外汇市场',
    commodity: '大宗商品',
    real_estate: '房地产',
    tech: '科技',
    ai: '人工智能',
    crypto: '加密货币',
    company: '公司动态',
    economy: '经济数据',
    international: '国际市场',
    other: '其他',
  }

  for (const [cat, catItems] of Object.entries(byCategory)) {
    const catName = catNames[cat] || cat
    parts.push(`\n### ${catName}`)
    
    for (const item of catItems) {
      let line = `- ${item.title}`
      if (includeTimestamp && item.timestamp) {
        const time = new Date(item.timestamp).toLocaleString('zh-CN', {
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        })
        line = `[${time}] ${line}`
      }
      if (item.symbols?.length > 0) {
        line += ` (${item.symbols.join(', ')})`
      }
      parts.push(line)
    }
  }

  parts.push('\n_以上信息由 Gina 新闻聚合器自动采集，仅供参考_')

  return parts.join('\n')
}

export function getNewsForContext(query, options = {}) {
  const { limit = 3 } = options
  
  const items = getLatestNews({ limit: 20 })
  
  // 基于 query 的简单相关性筛选
  const queryLower = query.toLowerCase()
  const scored = items.map(item => {
    let score = 0
    const text = (item.title + ' ' + (item.summary || '')).toLowerCase()
    
    // 关键词匹配
    const queryWords = queryLower.split(/[\s,，。？?！!]+/).filter(w => w.length >= 2)
    for (const word of queryWords) {
      if (text.includes(word)) score += 2
    }
    
    // 类别匹配
    const category = item.category?.primary
    const categoryKeywords = {
      'stock': ['股票', '股市', '指数', '大盘', '涨停', '跌停'],
      'ai': ['ai', '人工智能', '大模型', '芯片'],
      'real_estate': ['房地产', '房价', '楼市'],
      'forex': ['汇率', '外汇', '美元', '人民币'],
      'macro': ['宏观', '经济', 'gdp', 'cpi'],
      'policy': ['政策', '监管', '法规'],
    }
    
    for (const [cat, keywords] of Object.entries(categoryKeywords)) {
      if (category === cat) {
        for (const kw of keywords) {
          if (queryLower.includes(kw)) score += 3
        }
      }
    }
    
    return { item, score }
  })
  
  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(s => s.item)
}

export {
}