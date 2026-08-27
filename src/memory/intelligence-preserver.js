/**
 * intelligence-preserver.js — 智商保持与增强系统
 *
 * 核心目标：
 *   1. 在切换大模型后保持"智商"不变
 *   2. 通过成长让 Gina 越来越聪明
 *
 * 技术方案：
 *   ┌─────────────────────────────────────────────┐
 *   │  云端模型（高智商）                          │
 *   │  └─ 收集高质量交互                           │
 *   │     └─ 提炼思考模式、决策规则                │
 *   │        └─ 存入"智商库"                      │
 *   └─────────────────────────────────────────────┘
 *                        ↓
 *   ┌─────────────────────────────────────────────┐
 *   │  智商保持层                                  │
 *   │  ├─ 思考模式库：高智商的思考路径             │
 *   │  ├─ 决策规则库：复杂决策的判断逻辑          │
 *   │  ├─ 表达模板库：高质量回复的结构模板        │
 *   │  └─ 知识图谱：结构化的领域知识              │
 *   └─────────────────────────────────────────────┘
 *                        ↓
 *   ┌─────────────────────────────────────────────┐
 *   │  本地模型（基础智商）                        │
 *   │  └─ 借助"智商库"提升表现                    │
 *   │     └─ 按模板思考、按规则决策               │
 *   │        └─ 表现出更高的智商                 │
 *   └─────────────────────────────────────────────┘
 */

import fs from 'fs'
import path from 'path'

let _INTELLIGENCE_DIR = null

function getIntelligenceDir() {
  if (!_INTELLIGENCE_DIR) {
    _INTELLIGENCE_DIR = process.env.GINA_HOME
      ? path.join(process.env.GINA_HOME, 'intelligence')
      : path.join(process.env.HOME || '.', '.gina', 'intelligence')
  }
  return _INTELLIGENCE_DIR
}

// 智商库结构
function getIntelligenceStore() {
  const dir = getIntelligenceDir()
  return {
    thinking: path.join(dir, 'thinking-patterns.jsonl'),
    rules: path.join(dir, 'decision-rules.jsonl'),
    templates: path.join(dir, 'response-templates.jsonl'),
    knowledge: path.join(dir, 'knowledge-graph.json'),
    config: path.join(dir, 'intelligence-config.json'),
  }
}

// 智商维度
const INTELLIGENCE_DIMENSIONS = {
  REASONING: 'reasoning',           // 推理能力
  CREATIVITY: 'creativity',         // 创造力
  PLANNING: 'planning',             // 规划能力
  ANALYSIS: 'analysis',             // 分析能力
  COMMUNICATION: 'communication',   // 沟通能力
  PROBLEM_SOLVING: 'problem_solving', // 问题解决
  ADAPTABILITY: 'adaptability',     // 适应能力
  ABSTRACTION: 'abstraction',       // 抽象思维
}

// 智商等级定义
const IQ_LEVELS = {
  GENIUS: { min: 140, label: '天才', description: '能解决极复杂的问题，创造新概念' },
  HIGH: { min: 120, label: '高智商', description: '能处理复杂任务，独立思考' },
  ABOVE_AVERAGE: { min: 110, label: '中上', description: '能完成常规复杂任务' },
  AVERAGE: { min: 90, label: '平均', description: '能完成基本任务' },
  BELOW_AVERAGE: { min: 0, label: '待提升', description: '需要更多学习和训练' },
}

/**
 * 初始化智商保持系统
 */
