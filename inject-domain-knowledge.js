/**
 * inject-domain-knowledge.js — 多领域知识注入脚本（完整版）
 *
 * 注入五大领域的五星级知识：
 *   1. AI/Agent 开发知识
 *   2. 孙子兵法运用知识
 *   3. 国内外地产行业分析知识
 *   4. 股票金融分析知识
 *   5. 工商管理学运用知识
 *
 * 运行：
 *   node inject-domain-knowledge.js
 */

import fs from 'fs'
import path from 'path'
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
} from './src/memory/intelligence-preserver.js'

// 使用统一数据目录
const GINA_HOME = process.env.GINA_HOME || path.join(process.env.HOME || '.', '.gina')

// 清理并重建
if (fs.existsSync(GINA_HOME)) {
  fs.rmSync(GINA_HOME, { recursive: true })
}

console.log('============================================================')
console.log('  🧠 Gina 多领域知识注入')
console.log('============================================================')
console.log(`  存储路径: ${GINA_HOME}\n`)

initIntelligenceSystem()

const stats = {
  domains: [],
  thinkingPatterns: 0,
  decisionRules: 0,
  responseTemplates: 0,
  coreKnowledge: 0,
}

// ═══════════════════════════════════════════════════════════════
// 辅助函数
// ═══════════════════════════════════════════════════════════════

function injectThinkingPatterns(patterns, label) {
  for (const p of patterns) {
    recordThinkingPattern(p)
    stats.thinkingPatterns++
  }
  console.log(`  ✓ 注入 ${patterns.length} 个${label}思考模式`)
}

function injectDecisionRules(rules, label) {
  for (const r of rules) {
    recordDecisionRule(r)
    stats.decisionRules++
  }
  console.log(`  ✓ 注入 ${rules.length} 条${label}决策规则`)
}

function injectResponseTemplates(templates, label) {
  for (const t of templates) {
    recordResponseTemplate(t)
    stats.responseTemplates++
  }
  console.log(`  ✓ 注入 ${templates.length} 个${label}回复模板`)
}

function injectCoreKnowledge(knowledge, label) {
  for (const k of knowledge) {
    addKnowledge(k)
    stats.coreKnowledge++
  }
  console.log(`  ✓ 注入 ${knowledge.length} 条${label}核心知识`)
}

function domainHeader(title) {
  console.log('\n' + '─'.repeat(60))
  console.log(title)
  console.log('─'.repeat(60))
}

// ═══════════════════════════════════════════════════════════════
// 领域 1：AI / Agent 开发知识
// ═══════════════════════════════════════════════════════════════

domainHeader('🤖 领域 1：AI / Agent 开发知识')

injectThinkingPatterns([
  {
    trigger: 'Agent架构|多Agent系统|Agent设计|agent',
    thinkingPath: [
      '1. 明确 Agent 角色和目标：它是谁？要解决什么问题？',
      '2. 设计感知系统：Agent 如何获取外部信息',
      '3. 设计决策系统：Agent 如何推理、规划、选择行动',
      '4. 设计行动系统：Agent 能执行哪些操作',
      '5. 设计记忆系统：Agent 如何存储和检索经验',
      '6. 设计进化机制：Agent 如何持续学习和改进'
    ],
    conclusion: 'Agent 设计从角色定义出发，依次构建感知-决策-行动-记忆-进化五大系统',
    quality: 5, sourceModel: 'injected-domain-master',
    metadata: { domain: 'ai_agent', category: 'architecture', level: 'expert' }
  },
  {
    trigger: 'Prompt工程|提示词|prompt|系统提示',
    thinkingPath: [
      '1. 明确 Prompt 目标：要让模型做什么',
      '2. 设计角色设定：赋予模型专业身份和能力边界',
      '3. 构建上下文：提供必要的背景信息和示例',
      '4. 定义输出格式：结构化、可解析的输出',
      '5. 添加约束和规则：明确禁止和必须',
      '6. 测试和迭代：根据输出调整 Prompt'
    ],
    conclusion: '好的 Prompt 设计遵循：目标→角色→上下文→格式→约束→迭代',
    quality: 5, sourceModel: 'injected-domain-master',
    metadata: { domain: 'ai_agent', category: 'prompt_engineering', level: 'expert' }
  },
  {
    trigger: 'RAG|检索增强|向量数据库|embedding',
    thinkingPath: [
      '1. 确定知识源：哪些外部知识需要被检索',
      '2. 选择 Embedding 模型：平衡质量和成本',
      '3. 设计分块策略：文档切块大小和重叠',
      '4. 选择向量数据库：FAISS/Milvus/Pinecone',
      '5. 设计检索策略：相似度阈值、Top-K',
      '6. 设计生成策略：融合检索结果和模型回答'
    ],
    conclusion: 'RAG 系统设计的核心是检索质量和生成质量的平衡',
    quality: 5, sourceModel: 'injected-domain-master',
    metadata: { domain: 'ai_agent', category: 'rag', level: 'expert' }
  },
  {
    trigger: '微调|fine-tuning|LoRA|训练',
    thinkingPath: [
      '1. 明确微调目标：领域适配、风格调整',
      '2. 准备训练数据：高质量、多样化',
      '3. 选择微调方法：全参数/LoRA/Adapter',
      '4. 选择基础模型：考虑大小、架构',
      '5. 设置训练参数：学习率、批大小',
      '6. 评估和迭代：在验证集上测试'
    ],
    conclusion: '微调的关键是高质量数据 > 好的方法 > 大的模型',
    quality: 5, sourceModel: 'injected-domain-master',
    metadata: { domain: 'ai_agent', category: 'fine_tuning', level: 'expert' }
  },
  {
    trigger: 'LLM评估|模型评估|benchmark|评测',
    thinkingPath: [
      '1. 明确评估目标：要衡量什么能力',
      '2. 选择评估方法：自动指标/人工评估',
      '3. 设计测试集：覆盖核心场景',
      '4. 建立基线：与基准模型对比',
      '5. 收集和分析结果：统计显著性',
      '6. 形成结论：改进方向'
    ],
    conclusion: 'LLM 评估要量化、可复现、覆盖真实场景',
    quality: 5, sourceModel: 'injected-domain-master',
    metadata: { domain: 'ai_agent', category: 'evaluation', level: 'expert' }
  },
  {
    trigger: 'Agent记忆|长期记忆|短期记忆|memory',
    thinkingPath: [
      '1. 区分记忆类型：工作/短期/长期',
      '2. 选择存储方案：内存/文件/数据库',
      '3. 设计写入策略：何时写、写什么',
      '4. 设计检索策略：何时读、如何排序',
      '5. 设计遗忘机制：过期/衰减',
      '6. 设计整合机制：新旧知识融合'
    ],
    conclusion: 'Agent 记忆系统需要在可访问性和准确性之间平衡',
    quality: 5, sourceModel: 'injected-domain-master',
    metadata: { domain: 'ai_agent', category: 'memory', level: 'expert' }
  },
  {
    trigger: '工具调用|function calling|API调用|tool use',
    thinkingPath: [
      '1. 识别可工具化的能力',
      '2. 设计工具接口：清晰的输入输出',
      '3. 描述工具能力：让 LLM 理解',
      '4. 处理工具调用：解析、执行、返回',
      '5. 处理异常：超时、失败',
      '6. 优化调用策略：批量、异步、缓存'
    ],
    conclusion: '工具调用的关键是清晰的接口描述和健壮的错误处理',
    quality: 5, sourceModel: 'injected-domain-master',
    metadata: { domain: 'ai_agent', category: 'tool_calling', level: 'expert' }
  },
], 'AI/Agent ')

