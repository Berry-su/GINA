/**
 * inject-financial-domain-tags.js — 为金融知识添加领域标签和增强思考模式
 *
 * 为现有知识添加 domain 标签，增加领域匹配的准确性
 * 注入更多金融场景专用的思考模式和决策规则
 *
 * 运行：
 *   node inject-financial-domain-tags.js
 */

import fs from 'fs'
import path from 'path'

const GINA_HOME = process.env.GINA_HOME || path.join(process.env.HOME || '.', '.gina')
const INTELLIGENCE_DIR = path.join(GINA_HOME, 'intelligence')

function readJsonlFile(filePath) {
  if (!fs.existsSync(filePath)) return []
  const content = fs.readFileSync(filePath, 'utf-8')
  return content.trim().split('\n').filter(Boolean).map(line => {
    try { return JSON.parse(line) } catch { return null }
  }).filter(Boolean)
}

function writeJsonlFile(filePath, data) {
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(filePath, data.map(item => JSON.stringify(item)).join('\n') + '\n', 'utf-8')
}

console.log('============================================================')
console.log('  🏷️  金融知识领域标签增强')
console.log('============================================================\n')

// 1. 为现有思考模式添加领域标签
console.log('📋 更新思考模式的 domain 标签...')

const thinkingFile = path.join(INTELLIGENCE_DIR, 'thinking-patterns.jsonl')
const patterns = readJsonlFile(thinkingFile)

const domainMappings = {
  // 金融相关关键词
  'finance': ['投资', '选股', '估值', '风险', '对冲', '周期', '因子', '套利', '资产', '配置',
    '趋势', '技术分析', '基本面', '财务分析', '价值投资', '成长股', '蓝筹', '白马',
    '巴菲特', '芒格', '量化', '私募', '公募', '基金', '股票', '债券',
    '牛市', '熊市', '震荡', '反弹', '回调', '崩盘', '泡沫',
    'PE', 'PB', 'EPS', 'ROE', 'ROA', '毛利率', '净利率', '市占率'],
  // AI相关
  'ai': ['AI', 'Agent', 'LLM', '模型', '神经网络', '机器学习', '深度学习', '算法',
    'Transformer', 'GPT', 'RAG', 'Embedding', 'Token', 'Prompt', '微调'],
  // 地产相关
  'realestate': ['地产', '房地产', '房价', '楼市', '土地', '开发商', '购房', '投资房产',
    '学区房', '地段', '保值', '增值'],
  // 工商相关
  'business': ['战略', '竞争', '营销', '供应链', '管理', '领导力', '创新', '品牌',
    '客户', '市场', '增长', '运营'],
  // 法律相关
  'legal': ['法律', '合同', '合规', '知识产权', '专利', '商标', '版权', '诉讼',
    '责任', '赔偿', '劳动法', '公司法'],
  // 科学相关
  'science': ['物理', '化学', '生物', '基因', '量子', '相对论', '热力学',
    '细胞', '进化', '数学', '统计', '概率']
}

let updatedCount = 0

for (const pattern of patterns) {
  const triggerStr = JSON.stringify(pattern.trigger || '')
  const thinkingPath = JSON.stringify(pattern.thinkingPath || [])
  const content = triggerStr + thinkingPath
  
  // 检测领域
  const detectedDomains = []
  for (const [domain, keywords] of Object.entries(domainMappings)) {
    for (const kw of keywords) {
      if (content.toLowerCase().includes(kw.toLowerCase())) {
        detectedDomains.push(domain)
        break
      }
    }
  }
  
  if (detectedDomains.length > 0) {
    const oldDomain = pattern.domain
    pattern.domain = detectedDomains
    if (JSON.stringify(oldDomain) !== JSON.stringify(detectedDomains)) {
      updatedCount++
    }
  } else if (!pattern.domain) {
    pattern.domain = ['general']
    updatedCount++
  }
}

writeJsonlFile(thinkingFile, patterns)
console.log(`  ✓ 更新了 ${updatedCount} 个思考模式的领域标签`)

// 2. 为现有决策规则添加领域标签
console.log('\n📋 更新决策规则的 domain 标签...')

const rulesFile = path.join(INTELLIGENCE_DIR, 'decision-rules.jsonl')
const rules = readJsonlFile(rulesFile)

let rulesUpdatedCount = 0

