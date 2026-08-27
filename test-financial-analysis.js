/**
 * test-financial-analysis.js — 股票金融分析实时判断能力测试
 *
 * 模拟真实市场场景，测试 Gina 的金融分析和决策能力
 *
 * 运行：
 *   node test-financial-analysis.js
 */

import { addKnowledge, queryKnowledge, retrieveRelevantKnowledge } from './src/memory/knowledge-distiller.js'
import {
  initIntelligenceSystem,
  recordThinkingPattern,
  recordDecisionRule,
  recordResponseTemplate,
  applyThinkingPattern,
  applyDecisionRule,
  getResponseTemplate,
  calculateIQScore,
  buildEnhancedPrompt,
} from './src/memory/intelligence-preserver.js'
import fs from 'fs'
import path from 'path'

const GINA_HOME = process.env.GINA_HOME || path.join(process.env.HOME || '.', '.gina')

// 确保知识已注入
if (!fs.existsSync(GINA_HOME)) {
  console.log('⚠️  知识库不存在，请先运行:')
  console.log('   node inject-programming-knowledge.js')
  console.log('   node inject-domain-knowledge.js')
  console.log('   node inject-deep-knowledge.js')
  process.exit(1)
}

initIntelligenceSystem()

console.log('============================================================')
console.log('  📈 Gina 股票金融分析实时判断能力测试')
console.log('============================================================\n')

// ═══════════════════════════════════════════════════════════════
// 测试场景
// ═══════════════════════════════════════════════════════════════

const scenarios = [
  {
    id: 'S1',
    name: '美联储加息冲击',
    description: '假设美联储宣布加息75个基点，远超市场预期的50个基点',
    marketContext: {
      us: '科技股普跌3%，纳指期货跌2.5%',
      china: '恒生科技指数跌4%，A股新能源板块跌2%',
      bond: '美债收益率飙升至4.2%',
      gold: '黄金从2000美元跌破1950'
    },
    question: '这个时候应该如何调整投资组合？',
    expectedAnalysis: '宏观分析→利率敏感行业承压→防御配置→减仓科技加消费'
  },
  {
    id: 'S2',
    name: 'AI龙头财报超预期',
    description: '国内AI龙头公司Q3财报发布：营收同比增长80%，净利增长120%',
    marketContext: {
      stock: 'AI龙头股价盘后涨8%',
      sector: 'AI板块整体拉升，平均涨幅3%',
      related: '云计算、大数据概念跟涨',
      volume: '成交量放大3倍'
    },
    question: '是否应该追涨买入这只股票？',
    expectedAnalysis: '基本面分析→估值水平→技术面→是否追涨要看位置'
  },
  {
    id: 'S3',
    name: '房地产政策松绑',
    description: '央行宣布下调首套房贷款利率30个基点，一线城市取消限购',
    marketContext: {
      realestate: '万科、保利等龙头涨停',
      bank: '银行股集体上涨2%',
      index: '上证指数涨1.5%',
      volume: '房地产板块成交额暴增5倍'
    },
    question: '房地产板块的投资机会如何把握？',
    expectedAnalysis: '政策分析→周期位置→龙头选择→投资时机'
  },
  {
    id: 'S4',
    name: '量化策略失效',
    description: '某量化基金的多因子策略最近一个月回撤15%，远超标普500的3%跌幅',
    marketContext: {
      factor: '价值因子表现不佳，成长因子继续走强',
      market: '市场风格快速切换',
      volatility: '波动率指数VIX上升至30'
    },
    question: '量化策略失效应该如何应对？',
    expectedAnalysis: '因子分析→模型诊断→风险控制→策略调整'
  },
  {
    id: 'S5',
    name: '人民币汇率贬值',
    description: '美元兑人民币汇率突破7.3，创三年新高，央行未干预',
    marketContext: {
      forex: '人民币兑美元单日跌1.5%',
      import: '航空、造纸等进口依赖行业承压',
      export: '纺织、电子等出口行业受益',
      gold: '黄金创新高2100美元'
    },
    question: '汇率贬值环境下如何配置资产？',
    expectedAnalysis: '汇率影响→行业分析→资产配置→对冲策略'
  },
  {
    id: 'S6',
    name: '牛市顶部信号',
    description: '上证指数突破4000点，日成交量破万亿，全民炒股氛围浓厚',
    marketContext: {
      valuation: '沪深300 PE估值达历史85%分位',
      sentiment: '新增开户数连续5周创新高',
      margin: '融资余额突破2万亿',
      ipo: 'IPO数量激增，首日平均涨幅超50%'
    },
    question: '这个位置应该加仓还是减仓？',
    expectedAnalysis: '估值分析→情绪指标→周期判断→风险控制'
  }
]