injectDecisionRules([
  {
    condition: '设计新 Agent 时',
    decision: '优先使用 ReAct 框架（Reasoning + Acting）',
    reasoning: 'ReAct 框架简单有效，兼顾推理和执行',
    examples: ['客服 Agent', '数据分析 Agent', '研究助理 Agent'],
    quality: 5, category: 'Agent架构',
  },
  {
    condition: '需要让 Agent 具备长期记忆时',
    decision: '使用向量数据库存储语义记忆 + SQLite 存储结构化记忆',
    reasoning: '向量库擅长语义检索，SQLite 擅长结构化查询',
    examples: ['用户偏好存向量库', '任务历史存 SQLite'],
    quality: 5, category: 'Agent记忆',
  },
  {
    condition: '设计多 Agent 协作系统时',
    decision: '先单 Agent 跑通，再增加多 Agent 协调层',
    reasoning: '多 Agent 复杂度高，单 Agent 验证后再扩展更稳妥',
    examples: ['先单 Agent', '再加协调者', '最后加专家'],
    quality: 5, category: '多Agent系统',
  },
  {
    condition: '选择 LLM 部署方案时',
    decision: '先用云端模型验证，再考虑本地部署',
    reasoning: '云端模型能力强，快速验证可行性',
    examples: ['开发用云端', '验证后考虑本地'],
    quality: 5, category: 'LLM部署',
  },
  {
    condition: '处理 Agent 幻觉问题时',
    decision: '引入验证机制：知识源校验、工具验证、人工审核',
    reasoning: '幻觉是 LLM 固有问题，需要外部验证机制',
    examples: ['事实需查证', '代码需测试', '重要决策需人工确认'],
    quality: 5, category: 'Agent安全',
  },
], 'AI/Agent ')

injectResponseTemplates([
  {
    type: 'agent_design',
    structure: ['需求分析', '架构设计', '模块实现', '集成测试', '部署优化'],
    style: '系统性、前瞻性',
    components: ['需求文档', '架构图', '模块代码', '测试报告'],
    useCases: ['新 Agent 设计', 'Agent 架构评审']
  },
  {
    type: 'prompt_engineering',
    structure: ['目标定义', '角色设定', '上下文构建', '输出规范', '测试迭代'],
    style: '清晰、可执行',
    components: ['Prompt 模板', 'Few-shot 示例', '约束条件'],
    useCases: ['Prompt 优化', '系统提示设计']
  },
  {
    type: 'rag_architecture',
    structure: ['知识源梳理', 'Embedding 选型', '索引构建', '检索策略', '生成融合'],
    style: '工程化、可扩展',
    components: ['数据管道', '向量索引', '检索服务', '生成服务'],
    useCases: ['RAG 系统设计', '知识库构建']
  },
], 'AI/Agent ')

injectCoreKnowledge([
  { type: 'rule', content: 'Agent 设计原则：感知-决策-行动-记忆-进化五大系统缺一不可。没有记忆的 Agent 无法学习，没有进化的 Agent 无法成长。', confidence: 0.97, sources: ['Agent 设计模式'], tags: ['Agent', '架构设计'], metadata: { domain: 'ai_agent', specificity: 0.95, applicability: 'high' } },
  { type: 'strategy', content: 'ReAct 框架：Reasoning（推理）+ Acting（行动）交替进行。Agent 先思考要做什么，再执行行动，观察结果后继续思考。', confidence: 0.96, sources: ['Yao et al., 2022'], tags: ['ReAct', 'Agent框架'], metadata: { domain: 'ai_agent', specificity: 0.92, applicability: 'high' } },
  { type: 'fact', content: '主流 LLM 对比：GPT-4 综合能力强、Claude 3 长上下文、Gemini 多模态、开源模型 LLaMA/Mistral 可本地部署。', confidence: 0.9, sources: ['LLM 评测报告'], tags: ['LLM', '模型对比'], metadata: { domain: 'ai_agent', specificity: 0.85, applicability: 'medium' } },
  { type: 'procedure', content: 'RAG 实现步骤：文档收集→文本切块→Embedding 编码→存入向量库→查询时检索 Top-K→融合到 Prompt 生成回答。', confidence: 0.94, sources: ['RAG 最佳实践'], tags: ['RAG', '检索增强'], metadata: { domain: 'ai_agent', specificity: 0.9, applicability: 'high' } },
  { type: 'rule', content: 'Agent 安全原则：1) 不执行未验证的操作 2) 关键操作需人工确认 3) 限制权限范围 4) 记录操作日志。', confidence: 0.95, sources: ['AI 安全准则'], tags: ['Agent安全', 'AI伦理'], metadata: { domain: 'ai_agent', specificity: 0.92, applicability: 'high' } },
  { type: 'insight', content: '高质量数据比大模型更重要。用 7B 模型配合高质量数据，可以击败用 70B 模型配合低质量数据的方案。', confidence: 0.92, sources: ['数据为王'], tags: ['数据', '模型训练'], metadata: { domain: 'ai_agent', specificity: 0.88, applicability: 'high' } },
  { type: 'strategy', content: 'Agent 成长路径：预置知识→交互学习→反思总结→自动测试→持续优化。形成完整的自我进化闭环。', confidence: 0.93, sources: ['Agent 进化框架'], tags: ['Agent成长', '自我改进'], metadata: { domain: 'ai_agent', specificity: 0.9, applicability: 'high' } },
  { type: 'fact', content: 'Token 成本优化技巧：使用更小模型、缓存前缀、减少上下文、流式响应、本地部署推理。', confidence: 0.91, sources: ['LLM 成本优化'], tags: ['成本优化', '性能'], metadata: { domain: 'ai_agent', specificity: 0.88, applicability: 'medium' } },
  { type: 'rule', content: 'Function Calling 设计原则：函数描述清晰完整、参数类型明确、返回值结构化、错误可解释。', confidence: 0.94, sources: ['API 设计指南'], tags: ['Function Calling', 'API设计'], metadata: { domain: 'ai_agent', specificity: 0.9, applicability: 'high' } },
  { type: 'strategy', content: '多 Agent 协作模式：编排模式（Orchestrator + Workers）、讨论模式（Debate）、层级模式（Manager）、协作模式（Peer-to-Peer）。', confidence: 0.9, sources: ['多 Agent 模式'], tags: ['多Agent', '协作'], metadata: { domain: 'ai_agent', specificity: 0.85, applicability: 'medium' } },
], 'AI/Agent ')

stats.domains.push('AI/Agent 开发')

// ═══════════════════════════════════════════════════════════════
// 领域 2：孙子兵法运用知识
// ═══════════════════════════════════════════════════════════════