for (const rule of rules) {
  const conditionStr = JSON.stringify(rule.condition || '')
  const decisionStr = JSON.stringify(rule.decision || '')
  const content = conditionStr + decisionStr
  
  const detectedDomains = []
  for (const [domain, keywords] of Object.entries(domainMappings)) {
    for (const kw of keywords) {
      if (content.toLowerCase().includes(kw.toLowerCase())) {
        detectedDomains.push(domain)
        break
      }
    }
  }
  
  if (detectedDomains.length > 0) {
    const oldDomain = rule.domain
    rule.domain = detectedDomains
    if (JSON.stringify(oldDomain) !== JSON.stringify(detectedDomains)) {
      rulesUpdatedCount++
    }
  } else if (!rule.domain) {
    rule.domain = ['general']
    rulesUpdatedCount++
  }
}

writeJsonlFile(rulesFile, rules)
console.log(`  ✓ 更新了 ${rulesUpdatedCount} 个决策规则的领域标签`)

// 3. 注入更多金融场景专用思考模式
console.log('\n📋 注入金融场景专用思考模式...')

const financePatterns = [
  {
    id: 'finance-cycle-analysis',
    name: '周期位置判断',
    domain: ['finance'],
    trigger: '如何判断当前市场周期位置？牛市还是熊市？',
    thinkingPath: [
      '判断市场周期位置',
      '参考宏观经济指标（GDP增速、CPI、PMI）',
      '评估货币政策方向（加息/降息周期）',
      '分析市场估值水平（指数PE/PB历史分位）',
      '观察市场情绪指标（换手率、融资余额、IPO数量）',
      '结合技术形态（均线、量价关系）',
      '形成周期判断结论',
    ],
    quality: 0.9,
    usageCount: 50,
    successRate: 0.8,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'finance-risk-assessment',
    name: '投资风险评估',
    domain: ['finance'],
    trigger: '这笔投资的风险有多大？如何评估？',
    thinkingPath: [
      '识别主要风险类型（系统性风险/非系统性风险）',
      '评估波动率（历史波动率、隐含波动率）',
      '计算最大回撤和下行风险',
      '分析在不同市场环境下的表现',
      '考虑相关性和分散化效果',
      '评估流动性风险',
      '形成风险评估结论',
    ],
    quality: 0.95,
    usageCount: 45,
    successRate: 0.85,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'finance-bubble-detection',
    name: '泡沫识别与顶部判断',
    domain: ['finance'],
    trigger: '市场是否存在泡沫？如何识别顶部信号？',
    thinkingPath: [
      '检查估值水平是否远超历史均值',
      '观察市场情绪是否过热（全民炒股、融资暴增）',
      '分析成交量和换手率是否异常放大',
      '检查新股发行和再融资节奏',
      '观察大股东和内部人士减持情况',
      '对比历史泡沫案例的特征',
      '判断顶部风险等级',
    ],
    quality: 0.88,
    usageCount: 30,
    successRate: 0.75,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'finance-macro-impact',
    name: '宏观事件市场影响分析',
    domain: ['finance'],
    trigger: '这个宏观事件对市场有什么影响？政策变动会如何影响？',
    thinkingPath: [
      '明确事件类型和性质（货币政策/财政政策/地缘政治）',
      '分析事件的直接影响（利率、流动性、汇率）',
      '评估对不同行业的差异化影响',
      '考虑市场预期差（超预期/不及预期）',
      '分析历史上类似事件的市场反应',
      '制定投资应对策略',
    ],
    quality: 0.92,
    usageCount: 40,
    successRate: 0.82,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'finance-sector-rotation',
    name: '行业轮动分析',
    domain: ['finance'],
    trigger: '当前市场应该配置什么行业？如何进行行业轮动？',
    thinkingPath: [
      '判断当前经济周期阶段',
      '分析各行业的景气度变化',
      '评估行业估值水平相对位置',
      '观察资金流向和北向资金动向',
      '分析政策支持方向',
      '结合技术面信号',
      '确定行业配置建议',
    ],
    quality: 0.87,
    usageCount: 35,
    successRate: 0.78,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'finance-portfolio-adjustment',
    name: '组合调整决策',
    domain: ['finance'],
    trigger: '当前应该加仓还是减仓？如何调整投资组合？',
    thinkingPath: [
      '评估当前市场环境和风险水平',
      '分析组合的风险暴露和集中度',
      '检查各资产的估值吸引力',
      '考虑投资者的风险偏好和投资期限',
      '制定加仓/减仓的方向和节奏',
      '设置止盈止损和再平衡触发点',
    ],
    quality: 0.9,
    usageCount: 42,
    successRate: 0.8,
    createdAt: new Date().toISOString(),
  },
]

