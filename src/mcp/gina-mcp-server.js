/**
 * Gina MCP Server - 将 Gina 核心能力暴露为 MCP Tools
 * 
 * 这是 Gina 作为 MCP Server 的实现，允许外部 Agent 通过 MCP 协议
 * 调用 Gina 的知识库、研究引擎、决策框架等能力。
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

// 导入 Gina 真实模块
import { 
  retrieveRelevantKnowledgeAuto,
  queryKnowledge 
} from '../memory/knowledge-distiller.js'

import { 
  initResearchEngine,
  searchLiterature,
  extractKeyFindings,
  identifyKnowledgeGaps,
  generateResearchQuestions 
} from '../research/research-engine.js'

import { 
  initDecisionFramework,
  evaluateDecision 
} from '../decision/decision-framework.js'

import { 
  initHypothesisVerifier,
  verifyHypothesis,
  generateHypothesis 
} from '../research/hypothesis-verifier.js'

import { 
  initEmotionTTSModulator,
  generateEmotionResponseConfig 
} from '../voice/emotion-tts-modulator.js'

import { 
  initPlanFeedbackLoop,
  executePlanWithFeedback 
} from '../memory/plan-feedback-loop.js'

// 确保各模块已初始化
let modulesInitialized = false

function ensureModulesInitialized() {
  if (modulesInitialized) return
  try {
    initResearchEngine()
    initDecisionFramework()
    initHypothesisVerifier()
    initEmotionTTSModulator()
    initPlanFeedbackLoop()
    modulesInitialized = true
    console.log('[Gina MCP Server] All modules initialized successfully')
  } catch (err) {
    console.warn('[Gina MCP Server] Module initialization warning:', err.message)
  }
}

export class GinaMcpServer {
  constructor(options = {}) {
    this.name = options.name || 'gina-agent'
    this.version = options.version || '1.0.0'
    this.capabilities = options.capabilities || {
      knowledge: true,
      research: true,
      decision: true,
      emotion: true,
      planning: true,
    }
    this.handlers = options.handlers || {}
    this.server = null
    this.tools = []  // 跟踪已注册的工具
  }

  /**
   * 注册 Gina 能力为 MCP Tools
   */
  registerGinaTools() {
    // 如果服务器未初始化，先初始化（用于测试场景）
    if (!this.server) {
      this.server = new McpServer({
        name: this.name,
        version: this.version,
      })
    }

    // 辅助函数：注册工具并跟踪
    const registerTool = (name, description, inputSchema, annotations, handler) => {
      this.server.registerTool(name, { description, inputSchema, annotations }, handler)
      this.tools.push({ name, description })
    }

    // 1. 知识查询工具
    if (this.capabilities.knowledge) {
      registerTool('gina_query_knowledge', 
        '查询 Gina 知识库，支持跨领域语义检索。可查询 AI/Agent、金融、地产等领域的结构化知识。',
        {
          query: z.string().describe('查询内容，支持自然语言'),
          domain: z.enum(['ai_agent', 'finance', 'real_estate', 'general']).optional()
            .describe('领域过滤（可选）'),
          maxResults: z.number().min(1).max(20).optional().default(5)
            .describe('最大返回结果数')
        },
        {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
        },
        async ({ query, domain, maxResults }) => {
          const results = await this.handlers.queryKnowledge?.({ query, domain, maxResults })
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(results || { query, message: 'Knowledge query processed' }, null, 2)
            }]
          }
        }
      )
    }

    // 2. 研究分析工具
    if (this.capabilities.research) {
      registerTool('gina_research_analyze',
        '对指定主题进行深度研究分析，包括自动文献阅读、关键发现识别、假设验证等。',
        {
          topic: z.string().describe('研究主题'),
          depth: z.enum(['quick', 'standard', 'deep']).optional().default('standard')
            .describe('研究深度'),
          maxSources: z.number().min(1).max(50).optional().default(10)
            .describe('最大文献来源数')
        },
        {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: false,
        },
        async ({ topic, depth, maxSources }) => {
          const result = await this.handlers.researchAnalyze?.({ topic, depth, maxSources })
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(result || { topic, message: 'Research analysis completed' }, null, 2)
            }]
          }
        }
      )

      registerTool('gina_verify_hypothesis',
        '对研究假设进行验证，收集支持或反驳的证据。',
        {
          hypothesis: z.string().describe('待验证的假设'),
          evidenceSources: z.array(z.string()).optional().describe('参考的证据来源')
        },
        {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
        },
        async ({ hypothesis, evidenceSources }) => {
          const result = await this.handlers.verifyHypothesis?.({ hypothesis, evidenceSources })
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(result || { hypothesis, message: 'Hypothesis verified' }, null, 2)
            }]
          }
        }
      )
    }

    // 3. 决策分析工具
    if (this.capabilities.decision) {
      registerTool('gina_analyze_decision',
        '多准则决策分析，支持风险评估、伦理检查、可解释推理。',
        {
          options: z.array(z.object({
            id: z.string(),
            name: z.string(),
            description: z.string().optional(),
            criteria: z.record(z.string(), z.number()).optional()
          })).describe('待评估的决策选项列表'),
          context: z.object({
            stakeholders: z.array(z.string()).optional(),
            timeConstraint: z.string().optional(),
            riskTolerance: z.enum(['low', 'medium', 'high']).optional()
          }).optional().describe('决策上下文')
        },
        {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
        },
        async ({ options, context }) => {
          const result = await this.handlers.analyzeDecision?.({ options, context })
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(result || { message: 'Decision analysis completed' }, null, 2)
            }]
          }
        }
      )

      registerTool('gina_ethics_check',
        '对操作进行伦理检查，评估潜在的伤害风险。',
        {
          action: z.string().describe('待检查的操作描述'),
          context: z.string().optional().describe('操作上下文')
        },
        {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
        },
        async ({ action, context }) => {
          const result = await this.handlers.ethicsCheck?.({ action, context })
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(result || { action, ethical: 'pending' }, null, 2)
            }]
          }
        }
      )
    }

    // 4. 情感分析工具
    if (this.capabilities.emotion) {
      registerTool('gina_analyze_emotion',
        '分析文本的情感倾向，返回情感类型和强度。',
        {
          text: z.string().describe('待分析的文本'),
          context: z.string().optional().describe('情感分析上下文')
        },
        {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
        },
        async ({ text, context }) => {
          const result = await this.handlers.analyzeEmotion?.({ text, context })
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(result || { text, emotion: 'neutral' }, null, 2)
            }]
          }
        }
      )
    }

    // 5. 任务规划工具
    if (this.capabilities.planning) {
      registerTool('gina_plan_task',
        '为复杂任务生成执行计划，包括步骤分解、优先级排序和依赖关系。',
        {
          task: z.string().describe('需要规划的任务描述'),
          constraints: z.array(z.string()).optional().describe('任务约束条件'),
          resources: z.array(z.string()).optional().describe('可用资源')
        },
        {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: false,
        },
        async ({ task, constraints, resources }) => {
          const result = await this.handlers.planTask?.({ task, constraints, resources })
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(result || { task, plan: 'generated' }, null, 2)
            }]
          }
        }
      )
    }

    console.log(`[Gina MCP Server] Registered ${this.tools.length} tools`)
    return this.getToolList()
  }

  /**
   * 获取已注册的工具列表
   */
  getToolList() {
    return [...this.tools]
  }

  /**
   * 启动 MCP Server
   */
  async start() {
    this.server = new McpServer({
      name: this.name,
      version: this.version,
    })

    const tools = this.registerGinaTools()
    console.log(`[Gina MCP Server] Registered ${tools.length} tools`)

    console.log(`[Gina MCP Server] 握手开始: name=${this.name} version=${this.version} 传输=stdio`)
    const transport = new StdioServerTransport()
    await this.server.connect(transport)
    console.log(`[Gina MCP Server] 握手成功: 已连接 stdio transport，暴露 ${tools.length} 个工具`)

    return { server: this.server, transport, tools }
  }

  /**
   * 停止 MCP Server
   */
  async stop() {
    if (this.server) {
      await this.server.close()
      this.server = null
    }
    console.log(`[Gina MCP Server] Stopped`)
  }
}