domainHeader('⚔️ 领域 2：孙子兵法运用知识')

injectThinkingPatterns([
  {
    trigger: '战略规划|竞争策略|兵法|孙子',
    thinkingPath: [
      '1. 进行"五事七计"分析：道、天、地、将、法',
      '2. 评估双方实力对比：优势、劣势、机会、威胁',
      '3. 选择战略方向：进攻/防守/迂回/联盟',
      '4. 制定具体策略：奇正配合、虚实结合',
      '5. 规划执行步骤：分阶段推进',
      '6. 设计应变方案：根据敌情变化调整'
    ],
    conclusion: '战略规划从形势分析出发，选择正确方向，制定灵活策略',
    quality: 5, sourceModel: 'injected-domain-master',
    metadata: { domain: 'military_strategy', category: 'strategy_planning', level: 'expert' }
  },
  {
    trigger: '市场竞争|对手分析|商战|竞争',
    thinkingPath: [
      '1. 知己知彼：分析自身和竞争对手的优劣势',
      '2. 避实击虚：寻找竞争对手的薄弱环节',
      '3. 出其不意：以竞争对手意想不到的方式行动',
      '4. 集中优势：在关键点集中资源',
      '5. 速战速决：避免持久战',
      '6. 留有余地：给对手留出退路'
    ],
    conclusion: '竞争的核心是避实击虚、出奇制胜',
    quality: 5, sourceModel: 'injected-domain-master',
    metadata: { domain: 'military_strategy', category: 'market_competition', level: 'expert' }
  },
  {
    trigger: '谈判策略|外交|沟通|谈判',
    thinkingPath: [
      '1. 做好情报收集：了解对方需求和底线',
      '2. 创造有利态势：选择对自己有利的谈判环境',
      '3. 示弱示强：根据情况展示实力或示弱',
      '4. 掌握节奏：控制谈判进度',
      '5. 以退为进：在关键点做出必要让步',
      '6. 达成双赢：寻找双方利益交汇点'
    ],
    conclusion: '谈判的精髓是知己知彼、进退有度',
    quality: 5, sourceModel: 'injected-domain-master',
    metadata: { domain: 'military_strategy', category: 'negotiation', level: 'expert' }
  },
  {
    trigger: '危机管理|突发事件|应急|危机',
    thinkingPath: [
      '1. 保持冷静：临危不乱是第一原则',
      '2. 快速评估：判断危机性质和影响范围',
      '3. 立即行动：控制事态发展',
      '4. 分化瓦解：将大危机分解为小问题',
      '5. 化险为夷：寻找危机中的转机',
      '6. 事后复盘：总结经验防止再发'
    ],
    conclusion: '危机管理的关键是快速反应、分化问题、化危为机',
    quality: 5, sourceModel: 'injected-domain-master',
    metadata: { domain: 'military_strategy', category: 'crisis_management', level: 'expert' }
  },
], '孙子兵法 ')

injectDecisionRules([
  {
    condition: '面对强敌时',
    decision: '避而避之，寻找敌人弱点或等待其犯错',
    reasoning: '孙子曰："避实而击虚"。在敌人强势时硬碰硬代价太大',
    examples: ['竞争对手强势时不正面竞争', '等待市场变化再出击', '选择差异化定位'],
    quality: 5, category: '敌强我弱',
  },
  {
    condition: '需要快速取胜时',
    decision: '集中兵力攻击敌人要害，速战速决',
    reasoning: '孙子曰："兵贵胜，不贵久"。持久战消耗大',
    examples: ['新产品快速上市', '快速占领市场', '集中资源突破关键点'],
    quality: 5, category: '速战速决',
  },
  {
    condition: '处于劣势时',
    decision: '用奇取胜，以弱胜强需要出其不意',
    reasoning: '孙子曰："凡战者，以正合，以奇胜"',
    examples: ['用创新商业模式挑战巨头', '用新技术颠覆市场', '用差异化产品突围'],
    quality: 5, category: '奇正配合',
  },
  {
    condition: '建立联盟时',
    decision: '选择利益互补的盟友，确保联盟稳固',
    reasoning: '孙子曰："上兵伐谋，其次伐交"。外交联盟是重要战略',
    examples: ['与互补型企业合作', '建立行业联盟', '形成生态伙伴关系'],
    quality: 5, category: '联盟策略',
  },
  {
    condition: '撤退或让步时',
    decision: '有序撤退，保留实力，寻找再战机会',
    reasoning: '孙子曰："善守者藏于九地之下，善攻者动于九天之上"',
    examples: ['收缩业务聚焦核心', '暂时放弃非核心市场', '保留实力等待时机'],
    quality: 5, category: '攻守转换',
  },
], '孙子兵法 ')

injectResponseTemplates([
  {
    type: 'strategy_analysis',
    structure: ['形势分析', '敌我对比', '战略选择', '策略制定', '行动规划'],
    style: '宏观、系统、辩证',
    components: ['五事七计', 'SWOT分析', '战略方向', '执行步骤'],
    useCases: ['战略规划', '竞争分析', '路线图']
  },
  {
    type: 'competition_strategy',
    structure: ['竞争对手分析', '自身定位', '差异化设计', '市场切入', '防御布局'],
    style: '务实、灵活、进取',
    components: ['对手画像', '价值主张', '进入策略', '护城河'],
    useCases: ['市场进入', '竞争应对', '差异化定位']
  },
], '孙子兵法 ')