export function initIntelligenceSystem() {
  try {
    const dir = getIntelligenceDir()
    const store = getIntelligenceStore()
    
    // 创建目录
    fs.mkdirSync(dir, { recursive: true })

    // 初始化各个存储文件
    for (const [key, filePath] of Object.entries(store)) {
      if (!fs.existsSync(filePath)) {
        if (key === 'knowledge') {
          fs.writeFileSync(filePath, JSON.stringify({
            nodes: [],
            edges: [],
            version: 1,
            lastUpdated: Date.now(),
          }, null, 2))
        } else if (key === 'config') {
          fs.writeFileSync(filePath, JSON.stringify({
            version: 1,
            createdAt: Date.now(),
            iqScore: 100,
            dimensions: {},
            patternsLearned: 0,
            rulesLearned: 0,
            active: true,
          }, null, 2))
        } else {
          fs.writeFileSync(filePath, '')
        }
      }
    }

    console.log('[智商保持] 系统初始化完成')
    return { success: true }
  } catch (e) {
    console.error('[智商保持] 初始化失败:', e?.message)
    return { success: false, error: e?.message }
  }
}

/**
 * 记录高质量思考模式（从云端模型学习）
 */
export function recordThinkingPattern({
  trigger,           // 触发这个思考的问题类型
  thinkingPath,      // 思考路径（步骤序列）
  conclusion,        // 思考结论
  quality,           // 质量评分 (1-5)
  sourceModel,       // 来源模型
  metadata = {},
} = {}) {
  try {
    const pattern = {
      id: `tp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      trigger,
      thinkingPath,
      conclusion,
      quality,
      sourceModel,
      metadata,
      timestamp: Date.now(),
      usageCount: 0,
      successRate: 1.0,
    }

    fs.appendFileSync(getIntelligenceStore().thinking, JSON.stringify(pattern) + '\n')
    updateConfig({ patternsLearned: getConfigValue('patternsLearned', 0) + 1 })

    return { success: true, pattern }
  } catch (e) {
    return { success: false, error: e?.message }
  }
}

/**
 * 记录高质量决策规则
 */
export function recordDecisionRule({
  condition,         // 适用条件
  decision,          // 应该做的决策
  reasoning,         // 决策理由
  examples = [],     // 应用示例
  quality = 5,       // 质量评分
  category,          // 决策类别
} = {}) {
  try {
    const rule = {
      id: `dr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      condition,
      decision,
      reasoning,
      examples,
      quality,
      category,
      timestamp: Date.now(),
      usageCount: 0,
      effectiveness: 1.0,
    }

    fs.appendFileSync(getIntelligenceStore().rules, JSON.stringify(rule) + '\n')
    updateConfig({ rulesLearned: getConfigValue('rulesLearned', 0) + 1 })

    return { success: true, rule }
  } catch (e) {
    return { success: false, error: e?.message }
  }
}

/**
 * 记录高质量回复模板
 */
