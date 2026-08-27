/**
 * inject-programming-knowledge.js — 编程知识注入与学习测试脚本
 *
 * 功能：
 *   1. 注入五星级编程知识到 Gina 大脑
 *   2. 测试知识是否成功存储
 *   3. 测试知识是否能被检索和应用
 *   4. 验证 IQ 分数提升
 *
 * 运行：
 *   node inject-programming-knowledge.js
 */

// 设置临时数据目录
process.env.GINA_HOME = '/tmp/gina-programming-test'

import { addKnowledge, queryKnowledge, retrieveRelevantKnowledge } from './src/memory/knowledge-distiller.js'
import {
  initIntelligenceSystem,
  recordThinkingPattern,
  recordDecisionRule,
  recordResponseTemplate,
  applyThinkingPattern,
  applyDecisionRule,
  getResponseTemplate,
  buildEnhancedPrompt,
  calculateIQScore,
} from './src/memory/intelligence-preserver.js'

// 清空并重建
import fs from 'fs'
import path from 'path'

const GINA_HOME = process.env.GINA_HOME
const KNOWLEDGE_DIR = path.join(GINA_HOME, 'knowledge')
const INTELLIGENCE_DIR = path.join(GINA_HOME, 'intelligence')

// 清理旧数据
if (fs.existsSync(GINA_HOME)) {
  fs.rmSync(GINA_HOME, { recursive: true })
}

console.log('============================================================')
console.log('  🧠 Gina 编程知识注入与学习测试')
console.log('============================================================\n')

// ──────────────────────────────────────────────────────────────
// 第一部分：注入五星级编程知识
// ──────────────────────────────────────────────────────────────

console.log('📚 第一部分：注入五星级编程知识')
console.log('─'.repeat(60))

// 初始化系统
initIntelligenceSystem()

// 1. 编程思考模式 - 5星质量
const thinkingPatterns = [
  {
    trigger: '代码重构|重构|refactor|代码优化',
    thinkingPath: [
      '1. 识别重构目标：确定要改进的代码范围',
      '2. 理解现有逻辑：在修改前完全理解当前实现',
      '3. 建立测试保护：确保重构不改变行为',
      '4. 逐步替换：每次只改一处，小步迭代',
      '5. 验证结果：确保所有测试通过，行为一致'
    ],
    conclusion: '重构的核心是小步迭代、测试驱动，确保每一步都可验证',
    quality: 5,
    sourceModel: 'injected-programming-master',
    metadata: { domain: 'programming', category: 'refactoring', level: 'expert' }
  },
  {
    trigger: '算法选择|数据结构|algorithm|复杂度',
    thinkingPath: [
      '1. 分析问题特征：数据规模、访问模式、性能要求',
      '2. 评估时间复杂度和空间复杂度',
      '3. 选择最合适的数据结构（数组/链表/树/图/哈希）',
      '4. 考虑实际场景的常数因子',
      '5. 验证边界情况和极端场景'
    ],
    conclusion: '选择算法时，先看问题特征和数据规模，再考虑理论复杂度',
    quality: 5,
    sourceModel: 'injected-programming-master',
    metadata: { domain: 'programming', category: 'algorithm', level: 'expert' }
  },
  {
    trigger: '系统设计|架构设计|分布式|高并发',
    thinkingPath: [
      '1. 明确需求：功能需求 + 非功能需求（性能/可用性/扩展性）',
      '2. 估算容量：QPS、数据量、存储需求',
      '3. 设计高层架构：单体内还是微服务',
      '4. 选择关键技术：数据库、缓存、消息队列',
      '5. 设计核心流程：数据流、状态管理',
      '6. 考虑容灾和扩展'
    ],
    conclusion: '系统设计从需求出发，先做容量估算，再选架构风格和关键技术',
    quality: 5,
    sourceModel: 'injected-programming-master',
    metadata: { domain: 'programming', category: 'system-design', level: 'expert' }
  },
  {
    trigger: '调试|debug|bug|错误排查|性能问题',
    thinkingPath: [
      '1. 建立可重复的最小复现用例',
      '2. 收集信息：日志、堆栈、监控指标',
      '3. 形成假设：基于证据而非猜测',
      '4. 验证假设：一次只改一个变量',
      '5. 确认修复：在多种场景下验证',
      '6. 预防复发：添加测试、完善文档'
    ],
    conclusion: '调试的关键是可复现 + 假设验证 + 最小改动',
    quality: 5,
    sourceModel: 'injected-programming-master',
    metadata: { domain: 'programming', category: 'debugging', level: 'expert' }
  },
  {
    trigger: '代码审查|code review|代码质量',
    thinkingPath: [
      '1. 检查正确性：逻辑是否正确、边界是否处理',
      '2. 检查可读性：命名、注释、结构是否清晰',
      '3. 检查健壮性：异常处理、资源管理',
      '4. 检查性能：是否有明显的性能问题',
      '5. 检查测试：关键路径是否有测试覆盖'
    ],
    conclusion: '代码审查从正确性出发，依次检查可读性、健壮性、性能和测试',
    quality: 5,
    sourceModel: 'injected-programming-master',
    metadata: { domain: 'programming', category: 'code-review', level: 'expert' }
  },
]

