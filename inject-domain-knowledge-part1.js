/**
 * inject-domain-knowledge.js — 多领域知识注入脚本
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
// 领域 1：AI / Agent 开发知识
// ═══════════════════════════════════════════════════════════════

console.log('\n\n' + '─'.repeat(60))
console.log('🤖 领域 1：AI / Agent 开发知识')
console.log('─'.repeat(60))

// AI/Agent 思考模式
const aiThinkingPatterns = [
  {
    trigger: 'Agent架构|多Agent系统|Agent设计|agent',
    thinkingPath: [
      '1. 明确 Agent 角色和目标：它是谁？要解决什么问题？',
      '2. 设计感知系统：Agent 如何获取外部信息（工具调用、API、知识库）',
      '3. 设计决策系统：Agent 如何推理、规划、选择行动',
      '4. 设计行动系统：Agent 能执行哪些操作（工具、对话、代码）',
      '5. 设计记忆系统：Agent 如何存储和检索经验',
      '6. 设计进化机制：Agent 如何持续学习和改进'
    ],
    conclusion: 'Agent 设计从角色定义出发，依次构建感知-决策-行动-记忆-进化五大系统',
    quality: 5,
    sourceModel: 'injected-domain-master',
    metadata: { domain: 'ai_agent', category: 'architecture', level: 'expert' }
  },
  {
    trigger: 'Prompt工程|提示词|prompt|系统提示',
    thinkingPath: [
      '1. 明确 Prompt 目标：要让模型做什么？',
      '2. 设计角色设定：赋予模型专业身份和能力边界',
      '3. 构建上下文：提供必要的背景信息和示例',
      '4. 定义输出格式：结构化、可解析的输出',
      '5. 添加约束和规则：明确禁止和必须',
      '6. 测试和迭代：根据输出调整 Prompt'
    ],
    conclusion: '好的 Prompt 设计遵循：目标→角色→上下文→格式→约束→迭代',
    quality: 5,
    sourceModel: 'injected-domain-master',
    metadata: { domain: 'ai_agent', category: 'prompt_engineering', level: 'expert' }
  },
  {
    trigger: 'RAG|检索增强|向量数据库|embedding',
    thinkingPath: [
      '1. 确定知识源：哪些外部知识需要被检索',
      '2. 选择 Embedding 模型：平衡质量和成本',
      '3. 设计分块策略：文档切块大小和重叠',
      '4. 选择向量数据库：FAISS/Milvus/Pinecone 等',
      '5. 设计检索策略：相似度阈值、Top-K、重排序',
      '6. 设计生成策略：如何融合检索结果和模型回答'
    ],
    conclusion: 'RAG 系统设计的核心是检索质量和生成质量的平衡',
    quality: 5,
    sourceModel: 'injected-domain-master',
    metadata: { domain: 'ai_agent', category: 'rag', level: 'expert' }
  },
  {
    trigger: '微调|fine-tuning|LoRA|训练',
    thinkingPath: [
      '1. 明确微调目标：领域适配、风格调整、能力增强',
      '2. 准备训练数据：高质量、多样化、无错误',
      '3. 选择微调方法：全参数/LoRA/Adapter',
      '4. 选择基础模型：考虑大小、架构、语言能力',
      '5. 设置训练参数：学习率、批大小、训练轮数',
      '6. 评估和迭代：在验证集上测试效果'
    ],
    conclusion: '微调的关键是高质量数据 > 好的方法 > 大的模型',
    quality: 5,
    sourceModel: 'injected-domain-master',
    metadata: { domain: 'ai_agent', category: 'fine_tuning', level: 'expert' }
  },
  {
    trigger: 'LLM评估|模型评估|benchmark|评测',
    thinkingPath: [
      '1. 明确评估目标：要衡量什么能力？',
      '2. 选择评估方法：自动指标/人工评估/A-B测试',
      '3. 设计测试集：覆盖核心场景和边界情况',
      '4. 建立基线：与现有方案或基准模型对比',
      '5. 收集和分析结果：统计显著性检查',
      '6. 形成结论：改进方向和下一步行动'
    ],
    conclusion: 'LLM 评估要量化、可复现、覆盖真实使用场景',
    quality: 5,
    sourceModel: 'injected-domain-master',
    metadata: { domain: 'ai_agent', category: 'evaluation', level: 'expert' }
  },
  {
    trigger: 'Agent记忆|长期记忆|短期记忆|memory',
    thinkingPath: [
      '1. 区分记忆类型：工作记忆/短期记忆/长期记忆',
      '2. 选择存储方案：内存/文件/数据库/向量库',
      '3. 设计写入策略：何时写、写什么、如何写',
      '4. 设计检索策略：何时读、读什么、如何排序',
      '5. 设计遗忘机制：过期/衰减/压缩',
      '6. 设计整合机制：新信息如何与旧知识融合'
    ],
    conclusion: 'Agent 记忆系统需要在可访问性和准确性之间平衡',
    quality: 5,
    sourceModel: 'injected-domain-master',
    metadata: { domain: 'ai_agent', category: 'memory', level: 'expert' }
  },
  {
    trigger: '工具调用|function calling|API调用|tool use',
    thinkingPath: [
      '1. 识别可工具化的能力：哪些操作适合用工具',
      '2. 设计工具接口：清晰的输入输出和错误处理',
      '3. 描述工具能力：让 LLM 理解何时该用',
      '4. 处理工具调用：解析、执行、返回结果',
      '5. 处理异常：超时、失败、无效结果',
      '6. 优化调用策略：批量调用、异步调用、缓存'
    ],
    conclusion: '工具调用的关键是清晰的接口描述和健壮的错误处理',
    quality: 5,
    sourceModel: 'injected-domain-master',
    metadata: { domain: 'ai_agent', category: 'tool_calling', level: 'expert' }
  },
]

for (const p of aiThinkingPatterns) {
  recordThinkingPattern(p)
  stats.thinkingPatterns++
}
console.log(`  ✓ 注入 ${aiThinkingPatterns.length} 个思考模式`)

// AI/Agent 决策规则
const aiDecisionRules = [
  {
    condition: '设计新 Agent 时',
    decision: '优先使用 ReAct 框架（Reasoning + Acting），让 Agent 交替进行推理和行动',
    reasoning: 'ReAct 框架简单有效，兼顾推理和执行，适合大多数任务型 Agent',
    examples: ['客服 Agent 使用 ReAct', '数据分析 Agent 使用 ReAct', '研究助理 Agent 使用 ReAct'],
    quality: 5,
    category: 'Agent架构',
  },
  {
    condition: '需要让 Agent 具备长期记忆时',
    decision: '使用向量数据库存储语义记忆，配合 SQLite 存储结构化记忆',
    reasoning: '向量数据库擅长语义检索，SQLite 擅长结构化查询，两者互补',
    examples: ['用户偏好存向量库', '任务历史存 SQLite', '知识片段存向量库'],
    quality: 5,
    category: 'Agent记忆',
  },
  {
    condition: '设计多 Agent 协作系统时',
    decision: '先单 Agent 跑通，再增加多 Agent 协调层',
    reasoning: '多 Agent 系统复杂度高，单 Agent 验证后再扩展更稳妥',
    examples: ['先用单 Agent 实现核心功能', '再增加协调者 Agent', '最后增加专家 Agent'],
    quality: 5,
    category: '多Agent系统',
  },
  {
    condition: '选择 LLM 部署方案时',
    decision: '先用云端模型验证，再考虑本地部署',
    reasoning: '云端模型能力强，快速验证可行性后再考虑成本和隐私需求',
    examples: ['开发阶段用云端', '验证通过后考虑本地', '对隐私敏感时用本地'],
    quality: 5,
    category: 'LLM部署',
  },
  {
    condition: '设计 Agent 评价体系时',
    decision: '建立多维评价：任务完成率、用户满意度、效率、错误率',
    reasoning: '单一指标不能全面反映 Agent 质量，需要多维度综合评价',
    examples: ['任务完成率 ≥ 90%', '用户满意度 ≥ 4.5/5', '平均响应时间 ≤ 5s'],
    quality: 5,
    category: 'Agent评估',
  },
  {
    condition: '处理 Agent 幻觉问题时',
    decision: '引入验证机制：知识源校验、工具验证、人工审核',
    reasoning: '幻觉是 LLM 固有问题，需要外部验证机制降低风险',
    examples: ['事实性内容需查证', '代码需测试运行', '重要决策需人工确认'],
    quality: 5,
    category: 'Agent安全',
  },
]

for (const r of aiDecisionRules) {
  recordDecisionRule(r)
  stats.decisionRules++
}
console.log(`  ✓ 注入 ${aiDecisionRules.length} 条决策规则`)

// AI/Agent 回复模板
const aiResponseTemplates = [
  {
    type: 'agent_design',
    structure: ['需求分析', '架构设计', '模块实现', '集成测试', '部署优化'],
    style: '系统性、前瞻性',
    components: ['需求文档', '架构图', '模块代码', '测试报告'],
    useCases: ['新 Agent 设计', 'Agent 架构评审', '技术方案']
  },
  {
    type: 'prompt_engineering',
    structure: ['目标定义', '角色设定', '上下文构建', '输出规范', '测试迭代'],
    style: '清晰、可执行',
    components: ['Prompt 模板', 'Few-shot 示例', '约束条件'],
    useCases: ['Prompt 优化', '系统提示设计', '对话流程']
  },
  {
    type: 'rag_architecture',
    structure: ['知识源梳理', 'Embedding 选型', '索引构建', '检索策略', '生成融合'],
    style: '工程化、可扩展',
    components: ['数据管道', '向量索引', '检索服务', '生成服务'],
    useCases: ['RAG 系统设计', '知识库构建', '检索优化']
  },
]

for (const t of aiResponseTemplates) {
  recordResponseTemplate(t)
  stats.responseTemplates++
}
console.log(`  ✓ 注入 ${aiResponseTemplates.length} 个回复模板`)

// AI/Agent 核心知识
const aiCoreKnowledge = [
  { type: 'rule', content: 'Agent 设计原则：感知-决策-行动-记忆-进化五大系统缺一不可。没有记忆的 Agent 无法学习，没有进化的 Agent 无法成长。', confidence: 0.97, sources: ['Agent 设计模式'], tags: ['Agent', '架构设计'], metadata: { domain: 'ai_agent', specificity: 0.95, applicability: 'high' } },
  { type: 'strategy', content: 'ReAct 框架：Reasoning（推理）+ Acting（行动）交替进行。Agent 先思考要做什么，再执行行动，观察结果后继续思考。', confidence: 0.96, sources: ['Yao et al., 2022'], tags: ['ReAct', 'Agent框架'], metadata: { domain: 'ai_agent', specificity: 0.92, applicability: 'high' } },
  { type: 'fact', content: '主流 LLM 对比：GPT-4 综合能力强、Claude 3 长上下文、Gemini 多模态、开源模型 LLaMA/Mistral 可本地部署。', confidence: 0.9, sources: ['LLM 评测报告'], tags: ['LLM', '模型对比'], metadata: { domain: 'ai_agent', specificity: 0.85, applicability: 'medium' } },
  { type: 'procedure', content: 'RAG 实现步骤：1) 文档收集和清洗 2) 文本切块（500-1000字，100字重叠） 3) Embedding 编码 4) 存入向量数据库 5) 查询时检索 Top-K 相关片段 6) 融合到 Prompt 中生成回答', confidence: 0.94, sources: ['RAG 最佳实践'], tags: ['RAG', '检索增强'], metadata: { domain: 'ai_agent', specificity: 0.9, applicability: 'high' } },
  { type: 'rule', content: 'Agent 安全原则：1) 永远不要让 Agent 执行未验证的操作 2) 关键操作需要人工确认 3) 限制 Agent 的权限范围 4) 记录所有操作日志', confidence: 0.95, sources: ['AI 安全准则'], tags: ['Agent安全', 'AI伦理'], metadata: { domain: 'ai_agent', specificity: 0.92, applicability: 'high' } },
  { type: 'insight', content: '高质量数据比大模型更重要。在很多任务中，用 7B 模型配合高质量数据，可以击败用 70B 模型配合低质量数据的方案。', confidence: 0.92, sources: ['数据为王'], tags: ['数据', '模型训练'], metadata: { domain: 'ai_agent', specificity: 0.88, applicability: 'high' } },
  { type: 'strategy', content: 'Agent 成长路径：1) 预置知识和规则 2) 从交互中学习经验 3) 反思总结生成改进 4) 自动测试新能力 5) 持续迭代优化', confidence: 0.93, sources: ['Agent 进化框架'], tags: ['Agent成长', '自我改进'], metadata: { domain: 'ai_agent', specificity: 0.9, applicability: 'high' } },
  { type: 'fact', content: 'Token 成本优化技巧：1) 使用更小的模型 2) 缓存相同的前缀 3) 减少不必要的上下文 4) 使用流式响应 5) 本地部署推理。', confidence: 0.91, sources: ['LLM 成本优化'], tags: ['成本优化', '性能'], metadata: { domain: 'ai_agent', specificity: 0.88, applicability: 'medium' } },
  { type: 'rule', content: '函数调用（Function Calling）设计原则：1) 函数描述要清晰完整 2) 参数类型要明确 3) 返回值要结构化 4) 错误要可解释', confidence: 0.94, sources: ['API 设计指南'], tags: ['Function Calling', 'API设计'], metadata: { domain: 'ai_agent', specificity: 0.9, applicability: 'high' } },
  { type: 'strategy', content: '多 Agent 协作模式：1) 编排模式（Orchestrator + Workers） 2) 讨论模式（Debate/Critic） 3) 层级模式（Manager + Subordinates） 4) 协作模式（Peer-to-Peer）', confidence: 0.9, sources: ['多 Agent 模式'], tags: ['多Agent', '协作'], metadata: { domain: 'ai_agent', specificity: 0.85, applicability: 'medium' } },
]

for (const k of aiCoreKnowledge) {
  addKnowledge(k)
  stats.coreKnowledge++
}
console.log(`  ✓ 注入 ${aiCoreKnowledge.length} 条核心知识`)

stats.domains.push('AI/Agent 开发')