export function recordResponseTemplate({
  type,              // 模板类型
  structure,         // 回复结构
  style,             // 风格特点
  components = [],   // 组成部分
  useCases = [],     // 适用场景
} = {}) {
  try {
    const template = {
      id: `rt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type,
      structure,
      style,
      components,
      useCases,
      timestamp: Date.now(),
      usageCount: 0,
      qualityScore: 5,
    }

    fs.appendFileSync(getIntelligenceStore().templates, JSON.stringify(template) + '\n')
    return { success: true, template }
  } catch (e) {
    return { success: false, error: e?.message }
  }
}

// 领域关键词字典
const DOMAIN_KEYWORDS = {
  finance: ['股票', '基金', '投资', '买入', '卖出', '持仓', '仓位', '牛市', '熊市', '反弹', '回调',
    '估值', 'pe', 'pb', 'eps', '财报', '业绩', '增长', '营收', '利润', '分红',
    '量化', '对冲', '期权', '期货', '外汇', '汇率', '黄金', '原油', '大宗商品',
    '指数', '上证', '深证', '创业板', '纳斯达克', '标普', '道琼斯', '恒生',
    '加息', '降息', '货币政策', '财政政策', '通胀', '利率', '债券',
    '加仓', '减仓', '追涨', '杀跌', '止损', '止盈', '风险', '收益', '回撤',
    '因子', 'alpha', 'beta', '夏普', '波动率', 'vix', '动量', '价值', '成长',
    '经济', 'gdp', '就业', '非农', 'cpi', 'ppi', '社融', 'm2'],
  realestate: ['房地产', '房价', '楼市', '土地', '开发商', '万科', '保利', '龙湖',
    '限购', '限贷', '公积金', '房贷', '抵押贷款', '首付', '按揭', '装修',
    '学区房', '地段', '户型', '楼盘', '新房', '二手房', '租房', '租金',
    '不动产', 'property', 'real estate'],
  ai: ['ai', 'agent', 'llm', '大模型', '机器学习', '深度学习', '神经网络',
    'transformer', 'gpt', 'bert', 'rlhf', '微调', 'fine-tune', 'embedding',
    'prompt', 'token', '推理', '生成', '对话', 'chatbot', '智能体', '多模态',
    'rag', '检索增强', '向量数据库', '知识图谱', '语义搜索', 'nlp', '计算机视觉'],
  business: ['战略', '竞争', '市场', '客户', '品牌', '营销', '销售', '增长',
    '供应链', '运营', '管理', '领导力', '创新', '创业', '产品', '服务',
    '组织', '团队', '文化', '变革', '并购', '重组', '多元化', '国际化'],
  legal: ['合同', '法律', '法规', '合规', '诉讼', '知识产权', '专利', '商标',
    '版权', '侵权', '责任', '赔偿', '仲裁', '监管', '审计', '公司法',
    '劳动法', '合同法', '税法', '反垄断', '数据保护', '隐私', 'gdpr'],
  science: ['物理', '化学', '生物', '基因', '量子', '相对论', '热力学',
    '细胞', 'dna', '进化', '光合作用', '力学', '电磁', '光学',
    '数学', '代数', '微积分', '统计', '概率', '算法', '复杂度',
    '科技', '创新', '研究', '实验', '发现', '发明']
}

function detectDomains(context) {
  const contextLower = String(context).toLowerCase()
  const domainScores = {}
  
  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
    let score = 0
    for (const kw of keywords) {
      if (contextLower.includes(kw)) {
        score += 1
      }
    }
    if (score > 0) {
      domainScores[domain] = score
    }
  }
  
  return Object.entries(domainScores)
    .sort((a, b) => b[1] - a[1])
    .map(([domain, score]) => ({ domain, score }))
}

/**
 * 应用思考模式（增强本地模型的推理能力）
 */
export function applyThinkingPattern(problem) {
  try {
    const patterns = readJsonlFile(getIntelligenceStore().thinking)

    // 将 problem 统一为字符串
    const problemStr = Array.isArray(problem) ? problem.join(' ') : String(problem)
    const problemLower = problemStr.toLowerCase()
    const problemKeywords = extractKeywordsSimple(problemLower)
    
    // 检测上下文领域
    const detectedDomains = detectDomains(problemLower)
    const primaryDomain = detectedDomains[0]?.domain

    // 根据问题特征匹配思考模式 - 计算匹配分数
    const matchedPatterns = patterns.map(p => {
      if (!p.trigger) return null
      const triggerStr = typeof p.trigger === 'string' ? p.trigger : JSON.stringify(p.trigger)
      const triggerLower = triggerStr.toLowerCase()
      const triggerKeywords = extractKeywordsSimple(triggerLower)

      let matchScore = 0

      // 问题关键词在触发词中出现
      for (const kw of problemKeywords) {
        if (kw.length < 2) continue
        if (triggerLower.includes(kw)) matchScore += 3
      }

      // 触发词关键词在问题中出现
      for (const kw of triggerKeywords) {
        if (kw.length < 2) continue
        if (problemLower.includes(kw)) matchScore += 3
      }
      
      // 领域匹配加成
      if (primaryDomain && p.domain) {
        let patternDomainStr = ''
        if (Array.isArray(p.domain)) {
          patternDomainStr = p.domain.join(' ').toLowerCase()
        } else {
          patternDomainStr = String(p.domain).toLowerCase()
        }
        if (patternDomainStr.includes(primaryDomain)) {
          matchScore += 15
        }
      }

      if (matchScore > 0) {
        return { pattern: p, matchScore }
      }
      return null
    }).filter(Boolean)

    // 按匹配分数和质量排序
    const sortedPatterns = matchedPatterns.sort((a, b) => {
      const scoreA = a.matchScore * (a.pattern.quality || 1) * (a.pattern.successRate || 0.5)
      const scoreB = b.matchScore * (b.pattern.quality || 1) * (b.pattern.successRate || 0.5)
      return scoreB - scoreA
    })

    // 返回最匹配的思考模式
    if (sortedPatterns.length > 0) {
      const best = sortedPatterns[0]
      best.pattern.usageCount = (best.pattern.usageCount || 0) + 1
      return {
        matched: true,
        pattern: best.pattern,
        thinkingPath: best.pattern.thinkingPath,
        confidence: Math.min(1, best.matchScore / 10),
      }
    }

    return { matched: false, confidence: 0 }
  } catch (e) {
    return { matched: false, error: e?.message }
  }
}

/**
 * 应用决策规则（增强本地模型的决策能力）
 */
export function applyDecisionRule(context) {
  try {
    const rules = readJsonlFile(getIntelligenceStore().rules)
    const contextStr = typeof context === 'string' ? context : JSON.stringify(context)
    const contextLower = contextStr.toLowerCase()

    // 将上下文拆分为关键词（支持中英文混合）
    const contextKeywords = extractKeywordsSimple(contextLower)
    
    // 检测上下文领域
    const detectedDomains = detectDomains(contextLower)
    const primaryDomain = detectedDomains[0]?.domain

    // 根据上下文匹配决策规则 - 使用关键词匹配
    const matchedRules = rules.map(rule => {
      if (!rule.condition) return null
      const conditionStr = typeof rule.condition === 'string' ? rule.condition : JSON.stringify(rule.condition)
      const conditionLower = conditionStr.toLowerCase()
      const categoryLower = (rule.category || '').toLowerCase()
      const decisionLower = (rule.decision || '').toLowerCase()

      // 计算匹配分数
      let matchScore = 0

      // 1. 上下文关键词在条件中出现（双向匹配）
      for (const kw of contextKeywords) {
        if (kw.length < 2) continue
        if (conditionLower.includes(kw)) matchScore += 3
      }
      // 条件关键词在上下文中出现
      const condKeywords = extractKeywordsSimple(conditionLower)
      for (const kw of condKeywords) {
        if (kw.length < 2) continue
        if (contextLower.includes(kw)) matchScore += 3
      }

      // 2. 类别关键词匹配
      if (categoryLower) {
        const catKeywords = extractKeywordsSimple(categoryLower)
        for (const kw of catKeywords) {
          if (kw.length < 2) continue
          if (contextLower.includes(kw)) matchScore += 4
          if (conditionLower.includes(kw)) matchScore += 2
        }
      }

      // 3. 决策关键词匹配
      const decisionKeywords = extractKeywordsSimple(decisionLower)
      for (const kw of decisionKeywords) {
        if (kw.length < 2) continue
        if (contextLower.includes(kw)) matchScore += 1
      }
      
      // 4. 领域匹配加成
      if (primaryDomain) {
        let ruleDomainStr = ''
        if (rule.domain) {
          ruleDomainStr = Array.isArray(rule.domain) 
            ? rule.domain.join(' ').toLowerCase() 
            : String(rule.domain).toLowerCase()
        }
        const ruleCategoryStr = (rule.category || '').toLowerCase()
        if ((ruleDomainStr && ruleDomainStr.includes(primaryDomain)) ||
            (ruleCategoryStr && ruleCategoryStr.includes(primaryDomain))) {
          matchScore += 20
        }
      }

      if (matchScore > 0) {
        return { rule, matchScore }
      }
      return null
    }).filter(Boolean)

    // 按匹配分数和规则质量排序
    const sortedRules = matchedRules.sort((a, b) => {
      const scoreA = a.matchScore * (a.rule.quality || 1) * (a.rule.effectiveness || 1)
      const scoreB = b.matchScore * (b.rule.quality || 1) * (b.rule.effectiveness || 1)
      return scoreB - scoreA
    })

    if (sortedRules.length > 0) {
      const best = sortedRules[0]
      return {
        matched: true,
        rule: best.rule,
        decision: best.rule.decision,
        reasoning: best.rule.reasoning,
        confidence: Math.min(1, best.matchScore / 10),
      }
    }

    return { matched: false }
  } catch (e) {
    return { matched: false, error: e?.message }
  }
}

/**
 * 简单关键词提取（支持中英文混合）
 */
function extractKeywordsSimple(text) {
  if (!text) return []
  const lower = text.toLowerCase()
  const result = []

  // 按空格和标点分割
  const words = lower.split(/[\s,，。.!！?？;；:："'""''()（）\[\]【】、]+/)
  for (const w of words) {
    if (w.length >= 2) result.push(w)
  }

  // 提取中文词组（2字、3字、4字组合）
  // 先提取连续的中文字符段
  const chineseSegments = lower.match(/[\u4e00-\u9fa5]+/g) || []
  for (const seg of chineseSegments) {
    // 生成2字、3字、4字的子串
    for (let len = 2; len <= Math.min(4, seg.length); len++) {
      for (let i = 0; i <= seg.length - len; i++) {
        result.push(seg.substring(i, i + len))
      }
    }
  }

  return [...new Set(result)]
}

/**
 * 获取回复模板（增强本地模型的表达能力）
 */
export function getResponseTemplate(type = 'default') {
  try {
    const templates = readJsonlFile(getIntelligenceStore().templates)
    const matched = templates.filter(t => t.type === type)

    if (matched.length > 0) {
      return matched[0]
    }

    // 返回默认模板
    return {
      type: 'default',
      structure: ['分析问题', '确定方案', '执行步骤', '验证结果'],
      style: '清晰、简洁、专业',
      components: [],
    }
  } catch (e) {
    return null
  }
}

/**
 * 构建增强提示词（给本地模型"开小灶"）
 */
export function buildEnhancedPrompt({
  userInput,
  context = [],
  problemType = 'general',
  history = [],
} = {}) {
  const enhancements = []

  // 1. 应用思考模式
  const thinkingResult = applyThinkingPattern([problemType, ...userInput.split(' ')])
  if (thinkingResult.matched) {
    enhancements.push({
      type: 'thinking_pattern',
      content: `请按照以下思考路径分析：\n${thinkingResult.thinkingPath?.join('\n') || '1. 分析问题核心\n2. 拆解子问题\n3. 逐一解决\n4. 整合结果'}`,
    })
  }

  // 2. 应用决策规则
  const decisionResult = applyDecisionRule(userInput)
  if (decisionResult.matched) {
    enhancements.push({
      type: 'decision_rule',
      content: `参考决策规则：当遇到此类问题时，应优先考虑：${decisionResult.reasoning}`,
    })
  }

  // 3. 获取回复模板
  const template = getResponseTemplate(problemType)
  if (template) {
    enhancements.push({
      type: 'response_template',
      content: `回复结构建议：${template.structure?.join(' → ') || '清晰表达 → 提供方案 → 确认执行'}`,
    })
  }

  // 4. 组合增强提示词
  const enhancedPrompt = {
    systemEnhancement: enhancements.map(e => `[${e.type}] ${e.content}`).join('\n\n'),
    originalInput: userInput,
    context,
    historyLength: history.length,
    enhancementCount: enhancements.length,
  }

  return enhancedPrompt
}

/**
 * 计算当前智商分数
 */
export function calculateIQScore() {
  try {
    const config = loadConfig()
    const patterns = readJsonlFile(getIntelligenceStore().thinking)
    const rules = readJsonlFile(getIntelligenceStore().rules)
    const templates = readJsonlFile(getIntelligenceStore().templates)

    // 基础分
    let score = 80

    // 思考模式加成（每个高质量模式 +2，最多 +20）
    const qualityPatterns = patterns.filter(p => p.quality >= 4).length
    score += Math.min(20, qualityPatterns * 2)

    // 决策规则加成（每个有效规则 +3，最多 +20）
    const effectiveRules = rules.filter(r => r.effectiveness >= 0.8).length
    score += Math.min(20, effectiveRules * 3)

    // 回复模板加成（每个模板 +2，最多 +20）
    score += Math.min(20, templates.length * 2)

    // 知识广度加成（按类别数）
    const categories = new Set()
    for (const p of patterns) if (p.metadata?.category) categories.add(p.metadata.category)
    for (const r of rules) if (r.category) categories.add(r.category)
    score += Math.min(15, categories.size * 2)

    // 取整并限制范围
    score = Math.round(Math.max(80, Math.min(160, score)))

    // 更新配置
    updateConfig({ iqScore: score })

    // 确定等级
    let level = 'BELOW_AVERAGE'
    for (const [key, def] of Object.entries(IQ_LEVELS)) {
      if (score >= def.min) {
        level = key
        break
      }
    }

    return {
      score,
      level,
      levelLabel: IQ_LEVELS[level].label,
      description: IQ_LEVELS[level].description,
      breakdown: {
        base: 80,
        patterns: Math.min(20, qualityPatterns * 2),
        rules: Math.min(20, effectiveRules * 3),
        templates: Math.min(20, templates.length * 2),
        breadth: Math.min(15, categories.size * 2),
      },
      statistics: {
        totalPatterns: patterns.length,
        qualityPatterns,
        totalRules: rules.length,
        effectiveRules,
        totalTemplates: templates.length,
        categories: categories.size,
      },
    }
  } catch (e) {
    return {
      score: 100,
      level: 'AVERAGE',
      error: e?.message,
    }
  }
}

/**
 * 从云端模型交互中蒸馏知识
 */
export function distillFromCloudInteraction({
  userInput,
  cloudResponse,
  localResponse = null,
  qualityDifference = 0,
} = {}) {
  const results = []

  // 1. 分析云端回复的思考过程
  if (cloudResponse && cloudResponse.thinking) {
    const pattern = recordThinkingPattern({
      trigger: userInput.slice(0, 100),
      thinkingPath: cloudResponse.thinking,
      conclusion: cloudResponse.answer,
      quality: 5,
      sourceModel: 'cloud',
      metadata: { type: 'distilled' },
    })
    results.push({ type: 'pattern', ...pattern })
  }

  // 2. 提取决策逻辑
  if (cloudResponse && cloudResponse.decision) {
    const rule = recordDecisionRule({
      condition: userInput.slice(0, 100),
      decision: cloudResponse.decision,
      reasoning: cloudResponse.reasoning || '',
      quality: 5,
      category: extractCategory(userInput),
    })
    results.push({ type: 'rule', ...rule })
  }

  // 3. 提取回复结构
  if (cloudResponse && cloudResponse.structure) {
    const template = recordResponseTemplate({
      type: extractCategory(userInput),
      structure: cloudResponse.structure,
      style: cloudResponse.style || 'professional',
      components: cloudResponse.components || [],
      useCases: [userInput.slice(0, 50)],
    })
    results.push({ type: 'template', ...template })
  }

  return {
    distilled: results.length > 0,
    items: results,
    qualityDifference,
  }
}

/**
 * 自我进化：从成功经验中学习
 */
export function selfEvolve({
  taskType,
  outcome,
  userFeedback = null,
  executionPath = [],
} = {}) {
  const learnings = []

  // 如果任务成功，提取成功模式
  if (outcome === 'success') {
    // 记录成功的思考路径
    if (executionPath.length > 0) {
      const pattern = recordThinkingPattern({
        trigger: taskType,
        thinkingPath: executionPath,
        conclusion: '任务成功完成',
        quality: 4,
        sourceModel: 'self-evolved',
        metadata: { type: 'success_pattern' },
      })
      learnings.push({ type: 'success_pattern', ...pattern })
    }

    // 如果有用户正面反馈，记录规则
    if (userFeedback && isPositiveFeedback(userFeedback)) {
      const rule = recordDecisionRule({
        condition: taskType,
        decision: executionPath[executionPath.length - 1] || '继续当前策略',
        reasoning: '用户反馈正面，当前策略有效',
        quality: 5,
        category: taskType,
      })
      learnings.push({ type: 'validated_rule', ...rule })
    }
  }

  // 如果任务失败，记录失败教训
  if (outcome === 'failure') {
    const rule = recordDecisionRule({
      condition: taskType,
      decision: '避免重复此路径',
      reasoning: '任务失败，需要寻找替代方案',
      quality: 3,
      category: taskType,
    })
    learnings.push({ type: 'failure_lesson', ...rule })
  }

  // 更新智商分数
  const iqUpdate = calculateIQScore()

  return {
    evolved: learnings.length > 0,
    learnings,
    currentIQ: iqUpdate,
  }
}

// ========== 辅助函数 ==========

function readJsonlFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return []
    const content = fs.readFileSync(filePath, 'utf8')
    return content.trim().split('\n')
      .filter(Boolean)
      .map(line => {
        try { return JSON.parse(line) } catch { return null }
      })
      .filter(Boolean)
  } catch {
    return []
  }
}

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(getIntelligenceStore().config, 'utf8'))
  } catch {
    return { version: 1, iqScore: 100 }
  }
}

function updateConfig(updates) {
  try {
    const config = loadConfig()
    const newConfig = { ...config, ...updates, lastUpdated: Date.now() }
    fs.writeFileSync(getIntelligenceStore().config, JSON.stringify(newConfig, null, 2))
    return newConfig
  } catch {
    return config
  }
}

function getConfigValue(key, defaultValue) {
  const config = loadConfig()
  return config[key] !== undefined ? config[key] : defaultValue
}

function extractCategory(text) {
  const categories = {
    coding: ['代码', '编程', '函数', 'bug', '错误', '程序', 'script', 'code'],
    analysis: ['分析', '统计', '数据', '计算', '对比', '评估'],
    creative: ['创意', '设计', '文案', '写作', '内容', 'idea'],
    planning: ['计划', '安排', '日程', '任务', '项目', 'schedule'],
    research: ['研究', '搜索', '查找', '了解', '学习', 'research'],
    communication: ['解释', '说明', '介绍', '沟通', '对话'],
  }

  const lower = text.toLowerCase()
  for (const [cat, keywords] of Object.entries(categories)) {
    if (keywords.some(k => lower.includes(k.toLowerCase()))) {
      return cat
    }
  }
  return 'general'
}

function isPositiveFeedback(feedback) {
  const positiveWords = ['好', '棒', '对', '满意', '喜欢', '谢谢', '不错', '可以', '正确', 'perfect', 'good', 'great', 'excellent']
  const lower = feedback.toLowerCase()
  return positiveWords.some(w => lower.includes(w.toLowerCase()))
}

// ========== 导出 ==========

export const INTELLIGENCE_SYSTEM = {
  init: initIntelligenceSystem,
  recordPattern: recordThinkingPattern,
  recordRule: recordDecisionRule,
  recordTemplate: recordResponseTemplate,
  applyPattern: applyThinkingPattern,
  applyRule: applyDecisionRule,
  getTemplate: getResponseTemplate,
  buildEnhancedPrompt,
  calculateIQ: calculateIQScore,
  distillFromCloud: distillFromCloudInteraction,
  selfEvolve,
}

export {
  INTELLIGENCE_DIMENSIONS,
  IQ_LEVELS,
}