console.log('\n📝 注入编程思考模式...')
for (const pattern of thinkingPatterns) {
  const result = recordThinkingPattern(pattern)
  if (result.success) {
    console.log(`  ✓ ${pattern.trigger}`)
  } else {
    console.log(`  ✗ 失败: ${result.error}`)
  }
}

// 2. 编程决策规则 - 5星质量
const decisionRules = [
  {
    condition: '需要处理异步操作、并发任务',
    decision: '优先使用 async/await，合理使用 Promise.all 和 Promise.race',
    reasoning: 'async/await 代码更清晰，错误处理更方便；并发操作使用 Promise.all 但要注意全部失败的情况',
    examples: [
      '批量请求使用 Promise.all + 超时',
      '串行异步操作使用 for...of + await',
      '需要结果的操作优先用 Promise.all，需要尽早返回用 Promise.race'
    ],
    quality: 5,
    category: '异步编程',
  },
  {
    condition: '设计数据库表结构、数据模型',
    decision: '先满足第三范式，再根据查询需求反范式化',
    reasoning: '第三范式减少数据冗余和更新异常，但过度范式化会导致复杂 JOIN 和性能问题',
    examples: [
      '高频查询字段可以冗余到主表',
      '读写分离场景读模型可以反范式',
      'NoSQL 数据库按查询模式设计'
    ],
    quality: 5,
    category: '数据库设计',
  },
  {
    condition: '进行性能优化',
    decision: '先测量，再定位瓶颈，最后针对性优化',
    reasoning: '过早优化是万恶之源。没有数据支撑的优化往往是错的',
    examples: [
      '使用 profiler 找出热点函数',
      '使用监控系统识别慢查询',
      '使用火焰图分析 CPU 使用'
    ],
    quality: 5,
    category: '性能优化',
  },
  {
    condition: '选择设计模式',
    decision: '先理解模式的适用场景，再决定是否使用',
    reasoning: '设计模式是解决方案模板，不是银弹。误用比不用更糟糕',
    examples: [
      '工厂模式：创建逻辑复杂时使用',
      '观察者模式：一对多依赖关系时使用',
      '策略模式：多种算法需要可切换时使用'
    ],
    quality: 5,
    category: '设计模式',
  },
  {
    condition: '编写单元测试',
    decision: '测试行为而非实现，保持测试独立性和可重复性',
    reasoning: '测试应该关注函数的输入输出，而不是内部实现细节',
    examples: [
      '每个测试只验证一件事',
      '使用 setUp/tearDown 保持状态独立',
      '优先覆盖边界条件和异常路径'
    ],
    quality: 5,
    category: '测试驱动',
  },
]

console.log('\n📝 注入编程决策规则...')
for (const rule of decisionRules) {
  const result = recordDecisionRule(rule)
  if (result.success) {
    console.log(`  ✓ ${rule.condition.slice(0, 30)}...`)
  } else {
    console.log(`  ✗ 失败: ${result.error}`)
  }
}