injectCoreKnowledge([
  { type: 'rule', content: '孙子兵法核心原则：知己知彼，百战不殆。不打无准备之仗，不打无把握之仗。', confidence: 0.98, sources: ['《孙子兵法》'], tags: ['兵法', '战略'], metadata: { domain: 'military_strategy', specificity: 0.98, applicability: 'high' } },
  { type: 'strategy', content: '五事七计：道（政治）、天（时机）、地（地形）、将（将领）、法（制度）。这是战略分析的基本框架。', confidence: 0.96, sources: ['《孙子兵法·始计篇》'], tags: ['兵法', '战略分析'], metadata: { domain: 'military_strategy', specificity: 0.95, applicability: 'high' } },
  { type: 'rule', content: '避实击虚原则：避开敌人强处，攻击敌人弱点。商业中意味着避开红海，寻找蓝海。', confidence: 0.95, sources: ['《孙子兵法·虚实篇》'], tags: ['兵法', '竞争策略'], metadata: { domain: 'military_strategy', specificity: 0.92, applicability: 'high' } },
  { type: 'strategy', content: '奇正之术：以正合，以奇胜。正为常规战法，奇为变化战法。商业中正为核心业务，奇为创新业务。', confidence: 0.94, sources: ['《孙子兵法·势篇》'], tags: ['兵法', '创新'], metadata: { domain: 'military_strategy', specificity: 0.9, applicability: 'high' } },
  { type: 'insight', content: '兵贵神速：在商业中，速度决定生死。快速迭代、快速上市、快速响应是竞争关键。', confidence: 0.93, sources: ['《孙子兵法·作战篇》'], tags: ['兵法', '执行力'], metadata: { domain: 'military_strategy', specificity: 0.9, applicability: 'high' } },
  { type: 'rule', content: '不战而屈人之兵：最高境界是通过威慑、外交、经济手段达到目的，而不必诉诸武力。', confidence: 0.97, sources: ['《孙子兵法·谋攻篇》'], tags: ['兵法', '战略'], metadata: { domain: 'military_strategy', specificity: 0.95, applicability: 'high' } },
  { type: 'procedure', content: '战略制定流程：1) 环境分析（PEST/五力模型）2) 自身评估（SWOT）3) 战略选择（BCG/安索夫矩阵）4) 策略制定 5) 执行规划。', confidence: 0.92, sources: ['战略管理'], tags: ['战略', '流程'], metadata: { domain: 'military_strategy', specificity: 0.88, applicability: 'high' } },
  { type: 'strategy', content: '致人而不致于人：调动对手而不被对手调动。商业中意味着主动引导市场，而非被动跟随。', confidence: 0.91, sources: ['《孙子兵法·虚实篇》'], tags: ['兵法', '主动性'], metadata: { domain: 'military_strategy', specificity: 0.88, applicability: 'high' } },
  { type: 'rule', content: '围魏救赵：不直接救援，而是攻击敌人必救之处，迫使其退兵。商业中意味着正面困难时换角度切入。', confidence: 0.94, sources: ['《史记》'], tags: ['兵法', '策略'], metadata: { domain: 'military_strategy', specificity: 0.9, applicability: 'high' } },
  { type: 'insight', content: '善战者无赫赫之功：最好的将领赢得战争却没有辉煌的战绩，因为他在战争开始前就已经赢了。', confidence: 0.93, sources: ['《孙子兵法·形篇》'], tags: ['兵法', '远见'], metadata: { domain: 'military_strategy', specificity: 0.9, applicability: 'high' } },
], '孙子兵法 ')

stats.domains.push('孙子兵法运用')

// ═══════════════════════════════════════════════════════════════
// 领域 3：国内外地产行业分析知识
// ═══════════════════════════════════════════════════════════════

domainHeader('🏢 领域 3：国内外地产行业分析知识')

injectThinkingPatterns([
  {
    trigger: '房地产分析|地产行业|楼市|房价',
    thinkingPath: [
      '1. 宏观环境分析：GDP、政策、利率、人口',
      '2. 区域市场分析：城市发展、区域规划、供需',
      '3. 物业类型分析：住宅/商业/工业/办公',
      '4. 价格趋势分析：历史走势、预测因素',
      '5. 投资价值评估：租金回报率、增值潜力',
      '6. 风险因素评估：政策风险、市场风险'
    ],
    conclusion: '地产分析从宏观到微观，从趋势到价值',
    quality: 5, sourceModel: 'injected-domain-master',
    metadata: { domain: 'real_estate', category: 'market_analysis', level: 'expert' }
  },
  {
    trigger: '购房决策|投资房产|买房|置业',
    thinkingPath: [
      '1. 明确需求：自住/投资/保值',
      '2. 预算评估：总价、首付、月供能力',
      '3. 区域选择：地段、学区、配套',
      '4. 产品选择：新房/二手房/户型',
      '5. 时机判断：市场周期、政策动向',
      '6. 风险评估：财务风险、流动性'
    ],
    conclusion: '购房决策要兼顾需求和能力，长期考虑',
    quality: 5, sourceModel: 'injected-domain-master',
    metadata: { domain: 'real_estate', category: 'purchase_decision', level: 'expert' }
  },
  {
    trigger: '城市选择|投资城市|选址|城市',
    thinkingPath: [
      '1. 城市基本面：人口、经济、产业',
      '2. 政策环境：限购、限贷、户籍',
      '3. 市场周期：当前所处阶段',
      '4. 区域差异：核心区/郊区/新区',
      '5. 未来规划：地铁、学校、商圈',
      '6. 流动性：出租、出售难度'
    ],
    conclusion: '城市选择是房产投资最重要的决策',
    quality: 5, sourceModel: 'injected-domain-master',
    metadata: { domain: 'real_estate', category: 'city_selection', level: 'expert' }
  },
], '地产分析 ')

injectDecisionRules([
  {
    condition: '房产投资时',
    decision: '优先选择人口流入的核心城市核心地段',
    reasoning: '地段是房产价值的第一决定因素，人口流入支撑需求',
    examples: ['北上广深核心区', '强二线城市核心区', '城市群中心'],
    quality: 5, category: '投资策略',
  },
  {
    condition: '自住购房时',
    decision: '优先考虑居住便利性和学区，保值增值为次',
    reasoning: '自住要兼顾生活质量，学区房对子女教育重要',
    examples: ['通勤便利地段', '优质学区房', '生活配套完善区'],
    quality: 5, category: '自住购房',
  },
  {
    condition: '判断市场时机时',
    decision: '关注政策动向和信贷环境，逆向思维',
    reasoning: '政策是中国楼市最重要的变量，信贷宽松通常利好',
    examples: ['关注降准降息信号', '观察成交先行指标', '注意舆论风向'],
    quality: 5, category: '时机判断',
  },
  {
    condition: '选择新房还是二手房时',
    decision: '地段优先，其次才是新旧',
    reasoning: '地段决定保值能力，新房溢价不一定划算',
    examples: ['核心区老旧小区保值', '郊区新房风险大', '学区房优先'],
    quality: 5, category: '产品选择',
  },
  {
    condition: '评估房产投资回报时',
    decision: '计算租售比和持有成本，关注增值预期',
    reasoning: '租售比是国际通用的房产估值指标',
    examples: ['租金/总价 ≥ 3% 较好', '持有成本（物业、税、维修）', '预期增值率'],
    quality: 5, category: '估值方法',
  },
], '地产分析 ')

injectResponseTemplates([
  {
    type: 'market_report',
    structure: ['宏观环境', '区域分析', '价格走势', '供需预测', '投资建议'],
    style: '数据驱动、逻辑清晰',
    components: ['宏观数据', '区域数据', '价格指数', '成交量', '政策解读'],
    useCases: ['市场报告', '投资分析', '行业研究']
  },
  {
    type: 'property_analysis',
    structure: ['物业概况', '区域评估', '价值分析', '风险评估', '建议方案'],
    style: '客观、全面、实用',
    components: ['基本信息', '位置分析', '价值估算', '风险矩阵', '行动建议'],
    useCases: ['物业评估', '购房决策', '投资分析']
  },
], '地产分析 ')

