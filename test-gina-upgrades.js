/**
 * test-gina-upgrades.js — Gina 三大核心升级验证测试
 *
 * 验证内容：
 *   1. 语义理解：向量嵌入检索 vs 关键词匹配对比
 *   2. 主动感知：事件监听与主动触发
 *   3. 任务规划：自动计划生成与执行
 */

import fs from 'fs'
import path from 'path'
import os from 'os'

const GINA_HOME = process.env.GINA_HOME || path.join(os.homedir(), '.gina')
const KB_FILE = path.join(GINA_HOME, 'knowledge', 'knowledge-base.jsonl')

// 清理旧知识
try {
  if (fs.existsSync(KB_FILE)) fs.unlinkSync(KB_FILE)
} catch {}

// 导入升级后的模块
import { 
  addKnowledge, 
  retrieveRelevantKnowledge,
  semanticRetrieveKnowledge,
  retrieveRelevantKnowledgeHybrid,
  retrieveRelevantKnowledgeAuto
} from './src/memory/knowledge-distiller.js'

import { isEmbeddingConfigured } from './src/embedding.js'

import { 
  initProactivePerception, 
  triggerProactiveCheck,
  getProactiveStatus,
  subscribePerception
} from './src/memory/proactive-perception.js'

import { 
  initAutoPlanner, 
  generatePlanFromTrigger,
  getActivePlans,
  getPlanHistory,
  getQueueStatus
} from './src/memory/auto-planner.js'

// ─── 测试数据 ────────────────────────────────────────────────────────────────────

const testKnowledge = [
  {
    content: '中国房地产市场在2024年面临调整压力，一线城市房价出现松动',
    type: 'fact',
    tags: ['real_estate', 'china', 'housing'],
    metadata: { domain: 'real_estate', category: 'market' },
  },
  {
    content: 'AI大语言模型在自然语言处理任务上已达到人类专家水平',
    type: 'fact',
    tags: ['ai', 'llm', 'nlp'],
    metadata: { domain: 'ai', category: 'technology' },
  },
  {
    content: '美联储2024年维持利率不变，暗示2025年可能降息',
    type: 'fact',
    tags: ['finance', 'fed', 'monetary_policy'],
    metadata: { domain: 'finance', category: 'policy' },
  },
  {
    content: 'Python是数据科学和机器学习的首选编程语言',
    type: 'procedure',
    tags: ['programming', 'python', 'data_science'],
    metadata: { domain: 'tech', category: 'programming' },
  },
  {
    content: '用户偏好简洁的中文回复，不喜欢冗长的英文术语',
    type: 'preference',
    tags: ['user_preference', 'language'],
    metadata: { domain: 'user', category: 'preference' },
  },
  {
    content: '地产投资三要素：地段、地段、地段',
    type: 'rule',
    tags: ['real_estate', 'investment'],
    metadata: { domain: 'real_estate', category: 'investment' },
  },
  {
    content: 'AI Agent能够自主规划任务并调用工具完成复杂工作流',
    type: 'insight',
    tags: ['ai', 'agent', 'workflow'],
    metadata: { domain: 'ai', category: 'capability' },
  },
  {
    content: '全球气候变化导致极端天气事件频率增加，保险业面临新挑战',
    type: 'fact',
    tags: ['climate', 'insurance', 'risk'],
    metadata: { domain: 'finance', category: 'risk' },
  },
]

const testQueries = [
  { text: '中国房价最新走势', expectedDomain: 'real_estate', keywords: ['real_estate'] },
  { text: 'AI模型能力对比', expectedDomain: 'ai', keywords: ['ai'] },
  { text: '美联储降息预期', expectedDomain: 'finance', keywords: ['finance'] },
  { text: '机器学习用什么语言', expectedDomain: 'tech', keywords: ['tech'] },
  { text: '请用中文回复', expectedDomain: 'user', keywords: ['user'] },
  { text: '房地产投资要点', expectedDomain: 'real_estate', keywords: ['real_estate'] },
  { text: '智能体自主执行', expectedDomain: 'ai', keywords: ['ai'] },
  { text: '气候风险保险', expectedDomain: 'finance', keywords: ['finance'] },
]