// 3. 编程回复模板 - 5星质量
const responseTemplates = [
  {
    type: 'code_analysis',
    structure: ['理解需求', '分析现状', '设计方案', '实现代码', '验证结果'],
    style: '专业、清晰、结构化',
    components: ['问题理解', '技术方案', '代码实现', '测试验证'],
    useCases: ['代码审查', '技术方案设计', '问题分析']
  },
  {
    type: 'debugging',
    structure: ['复现问题', '收集信息', '形成假设', '验证修复', '预防复发'],
    style: '系统性、证据驱动',
    components: ['复现步骤', '诊断分析', '修复方案', '测试用例'],
    useCases: ['Bug 修复', '故障排查', '性能问题']
  },
  {
    type: 'design',
    structure: ['明确需求', '评估方案', '选择技术栈', '设计架构', '规划实施'],
    style: '前瞻性、权衡清晰',
    components: ['需求分析', '方案对比', '技术选型', '架构图'],
    useCases: ['系统设计', '技术选型', '架构评审']
  },
  {
    type: 'refactoring',
    structure: ['识别坏味道', '建立测试', '逐步替换', '持续验证', '清理收尾'],
    style: '谨慎、小步快跑',
    components: ['代码分析', '重构计划', '重构步骤', '测试结果'],
    useCases: ['代码重构', '技术债清理', '代码优化']
  },
  {
    type: 'algorithm',
    structure: ['分析问题', '选择数据结构', '设计算法', '分析复杂度', '编写代码'],
    style: '逻辑严密、复杂度明确',
    components: ['问题分析', '算法设计', '复杂度分析', '代码实现'],
    useCases: ['算法实现', '数据结构选择', '复杂度分析']
  },
]

console.log('\n📝 注入编程回复模板...')
for (const template of responseTemplates) {
  const result = recordResponseTemplate(template)
  if (result.success) {
    console.log(`  ✓ ${template.type}`)
  } else {
    console.log(`  ✗ 失败: ${result.error}`)
  }
}