injectCoreKnowledge([
  { type: 'fact', content: '中国房地产市场特征：政策市特征明显，城市化率约65%，核心城市供需紧张，三四线城市库存高。', confidence: 0.92, sources: ['国家统计局'], tags: ['中国地产', '市场特征'], metadata: { domain: 'real_estate', specificity: 0.88, applicability: 'high' } },
  { type: 'fact', content: '全球主要房地产市场：美国（次贷后复苏）、欧洲（利率影响）、日本（失去的二十年）、澳大利亚（调控严格）、东南亚（新兴市场）。', confidence: 0.88, sources: ['全球地产报告'], tags: ['国际地产', '市场对比'], metadata: { domain: 'real_estate', specificity: 0.82, applicability: 'medium' } },
  { type: 'rule', content: '房产投资三要素：地段、地段、地段。这是地产投资永恒的铁律。', confidence: 0.98, sources: ['地产投资名言'], tags: ['地产', '投资原则'], metadata: { domain: 'real_estate', specificity: 0.98, applicability: 'high' } },
  { type: 'strategy', content: '中国楼市政策周期：宽松期→繁荣期→调控期→观望期。投资要逆周期思考，在调控期寻找机会。', confidence: 0.9, sources: ['中国楼市周期'], tags: ['地产', '周期'], metadata: { domain: 'real_estate', specificity: 0.85, applicability: 'high' } },
  { type: 'fact', content: '租售比是房产投资核心指标：国际合理区间为 1:200 至 1:300（月租/总价）。中国一线城市普遍偏低。', confidence: 0.91, sources: ['地产估值标准'], tags: ['地产', '估值'], metadata: { domain: 'real_estate', specificity: 0.88, applicability: 'high' } },
  { type: 'strategy', content: '房产配置比例建议：自住需求优先满足，投资性房产不超过总资产的 30%，注意流动性。', confidence: 0.89, sources: ['资产配置建议'], tags: ['地产', '资产配置'], metadata: { domain: 'real_estate', specificity: 0.85, applicability: 'medium' } },
  { type: 'rule', content: '购房三大原则：1) 不买看不上的房子 2) 不超出能力范围 3) 关注流动性。', confidence: 0.93, sources: ['购房经验'], tags: ['地产', '决策'], metadata: { domain: 'real_estate', specificity: 0.9, applicability: 'high' } },
  { type: 'insight', content: '学区房价值的本质是教育资源的资本化。购买学区房是在为子女购买教育资源，而非单纯购买房产。', confidence: 0.9, sources: ['教育经济学'], tags: ['学区房', '教育'], metadata: { domain: 'real_estate', specificity: 0.88, applicability: 'medium' } },
  { type: 'procedure', content: '购房流程：1) 确定预算和需求 2) 城市和区域选择 3) 看房和筛选 4) 议价和谈判 5) 签约和过户 6) 入住和维权。', confidence: 0.92, sources: ['购房指南'], tags: ['地产', '流程'], metadata: { domain: 'real_estate', specificity: 0.88, applicability: 'high' } },
  { type: 'strategy', content: '商业地产投资要点：关注租户质量、租约期限、租金增长预期、空置率。核心商圈商业地产抗周期能力强。', confidence: 0.88, sources: ['商业地产研究'], tags: ['商业地产', '投资'], metadata: { domain: 'real_estate', specificity: 0.82, applicability: 'medium' } },
], '地产分析 ')

stats.domains.push('国内外地产分析')

// ═══════════════════════════════════════════════════════════════
// 领域 4：股票金融分析知识
// ═══════════════════════════════════════════════════════════════

domainHeader('📈 领域 4：股票金融分析知识')

injectThinkingPatterns([
  {
    trigger: '股票分析|选股|投资|股市',
    thinkingPath: [
      '1. 宏观判断：当前市场环境和政策',
      '2. 行业分析：行业周期和发展前景',
      '3. 公司分析：财务状况、竞争优势、管理团队',
      '4. 估值分析：DCF/PE/PB 等估值方法',
      '5. 技术分析：趋势、形态、成交量',
      '6. 风险评估：最大回撤、波动率、下行风险'
    ],
    conclusion: '股票分析从宏观到微观，结合基本面和技术面',
    quality: 5, sourceModel: 'injected-domain-master',
    metadata: { domain: 'finance', category: 'stock_analysis', level: 'expert' }
  },
  {
    trigger: '投资组合|资产配置|portfolio|配置',
    thinkingPath: [
      '1. 确定投资目标：收益目标、风险承受',
      '2. 资产配置比例：股票/债券/现金/另类',
      '3. 行业分散：避免过度集中在单一行业',
      '4. 地域分散：国内/国际市场配置',
      '5. 再平衡策略：定期调整偏离',
      '6. 费用管理：降低交易成本'
    ],
    conclusion: '资产配置是投资成功的最大决定因素',
    quality: 5, sourceModel: 'injected-domain-master',
    metadata: { domain: 'finance', category: 'portfolio', level: 'expert' }
  },
  {
    trigger: '风险控制|止损|风控|风险',
    thinkingPath: [
      '1. 识别风险来源：市场/行业/个股',
      '2. 量化风险：波动率、最大回撤、VaR',
      '3. 设定止损：技术止损/时间止损/事件止损',
      '4. 分散风险：行业分散/标的分散/时间分散',
      '5. 对冲策略：期货/期权/对冲基金',
      '6. 定期复盘：总结风险事件经验'
    ],
    conclusion: '风险控制是长期投资的生命线',
    quality: 5, sourceModel: 'injected-domain-master',
    metadata: { domain: 'finance', category: 'risk_management', level: 'expert' }
  },
  {
    trigger: '技术分析|K线|趋势|指标',
    thinkingPath: [
      '1. 确定周期：日线/周线/月线',
      '2. 识别趋势：上涨/下跌/震荡',
      '3. 关键点位：支撑位/压力位',
      '4. 指标验证：MACD/RSI/KDJ',
      '5. 量价配合：量能是否配合',
      '6. 形态确认：头肩顶/双顶/三角形'
    ],
    conclusion: '技术分析是概率判断，要结合基本面使用',
    quality: 5, sourceModel: 'injected-domain-master',
    metadata: { domain: 'finance', category: 'technical_analysis', level: 'expert' }
  },
], '金融分析 ')

injectDecisionRules([
  {
    condition: '选择个股时',
    decision: '优先选择行业龙头，关注 ROE、护城河、增长性',
    reasoning: '龙头公司抗风险能力强，长期回报更高',
    examples: ['消费龙头（茅台）', '科技龙头（苹果）', '金融龙头（招商银行）'],
    quality: 5, category: '选股策略',
  },
  {
    condition: '决定买入时机时',
    decision: '估值合理 + 技术面配合 + 基本面向上',
    reasoning: '三者共振才是最佳买入时机',
    examples: ['PB 在历史低位', '突破关键压力位', '业绩预期向上修正'],
    quality: 5, category: '买入时机',
  },
  {
    condition: '决定卖出时机时',
    decision: '达到目标价或基本面恶化或技术面破位',
    reasoning: '要有纪律的卖出，让利润奔跑，让亏损截断',
    examples: ['达到估值目标', '行业景气度下行', '跌破重要支撑'],
    quality: 5, category: '卖出时机',
  },
  {
    condition: '资产配置时',
    decision: '年龄越小权益比例越高，随年龄增加固定收益比例',
    reasoning: '经典生命周期投资策略',
    examples: ['20岁：80%股票', '40岁：60%股票', '60岁：30%股票'],
    quality: 5, category: '资产配置',
  },
  {
    condition: '面对市场波动时',
    decision: '保持纪律，不追涨杀跌，定期再平衡',
    reasoning: '情绪是投资最大的敌人',
    examples: ['大跌不恐慌', '大涨不贪婪', '定期再平衡'],
    quality: 5, category: '投资心理',
  },
], '金融分析 ')