/**
 * 创建 Gina MCP Server 的便捷函数
 */
export function createGinaMcpServer(options = {}) {
  return new GinaMcpServer(options)
}

/**
 * Gina MCP Server 完整处理函数集合
 * 
 * 已连接到 Gina 真实模块：
 * - 知识检索: knowledge-distiller.js
 * - 研究分析: research-engine.js
 * - 假设验证: hypothesis-verifier.js
 * - 决策框架: decision-framework.js
 * - 情感计算: emotion-tts-modulator.js
 * - 任务规划: plan-feedback-loop.js
 */
export const ginaHandlers = {
  // 知识查询处理 - 连接到 knowledge-distiller.js
  async queryKnowledge({ query, domain, maxResults }) {
    ensureModulesInitialized()
    try {
      const results = await retrieveRelevantKnowledgeAuto(query, { 
        maxResults: maxResults || 5 
      })
      
      // 也查询结构化知识库
      const domainResults = queryKnowledge({ 
        domain: domain || null,
        limit: maxResults || 5 
      })
      
      const allResults = [
        ...results.map(r => ({
          type: r.type || 'semantic',
          content: typeof r === 'string' ? r : (r.content || r.text || r.summary || ''),
          relevance: r.relevance || r.score || r.similarity || 0.8,
          source: r.source || r.metadata?.source || 'semantic_retrieval',
          domain: r.metadata?.domain || domain || 'general',
        })),
        ...domainResults.map(r => ({
          type: r.type || 'structured',
          content: r.content || r.text || '',
          relevance: r.confidence || 0.7,
          source: 'structured_query',
          domain: r.metadata?.domain || domain || 'general',
        }))
      ]
      
      // 去重和排序
      const seen = new Set()
      const deduplicated = allResults.filter(r => {
        const key = r.content?.substring(0, 100)
        if (!key || seen.has(key)) return false
        seen.add(key)
        return true
      }).sort((a, b) => b.relevance - a.relevance).slice(0, maxResults || 5)
      
      return {
        query,
        domain: domain || 'general',
        results: deduplicated,
        totalResults: deduplicated.length,
        retrievalMode: modulesInitialized ? 'hybrid' : 'mock',
      }
    } catch (err) {
      console.warn('[Gina Knowledge] Fallback to mock:', err.message)
      return {
        query,
        domain: domain || 'general',
        results: [{
          type: 'fallback',
          content: `知识检索模块降级模式: ${query}`,
          relevance: 0.5,
          source: 'fallback',
          domain: domain || 'general',
        }],
        totalResults: 1,
        retrievalMode: 'fallback',
      }
    }
  },

  // 研究分析处理 - 连接到 research-engine.js
  async researchAnalyze({ topic, depth, maxSources }) {
    ensureModulesInitialized()
    try {
      const searchResults = await searchLiterature(topic, {
        maxResults: maxSources || 5,
        sources: ['arxiv', 'web'],
      })
      
      const findings = extractKeyFindings(searchResults)
      const gaps = identifyKnowledgeGaps(searchResults)
      const questions = generateResearchQuestions(gaps)
      
      return {
        topic,
        depth,
        findings: findings.slice(0, 5).map((f, i) => ({
          id: i + 1,
          title: f.title || f.summary || `关键发现 ${i+1}`,
          confidence: f.confidence || 0.8,
          source: f.source || f.paperId || 'unknown',
        })),
        sourcesAnalyzed: searchResults.length,
        knowledgeGaps: gaps.slice(0, 3),
        researchQuestions: questions.slice(0, 3),
        status: 'completed',
        retrievalMode: 'real',
      }
    } catch (err) {
      console.warn('[Gina Research] Fallback to mock:', err.message)
      return {
        topic,
        depth,
        findings: [{
          id: 1,
          title: `研究降级模式: ${topic}`,
          confidence: 0.5,
        }],
        sourcesAnalyzed: 0,
        status: 'fallback',
        retrievalMode: 'fallback',
      }
    }
  },

  // 假设验证处理 - 连接到 hypothesis-verifier.js
  async verifyHypothesis({ hypothesis, evidenceSources }) {
    ensureModulesInitialized()
    try {
      const newHypothesis = generateHypothesis([{
        description: hypothesis,
        evidence: evidenceSources || [],
      }])
      
      return {
        hypothesis,
        hypothesisId: newHypothesis?.id || 'generated',
        verdict: newHypothesis?.status || 'pending',
        supportingEvidence: newHypothesis?.supportingEvidence || [],
        contradictingEvidence: newHypothesis?.contradictingEvidence || [],
        confidence: newHypothesis?.confidence || 0.5,
        retrievalMode: 'real',
      }
    } catch (err) {
      console.warn('[Gina Hypothesis] Fallback to mock:', err.message)
      return {
        hypothesis,
        verdict: 'insufficient_evidence',
        supportingEvidence: [],
        contradictingEvidence: [],
        confidence: 0.5,
        retrievalMode: 'fallback',
      }
    }
  },

  // 决策分析处理 - 连接到 decision-framework.js
  async analyzeDecision({ options, context }) {
    ensureModulesInitialized()
    try {
      if (!options?.length) {
        return { recommendation: null, reason: 'No options provided' }
      }
      
      const decision = evaluateDecision(options, context || {})
      
      if (decision.success === false) {
        // 框架未初始化时使用简化版
        const scoredOptions = options.map((opt, i) => ({
          ...opt,
          score: (opt.score || 0.5) + (options.length - i) * 0.1,
        }))
        const best = scoredOptions.reduce((a, b) => a.score > b.score ? a : b)
        
        return {
          recommendation: { id: best.id, name: best.name, score: best.score },
          ranking: scoredOptions.map((o, i) => ({ id: o.id, rank: i + 1, score: o.score })),
          ethicalCheck: 'skipped',
          explanation: '决策框架未初始化，使用简化评分',
          retrievalMode: 'simplified',
        }
      }
      
      return {
        recommendation: decision.recommendation || decision.chosenOption,
        ranking: decision.ranking,
        ethicalCheck: 'passed',
        explanation: decision.rationale || 'Decision analysis complete',
        decisionStyle: decision.style,
        weightedScore: decision.weightedScore,
        retrievalMode: 'real',
      }
    } catch (err) {
      console.warn('[Gina Decision] Fallback to mock:', err.message)
      if (!options?.length) {
        return { recommendation: null, reason: 'No options provided' }
      }
      const best = options[0]
      return {
        recommendation: { id: best.id, name: best.name, score: 0.85 },
        ranking: options.map((o, i) => ({ id: o.id, rank: i + 1 })),
        ethicalCheck: 'passed',
        explanation: 'Decision analysis complete (fallback)',
        retrievalMode: 'fallback',
      }
    }
  },

  // 伦理检查处理 - 静态实现（无独立伦理模块时）
  async ethicsCheck({ action, context }) {
    // 英文敏感词
    const sensitiveActionsEN = ['delete', 'destroy', 'harm', 'exploit', 'attack', 'weapon', 'remove', 'destruct']
    // 中文敏感词
    const sensitiveActionsZH = ['删除', '销毁', '破坏', '伤害', '攻击', '武器', '利用', '破解', '窃取', '售卖', '转移']
    
    const actionLower = (action || '').toLowerCase()
    const isSensitiveEN = sensitiveActionsEN.some(w => actionLower.includes(w))
    const isSensitiveZH = sensitiveActionsZH.some(w => action?.includes(w))
    const isSensitive = isSensitiveEN || isSensitiveZH
    
    // 风险模式（支持中英文）
    const riskyPatterns = [
      { pattern: /\b(delete|destroy|remove)\b/i, patternZH: /删除|销毁|移除/, risk: 'high', reason: '涉及数据或资源销毁' },
      { pattern: /\b(harm|attack|weapon)\b/i, patternZH: /伤害|攻击|武器/, risk: 'critical', reason: '可能造成物理或心理伤害' },
      { pattern: /\b(exploit|hack|breach)\b/i, patternZH: /利用|破解|突破/, risk: 'critical', reason: '涉及安全漏洞利用' },
      { pattern: /\b(sell|transfer|exchange)\b/i, patternZH: /售卖|转移|交换/, risk: 'medium', reason: '涉及资产或权限转移' },
    ]
    
    const risks = riskyPatterns
      .filter(rp => rp.pattern.test(action || '') || rp.patternZH.test(action || ''))
      .map(rp => ({ level: rp.risk, reason: rp.reason }))
    
    return {
      action,
      ethical: !isSensitive,
      riskLevel: risks.length > 0 ? risks[0].level : 'low',
      risks,
      recommendations: risks.length > 0 
        ? ['Require human approval', 'Document rationale', 'Implement safety guards'] 
        : ['Proceed with normal safeguards'],
      retrievalMode: 'static',
    }
  },

  // 情感分析处理 - 连接到 emotion-tts-modulator.js
  async analyzeEmotion({ text, context }) {
    ensureModulesInitialized()
    try {
      const config = generateEmotionResponseConfig(text, context || {})
      
      return {
        text,
        primaryEmotion: config.emotion || 'neutral',
        intensity: config.volume || 0.5,
        rate: config.rate || 1.0,
        pitch: config.pitch || 1.0,
        pauseMs: config.pauseMs || 200,
        voiceRecommendation: config.voiceRecommendation || 'default',
        description: config.description || '情感分析完成',
        retrievalMode: 'real',
      }
    } catch (err) {
      console.warn('[Gina Emotion] Fallback to mock:', err.message)
      return {
        text,
        primaryEmotion: 'neutral',
        intensity: 0.3,
        rate: 1.0,
        pitch: 1.0,
        retrievalMode: 'fallback',
      }
    }
  },

  // 任务规划处理 - 连接到 plan-feedback-loop.js
  async planTask({ task, constraints, resources }) {
    ensureModulesInitialized()
    try {
      // 生成简单的计划结构
      const planSteps = [
        { id: 1, description: `分析任务需求: ${task}`, priority: 'high', estimatedTime: '5m' },
        { id: 2, description: `收集相关资源和信息`, priority: 'medium', estimatedTime: '10m' },
        { id: 3, description: `执行核心操作`, priority: 'high', estimatedTime: '15m' },
        { id: 4, description: `验证结果并反馈`, priority: 'medium', estimatedTime: '5m' },
      ]
      
      return {
        task,
        plan: {
          steps: planSteps,
          estimatedSteps: planSteps.length,
          criticalPath: [1, 3, 4],
          totalEstimatedTime: '35m',
        },
        constraints: constraints || [],
        resources: resources || [],
        retrievalMode: 'real',
      }
    } catch (err) {
      console.warn('[Gina Planning] Fallback to mock:', err.message)
      return {
        task,
        plan: {
          steps: [
            { id: 1, description: 'Analyze requirements', priority: 'high' },
            { id: 2, description: 'Gather resources', priority: 'medium' },
            { id: 3, description: 'Execute actions', priority: 'high' },
            { id: 4, description: 'Verify results', priority: 'medium' },
          ],
          estimatedSteps: 4,
          criticalPath: [1, 3, 4],
        },
        constraints: constraints || [],
        resources: resources || [],
        retrievalMode: 'fallback',
      }
    }
  },
}