// 4. 核心编程知识 - 存入知识库
const coreKnowledge = [
  {
    type: 'rule',
    content: '编程第一原则：代码是写给人看的，只是顺便让机器执行。可读性永远优先于精巧。',
    confidence: 0.98,
    sources: ['Robert C. Martin《代码整洁之道》'],
    tags: ['编程原则', '代码质量', '可读性'],
    metadata: { domain: 'programming', specificity: 0.95, applicability: 'high' }
  },
  {
    type: 'rule',
    content: 'KISS 原则（Keep It Simple, Stupid）：简单的设计优于复杂的设计。每个功能只做一件事，做好一件事。',
    confidence: 0.95,
    sources: ['软件开发经典原则'],
    tags: ['设计原则', '简单性'],
    metadata: { domain: 'programming', specificity: 0.9, applicability: 'high' }
  },
  {
    type: 'rule',
    content: 'DRY 原则（Don\'t Repeat Yourself）：不要重复自己。任何重复的逻辑都应该被抽象出来。',
    confidence: 0.95,
    sources: ['软件开发经典原则'],
    tags: ['设计原则', '代码复用'],
    metadata: { domain: 'programming', specificity: 0.9, applicability: 'high' }
  },
  {
    type: 'strategy',
    content: '设计模式选择策略：当需要创建复杂对象时用工厂模式；当需要在多种算法间切换时用策略模式；当需要解耦对象间通信时用观察者模式。',
    confidence: 0.92,
    sources: ['GoF《设计模式》'],
    tags: ['设计模式', 'GoF'],
    metadata: { domain: 'programming', specificity: 0.85, applicability: 'high' }
  },
  {
    type: 'procedure',
    content: 'TDD 流程：1) 写一个会失败的测试 2) 写最少的代码让测试通过 3) 重构代码 4) 重复。核心是测试先行。',
    confidence: 0.93,
    sources: ['Kent Beck《测试驱动开发》'],
    tags: ['TDD', '测试驱动', '开发流程'],
    metadata: { domain: 'programming', specificity: 0.88, applicability: 'high' }
  },
  {
    type: 'fact',
    content: '常见时间复杂度：O(1) < O(log n) < O(n) < O(n log n) < O(n²) < O(2^n) < O(n!)。实际应用中应避免 O(n²) 以上的复杂度。',
    confidence: 0.98,
    sources: ['算法导论'],
    tags: ['算法', '复杂度', '性能'],
    metadata: { domain: 'programming', specificity: 0.95, applicability: 'high' }
  },
  {
    type: 'insight',
    content: '好的命名比注释更重要。如果需要注释来解释代码，通常意味着命名不好或结构有问题。',
    confidence: 0.9,
    sources: ['代码整洁之道'],
    tags: ['命名', '代码质量'],
    metadata: { domain: 'programming', specificity: 0.85, applicability: 'high' }
  },
  {
    type: 'rule',
    content: 'Git 工作流规则：提交信息应该清晰说明做了什么和为什么。每个提交应该只包含一个逻辑变更。',
    confidence: 0.92,
    sources: ['Git 最佳实践'],
    tags: ['Git', '版本控制', '协作'],
    metadata: { domain: 'programming', specificity: 0.88, applicability: 'high' }
  },
  {
    type: 'strategy',
    content: '错误处理策略：使用 try-catch 捕获可能的失败；不要忽略错误（至少 log）；向上层传递错误让调用者决定处理方式。',
    confidence: 0.9,
    sources: ['编程最佳实践'],
    tags: ['错误处理', '健壮性'],
    metadata: { domain: 'programming', specificity: 0.85, applicability: 'high' }
  },
  {
    type: 'procedure',
    content: '代码审查清单：1) 是否有逻辑错误 2) 是否处理了边界条件 3) 是否有性能问题 4) 是否有安全漏洞 5) 是否有足够的测试覆盖。',
    confidence: 0.93,
    sources: ['代码审查实践'],
    tags: ['代码审查', '质量保证'],
    metadata: { domain: 'programming', specificity: 0.88, applicability: 'high' }
  },
  {
    type: 'rule',
    content: 'SOLID 原则：单一职责、开闭原则、里氏替换、接口隔离、依赖倒置。是面向对象设计的基石。',
    confidence: 0.96,
    sources: ['Robert C. Martin'],
    tags: ['设计原则', 'SOLID', '面向对象'],
    metadata: { domain: 'programming', specificity: 0.92, applicability: 'high' }
  },
  {
    type: 'strategy',
    content: '缓存策略：优先使用内存缓存（LRU）；热点数据预加载；缓存穿透用布隆过滤器；缓存击穿用互斥锁；缓存雪崩用随机过期时间。',
    confidence: 0.9,
    sources: ['缓存设计模式'],
    tags: ['缓存', '性能优化', '分布式'],
    metadata: { domain: 'programming', specificity: 0.88, applicability: 'high' }
  },
  {
    type: 'procedure',
    content: 'Git 分支策略：main 分支保持稳定；develop 分支集成功能；feature 分支开发新功能；release 分支准备发布；hotfix 分支紧急修复。',
    confidence: 0.91,
    sources: ['Git Flow'],
    tags: ['Git', '版本控制', '协作流程'],
    metadata: { domain: 'programming', specificity: 0.87, applicability: 'medium' }
  },
  {
    type: 'fact',
    content: 'HTTP 状态码：200 成功、301 永久重定向、302 临时重定向、400 请求错误、401 未认证、403 禁止访问、404 未找到、500 服务器错误、503 服务不可用。',
    confidence: 0.97,
    sources: ['HTTP 规范'],
    tags: ['HTTP', '网络', 'API'],
    metadata: { domain: 'programming', specificity: 0.95, applicability: 'high' }
  },
  {
    type: 'insight',
    content: '编写可维护代码的秘诀：让每个函数只做一件事；让每个模块只包含一个抽象层次；让命名自解释；让依赖方向单向。',
    confidence: 0.92,
    sources: ['可维护性设计'],
    tags: ['可维护性', '代码质量', '架构'],
    metadata: { domain: 'programming', specificity: 0.88, applicability: 'high' }
  }
]

console.log('\n📝 注入核心编程知识...')
for (const k of coreKnowledge) {
  const result = addKnowledge(k)
  if (result.id) {
    console.log(`  ✓ [${k.type}] ${k.content.slice(0, 40)}...`)
  } else {
    console.log(`  ✗ 失败`)
  }
}

console.log('\n✅ 知识注入完成！')

// ──────────────────────────────────────────────────────────────
// 第二部分：测试知识学习效果
// ──────────────────────────────────────────────────────────────

console.log('\n\n📊 第二部分：测试知识学习效果')
console.log('─'.repeat(60))

// 测试 1：知识检索
console.log('\n🔍 测试 1：知识检索')
const allKnowledge = queryKnowledge({ limit: 50 })
console.log(`  知识库总数: ${allKnowledge.length} 条`)