injectResponseTemplates([
  {
    type: 'stock_research',
    structure: ['公司概况', '行业分析', '财务分析', '估值判断', '投资建议'],
    style: '数据驱动、逻辑严谨',
    components: ['公司简介', '行业对比', '财务表格', '估值模型', '评级目标'],
    useCases: ['个股研究', '买入评级', '深度报告']
  },
  {
    type: 'portfolio_review',
    structure: ['组合概览', '业绩分析', '风险评估', '配置建议', '调整方案'],
    style: '客观、务实、可执行',
    components: ['持仓明细', '收益曲线', '风险指标', '配置比例', '调仓建议'],
    useCases: ['组合复盘', '资产配置', '业绩归因']
  },
], '金融分析 ')

injectCoreKnowledge([
  { type: 'rule', content: '投资三原则：1) 分散投资 2) 长期持有 3) 价值投资。这是最基本也是最重要的投资原则。', confidence: 0.97, sources: ['投资大师共识'], tags: ['投资', '原则'], metadata: { domain: 'finance', specificity: 0.95, applicability: 'high' } },
  { type: 'strategy', content: '价值投资四要素：1) 好的公司 2) 合理的价格 3) 足够长的时间 4) 适当的集中。', confidence: 0.95, sources: ['巴菲特投资哲学'], tags: ['价值投资', '巴菲特'], metadata: { domain: 'finance', specificity: 0.92, applicability: 'high' } },
  { type: 'fact', content: '常用估值指标：PE（市盈率）适合成熟期公司、PB（市净率）适合金融业、PS（市销率）适合亏损企业、DCF（现金流折现）适合稳定现金流公司。', confidence: 0.92, sources: ['估值方法'], tags: ['估值', '指标'], metadata: { domain: 'finance', specificity: 0.88, applicability: 'high' } },
  { type: 'rule', content: '风险收益对等：高风险高收益，低风险低收益。不要期望获得超出风险等级的收益。', confidence: 0.94, sources: ['金融基本原理'], tags: ['风险', '收益'], metadata: { domain: 'finance', specificity: 0.9, applicability: 'high' } },
  { type: 'insight', content: '市场短期是投票机，长期是称重机。短期看情绪，长期看价值。', confidence: 0.93, sources: ['凯恩斯名言'], tags: ['市场', '短期长期'], metadata: { domain: 'finance', specificity: 0.9, applicability: 'high' } },
  { type: 'strategy', content: '定投策略：定期定额投资指数基金。适合普通投资者，长期坚持效果好。', confidence: 0.91, sources: ['定投指南'], tags: ['定投', '指数基金'], metadata: { domain: 'finance', specificity: 0.88, applicability: 'high' } },
  { type: 'rule', content: '止损三原则：1) 止损要趁早 2) 止损要坚决 3) 止损后要休息。不要让小亏损变大亏损。', confidence: 0.92, sources: ['交易纪律'], tags: ['止损', '风险控制'], metadata: { domain: 'finance', specificity: 0.9, applicability: 'high' } },
  { type: 'fact', content: 'A股市场特征：散户占比高、波动大、政策影响大、信息不对称。适合波段操作，注意节奏。', confidence: 0.9, sources: ['A股市场研究'], tags: ['A股', '市场特征'], metadata: { domain: 'finance', specificity: 0.85, applicability: 'medium' } },
  { type: 'strategy', content: '投资组合核心配置：60% 权益类（股票/基金）、20% 固定收益（债券）、10% 现金、10% 另类（黄金/房产）。', confidence: 0.88, sources: ['资产配置模型'], tags: ['资产配置', '组合'], metadata: { domain: 'finance', specificity: 0.82, applicability: 'medium' } },
  { type: 'insight', content: '不要把鸡蛋放在一个篮子里，但也不要放在太多篮子里。3-5 个标的的分散是合理的。', confidence: 0.92, sources: ['分散投资'], tags: ['分散', '集中'], metadata: { domain: 'finance', specificity: 0.9, applicability: 'high' } },
], '金融分析 ')

stats.domains.push('股票金融分析')

// ═══════════════════════════════════════════════════════════════
// 领域 5：工商管理学运用知识
// ═══════════════════════════════════════════════════════════════

domainHeader('💼 领域 5：工商管理学运用知识')

injectThinkingPatterns([
  {
    trigger: '战略管理|战略规划|公司战略|管理',
    thinkingPath: [
      '1. 外部环境分析：PEST、五力模型',
      '2. 内部资源分析：核心竞争力、价值链',
      '3. 战略匹配：SWOT、BCG 矩阵',
      '4. 战略选择：差异化/成本领先/聚焦',
      '5. 战略实施：组织结构、资源配置',
      '6. 战略评估：平衡计分卡、KPI'
    ],
    conclusion: '战略管理从环境分析到实施评估的闭环',
    quality: 5, sourceModel: 'injected-domain-master',
    metadata: { domain: 'business_admin', category: 'strategic_management', level: 'expert' }
  },
  {
    trigger: '市场营销|营销|品牌|推广',
    thinkingPath: [
      '1. 市场分析：目标市场、客户画像',
      '2. 产品策略：定位、差异化、生命周期',
      '3. 价格策略：定价方法、价格带',
      '4. 渠道策略：线上/线下、渠道管理',
      '5. 促销策略：广告、公关、销售促进',
      '6. 品牌管理：品牌资产、品牌延伸'
    ],
    conclusion: '市场营销以客户为中心，产品-价格-渠道-促销四要素',
    quality: 5, sourceModel: 'injected-domain-master',
    metadata: { domain: 'business_admin', category: 'marketing', level: 'expert' }
  },
  {
    trigger: '组织管理|团队建设|领导力|组织',
    thinkingPath: [
      '1. 组织设计：架构、流程、制度',
      '2. 人员管理：招聘、培训、激励',
      '3. 领导力：愿景、授权、辅导',
      '4. 团队建设：凝聚力、执行力、创新力',
      '5. 绩效管理：目标设定、考核、反馈',
      '6. 组织变革：变革管理、文化塑造'
    ],
    conclusion: '组织管理的核心是人和文化',
    quality: 5, sourceModel: 'injected-domain-master',
    metadata: { domain: 'business_admin', category: 'organization', level: 'expert' }
  },
  {
    trigger: '财务管理|财务分析|预算|成本',
    thinkingPath: [
      '1. 财务报表分析：三大报表、关键比率',
      '2. 预算管理：编制、执行、控制',
      '3. 成本管理：成本核算、成本控制',
      '4. 资金管理：现金流、资本结构',
      '5. 投资决策：NPV、IRR、回收期',
      '6. 风险控制：财务风险、合规风险'
    ],
    conclusion: '财务管理以现金流为核心，以价值创造为目标',
    quality: 5, sourceModel: 'injected-domain-master',
    metadata: { domain: 'business_admin', category: 'finance_management', level: 'expert' }
  },
  {
    trigger: '运营管理|流程|效率|精益',
    thinkingPath: [
      '1. 流程分析：价值流图、瓶颈识别',
      '2. 产能分析：瓶颈、约束、优化',
      '3. 质量管理：PDCA、六西格玛',
      '4. 库存管理：EOQ、JIT、ABC 分类',
      '5. 供应链：采购、生产、物流',
      '6. 持续改进：Kaizen、创新'
    ],
    conclusion: '运营管理追求效率、质量、成本的平衡',
    quality: 5, sourceModel: 'injected-domain-master',
    metadata: { domain: 'business_admin', category: 'operations', level: 'expert' }
  },
  {
    trigger: '项目管理|项目|计划|执行',
    thinkingPath: [
      '1. 项目立项：可行性研究、ROI 分析',
      '2. 项目规划：WBS、甘特图、关键路径',
      '3. 项目执行：资源调配、进度跟踪',
      '4. 项目控制：变更管理、风险应对',
      '5. 项目收尾：验收、总结、知识转移',
      '6. 项目评估：效果评估、经验教训'
    ],
    conclusion: '项目管理的核心是范围-时间-成本-质量的平衡',
    quality: 5, sourceModel: 'injected-domain-master',
    metadata: { domain: 'business_admin', category: 'project_management', level: 'expert' }
  },
], '工商管理 ')