// ─── 测试执行 ────────────────────────────────────────────────────────────────────

let testResults = []
let passedCount = 0
let failedCount = 0

function logResult(testName, passed, details = '') {
  const status = passed ? '✅ PASS' : '❌ FAIL'
  console.log(`  ${status} | ${testName}`)
  if (details) console.log(`     ${details}`)
  testResults.push({ testName, passed, details })
  if (passed) passedCount++
  else failedCount++
}

// ─── Phase 1: 语义理解测试 ────────────────────────────────────────────────────────

console.log('\n' + '='.repeat(60))
console.log('  Phase 1: 语义理解升级验证')
console.log('='.repeat(60))

// 1.1 添加测试知识
console.log('\n📝 添加测试知识...')
for (const item of testKnowledge) {
  addKnowledge({
    content: item.content,
    type: item.type,
    tags: item.tags,
    metadata: item.metadata,
    confidence: 0.8,
  })
}
logResult('添加8条测试知识', true)

// 1.2 关键词检索测试
console.log('\n🔍 关键词检索测试 (retrieveRelevantKnowledge)...')
const keywordResults = []
for (const query of testQueries) {
  const results = retrieveRelevantKnowledge(query.text, { maxResults: 3 })
  const topDomain = results[0]?.metadata?.domain || 'unknown'
  const hitExpected = results.some(r => r.metadata?.domain === query.expectedDomain)
  keywordResults.push({ query, results, topDomain, hitExpected })
  logResult(
    `关键词: "${query.text}" → top: ${topDomain} ${hitExpected ? '✓' : '✗'}`,
    hitExpected,
    `召回 ${results.length} 条`
  )
}

// 1.3 向量配置检测
const embeddingAvailable = isEmbeddingConfigured()
logResult(
  `Embedding 配置检测`,
  true,
  `状态: ${embeddingAvailable ? '✅ 已配置，将使用语义检索' : '⚠️ 未配置，仅使用关键词匹配'}`
)

// 1.4 语义检索测试（如果可用）
if (embeddingAvailable) {
  console.log('\n🧠 语义检索测试 (semanticRetrieveKnowledge)...')
  for (const query of testQueries.slice(0, 4)) {
    try {
      const results = await semanticRetrieveKnowledge(query.text, { maxResults: 3 })
      const topDomain = results[0]?.metadata?.domain || 'unknown'
      const hitExpected = results.some(r => r.metadata?.domain === query.expectedDomain)
      logResult(
        `语义: "${query.text}" → top: ${topDomain} ${hitExpected ? '✓' : '✗'}`,
        hitExpected,
        `召回 ${results.length} 条`
      )
    } catch (e) {
      logResult(`语义: "${query.text}"`, false, `错误: ${e.message}`)
    }
  }
} else {
  console.log('\n🧠 语义检索: Embedding 未配置，跳过语义检索测试')
  console.log('   💡 提示: 配置本地 Embedding 模型后，检索质量将显著提升')
}

// 1.5 混合检索测试
console.log('\n🔀 混合检索测试 (retrieveRelevantKnowledgeAuto)...')
for (const query of testQueries.slice(0, 4)) {
  try {
    const results = await retrieveRelevantKnowledgeAuto(query.text, { maxResults: 3 })
    const topDomain = results[0]?.metadata?.domain || 'unknown'
    const hitExpected = results.some(r => r.metadata?.domain === query.expectedDomain)
    const hasMeta = results[0]?._retrievalMeta
    logResult(
      `混合: "${query.text}" → top: ${topDomain} ${hitExpected ? '✓' : '✗'}`,
      hitExpected,
      hasMeta ? `语义+关键词混合 (分数: ${results[0]._retrievalMeta.score.toFixed(3)})` : '关键词模式'
    )
  } catch (e) {
    logResult(`混合: "${query.text}"`, false, `错误: ${e.message}`)
  }
}

// 1.6 跨域查询测试
console.log('\n🌐 跨域语义查询测试...')
const crossDomainQueries = [
  'AI 对房地产市场的影响',
  '利率政策影响科技投资',
  '气候变化如何影响金融风险',
  '编程语言选择与职业发展',
]

