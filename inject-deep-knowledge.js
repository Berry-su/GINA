/**
 * inject-deep-knowledge.js — 深度知识注入 & 持续学习机制
 *
 * 注入六大领域深度知识 + 建立持续迭代学习机制
 *
 * 运行：
 *   node inject-deep-knowledge.js
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

const GINA_HOME = process.env.GINA_HOME || path.join(process.env.HOME || '.', '.gina')

console.log('============================================================')
console.log('  🧠 Gina 深度知识注入 & 持续学习')
console.log('============================================================')
console.log(`  存储路径: ${GINA_HOME}\n`)

initIntelligenceSystem()

const stats = { domains: [], patterns: 0, rules: 0, templates: 0, knowledge: 0 }

function injectPatterns(patterns, label) {
  for (const p of patterns) { recordThinkingPattern(p); stats.patterns++ }
  console.log(`  ✓ ${label}: ${patterns.length} 个思考模式`)
}
function injectRules(rules, label) {
  for (const r of rules) { recordDecisionRule(r); stats.rules++ }
  console.log(`  ✓ ${label}: ${rules.length} 条决策规则`)
}
function injectTemplates(templates, label) {
  for (const t of templates) { recordResponseTemplate(t); stats.templates++ }
  console.log(`  ✓ ${label}: ${templates.length} 个回复模板`)
}
function injectKnowledge(items, label) {
  for (const k of items) { addKnowledge(k); stats.knowledge++ }
  console.log(`  ✓ ${label}: ${items.length} 条核心知识`)
}

function header(title) {
  console.log('\n' + '─'.repeat(60))
  console.log(title)
  console.log('─'.repeat(60))
}

// ═══════════════════════════════════════════════════════════════
// 领域 1：AI/Agent 深度知识（进阶）
// ═══════════════════════════════════════════════════════════════

header('🤖 领域 1：AI/Agent 深度知识')

injectPatterns([
  {
    trigger: 'Transformer架构|注意力机制|self-attention|大模型',
    thinkingPath: [
      '1. 理解核心组件：Multi-Head Self-Attention + Feed-Forward',
      '2. 分析注意力机制：Query/Key/Value 矩阵计算',
      '3. 位置编码：Sinusoidal 或 Learned Positional Embedding',
      '4. Transformer Block：残差连接 + LayerNorm',
      '5. 编码器-解码器结构或仅解码器架构',
      '6. 训练策略：预训练→监督微调→RLHF'
    ],
    conclusion: 'Transformer 核心是自注意力机制，让模型能捕捉长距离依赖关系',
    quality: 5, sourceModel: 'injected-domain-master',
    metadata: { domain: 'ai_agent', category: 'transformer', level: 'expert' }
  },
  {
    trigger: 'RLHF|强化学习人类反馈|对齐|对齐',
    thinkingPath: [
      '1. 收集人类偏好数据：对比式问答',
      '2. 训练奖励模型（Reward Model）：学习人类偏好',
      '3. 用 PPO 算法微调 LLM：最大化奖励',
      '4. 添加 KL 惩罚项：防止偏离原始模型太远',
      '5. 迭代优化：奖励模型和策略模型交替训练',
      '6. 评估对齐效果：TruthfulQA、BBH 等基准测试'
    ],
    conclusion: 'RLHF 让 LLM 的输出更符合人类价值观和意图',
    quality: 5, sourceModel: 'injected-domain-master',
    metadata: { domain: 'ai_agent', category: 'alignment', level: 'expert' }
  },
  {
    trigger: '模型压缩|量化|蒸馏|剪枝',
    thinkingPath: [
      '1. 明确压缩目标：推理速度/显存/部署成本',
      '2. 选择压缩方法：量化/蒸馏/剪枝/低秩分解',
      '3. 量化方案：INT8/INT4/混合精度',
      '4. 知识蒸馏：大模型（教师）→小模型（学生）',
      '5. 剪枝：结构化剪枝/非结构化剪枝',
      '6. 效果验证：准确率损失 vs 压缩比'
    ],
    conclusion: '模型压缩是部署本地 LLM 的核心技术',
    quality: 5, sourceModel: 'injected-domain-master',
    metadata: { domain: 'ai_agent', category: 'model_compression', level: 'expert' }
  },
  {
    trigger: 'Function Calling|工具使用|tool use|API调用',
    thinkingPath: [
      '1. 识别可工具化的操作：文件、搜索、计算、API',
      '2. 设计工具 Schema：清晰的 JSON Schema 定义',
      '3. 描述工具能力：何时使用、参数说明、返回值',
      '4. 解析模型输出：提取函数名和参数',
      '5. 执行工具调用：处理超时和错误',
      '6. 将结果返回给模型：继续推理或结束'
    ],
    conclusion: 'Function Calling 让 LLM 从"只会说"变成"会做事"',
    quality: 5, sourceModel: 'injected-domain-master',
    metadata: { domain: 'ai_agent', category: 'function_calling', level: 'expert' }
  },
  {
    trigger: '多模态|视觉-语言|VLM|图像理解',
    thinkingPath: [
      '1. 理解多模态架构：Vision Encoder + LLM',
      '2. 视觉编码器：CLIP/SigLip 等预训练模型',
      '3. 桥接模块：投影层/Q-Former 连接视觉和语言',
      '4. 训练策略：预训练+指令微调',
      '5. 能力范围：OCR、图表理解、文档分析、视觉推理',
      '6. 应用场景：文档处理、UI 自动化、医疗影像'
    ],
    conclusion: '多模态 LLM 让 AI 能"看懂"图片和视频内容',
    quality: 5, sourceModel: 'injected-domain-master',
    metadata: { domain: 'ai_agent', category: 'multimodal', level: 'expert' }
  },
], 'AI/Agent深度 ')

injectRules([
  {
    condition: '选择 LLM 架构时',
    decision: '简单任务用轻量模型，复杂任务用大模型，通过路由动态选择',
    reasoning: '不是所有任务都需要大模型，动态路由可降低成本',
    examples: ['闲聊用小模型', '代码生成用大模型', '简单问答路由处理'],
    quality: 5, category: '架构选择',
  },
  {
    condition: '进行模型量化时',
    decision: '优先 INT8 量化，精度损失最小；部署受限再试 INT4',
    reasoning: 'INT8 通常精度损失 < 1%，适合大多数场景',
    examples: ['服务器端用 INT8', '边缘设备用 INT4', '考虑混合精度'],
    quality: 5, category: '模型压缩',
  },
  {
    condition: '设计 Agent 记忆系统时',
    decision: '分层记忆：工作记忆（上下文窗口）+ 短期记忆（会话历史）+ 长期记忆（知识库）',
    reasoning: '不同类型的信息需要不同的存储和检索策略',
    examples: ['对话历史存上下文', '用户偏好存向量库', '事实知识存 SQLite'],
    quality: 5, category: 'Agent记忆',
  },
  {
    condition: '评估 Agent 能力时',
    decision: '建立分级能力测试：基础能力→领域能力→综合能力→创造能力',
    reasoning: '从易到难逐级验证 Agent 的能力边界',
    examples: ['基础：问答准确', '中级：任务完成', '高级：多步推理', '顶级：创造创新'],
    quality: 5, category: 'Agent评估',
  },
], 'AI/Agent深度 ')

injectKnowledge([
  { type: 'fact', content: 'Transformer 参数量对比：GPT-3(175B)→GPT-4(推测1.8T)→Claude 3(200K上下文)→Gemini Ultra(多模态)。', confidence: 0.95, sources: ['LLM 参数报告'], tags: ['Transformer', '模型规模'], metadata: { domain: 'ai_agent', specificity: 0.92, applicability: 'high' } },
  { type: 'strategy', content: '本地 LLM 部署路线图：7B(手机)→13B(PC)→34B(服务器)。量化后可部署更大模型。', confidence: 0.92, sources: ['本地部署指南'], tags: ['本地部署', '模型选择'], metadata: { domain: 'ai_agent', specificity: 0.88, applicability: 'high' } },
  { type: 'rule', content: 'RAG 增强策略：混合检索（关键词+向量）、重排序、查询改写、假设性文档生成、Step-back Prompting。', confidence: 0.93, sources: ['RAG 增强论文'], tags: ['RAG', '检索增强'], metadata: { domain: 'ai_agent', specificity: 0.9, applicability: 'high' } },
  { type: 'insight', content: 'LLM 思维链（CoT）：让模型分步思考可显著提升推理能力。适用于数学、逻辑、编程等需要多步推理的任务。', confidence: 0.94, sources: ['Wei et al., 2022'], tags: ['思维链', '推理'], metadata: { domain: 'ai_agent', specificity: 0.9, applicability: 'high' } },
  { type: 'fact', content: '主流开源 LLM：LLaMA 系列（Meta）、Mistral（Mistral AI）、Qwen（阿里云）、Baichuan（百川）、GLM（智谱AI）。', confidence: 0.9, sources: ['开源 LLM 列表'], tags: ['开源', 'LLM'], metadata: { domain: 'ai_agent', specificity: 0.85, applicability: 'medium' } },
  { type: 'strategy', content: 'Agent 进化路径：规则驱动→模板驱动→示例驱动→自主学习。从硬编码到自主进化的四阶段。', confidence: 0.91, sources: ['Agent 进化框架'], tags: ['Agent', '进化'], metadata: { domain: 'ai_agent', specificity: 0.88, applicability: 'high' } },
  { type: 'rule', content: 'Prompt 注入防护：1) 输入验证和清洗 2) 系统提示隔离 3) 权限分级 4) 输出审查 5) 沙箱执行。', confidence: 0.92, sources: ['AI 安全指南'], tags: ['安全', 'Prompt注入'], metadata: { domain: 'ai_agent', specificity: 0.88, applicability: 'high' } },
  { type: 'insight', content: '高质量 Prompt 的特征：清晰目标、具体角色、丰富上下文、明确格式、恰当示例、合理约束。', confidence: 0.95, sources: ['Prompt Engineering'], tags: ['Prompt', '工程'], metadata: { domain: 'ai_agent', specificity: 0.92, applicability: 'high' } },
], 'AI/Agent深度 ')

stats.domains.push('AI/Agent 深度')

// ═══════════════════════════════════════════════════════════════
// 领域 2：地产行业深度知识
// ═══════════════════════════════════════════════════════════════

header('🏢 领域 2：地产行业深度知识')

injectPatterns([
  {
    trigger: '商业地产|写字楼|商铺|商业',
    thinkingPath: [
      '1. 商业地产类型：写字楼/零售/餐饮/综合体',
      '2. 核心指标：租金水平、出租率、租售比、空置率',
      '3. 位置分析：CBD/商圈/交通枢纽',
      '4. 租户质量：知名品牌/稳定业态',
      '5. 运营管理：物业管理、设施维护',
      '6. 退出策略：出售/持有/REITs'
    ],
    conclusion: '商业地产投资关注租金回报和资产增值双重收益',
    quality: 5, sourceModel: 'injected-domain-master',
    metadata: { domain: 'real_estate', category: 'commercial', level: 'expert' }
  },
  {
    trigger: '地产政策|调控|限购|政策',
    thinkingPath: [
      '1. 宏观政策：货币政策、财政政策、产业政策',
      '2. 地方政策：限购、限贷、公积金、落户',
      '3. 土地政策：供地计划、土地出让、容积率',
      '4. 金融政策：房贷利率、首付比例、信贷额度',
      '5. 税收政策：契税、增值税、房产税',
      '6. 政策预判：关注政治局会议和经济工作会议'
    ],
    conclusion: '中国楼市是政策市，政策分析是投资决策的第一要素',
    quality: 5, sourceModel: 'injected-domain-master',
    metadata: { domain: 'real_estate', category: 'policy', level: 'expert' }
  },
  {
    trigger: 'REITs|房地产基金|资产证券化|投资',
    thinkingPath: [
      '1. REITs 类型：产权类/特许经营权类',
      '2. 底层资产：写字楼/产业园/保障房/基建',
      '3. 核心指标：派息率、资产增值、估值水平',
      '4. 投资优势：流动性强、分散投资、定期分红',
      '5. 风险因素：利率风险、房地产下行、运营风险',
      '6. 配置建议：作为另类资产的一部分'
    ],
    conclusion: 'REITs 是普通人参与商业地产投资的最佳方式',
    quality: 5, sourceModel: 'injected-domain-master',
    metadata: { domain: 'real_estate', category: 'reits', level: 'expert' }
  },
], '地产深度 ')

injectRules([
  {
    condition: '投资商业地产时',
    decision: '关注核心地段的甲级写字楼和优质商圈商铺',
    reasoning: '核心地段商业地产抗周期能力最强',
    examples: ['CBD 甲级写字楼', '核心商圈商铺', '交通枢纽综合体'],
    quality: 5, category: '商业投资',
  },
  {
    condition: '判断政策走向时',
    decision: '关注货币政策（M2、LPR）和政治局会议定调',
    reasoning: '货币政策直接影响信贷成本，政治局会议定调未来方向',
    examples: ['降准降息利好楼市', '房住不炒定调不变', '因城施策放松调控'],
    quality: 5, category: '政策分析',
  },
  {
    condition: '选择 REITs 时',
    decision: '优先选择产权清晰、现金流稳定、管理优秀的标的',
    reasoning: 'REITs 的核心是底层资产的质量和管理能力',
    examples: ['产业园 REITs', '保障房 REITs', '交通基建 REITs'],
    quality: 5, category: 'REITs投资',
  },
], '地产深度 ')

injectKnowledge([
  { type: 'fact', content: '中国房地产市场格局：一线城市（北上广深）、新一线（15个）、二线（30个）、三四线（200+）。不同城市分化严重。', confidence: 0.92, sources: ['城市排名'], tags: ['城市', '格局'], metadata: { domain: 'real_estate', specificity: 0.88, applicability: 'high' } },
  { type: 'fact', content: '全球房产投资热点城市：东京（复苏中）、新加坡（稳定）、悉尼（调整后）、迪拜（新兴）、伦敦（脱欧后）。', confidence: 0.88, sources: ['全球地产报告'], tags: ['国际', '热点城市'], metadata: { domain: 'real_estate', specificity: 0.82, applicability: 'medium' } },
  { type: 'rule', content: '房产投资时机判断：1) 信贷宽松期进入 2) 政策底过后 3) 成交量先行指标转暖 4) 开发商拿地意愿增强。', confidence: 0.9, sources: ['周期投资'], tags: ['时机', '周期'], metadata: { domain: 'real_estate', specificity: 0.88, applicability: 'high' } },
  { type: 'strategy', content: 'REITs 配置比例：建议占总资产 5-10%，作为另类资产分散风险。优先选择公募 REITs。', confidence: 0.88, sources: ['资产配置'], tags: ['REITs', '配置'], metadata: { domain: 'real_estate', specificity: 0.85, applicability: 'medium' } },
  { type: 'insight', content: '房产流动性判断：核心城市核心区 > 核心城市郊区 > 非核心城市核心区 > 非核心城市郊区。流动性比价值更重要。', confidence: 0.93, sources: ['流动性分析'], tags: ['流动性', '投资'], metadata: { domain: 'real_estate', specificity: 0.9, applicability: 'high' } },
], '地产深度 ')

stats.domains.push('地产深度')

// ═══════════════════════════════════════════════════════════════
// 领域 3：股票金融深度知识
// ═══════════════════════════════════════════════════════════════

header('📈 领域 3：股票金融深度知识')

injectPatterns([
  {
    trigger: '量化交易|算法交易|量化|alpha',
    thinkingPath: [
      '1. 策略类型：趋势跟踪/均值回归/套利/高频',
      '2. 因子模型：Fama-French 三因子/五因子',
      '3. 数据处理：清洗/对齐/特征工程',
      '4. 回测框架：避免前视偏差、过拟合检测',
      '5. 风险管理：止损/仓位控制/杠杆管理',
      '6. 执行优化：滑点控制、市场冲击最小化'
    ],
    conclusion: '量化交易的核心是策略有效性+风险控制+执行效率',
    quality: 5, sourceModel: 'injected-domain-master',
    metadata: { domain: 'finance', category: 'quantitative', level: 'expert' }
  },
  {
    trigger: '衍生品|期权|期货|对冲',
    thinkingPath: [
      '1. 产品类型：远期/期货/期权/互换',
      '2. 定价模型：Black-Scholes、二叉树、蒙特卡洛',
      '3. 希腊字母：Delta/Gamma/Theta/Vega',
      '4. 策略设计：保护性看跌、备兑看涨、跨式',
      '5. 风险管理：保证金、强平、VaR',
      '6. 应用场景：对冲、投机、套利'
    ],
    conclusion: '衍生品是双刃剑，既能对冲风险也能放大亏损',
    quality: 5, sourceModel: 'injected-domain-master',
    metadata: { domain: 'finance', category: 'derivatives', level: 'expert' }
  },
  {
    trigger: '宏观分析|经济周期|美联储|货币政策',
    thinkingPath: [
      '1. 经济周期：复苏→繁荣→衰退→萧条',
      '2. 核心指标：GDP、CPI、PPI、失业率',
      '3. 货币政策：利率、货币供应量、QE/QT',
      '4. 美联储政策：联邦基金利率、点阵图',
      '5. 资产表现：各周期股票/债券/黄金表现',
      '6. 投资策略：周期股/防御股/成长股切换'
    ],
    conclusion: '宏观周期决定大类资产配置方向',
    quality: 5, sourceModel: 'injected-domain-master',
    metadata: { domain: 'finance', category: 'macro_analysis', level: 'expert' }
  },
], '金融深度 ')

injectRules([
  {
    condition: '进行量化交易时',
    decision: '先做因子有效性检验，再做组合优化，最后做执行优化',
    reasoning: '因子是量化的核心，验证有效性是第一步',
    examples: ['IC/IR 因子检验', '马克维茨均值方差', '算法交易执行'],
    quality: 5, category: '量化策略',
  },
  {
    condition: '使用衍生品时',
    decision: '严格限制杠杆，设置止损，只用在对冲而非投机',
    reasoning: '衍生品风险极大，杠杆控制是生存关键',
    examples: ['杠杆 ≤ 2倍', '单笔最大亏损 2%', '只做保护性对冲'],
    quality: 5, category: '衍生品风险',
  },
  {
    condition: '判断经济周期位置时',
    decision: '综合领先指标（PMI）、同步指标（GDP）、滞后指标（CPI）判断',
    reasoning: '单一指标可能误导，需要综合判断',
    examples: ['PMI 回升→周期底部', 'GDP 高位→过热风险', 'CPI 高企→紧缩风险'],
    quality: 5, category: '周期判断',
  },
], '金融深度 ')

injectKnowledge([
  { type: 'fact', content: 'Fama-French 三因子模型：市场因子、规模因子(SMB)、价值因子(HML)。五因子增加盈利(RMW)和投资(CMA)。', confidence: 0.94, sources: ['因子模型'], tags: ['量化', '因子'], metadata: { domain: 'finance', specificity: 0.9, applicability: 'high' } },
  { type: 'rule', content: '期权希腊字母：Delta(方向敞口)、Gamma(Delta变化率)、Theta(时间衰减)、Vega(波动率敏感度)、Rho(利率敏感度)。', confidence: 0.93, sources: ['衍生品理论'], tags: ['期权', '希腊字母'], metadata: { domain: 'finance', specificity: 0.9, applicability: 'high' } },
  { type: 'strategy', content: '美林投资时钟：经济复苏期→股票；过热期→商品；衰退期→债券；萧条期→现金。', confidence: 0.9, sources: ['美林时钟'], tags: ['资产配置', '周期'], metadata: { domain: 'finance', specificity: 0.88, applicability: 'high' } },
  { type: 'insight', content: 'A股特征：牛短熊长、板块轮动、政策驱动、散户主导。适合波段操作但需要纪律。', confidence: 0.91, sources: ['A股研究'], tags: ['A股', '市场特征'], metadata: { domain: 'finance', specificity: 0.88, applicability: 'medium' } },
  { type: 'fact', content: '全球主要指数：道琼斯、标普500、纳斯达克、沪深300、恒生指数、日经225、德国DAX、英国富时100。', confidence: 0.95, sources: ['指数列表'], tags: ['指数', '全球'], metadata: { domain: 'finance', specificity: 0.92, applicability: 'high' } },
  { type: 'strategy', content: '风险平价策略：按风险贡献而非市值分配权重。波动率低的资产配更高权重。', confidence: 0.88, sources: ['风险平价'], tags: ['配置', '风险'], metadata: { domain: 'finance', specificity: 0.85, applicability: 'medium' } },
], '金融深度 ')

stats.domains.push('金融深度')

// ═══════════════════════════════════════════════════════════════
// 领域 4：科学类知识
// ═══════════════════════════════════════════════════════════════

header('🔬 领域 4：科学类知识')

injectPatterns([
  {
    trigger: '物理学|量子力学|相对论|物理',
    thinkingPath: [
      '1. 经典物理：牛顿力学、电磁学、热力学',
      '2. 现代物理：相对论、量子力学',
      '3. 量子力学核心概念：叠加、纠缠、不确定性',
      '4. 应用：半导体、激光、MRI、量子计算',
      '5. 最新进展：量子霸权、量子纠错',
      '6. 哲学含义：观测者效应、实在性'
    ],
    conclusion: '物理学是理解宇宙运行规律的基础学科',
    quality: 5, sourceModel: 'injected-domain-master',
    metadata: { domain: 'science', category: 'physics', level: 'expert' }
  },
  {
    trigger: '生物学|遗传学|进化论|生物',
    thinkingPath: [
      '1. 细胞生物学：细胞膜、细胞器、DNA',
      '2. 遗传学：孟德尔定律、DNA复制、基因表达',
      '3. 进化论：自然选择、适者生存、物种形成',
      '4. 分子生物学：PCR、测序、基因编辑',
      '5. 生物技术：CRISPR、mRNA疫苗、基因治疗',
      '6. 生态学：生态系统、物种多样性、气候变化'
    ],
    conclusion: '生物学从分子到生态的多层次研究生命现象',
    quality: 5, sourceModel: 'injected-domain-master',
    metadata: { domain: 'science', category: 'biology', level: 'expert' }
  },
  {
    trigger: '数学|算法|数学分析|数学',
    thinkingPath: [
      '1. 基础数学：代数、几何、微积分',
      '2. 应用数学：概率统计、线性代数、数值分析',
      '3. 离散数学：集合论、图论、组合数学',
      '4. 计算理论：可计算性、复杂性、算法设计',
      '5. 优化理论：线性规划、非线性规划、凸优化',
      '6. 数学证明：公理系统、形式化证明'
    ],
    conclusion: '数学是所有科学的语言和工具',
    quality: 5, sourceModel: 'injected-domain-master',
    metadata: { domain: 'science', category: 'mathematics', level: 'expert' }
  },
  {
    trigger: '前沿科技|量子计算|核聚变|人工智能|前沿',
    thinkingPath: [
      '1. 量子计算：量子比特、量子门、Shor算法、Grover算法',
      '2. 量子通信：量子密钥分发、量子隐形传态',
      '3. 核聚变：托卡马克、惯性约束、AI控制等离子体',
      '4. 脑科学：神经科学、脑机接口、意识研究',
      '5. 合成生物学：基因设计、生物计算',
      '6. 技术融合：AI+量子、AI+生物、AI+能源'
    ],
    conclusion: '前沿科技的核心是跨学科融合和基础理论突破',
    quality: 5, sourceModel: 'injected-domain-master',
    metadata: { domain: 'science', category: 'frontier', level: 'expert' }
  },
], '科学 ')

injectKnowledge([
  { type: 'fact', content: '相对论：狭义相对论（时空统一、E=mc²）、广义相对论（引力是时空弯曲）。改变了人类对时空的认识。', confidence: 0.97, sources: ['爱因斯坦'], tags: ['物理', '相对论'], metadata: { domain: 'science', specificity: 0.95, applicability: 'high' } },
  { type: 'fact', content: '量子力学基本原理：1) 叠加原理 2) 测量坍缩 3) 不确定性原理 4) 量子纠缠。', confidence: 0.95, sources: ['量子力学'], tags: ['物理', '量子'], metadata: { domain: 'science', specificity: 0.92, applicability: 'high' } },
  { type: 'rule', content: '进化论核心：变异→遗传→选择→适应。自然选择是进化的主要驱动力。', confidence: 0.96, sources: ['达尔文'], tags: ['生物', '进化'], metadata: { domain: 'science', specificity: 0.92, applicability: 'high' } },
  { type: 'fact', content: 'DNA 双螺旋结构：由 Watson 和 Crick 于 1953 年发现。基因是 DNA 上携带遗传信息的片段。', confidence: 0.96, sources: ['分子生物学'], tags: ['生物', '遗传'], metadata: { domain: 'science', specificity: 0.92, applicability: 'high' } },
  { type: 'strategy', content: 'CRISPR 基因编辑：利用细菌免疫系统实现精确基因编辑。效率高、成本低、应用广。', confidence: 0.93, sources: ['基因编辑'], tags: ['生物', 'CRISPR'], metadata: { domain: 'science', specificity: 0.9, applicability: 'high' } },
  { type: 'fact', content: '算法复杂度分类：多项式时间(P)、非确定性多项式(NP)、NP-hard、NP-complete。P≠NP 是著名猜想。', confidence: 0.94, sources: ['计算理论'], tags: ['数学', '算法'], metadata: { domain: 'science', specificity: 0.9, applicability: 'high' } },
  { type: 'rule', content: '微积分基本定理：导数和积分是一对互逆运算。是现代科学和工程的数学基础。', confidence: 0.96, sources: ['微积分'], tags: ['数学', '微积分'], metadata: { domain: 'science', specificity: 0.92, applicability: 'high' } },
  { type: 'fact', content: '量子计算优势：Shor 算法可多项式时间分解大数（威胁 RSA 加密）；Grover 算法可平方加速搜索。', confidence: 0.92, sources: ['量子计算'], tags: ['前沿', '量子'], metadata: { domain: 'science', specificity: 0.9, applicability: 'high' } },
  { type: 'insight', content: '科学研究方法论：观察→假设→实验→验证→理论。可重复性是科学的核心特征。', confidence: 0.94, sources: ['科学方法论'], tags: ['科学', '方法论'], metadata: { domain: 'science', specificity: 0.9, applicability: 'high' } },
  { type: 'strategy', content: '核聚变进展：ITER(法国)、EAST(中国)、NIF(美国)。2022 年 NIF 实现核聚变点火。', confidence: 0.88, sources: ['核聚变'], tags: ['前沿', '能源'], metadata: { domain: 'science', specificity: 0.85, applicability: 'medium' } },
], '科学 ')

stats.domains.push('科学')

// ═══════════════════════════════════════════════════════════════
// 领域 5：工商管理学深度知识
// ═══════════════════════════════════════════════════════════════

header('💼 领域 5：工商管理学深度知识')

injectPatterns([
  {
    trigger: '供应链|采购|物流|供应链管理',
    thinkingPath: [
      '1. 供应链结构：供应商→制造商→分销商→客户',
      '2. 核心流程：采购、生产、库存、运输、销售',
      '3. 关键指标：周转天数、库存准确率、订单满足率',
      '4. 风险管控：供应商风险、物流风险、需求波动',
      '5. 数字化：SCM 系统、IoT、大数据预测',
      '6. 绿色供应链：碳排放、可持续发展'
    ],
    conclusion: '供应链管理追求效率、弹性和可持续性的平衡',
    quality: 5, sourceModel: 'injected-domain-master',
    metadata: { domain: 'business_admin', category: 'supply_chain', level: 'expert' }
  },
  {
    trigger: '创新管理|研发|产品开发|创新',
    thinkingPath: [
      '1. 创新类型：产品创新/流程创新/商业模式创新',
      '2. 创新来源：内部研发/外部合作/用户共创',
      '3. 创新流程：创意产生→概念开发→原型制作→商业化',
      '4. 技术路线图：规划技术发展路径',
      '5. 知识产权：专利、商标、版权保护',
      '6. 创新文化：容错、激励、跨团队协作'
    ],
    conclusion: '创新管理的核心是建立持续创新的组织能力',
    quality: 5, sourceModel: 'injected-domain-master',
    metadata: { domain: 'business_admin', category: 'innovation', level: 'expert' }
  },
  {
    trigger: '品牌管理|品牌建设|品牌资产|品牌',
    thinkingPath: [
      '1. 品牌定位：目标市场、核心价值、品牌个性',
      '2. 品牌架构：单品牌/多品牌/背书品牌',
      '3. 品牌资产：认知度、美誉度、忠诚度、联想',
      '4. 品牌传播：整合营销传播(IMC)',
      '5. 品牌延伸：新产品使用现有品牌',
      '6. 品牌保护：商标、打假、危机公关'
    ],
    conclusion: '品牌是最重要的无形资产，需要长期投资和维护',
    quality: 5, sourceModel: 'injected-domain-master',
    metadata: { domain: 'business_admin', category: 'brand', level: 'expert' }
  },
], '工商深度 ')

injectKnowledge([
  { type: 'strategy', content: '波特三大通用战略：成本领先、差异化、聚焦。选择其一而不是混合型。', confidence: 0.93, sources: ['竞争战略'], tags: ['战略', '波特'], metadata: { domain: 'business_admin', specificity: 0.9, applicability: 'high' } },
  { type: 'rule', content: '供应链管理三大原则：1) 以客户为中心 2) 端到端优化 3) 合作伙伴关系。', confidence: 0.91, sources: ['SCM 最佳实践'], tags: ['供应链', '管理'], metadata: { domain: 'business_admin', specificity: 0.88, applicability: 'high' } },
  { type: 'insight', content: '创新的死亡谷：从发明到商业化之间的鸿沟。需要资金、人才和市场的配合。', confidence: 0.9, sources: ['创新管理'], tags: ['创新', '商业化'], metadata: { domain: 'business_admin', specificity: 0.88, applicability: 'medium' } },
  { type: 'strategy', content: '品牌资产四级模型：1) 品牌认知 2) 品牌联想 3) 品牌情感 4) 品牌忠诚。', confidence: 0.92, sources: ['Keller 品牌资产'], tags: ['品牌', '资产'], metadata: { domain: 'business_admin', specificity: 0.9, applicability: 'high' } },
  { type: 'fact', content: '企业估值方法：DCF(现金流折现)、可比公司法、先例交易法、LBO 分析。不同情况用不同方法。', confidence: 0.9, sources: ['估值方法'], tags: ['估值', '财务'], metadata: { domain: 'business_admin', specificity: 0.88, applicability: 'high' } },
], '工商深度 ')

stats.domains.push('工商深度')

// ═══════════════════════════════════════════════════════════════
// 领域 6：国内外法律知识
// ═══════════════════════════════════════════════════════════════

header('⚖️ 领域 6：国内外法律知识')

injectPatterns([
  {
    trigger: '合同法|合同|缔约|合同纠纷',
    thinkingPath: [
      '1. 合同成立：要约→承诺→成立',
      '2. 合同要件：主体合格、意思表示真实、内容合法',
      '3. 合同效力：有效/无效/可撤销/效力待定',
      '4. 违约责任：继续履行、赔偿损失、违约金',
      '5. 合同解除：约定解除/法定解除',
      '6. 争议解决：协商/调解/仲裁/诉讼'
    ],
    conclusion: '合同法是市场经济的基础法律，保障交易安全',
    quality: 5, sourceModel: 'injected-domain-master',
    metadata: { domain: 'law', category: 'contract', level: 'expert' }
  },
  {
    trigger: '公司法|公司治理|股权|公司法',
    thinkingPath: [
      '1. 公司类型：有限责任公司/股份有限公司',
      '2. 公司架构：股东会→董事会→经理层→监事会',
      '3. 股权结构：普通股/优先股/表决权差异',
      '4. 公司治理：内部控制、信息披露、关联交易',
      '5. 资本运作：融资/并购/重组/上市',
      '6. 股东权利：知情权、表决权、诉讼权'
    ],
    conclusion: '公司法确立了企业的基本组织形式和治理规则',
    quality: 5, sourceModel: 'injected-domain-master',
    metadata: { domain: 'law', category: 'company', level: 'expert' }
  },
  {
    trigger: '知识产权|专利|商标|版权',
    thinkingPath: [
      '1. 专利：发明/实用新型/外观设计，保护技术创新',
      '2. 商标：注册原则、有效期、驰名商标保护',
      '3. 版权：自动取得、保护期、合理使用',
      '4. 侵权判断：接触+实质性相似',
      '5. 维权途径：行政/民事/刑事',
      '6. 国际保护：PCT、马德里体系'
    ],
    conclusion: '知识产权是保护创新和创造的法律体系',
    quality: 5, sourceModel: 'injected-domain-master',
    metadata: { domain: 'law', category: 'ip', level: 'expert' }
  },
  {
    trigger: '劳动法|劳动合同|劳动争议|劳动法',
    thinkingPath: [
      '1. 劳动合同：订立/履行/变更/解除/终止',
      '2. 工时制度：标准工时/综合计算/不定时',
      '3. 薪酬福利：最低工资/加班工资/社保',
      '4. 劳动保护：安全生产/女职工特殊保护',
      '5. 劳动争议：调解/仲裁/诉讼',
      '6. 集体合同：工会与雇主的集体谈判'
    ],
    conclusion: '劳动法平衡劳动者权益和企业用工灵活性',
    quality: 5, sourceModel: 'injected-domain-master',
    metadata: { domain: 'law', category: 'labor', level: 'expert' }
  },
  {
    trigger: '国际经济法|国际贸易|跨境|国际商法',
    thinkingPath: [
      '1. 国际贸易术语：FOB/CIF/EXW/FCA',
      '2. 国际货物销售：CISG 公约',
      '3. 国际支付：信用证、托收、汇付',
      '4. 跨境投资：外资准入、国民待遇、最惠国待遇',
      '5. 外汇管理：经常项目/资本项目',
      '6. 争议解决：国际仲裁、外国判决承认'
    ],
    conclusion: '国际经济法是跨境交易的法律框架',
    quality: 5, sourceModel: 'injected-domain-master',
    metadata: { domain: 'law', category: 'international', level: 'expert' }
  },
], '法律 ')

injectKnowledge([
  { type: 'rule', content: '合同法基本原则：1) 平等自愿 2) 诚实信用 3) 公平原则 4) 守法和公序良俗 5) 合同严守。', confidence: 0.95, sources: ['民法典合同编'], tags: ['合同法', '原则'], metadata: { domain: 'law', specificity: 0.92, applicability: 'high' } },
  { type: 'fact', content: '公司三权分立：股东会（决策）、董事会（执行）、监事会（监督）。现代公司治理的核心架构。', confidence: 0.94, sources: ['公司法'], tags: ['公司法', '治理'], metadata: { domain: 'law', specificity: 0.9, applicability: 'high' } },
  { type: 'fact', content: '专利类型和保护期：发明 20 年、实用新型 10 年、外观设计 15 年（中国）。', confidence: 0.95, sources: ['专利法'], tags: ['知识产权', '专利'], metadata: { domain: 'law', specificity: 0.92, applicability: 'high' } },
  { type: 'rule', content: '劳动合同必备条款：工作内容、工作地点、工作时间、劳动报酬、社会保险、劳动保护。', confidence: 0.93, sources: ['劳动合同法'], tags: ['劳动法', '合同'], metadata: { domain: 'law', specificity: 0.9, applicability: 'high' } },
  { type: 'fact', content: '国际贸易术语 FOB：货物在指定装运港越过船舷时风险转移。CIF：卖方负责运输和保险到指定目的港。', confidence: 0.92, sources: ['Incoterms'], tags: ['国际经济法', '贸易'], metadata: { domain: 'law', specificity: 0.88, applicability: 'high' } },
  { type: 'rule', content: '民事法律行为有效要件：1) 行为人具有相应民事行为能力 2) 意思表示真实 3) 不违反法律、行政法规的强制性规定。', confidence: 0.95, sources: ['民法典总则'], tags: ['民法', '法律行为'], metadata: { domain: 'law', specificity: 0.92, applicability: 'high' } },
  { type: 'insight', content: '法律风险管理：事前预防 > 事中控制 > 事后补救。合规是企业的生命线。', confidence: 0.9, sources: ['法务管理'], tags: ['风控', '合规'], metadata: { domain: 'law', specificity: 0.88, applicability: 'medium' } },
  { type: 'fact', content: '中国法律体系层级：宪法→法律→行政法规→地方性法规→部门规章→地方政府规章→司法解释。', confidence: 0.94, sources: ['立法法'], tags: ['法律', '体系'], metadata: { domain: 'law', specificity: 0.9, applicability: 'high' } },
], '法律 ')

stats.domains.push('法律')

// ═══════════════════════════════════════════════════════════════
// 测试和总结
// ═══════════════════════════════════════════════════════════════

console.log('\n\n' + '='.repeat(60))
console.log('📊 深度知识注入总结')
console.log('='.repeat(60))

console.log(`\n  注入领域: ${stats.domains.length} 个`)
for (const d of stats.domains) {
  console.log(`    - ${d}`)
}
console.log(`\n  思考模式: ${stats.patterns} 个`)
console.log(`  决策规则: ${stats.rules} 条`)
console.log(`  回复模板: ${stats.templates} 个`)
console.log(`  核心知识: ${stats.knowledge} 条`)
console.log(`  总计: ${stats.patterns + stats.rules + stats.templates + stats.knowledge} 条知识`)

// 验证检索
console.log('\n\n🔍 验证各领域知识检索...')
const verifyQueries = [
  ['AI深度', 'Transformer架构注意力机制大模型'],
  ['地产深度', '商业地产REITs政策调控'],
  ['金融深度', '量化交易因子模型衍生品'],
  ['科学', '量子力学相对论进化论'],
  ['工商深度', '供应链创新品牌管理'],
  ['法律', '合同专利劳动法公司法'],
]

let allPass = true
for (const [label, query] of verifyQueries) {
  const results = retrieveRelevantKnowledge(query, { maxResults: 2 })
  const pass = results.length > 0
  console.log(`  ${label}: ${pass ? '✓' : '✗'} (${results.length} 条)`)
  if (!pass) allPass = false
}

// IQ 测试
console.log('\n🧮 IQ 测试...')
const iqResult = calculateIQScore()
console.log(`  IQ: ${iqResult.score} (${iqResult.levelLabel})`)
console.log(`  思考模式: ${iqResult.statistics.totalPatterns} 个`)
console.log(`  决策规则: ${iqResult.statistics.totalRules} 条`)
console.log(`  知识类别: ${iqResult.statistics.categories} 个`)

console.log('\n' + '='.repeat(60))
console.log(`  🎉 ${allPass ? '全部通过！' : '部分失败，需要优化'}`)
console.log('='.repeat(60))

// ═══════════════════════════════════════════════════════════════
// 持续学习机制：创建学习计划文件
// ═══════════════════════════════════════════════════════════════

const learningPlanPath = path.join(GINA_HOME, 'continuous-learning-plan.json')
const learningPlan = {
  version: 1.0,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  learningDomains: [
    { name: 'AI/Agent 开发', status: 'active', priority: 'high', depth: 'deep' },
    { name: '地产行业分析', status: 'active', priority: 'high', depth: 'deep' },
    { name: '股票金融分析', status: 'active', priority: 'high', depth: 'deep' },
    { name: '科学类', status: 'active', priority: 'medium', depth: 'deep' },
    { name: '工商管理学', status: 'active', priority: 'high', depth: 'deep' },
    { name: '国内外法律', status: 'active', priority: 'medium', depth: 'deep' },
    { name: '编程技术', status: 'active', priority: 'high', depth: 'base' },
    { name: '孙子兵法', status: 'active', priority: 'medium', depth: 'base' },
  ],
  learningSchedule: {
    daily: '交互中自动学习，记录经验和知识',
    weekly: '主动复盘一周交互，蒸馏新知识',
    monthly: '系统性补充领域知识，更新 IQ',
    quarterly: '深度研究前沿领域，生成研究报告',
  },
  learningMethods: [
    '交互学习：从每次对话中提取经验和知识',
    '反思学习：定期反思成功和失败，总结教训',
    '主动学习：主动生成学习任务，探索新知识',
    '云端蒸馏：从云端模型交互中蒸馏高质量知识',
    '自我进化：基于反馈持续优化思考模式和决策规则',
  ],
  nextSteps: [
    '注入更多领域知识（医学、心理学、教育学）',
    '集成视觉系统实现图片内容理解',
    '建立知识验证和淘汰机制',
    '实现基于对话的实时知识注入',
  ],
}

fs.writeFileSync(learningPlanPath, JSON.stringify(learningPlan, null, 2))
console.log(`\n📝 持续学习计划已保存: ${learningPlanPath}`)