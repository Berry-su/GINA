/**
 * debug-s6.js — 调试 S6 场景的思考模式匹配
 */

import { applyThinkingPattern, applyDecisionRule } from './src/memory/intelligence-preserver.js'
import { retrieveRelevantKnowledge } from './src/memory/knowledge-distiller.js'

const testCases = [
  {
    name: 'S6 牛市顶部信号',
    input: '这个位置应该加仓还是减仓？ 上证指数突破4000点，日成交量破万亿，全民炒股氛围浓厚',
  },
  {
    name: '单纯加仓减仓问题',
    input: '应该加仓还是减仓',
  },
  {
    name: '泡沫识别',
    input: '市场是否存在泡沫？如何识别顶部信号？',
  },
  {
    name: '组合调整',
    input: '当前应该加仓还是减仓？如何调整投资组合？',
  },
]

for (const tc of testCases) {
  console.log(`\n========== ${tc.name} ==========`)
  console.log(`输入: ${tc.input}`)
  
  const thinkingResult = applyThinkingPattern(tc.input)
  console.log(`\n思考模式:`)
  console.log(`  matched: ${thinkingResult.matched}`)
  if (thinkingResult.matched) {
    console.log(`  confidence: ${thinkingResult.confidence.toFixed(2)}`)
    console.log(`  pattern: ${thinkingResult.pattern?.name}`)
    console.log(`  trigger: ${thinkingResult.pattern?.trigger}`)
  }
  
  const decisionResult = applyDecisionRule(tc.input)
  console.log(`\n决策规则:`)
  console.log(`  matched: ${decisionResult.matched}`)
  if (decisionResult.matched) {
    console.log(`  confidence: ${decisionResult.confidence.toFixed(2)}`)
    console.log(`  decision: ${decisionResult.decision?.slice(0, 50)}`)
  }
}