const byType = {}
for (const k of allKnowledge) {
  byType[k.type] = (byType[k.type] || 0) + 1
}
console.log(`  按类型分布: ${JSON.stringify(byType)}`)

// 测试 2：相关知识检索
console.log('\n🔍 测试 2：相关知识检索（查询"重构"）')
const refactorKnowledge = retrieveRelevantKnowledge('我想重构一下这段代码，让代码更清晰', { maxResults: 3 })
console.log(`  相关知识条数: ${refactorKnowledge.length}`)
for (const k of refactorKnowledge) {
  console.log(`  - ${typeof k.content === 'string' ? k.content.slice(0, 60) : JSON.stringify(k.content).slice(0, 60)}...`)
}

console.log('\n🔍 测试 3：相关知识检索（查询"性能优化"）')
const perfKnowledge = retrieveRelevantKnowledge('这个程序性能不好，需要优化算法和缓存', { maxResults: 3 })
console.log(`  相关知识条数: ${perfKnowledge.length}`)
for (const k of perfKnowledge) {
  console.log(`  - ${typeof k.content === 'string' ? k.content.slice(0, 60) : JSON.stringify(k.content).slice(0, 60)}...`)
}

console.log('\n🔍 测试 4：相关知识检索（查询"设计原则"）')
const designKnowledge = retrieveRelevantKnowledge('代码设计原则 SOLID 面向对象', { maxResults: 3 })
console.log(`  相关知识条数: ${designKnowledge.length}`)

// 测试 3：思考模式应用
console.log('\n🧠 测试 4：思考模式应用')
const thinkingResult = applyThinkingPattern(['重构', '代码', 'refactor'])
if (thinkingResult.matched) {
  console.log(`  ✓ 成功匹配思考模式`)
  console.log(`    置信度: ${thinkingResult.confidence}`)
  console.log(`    思考路径: ${thinkingResult.thinkingPath?.slice(0, 3).join(' → ')}...`)
} else {
  console.log(`  ✗ 未匹配到思考模式`)
}

console.log('\n🧠 测试 5：思考模式应用（查询"调试 bug"）')
const debugThinking = applyThinkingPattern(['调试', 'debug', 'bug', '错误'])
if (debugThinking.matched) {
  console.log(`  ✓ 成功匹配调试思考模式`)
  console.log(`    置信度: ${debugThinking.confidence}`)
  console.log(`    思考路径: ${debugThinking.thinkingPath?.slice(0, 3).join(' → ')}...`)
}

// 测试 4：决策规则应用
console.log('\n⚖️ 测试 6：决策规则应用（异步编程）')
const asyncDecision = applyDecisionRule('异步操作 Promise async await')
if (asyncDecision.matched) {
  console.log(`  ✓ 成功匹配决策规则`)
  console.log(`    决策: ${asyncDecision.decision}`)
  console.log(`    推理: ${asyncDecision.reasoning}`)
  console.log(`    置信度: ${asyncDecision.confidence}`)
} else {
  console.log(`  ✗ 未匹配到决策规则`)
}

// 测试 5：回复模板获取
console.log('\n📝 测试 7：回复模板获取')
const codeAnalysisTemplate = getResponseTemplate('code_analysis')
if (codeAnalysisTemplate) {
  console.log(`  ✓ 成功获取模板: code_analysis`)
  console.log(`    结构: ${codeAnalysisTemplate.structure?.join(' → ')}`)
}

const debuggingTemplate = getResponseTemplate('debugging')
if (debuggingTemplate) {
  console.log(`  ✓ 成功获取模板: debugging`)
  console.log(`    结构: ${debuggingTemplate.structure?.join(' → ')}`)
}

// 测试 6：增强提示词构建
console.log('\n🚀 测试 8：增强提示词构建')
const enhancedPrompt = buildEnhancedPrompt({
  userInput: '帮我重构这段代码，使其更清晰高效',
  problemType: 'refactoring',
  context: ['代码质量', '可维护性'],
})
console.log(`  ✓ 增强提示词构建成功`)
console.log(`    增强数量: ${enhancedPrompt.enhancementCount}`)
console.log(`    系统增强（前100字）: ${enhancedPrompt.systemEnhancement?.slice(0, 100)}...`)