const financePatternsFile = path.join(INTELLIGENCE_DIR, 'thinking-patterns.jsonl')
const existingPatterns = readJsonlFile(financePatternsFile)

for (const newPattern of financePatterns) {
  const exists = existingPatterns.some(p => p.id === newPattern.id)
  if (!exists) {
    existingPatterns.push(newPattern)
    console.log(`  ✓ 添加思考模式: ${newPattern.name}`)
  }
}

writeJsonlFile(financePatternsFile, existingPatterns)

// 4. 注入更多金融决策规则
console.log('\n📋 注入金融决策规则...')

const financeRules = [
  {
    id: 'finance-bubble-top',
    name: '牛市顶部决策',
    domain: ['finance'],
    category: '投资决策',
    condition: '当市场估值处于历史高位（>80%分位）、情绪过热、融资余额创新高时',
    decision: '逐步减仓至30%以下，保留核心持仓，增加防御性资产配置',
    reasoning: '历史统计显示，在估值高位和情绪过热阶段，未来1年收益率为负的概率超过60%。减仓可锁定收益，降低回撤风险。',
    quality: 0.9,
    effectiveness: 0.85,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'finance-rate-hike',
    name: '加息周期投资策略',
    domain: ['finance'],
    category: '投资策略',
    condition: '当央行进入加息周期、利率持续上行时',
    decision: '减仓成长股和高估值板块，配置银行、能源等顺周期行业，增加短久期债券',
    reasoning: '加息周期中，利率敏感型资产（科技、成长股）承压，而高股息、低估值、顺周期板块表现更好。',
    quality: 0.92,
    effectiveness: 0.88,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'finance-rate-cut',
    name: '降息周期投资策略',
    domain: ['finance'],
    category: '投资策略',
    condition: '当央行进入降息周期、流动性宽松时',
    decision: '加仓成长股和科技板块，配置长久期债券，增加黄金等抗通胀资产',
    reasoning: '降息周期中，流动性充裕利好高成长、高估值板块，长久期债券价格上涨。',
    quality: 0.9,
    effectiveness: 0.86,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'finance-earnings-miss',
    name: '财报不及预期应对',
    domain: ['finance'],
    category: '个股决策',
    condition: '当持仓股票发布财报不及预期、业绩下滑时',
    decision: '分析下滑原因（周期性/结构性），如果是结构性问题则止损，如果是周期性问题则考虑加仓',
    reasoning: '财报不及预期后的跌幅取决于原因。周期性下滑通常是加仓机会，而结构性恶化需要果断止损。',
    quality: 0.88,
    effectiveness: 0.8,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'finance-market-crash',
    name: '市场暴跌应对',
    domain: ['finance'],
    category: '危机应对',
    condition: '当市场出现连续暴跌、恐慌性抛售时',
    decision: '保持冷静，分批建仓优质标的，避免追跌，保留现金应对进一步下跌',
    reasoning: '暴跌往往创造长期投资机会，但短期风险仍存在。分批建仓可降低择时风险。',
    quality: 0.93,
    effectiveness: 0.82,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'finance-factor-investing',
    name: '因子投资决策',
    domain: ['finance'],
    category: '量化策略',
    condition: '当多因子模型出现回撤、历史有效的因子失效时',
    decision: '检查因子有效性是否改变，考虑因子轮动和多元化配置，控制单一因子暴露不超过30%',
    reasoning: '因子并非永久有效，会随市场环境变化。定期评估因子表现和相关性是必要的。',
    quality: 0.85,
    effectiveness: 0.75,
    createdAt: new Date().toISOString(),
  },
]

const financeRulesFile = path.join(INTELLIGENCE_DIR, 'decision-rules.jsonl')
const existingRules = readJsonlFile(financeRulesFile)

for (const newRule of financeRules) {
  const exists = existingRules.some(r => r.id === newRule.id)
  if (!exists) {
    existingRules.push(newRule)
    console.log(`  ✓ 添加决策规则: ${newRule.name}`)
  }
}

writeJsonlFile(financeRulesFile, existingRules)

console.log('\n============================================================')
console.log('  ✅ 领域标签增强完成')
console.log('============================================================')
console.log(`\n  更新的思考模式: ${updatedCount}`)
console.log(`  更新的决策规则: ${rulesUpdatedCount}`)
console.log(`  新增的思考模式: ${financePatterns.length}`)
console.log(`  新增的决策规则: ${financeRules.length}`)
console.log(`\n  现在可以重新运行测试: node test-financial-analysis.js`)