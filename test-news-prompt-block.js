/**
 * test-news-prompt-block.js — 新闻提示词注入测试
 */

import { getNewsPromptBlock, getNewsForContext } from './src/data-sources/news-prompt-block.js'

console.log('='.repeat(60))
console.log('  🔮 新闻提示词注入测试')
console.log('='.repeat(60))

// 1. 测试新闻提示词块
console.log('\n📋 [1] 生成新闻提示词块...')
const block = getNewsPromptBlock({ maxItems: 8 })
if (block) {
  console.log(block)
  console.log(`\n  ✓ 生成成功 (${block.length} 字符)`)
} else {
  console.log('  ⚠️  暂无新闻数据，请先运行: node test-financial-news.js')
}

// 2. 测试上下文相关新闻
console.log('\n🔍 [2] 上下文相关新闻检索...')
const testQueries = [
  'AI芯片有什么最新进展？',
  '最近股票市场怎么样？',
  '人民币汇率走势如何？',
  '房地产政策有什么变化？',
]

for (const query of testQueries) {
  console.log(`\n  查询: "${query}"`)
  const relevantNews = getNewsForContext(query, { limit: 2 })
  
  if (relevantNews.length > 0) {
    console.log(`    找到 ${relevantNews.length} 条相关新闻:`)
    for (const item of relevantNews) {
      console.log(`      - ${item.title}`)
    }
  } else {
    console.log('    - 未找到直接相关的新闻')
  }
}

console.log('\n' + '='.repeat(60))
console.log('  ✅ 新闻提示词注入测试完成！')
console.log('='.repeat(60))
console.log('\n💡 使用方式:')
console.log('  // 在 system prompt 中注入新闻')
console.log('  const newsBlock = getNewsPromptBlock()')
console.log('  systemPrompt += newsBlock')
console.log('\n  // 针对用户问题获取相关新闻')
console.log('  const relevantNews = getNewsForContext(userQuery)')