// 测试 7：IQ 分数计算
console.log('\n🧮 测试 9：IQ 分数计算')
const iqResult = calculateIQScore()
console.log(`  ✓ IQ 分数: ${iqResult.score}`)
console.log(`    等级: ${iqResult.levelLabel}`)
console.log(`    描述: ${iqResult.description}`)
console.log(`    分解:`)
console.log(`      - 基础分: ${iqResult.breakdown.base}`)
console.log(`      - 思考模式加成: ${iqResult.breakdown.patterns}`)
console.log(`      - 决策规则加成: ${iqResult.breakdown.rules}`)
console.log(`      - 回复模板加成: ${iqResult.breakdown.templates}`)
console.log(`    统计:`)
console.log(`      - 总思考模式: ${iqResult.statistics.totalPatterns}`)
console.log(`      - 高质量模式: ${iqResult.statistics.qualityPatterns}`)
console.log(`      - 总决策规则: ${iqResult.statistics.totalRules}`)
console.log(`      - 有效规则: ${iqResult.statistics.effectiveRules}`)

// ──────────────────────────────────────────────────────────────
// 第三部分：学习效果总结
// ──────────────────────────────────────────────────────────────

console.log('\n\n📋 第三部分：学习效果总结')
console.log('─'.repeat(60))

const results = {
  knowledge: {
    total: allKnowledge.length,
    pass: allKnowledge.length >= 10,
  },
  retrieval: {
    refactor: refactorKnowledge.length >= 1,
    performance: perfKnowledge.length >= 1,
    design: designKnowledge.length >= 1,
  },
  thinking: {
    refactor: thinkingResult.matched,
    debugging: debugThinking.matched,
  },
  decision: {
    async: asyncDecision.matched,
  },
  template: {
    codeAnalysis: !!codeAnalysisTemplate,
    debugging: !!debuggingTemplate,
  },
  iq: {
    score: iqResult.score,
    improved: iqResult.score >= 100,
  }
}

const totalTests = Object.values(results).reduce((acc, cat) => {
  if (typeof cat === 'boolean') return acc + (cat ? 1 : 0)
  return acc + Object.values(cat).filter(v => typeof v === 'boolean' && v === true).length
}, 0)

const totalTestCases = Object.values(results).reduce((acc, cat) => {
  if (typeof cat === 'boolean') return acc + 1
  return acc + Object.values(cat).filter(v => typeof v === 'boolean').length
}, 0)

console.log(`\n  📈 测试结果: ${totalTests}/${totalTestCases} 通过`)
console.log(`  📊 通过率: ${(totalTests / totalTestCases * 100).toFixed(1)}%`)

// 详细结果
console.log('\n  详细结果:')
console.log(`    知识存储: ${results.knowledge.pass ? '✓' : '✗'} (${results.knowledge.total} 条)`)
console.log(`    知识检索: ${results.retrieval.refactor && results.retrieval.performance && results.retrieval.design ? '✓' : '✗'}`)
console.log(`      - 重构知识: ${results.retrieval.refactor ? '✓' : '✗'}`)
console.log(`      - 性能知识: ${results.retrieval.performance ? '✓' : '✗'}`)
console.log(`      - 设计原则: ${results.retrieval.design ? '✓' : '✗'}`)
console.log(`    思考模式: ${results.thinking.refactor && results.thinking.debugging ? '✓' : '✗'}`)
console.log(`    决策规则: ${results.decision.async ? '✓' : '✗'}`)
console.log(`    回复模板: ${results.template.codeAnalysis && results.template.debugging ? '✓' : '✗'}`)
console.log(`    IQ 提升: ${results.iq.improved ? '✓' : '✗'} (${results.iq.score} 分)`)

console.log('\n' + '='.repeat(60))
console.log('  🎉 编程知识注入与学习测试完成！')
console.log('='.repeat(60))
console.log(`\n  Gina 的编程大脑现在拥有：`)
console.log(`    - ${thinkingPatterns.length} 个五星级编程思考模式`)
console.log(`    - ${decisionRules.length} 个五星级编程决策规则`)
console.log(`    - ${responseTemplates.length} 个五星级编程回复模板`)
console.log(`    - ${coreKnowledge.length} 条核心编程知识`)
console.log(`    - IQ 分数: ${iqResult.score} (${iqResult.levelLabel})`)