// ═══════════════════════════════════════════════════════════════
// 执行测试
// ═══════════════════════════════════════════════════════════════

const results = []

for (const scenario of scenarios) {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`  📊 场景 ${scenario.id}: ${scenario.name}`)
  console.log(`${'='.repeat(60)}`)
  
  console.log(`\n  📝 场景描述:`)
  console.log(`  ${scenario.description}`)
  
  console.log(`\n  📈 市场情况:`)
  for (const [key, value] of Object.entries(scenario.marketContext)) {
    console.log(`    ${key}: ${value}`)
  }
  
  console.log(`\n  ❓ 问题: ${scenario.question}`)
  
  // 1. 应用思考模式
  const thinkingInput = scenario.question + ' ' + scenario.description
  const thinkingResult = applyThinkingPattern(thinkingInput)
  
  console.log(`\n  🧠 思考模式匹配:`)
  if (thinkingResult.matched) {
    console.log(`    ✓ 匹配成功 (置信度: ${thinkingResult.confidence.toFixed(2)})`)
    console.log(`    模式: ${thinkingResult.pattern?.trigger?.slice(0, 40)}`)
    console.log(`    思考路径:`)
    thinkingResult.thinkingPath?.slice(0, 3).forEach((step, i) => {
      console.log(`      ${i + 1}. ${step?.slice(0, 60)}...`)
    })
  } else {
    console.log(`    ✗ 未匹配`)
  }
  
  // 2. 应用决策规则
  const decisionResult = applyDecisionRule(thinkingInput)
  
  console.log(`\n  ⚖️ 决策规则匹配:`)
  if (decisionResult.matched) {
    console.log(`    ✓ 匹配成功 (置信度: ${decisionResult.confidence.toFixed(2)})`)
    console.log(`    决策: ${decisionResult.decision?.slice(0, 60)}...`)
    console.log(`    推理: ${decisionResult.reasoning?.slice(0, 60)}...`)
  } else {
    console.log(`    ✗ 未匹配`)
  }
  
  // 3. 检索相关知识
  const knowledgeResults = retrieveRelevantKnowledge(thinkingInput, { maxResults: 3 })
  
  console.log(`\n  📚 相关知识检索:`)
  if (knowledgeResults.length > 0) {
    console.log(`    ✓ 找到 ${knowledgeResults.length} 条相关知识`)
    for (const k of knowledgeResults) {
      const content = typeof k.content === 'string' ? k.content : JSON.stringify(k.content)
      console.log(`    - ${content.slice(0, 70)}...`)
    }
  } else {
    console.log(`    ✗ 未找到相关知识`)
  }
  
  // 4. 获取回复模板
  let templateType = 'stock_research'
  if (scenario.id === 'S4') templateType = 'portfolio_review'
  const template = getResponseTemplate(templateType)
  
  console.log(`\n  📝 回复模板:`)
  if (template) {
    console.log(`    ✓ 模板类型: ${templateType}`)
    console.log(`    结构: ${template.structure?.join(' → ')}`)
  }
  
  // 5. 构建增强提示词
  const enhancedPrompt = buildEnhancedPrompt({
    userInput: thinkingInput,
    problemType: 'financial_analysis',
    context: [scenario.name, scenario.id],
  })
  
  console.log(`\n  🚀 增强提示词:`)
  console.log(`    增强数量: ${enhancedPrompt.enhancementCount}`)
  
  // 记录结果
  results.push({
    id: scenario.id,
    name: scenario.name,
    thinking: thinkingResult.matched,
    decision: decisionResult.matched,
    knowledge: knowledgeResults.length,
    template: !!template,
    enhancementCount: enhancedPrompt.enhancementCount,
  })
}