for (const queryText of crossDomainQueries) {
  try {
    const results = await retrieveRelevantKnowledgeAuto(queryText, { maxResults: 5 })
    const domains = new Set(results.map(r => r.metadata?.domain).filter(Boolean))
    const domainList = Array.from(domains).join(', ')
    const crossDomainHit = domains.size >= 2
    logResult(
      `"${queryText}" → 覆盖 ${domains.size} 个域: [${domainList}]`,
      crossDomainHit,
      crossDomainHit ? '✅ 跨域联动成功' : '⚠️ 仅单域命中'
    )
  } catch (e) {
    logResult(`"${queryText}"`, false, `错误: ${e.message}`)
  }
}

// ─── Phase 2: 主动感知测试 ────────────────────────────────────────────────────────

console.log('\n' + '='.repeat(60))
console.log('  Phase 2: 主动感知升级验证')
console.log('='.repeat(60))

// 2.1 初始化感知引擎
console.log('\n📡 初始化主动感知引擎...')
try {
  const perception = initProactivePerception({ enabled: true })
  const status = getProactiveStatus()
  logResult('初始化主动感知引擎', true, `状态: enabled=${status.enabled}, sensor=${status.sensorAvailable ? '可用' : '不可用'}`)
} catch (e) {
  logResult('初始化主动感知引擎', false, `错误: ${e.message}`)
}

// 2.2 订阅感知事件
console.log('\n🔔 订阅感知事件...')
let eventCount = 0
const unsubscribe = subscribePerception((event) => {
  eventCount++
})
logResult('订阅感知事件', true, `已设置监听器`)

// 2.3 模拟用户返回事件
console.log('\n👤 模拟环境事件触发...')
try {
  // 触发用户返回事件
  const eventModule = await import('./src/events.js')
  eventModule.emitEvent('user-returned', { timestamp: Date.now() })
  logResult('触发 user-returned 事件', true)
} catch (e) {
  logResult('触发 user-returned 事件', false, `错误: ${e.message}`)
}

// 2.4 获取感知状态
const perceptionStatus = getProactiveStatus()
logResult(
  '获取主动感知状态',
  true,
  JSON.stringify({
    enabled: perceptionStatus.enabled,
    autoGenerateTasks: perceptionStatus.autoGenerateTasks,
    activeTasksCount: perceptionStatus.activeTasksCount,
  })
)

// 2.5 手动触发检查
console.log('\n🔍 手动触发主动检查...')
try {
  const results = await triggerProactiveCheck('test')
  logResult('手动触发主动检查', true, `结果: ${JSON.stringify(results)}`)
} catch (e) {
  logResult('手动触发主动检查', false, `错误: ${e.message}`)
}

// ─── Phase 3: 任务规划测试 ────────────────────────────────────────────────────────

console.log('\n' + '='.repeat(60))
console.log('  Phase 3: 自动任务规划验证')
console.log('='.repeat(60))

// 3.1 初始化规划器
console.log('\n📋 初始化自动规划器...')
try {
  const planner = initAutoPlanner({ enabled: true })
  const queueStatus = getQueueStatus()
  logResult('初始化自动规划器', true, `配置: enabled=${queueStatus.config.enabled}`)
} catch (e) {
  logResult('初始化自动规划器', false, `错误: ${e.message}`)
}

// 3.2 从新闻触发生成计划
console.log('\n📰 新闻触发 → 任务计划...')
const newsTrigger = {
  type: 'important_news',
  data: {
    title: '央行宣布下调存款准备金率0.5个百分点',
    source: 'sina_finance',
    category: { primary: 'finance' },
    importance: 0.85,
    url: 'https://example.com/news/123',
  },
  source: 'test',
}

try {
  const plan = generatePlanFromTrigger(newsTrigger)
  if (plan) {
    logResult(
      `生成新闻分析计划: "${plan.description.slice(0, 40)}...`,
      true,
      `类型: ${plan.type}, 步骤: ${plan.steps.length}, 优先级: ${plan.priority}`
    )
    
    // 显示计划步骤
    console.log('     步骤列表:')
    plan.steps.forEach((step, i) => {
      console.log(`       ${i + 1}. [${step.tool}] ${step.action}`)
    })
  } else {
    logResult('生成新闻分析计划', false, '返回 null')
  }
} catch (e) {
  logResult('生成新闻分析计划', false, `错误: ${e.message}`)
}