injectDecisionRules([
  {
    condition: '制定企业战略时',
    decision: 'SWOT 分析后选择 SO/WO/ST/WT 策略组合',
    reasoning: 'SWOT 是最经典的战略分析框架',
    examples: ['SO：优势+机会=进攻', 'WO：劣势+机会=改进', 'ST：优势+威胁=防御', 'WT：劣势+威胁=保守'],
    quality: 5, category: '战略管理',
  },
  {
    condition: '设计组织结构时',
    decision: '根据战略选择职能型/事业部型/矩阵型',
    reasoning: '组织结构要服务于战略',
    examples: ['单一业务用职能型', '多元化用事业部型', '复杂项目用矩阵型'],
    quality: 5, category: '组织设计',
  },
  {
    condition: '制定激励方案时',
    decision: '物质激励+精神激励+发展激励相结合',
    reasoning: '马斯洛需求层次理论，不同需求层次用不同激励',
    examples: ['基本工资+绩效奖金', '晋升机会+荣誉表彰', '培训发展+股权激励'],
    quality: 5, category: '激励管理',
  },
  {
    condition: '管理团队冲突时',
    decision: '先调解后仲裁，关注利益而非立场',
    reasoning: '哈佛谈判术：关注利益而非立场',
    examples: ['了解各方利益', '寻找双赢方案', '必要时上级介入'],
    quality: 5, category: '冲突管理',
  },
  {
    condition: '进行投资决策时',
    decision: '使用 NPV 或 IRR 评估，考虑风险调整',
    reasoning: '货币有时间价值，要进行折现计算',
    examples: ['NPV 为正可行', 'IRR > WACC 可行', '考虑敏感性分析'],
    quality: 5, category: '投资决策',
  },
  {
    condition: '管理变革时',
    decision: 'Kotter 八步法：建立紧迫感→组建团队→制定愿景→沟通→授权→短期胜利→巩固→制度化',
    reasoning: '变革失败 70% 是因为没有管理好变革过程',
    examples: ['数字化转型', '组织架构调整', '企业文化重塑'],
    quality: 5, category: '变革管理',
  },
], '工商管理 ')

injectResponseTemplates([
  {
    type: 'business_plan',
    structure: ['市场分析', '竞争分析', '运营计划', '财务预测', '风险评估'],
    style: '专业、严谨、可执行',
    components: ['市场数据', '竞争矩阵', '运营流程', '财务三表', '风险清单'],
    useCases: ['商业计划书', '年度规划', '战略报告']
  },
  {
    type: 'management_report',
    structure: ['执行摘要', '业绩回顾', '问题分析', '改进方案', '行动计划'],
    style: '简洁、重点突出、有数据',
    components: ['KPI 完成率', '问题根因分析', '改进措施', '责任人/时间表'],
    useCases: ['月度汇报', '季度总结', '专题报告']
  },
  {
    type: 'marketing_plan',
    structure: ['目标市场', '产品定位', '营销策略', '预算分配', '执行计划'],
    style: '创新、数据驱动',
    components: ['客户画像', '价值主张', '4P 策略', '营销预算', '时间线'],
    useCases: ['营销策划', '品牌推广', '产品上市']
  },
], '工商管理 ')

injectCoreKnowledge([
  { type: 'rule', content: '管理的五大职能：计划、组织、领导、协调、控制。这是管理学的基石。', confidence: 0.97, sources: ['法约尔管理理论'], tags: ['管理学', '基本原理'], metadata: { domain: 'business_admin', specificity: 0.95, applicability: 'high' } },
  { type: 'strategy', content: '波特五力模型：现有竞争者、潜在进入者、替代品、供应商议价能力、客户议价能力。用于行业分析。', confidence: 0.95, sources: ['迈克尔·波特'], tags: ['战略', '行业分析'], metadata: { domain: 'business_admin', specificity: 0.92, applicability: 'high' } },
  { type: 'strategy', content: 'SWOT 分析：优势(S)、劣势(W)、机会(O)、威胁(T)。用于战略匹配和选择。', confidence: 0.94, sources: ['战略分析工具'], tags: ['战略', 'SWOT'], metadata: { domain: 'business_admin', specificity: 0.9, applicability: 'high' } },
  { type: 'rule', content: '4P 营销组合：产品(Product)、价格(Price)、渠道(Place)、促销(Promotion)。', confidence: 0.96, sources: ['营销理论'], tags: ['营销', '4P'], metadata: { domain: 'business_admin', specificity: 0.92, applicability: 'high' } },
  { type: 'strategy', content: '马斯洛需求层次：生理→安全→社交→尊重→自我实现。激励要对应需求层次。', confidence: 0.93, sources: ['马斯洛需求层次'], tags: ['激励', '心理学'], metadata: { domain: 'business_admin', specificity: 0.9, applicability: 'high' } },
  { type: 'rule', content: 'PDCA 循环：计划(Plan)→执行(Do)→检查(Check)→处理(Act)。持续改进的基本方法。', confidence: 0.95, sources: ['戴明环'], tags: ['质量管理', '持续改进'], metadata: { domain: 'business_admin', specificity: 0.92, applicability: 'high' } },
  { type: 'insight', content: '精益管理核心：消除浪费、创造价值、持续改进。丰田生产方式是典范。', confidence: 0.92, sources: ['精益生产'], tags: ['精益', '效率'], metadata: { domain: 'business_admin', specificity: 0.88, applicability: 'high' } },
  { type: 'fact', content: '企业生命周期：创业期→成长期→成熟期→衰退期。每个阶段的管理重点不同。', confidence: 0.9, sources: ['企业生命周期理论'], tags: ['管理', '企业发展'], metadata: { domain: 'business_admin', specificity: 0.88, applicability: 'medium' } },
  { type: 'strategy', content: 'KPI 设计原则：SMART（具体、可衡量、可达成、相关、有时限）。避免 KPI 过多，聚焦关键指标。', confidence: 0.93, sources: ['KPI 设计'], tags: ['绩效管理', 'KPI'], metadata: { domain: 'business_admin', specificity: 0.9, applicability: 'high' } },
  { type: 'rule', content: '授权三原则：用人所长、责权对等、有效监督。既要给予空间又要确保目标达成。', confidence: 0.91, sources: ['授权管理'], tags: ['领导力', '授权'], metadata: { domain: 'business_admin', specificity: 0.88, applicability: 'high' } },
], '工商管理 ')

