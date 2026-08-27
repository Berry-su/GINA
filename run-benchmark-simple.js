#!/usr/bin/env node

/**
 * Gina Agent 基准测试 - 简易版
 */

import { ginaHandlers } from './src/mcp/gina-mcp-server.js'
import { runLocalBenchmark } from './src/benchmark/benchmark-framework.js'

async function main() {
  try {
    const report = await runLocalBenchmark(ginaHandlers, {
      verbose: true,
    })
    
    // 输出能力评估
    console.log('\n============================================================')
    console.log('  Gina Agent 能力评估')
    console.log('============================================================\n')
    
    const results = report.results
    const categories = {}
    
    results.forEach(r => {
      let category = 'unknown'
      if (r.taskId?.startsWith('kb-')) category = 'knowledge'
      else if (r.taskId?.startsWith('rs-')) category = 'research'
      else if (r.taskId?.startsWith('dc-')) category = 'decision'
      else if (r.taskId?.startsWith('et-')) category = 'ethics'
      else if (r.taskId?.startsWith('em-')) category = 'emotion'
      else if (r.taskId?.startsWith('pl-')) category = 'planning'
      else if (r.taskId?.startsWith('mcp-')) category = 'mcp'
      
      if (!categories[category]) {
        categories[category] = { total: 0, completed: 0, failed: 0 }
      }
      categories[category].total++
      if (r.status === 'completed') categories[category].completed++
      else categories[category].failed++
    })
    
    const categoryNames = {
      knowledge: '💡 知识检索',
      research: '🔬 研究分析',
      decision: '⚖️ 决策框架',
      ethics: '🛡️ 伦理检查',
      emotion: '😊 情感计算',
      planning: '📋 任务规划',
      mcp: '🔌 MCP 工具',
    }
    
    Object.entries(categories).forEach(([cat, stats]) => {
      const rate = (stats.completed / stats.total * 100).toFixed(0)
      const icon = rate >= 80 ? '🟢' : rate >= 50 ? '🟡' : '🔴'
      console.log(`  ${icon} ${categoryNames[cat] || cat}: ${stats.completed}/${stats.total} (${rate}%)`)
    })
    
    console.log('\n============================================================')
    console.log('  Gina Agent 评级')
    console.log('============================================================\n')
    
    const rate = parseFloat(report.summary.successRate)
    let level = ''
    if (rate >= 95) level = 'S 级 - 世界领先'
    else if (rate >= 85) level = 'A 级 - 优秀'
    else if (rate >= 70) level = 'B 级 - 良好'
    else if (rate >= 50) level = 'C 级 - 及格'
    else level = 'D 级 - 需要改进'
    
    console.log(`  综合评级: ${level}`)
    console.log(`  成功率: ${rate}%`)
    console.log(`  测试任务: ${report.summary.total} 个`)
    console.log(`  平均耗时: ${report.summary.avgDuration}ms`)
    
    // 导出 JSON 结果到控制台
    console.log('\n============================================================')
    console.log('  详细结果 (JSON)')
    console.log('============================================================\n')
    console.log(JSON.stringify(report, null, 2))
    
    return 0
  } catch (err) {
    console.error('❌ Benchmark failed:', err.message)
    return 1
  }
}

process.exit(await main())