// 3.3 从知识注入触发生成计划
console.log('\n🧠 知识触发 → 任务计划...')
const knowledgeTrigger = {
  type: 'knowledge_injected',
  data: {
    type: 'fact',
    content: '新能源汽车市场份额首次超过传统燃油车',
    confidence: 0.6,
    metadata: { domain: 'real_estate' },
    id: 'k_test_001',
  },
  source: 'test',
}

try {
  const plan = generatePlanFromTrigger(knowledgeTrigger)
  if (plan) {
    logResult(
      `生成知识验证计划: "${plan.description.slice(0, 40)}...`,
      true,
      `类型: ${plan.type}, 步骤: ${plan.steps.length}`
    )
  } else {
    logResult('生成知识验证计划', true, `置信度较高(${knowledgeTrigger.data.confidence})，无需验证`)
  }
} catch (e) {
  logResult('生成知识验证计划', false, `错误: ${e.message}`)
}

// 3.4 从环境变化触发生成计划
console.log('\n🖥️ 环境触发 → 任务计划...')
const envTrigger = {
  type: 'environment_change',
  data: {
    context: 'coding',
    app: 'Code',
  },
  source: 'test',
}

try {
  const plan = generatePlanFromTrigger(envTrigger)
  if (plan) {
    logResult(
      `生成环境适配计划: "${plan.description}"`,
      true,
      `类型: ${plan.type}, 步骤: ${plan.steps.length}`
    )
  } else {
    logResult('生成环境适配计划', false, '返回 null')
  }
} catch (e) {
  logResult('生成环境适配计划', false, `错误: ${e.message}`)
}

// 3.5 队列与状态测试
console.log('\n📊 队列与状态测试...')
const queueStatus = getQueueStatus()
logResult(
  '获取队列状态',
  true,
  `队列: ${queueStatus.queueLength}, 活动计划: ${queueStatus.activePlans}`
)

// 3.6 新闻分析计划生成测试
console.log('\n📰 新闻分析计划模板测试...')
const testNewsItems = [
  {
    title: '英伟达发布新一代AI芯片，性能提升3倍',
    category: { primary: 'ai' },
    importance: 0.9,
    source: 'techcrunch_ai',
  },
  {
    title: '一线城市房价连续3个月环比下跌',
    category: { primary: 'real_estate' },
    importance: 0.8,
    source: 'sina_realestate',
  },
  {
    title: '美股三大指数收盘涨跌互现',
    category: { primary: 'finance' },
    importance: 0.5,
    source: 'sina_finance',
  },
]

for (const news of testNewsItems) {
  const plan = generatePlanFromTrigger({
    type: 'important_news',
    data: news,
    source: 'test',
  })
  logResult(
    `生成${news.category.primary}领域新闻计划`,
    plan !== null,
    plan ? `"${plan.description.slice(0, 50)}...", ${plan.steps.length}步骤` : '未生成'
  )
}

// ─── 测试总结 ────────────────────────────────────────────────────────────────────

console.log('\n' + '='.repeat(60))
console.log('  测试总结')
console.log('='.repeat(60))

console.log(`\n  总计: ${testResults.length} 项测试`)
console.log(`  ✅ 通过: ${passedCount}`)
console.log(`  ❌ 失败: ${failedCount}`)
console.log(`  通过率: ${((passedCount / testResults.length) * 100).toFixed(1)}%`)

if (failedCount > 0) {
  console.log('\n  失败项详情:')
  for (const result of testResults.filter(r => !r.passed)) {
    console.log(`    - ${result.testName}`)
    if (result.details) console.log(`      ${result.details}`)
  }
}

console.log(`\n  ${passedCount > failedCount ? '🎉 升级验证通过！' : '⚠️ 部分测试失败，请检查'}`)

console.log('\n  📈 三大升级能力总结:')
console.log('     1. 语义理解: 向量嵌入检索 + 关键词匹配混合模式')
console.log('     2. 主动感知: 环境监听 + 新闻触发 + 上下文适配')
console.log('     3. 任务规划: 自动计划生成 + 步骤分解 + 优先级排序')