stats.domains.push('工商管理学运用')

// ═══════════════════════════════════════════════════════════════
// 测试和总结
// ═══════════════════════════════════════════════════════════════

console.log('\n\n' + '='.repeat(60))
console.log('📊 知识注入总结')
console.log('='.repeat(60))

console.log(`\n  注入领域: ${stats.domains.length} 个`)
for (const d of stats.domains) {
  console.log(`    - ${d}`)
}
console.log(`\n  思考模式: ${stats.thinkingPatterns} 个`)
console.log(`  决策规则: ${stats.decisionRules} 条`)
console.log(`  回复模板: ${stats.responseTemplates} 个`)
console.log(`  核心知识: ${stats.coreKnowledge} 条`)
console.log(`  总计: ${stats.thinkingPatterns + stats.decisionRules + stats.responseTemplates + stats.coreKnowledge} 条知识`)

// 测试检索
console.log('\n\n' + '─'.repeat(60))
console.log('🔍 知识检索测试')
console.log('─'.repeat(60))

const testQueries = [
  { query: 'Agent架构设计多Agent系统Agent框架', label: 'AI/Agent' },
  { query: '孙子兵法竞争策略市场兵法', label: '孙子兵法' },
  { query: '房地产投资地段楼市地产分析', label: '地产分析' },
  { query: '股票分析投资组合风险金融', label: '金融分析' },
  { query: '战略管理组织设计激励管理', label: '工商管理' },
]

for (const { query, label } of testQueries) {
  const results = retrieveRelevantKnowledge(query, { maxResults: 3 })
  console.log(`\n  ${label} (查询: "${query}"):`)
  console.log(`    相关知识: ${results.length} 条`)
  if (results.length > 0) {
    const top = results[0]
    const content = typeof top.content === 'string' ? top.content : JSON.stringify(top.content)
    console.log(`    最相关: ${content.slice(0, 60)}...`)
  }
}

// 测试思考模式
console.log('\n\n' + '─'.repeat(60))
console.log('🧠 思考模式应用测试')
console.log('─'.repeat(60))

const testThinking = [
  { keywords: ['Agent', '架构', 'agent'], label: 'AI/Agent 架构' },
  { keywords: ['战略', '竞争', '策略'], label: '孙子兵法 战略' },
  { keywords: ['房产', '投资', '地产'], label: '地产 投资' },
  { keywords: ['选股', '估值', '股票'], label: '金融 选股' },
  { keywords: ['管理', '组织', '战略'], label: '工商管理 组织' },
]

for (const { keywords, label } of testThinking) {
  const result = applyThinkingPattern(keywords)
  console.log(`\n  ${label}:`)
  if (result.matched) {
    console.log(`    ✓ 置信度: ${result.confidence.toFixed(2)}`)
    console.log(`    思考路径: ${result.thinkingPath?.[0]?.slice(0, 40)}...`)
  } else {
    console.log(`    ✗ 未匹配`)
  }
}

// 测试决策规则
console.log('\n\n' + '─'.repeat(60))
console.log('⚖️ 决策规则应用测试')
console.log('─'.repeat(60))

const testDecisions = [
  { context: '设计新 Agent 多Agent系统', label: 'AI/Agent' },
  { context: '面对强敌竞争战略', label: '孙子兵法' },
  { context: '房产投资地段选择', label: '地产分析' },
  { context: '选股买入时机', label: '金融分析' },
  { context: '组织结构设计管理', label: '工商管理' },
]

for (const { context, label } of testDecisions) {
  const result = applyDecisionRule(context)
  console.log(`\n  ${label}:`)
  if (result.matched) {
    console.log(`    ✓ 决策: ${result.decision?.slice(0, 50)}...`)
    console.log(`    置信度: ${result.confidence.toFixed(2)}`)
  } else {
    console.log(`    ✗ 未匹配`)
  }
}

// 测试回复模板
console.log('\n\n' + '─'.repeat(60))
console.log('📝 回复模板获取测试')
console.log('─'.repeat(60))

const templateTypes = [
  { type: 'agent_design', label: 'AI/Agent 设计' },
  { type: 'strategy_analysis', label: '孙子兵法 分析' },
  { type: 'market_report', label: '地产报告' },
  { type: 'stock_research', label: '金融研究' },
  { type: 'business_plan', label: '工商管理 计划' },
]

for (const { type, label } of templateTypes) {
  const template = getResponseTemplate(type)
  console.log(`\n  ${label}:`)
  if (template) {
    console.log(`    ✓ 结构: ${template.structure?.slice(0, 3).join(' → ')}...`)
  } else {
    console.log(`    ✗ 未获取`)
  }
}

// IQ 测试
console.log('\n\n' + '─'.repeat(60))
console.log('🧮 IQ 分数测试')
console.log('─'.repeat(60))

const iqResult = calculateIQScore()
console.log(`\n  IQ 分数: ${iqResult.score}`)
console.log(`  等级: ${iqResult.levelLabel}`)
console.log(`  描述: ${iqResult.description}`)
console.log(`\n  分解:`)
console.log(`    - 基础分: ${iqResult.breakdown.base}`)
console.log(`    - 思考模式加成: ${iqResult.breakdown.patterns}`)
console.log(`    - 决策规则加成: ${iqResult.breakdown.rules}`)
console.log(`    - 回复模板加成: ${iqResult.breakdown.templates}`)
console.log(`    - 知识广度加成: ${iqResult.breakdown.breadth}`)
console.log(`\n  统计:`)
console.log(`    - 总思考模式: ${iqResult.statistics.totalPatterns}`)
console.log(`    - 高质量模式: ${iqResult.statistics.qualityPatterns}`)
console.log(`    - 总决策规则: ${iqResult.statistics.totalRules}`)
console.log(`    - 有效规则: ${iqResult.statistics.effectiveRules}`)
console.log(`    - 总模板: ${iqResult.statistics.totalTemplates}`)
console.log(`    - 知识类别: ${iqResult.statistics.categories}`)

console.log('\n' + '='.repeat(60))
console.log('  🎉 多领域知识注入完成！')
console.log('='.repeat(60))

// 最终统计
console.log(`\n  Gina 大脑现在拥有:`)
console.log(`    - ${stats.thinkingPatterns} 个五星级思考模式`)
console.log(`    - ${stats.decisionRules} 条五星级决策规则`)
console.log(`    - ${stats.responseTemplates} 个五星级回复模板`)
console.log(`    - ${stats.coreKnowledge} 条核心知识`)
console.log(`    - 覆盖 ${stats.domains.length} 大领域:`)
stats.domains.forEach((d, i) => console.log(`      ${i + 1}. ${d}`))
console.log(`    - IQ 分数: ${iqResult.score} (${iqResult.levelLabel})`)