// ═══════════════════════════════════════════════════════════════
// 测试总结
// ═══════════════════════════════════════════════════════════════

console.log(`\n\n${'='.repeat(60)}`)
console.log(`  📊 测试结果总结`)
console.log(`${'='.repeat(60)}`)

let thinkingPass = 0
let decisionPass = 0
let knowledgePass = 0
let templatePass = 0

for (const r of results) {
  if (r.thinking) thinkingPass++
  if (r.decision) decisionPass++
  if (r.knowledge > 0) knowledgePass++
  if (r.template) templatePass++
}

console.log(`\n  场景测试结果:`)
console.log(`  场景  思考模式  决策规则  知识检索  回复模板`)
console.log(`  ${'─'.repeat(55)}`)
for (const r of results) {
  console.log(`  ${r.id}    ${r.thinking ? '✓' : '✗'}       ${r.decision ? '✓' : '✗'}        ${r.knowledge > 0 ? '✓' : '✗'}       ${r.template ? '✓' : '✗'}`)
}

const totalTests = scenarios.length * 4
const totalPass = thinkingPass + decisionPass + knowledgePass + templatePass

console.log(`\n  通过率: ${totalPass}/${totalTests} = ${(totalPass/totalTests*100).toFixed(1)}%`)

console.log(`\n  分项通过率:`)
console.log(`    思考模式: ${thinkingPass}/${scenarios.length} = ${(thinkingPass/scenarios.length*100).toFixed(0)}%`)
console.log(`    决策规则: ${decisionPass}/${scenarios.length} = ${(decisionPass/scenarios.length*100).toFixed(0)}%`)
console.log(`    知识检索: ${knowledgePass}/${scenarios.length} = ${(knowledgePass/scenarios.length*100).toFixed(0)}%`)
console.log(`    回复模板: ${templatePass}/${scenarios.length} = ${(templatePass/scenarios.length*100).toFixed(0)}%`)

// IQ 测试
const iqResult = calculateIQScore()
console.log(`\n  IQ 分数: ${iqResult.score} (${iqResult.levelLabel})`)

// 评估
console.log(`\n  📋 能力评估:`)
if (totalPass >= totalTests * 0.8) {
  console.log(`    ✓ Gina 具备良好的金融分析和决策能力`)
  console.log(`    ✓ 能匹配正确的思考模式和决策规则`)
  console.log(`    ✓ 能检索相关知识并构建结构化回复`)
} else if (totalPass >= totalTests * 0.6) {
  console.log(`    ⚠️  Gina 具备基础的金融分析能力`)
  console.log(`    ⚠️ 部分场景需要更多知识支持`)
} else {
  console.log(`    ✗ Gina 的金融分析能力需要加强`)
  console.log(`    ✗ 建议补充更多金融知识`)
}

console.log(`\n${'='.repeat(60)}`)
console.log(`  🎉 股票金融分析能力测试完成！`)
console.log(`${'='.repeat(60)}`)

// 输出建议
console.log(`\n💡 Gina 在金融场景中的分析路径示例:`)
console.log(`  1. 宏观判断（利率、政策、周期位置）`)
console.log(`  2. 行业分析（估值水平、景气度、竞争格局）`)
console.log(`  3. 公司分析（财务质量、竞争优势、管理层）`)
console.log(`  4. 技术分析（趋势、形态、成交量）`)
console.log(`  5. 风险评估（波动率、回撤、相关性）`)
console.log(`  6. 决策输出（买入/卖出/持有建议）`)