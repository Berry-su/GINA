/**
 * experience-collector.js — 经验积累引擎
 *
 * 核心功能：从每次交互中提取结构化经验，形成可学习的数据
 * 设计原则：不依赖 LLM，使用规则+统计方法，确保本地模型也能运行
 *
 * 积累的经验类型：
 *   1. 成功经验：哪些操作/回应有效
 *   2. 失败经验：哪些操作/回应失败
 *   3. 效率经验：工具调用耗时、资源消耗
 *   4. 用户反馈：用户的正负向反馈
 *   5. 环境经验：时间、场景、上下文
 */

import fs from 'fs'
import path from 'path'

const EXPERIENCE_DIR = process.env.GINA_HOME
  ? path.join(process.env.GINA_HOME, 'experiences')
  : path.join(process.env.HOME || '.', '.gina', 'experiences')

const EXPERIENCE_FILE = path.join(EXPERIENCE_DIR, 'collected.jsonl')
const INDEX_FILE = path.join(EXPERIENCE_DIR, 'index.json')

// 经验类型定义
const EXPERIENCE_TYPES = {
  SUCCESS: 'success',
  FAILURE: 'failure',
  EFFICIENCY: 'efficiency',
  USER_FEEDBACK: 'user_feedback',
  PATTERN: 'pattern',
}

// 经验严重程度
const SEVERITY_LEVELS = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical',
}

/**
 * 初始化经验存储
 */
function ensureStorage() {
  try {
    if (!fs.existsSync(EXPERIENCE_DIR)) {
      fs.mkdirSync(EXPERIENCE_DIR, { recursive: true })
    }
    if (!fs.existsSync(EXPERIENCE_FILE)) {
      fs.writeFileSync(EXPERIENCE_FILE, '', 'utf8')
    }
    if (!fs.existsSync(INDEX_FILE)) {
      fs.writeFileSync(INDEX_FILE, JSON.stringify({
        total: 0,
        byType: {},
        bySeverity: {},
        lastUpdated: null,
      }, null, 2), 'utf8')
    }
  } catch (e) {
    console.error('[经验积累] 存储初始化失败:', e?.message)
  }
}

/**
 * 记录一次成功经验
 */
export function recordSuccessExperience({
  action,
  result,
  context = {},
  userResponse = null,
  metadata = {},
} = {}) {
  ensureStorage()

  const experience = {
    id: `exp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: EXPERIENCE_TYPES.SUCCESS,
    timestamp: Date.now(),
    action: action || 'unknown',
    result: result || 'success',
    context: {
      toolName: context.toolName || null,
      duration_ms: context.duration_ms || 0,
      messageLength: context.messageLength || 0,
      conversationStage: context.conversationStage || 'unknown',
    },
    userFeedback: userResponse ? {
      sentiment: analyzeSentiment(userResponse),
      content: String(userResponse).slice(0, 200),
    } : null,
    metadata: {
      importance: metadata.importance || calculateImportance(result, context),
      confidence: metadata.confidence || 0.8,
      tags: metadata.tags || [],
    },
  }

  return writeExperience(experience)
}

/**
 * 记录一次失败经验
 */
export function recordFailureExperience({
  action,
  error,
  context = {},
  recovery = null,
  metadata = {},
} = {}) {
  ensureStorage()

  const severity = classifyErrorSeverity(error)

  const experience = {
    id: `exp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: EXPERIENCE_TYPES.FAILURE,
    timestamp: Date.now(),
    action: action || 'unknown',
    error: {
      message: error?.message || String(error) || 'unknown error',
      code: error?.code || null,
      stack: error?.stack ? String(error.stack).slice(0, 500) : null,
      category: classifyErrorType(error),
    },
    context: {
      toolName: context.toolName || null,
      duration_ms: context.duration_ms || 0,
      attemptCount: context.attemptCount || 1,
      conversationStage: context.conversationStage || 'unknown',
    },
    recovery: recovery ? {
      method: recovery.method,
      success: recovery.success,
      time_ms: recovery.time_ms || 0,
    } : null,
    severity,
    metadata: {
      importance: metadata.importance || (severity === SEVERITY_LEVELS.HIGH ? 0.9 : 0.5),
      learnable: detectLearnableError(error),
      tags: metadata.tags || [],
    },
  }

  return writeExperience(experience)
}

/**
 * 记录一次效率经验
 */
export function recordEfficiencyExperience({
  toolName,
  duration_ms,
  success,
  resourceUsage = {},
  context = {},
} = {}) {
  ensureStorage()

  const experience = {
    id: `exp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: EXPERIENCE_TYPES.EFFICIENCY,
    timestamp: Date.now(),
    toolName: toolName || 'unknown',
    duration_ms: duration_ms || 0,
    success: !!success,
    resourceUsage: {
      cpu_percent: resourceUsage.cpu_percent || 0,
      memory_mb: resourceUsage.memory_mb || 0,
      token_count: resourceUsage.token_count || 0,
    },
    context: {
      batchSize: context.batchSize || 1,
      parallel: context.parallel || false,
      conversationStage: context.conversationStage || 'unknown',
    },
    metadata: {
      efficiency: calculateEfficiency(duration_ms, success),
      tags: ['efficiency', toolName],
    },
  }

  return writeExperience(experience)
}

/**
 * 记录用户反馈经验
 */
export function recordUserFeedbackExperience({
  feedback,
  context = {},
  source = 'direct',
} = {}) {
  ensureStorage()

  const sentiment = analyzeSentiment(feedback)

  const experience = {
    id: `exp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: EXPERIENCE_TYPES.USER_FEEDBACK,
    timestamp: Date.now(),
    feedback: {
      raw: String(feedback).slice(0, 500),
      sentiment,
      intensity: calculateIntensity(feedback),
      topics: extractTopics(feedback),
    },
    context: {
      relatedAction: context.relatedAction || null,
      conversationId: context.conversationId || null,
      turnCount: context.turnCount || 0,
    },
    source,
    metadata: {
      importance: sentiment === 'negative' ? 0.9 : 0.6,
      tags: ['user_feedback', sentiment],
    },
  }

  return writeExperience(experience)
}

/**
 * 记录模式发现经验
 */
export function recordPatternExperience({
  pattern,
  data = {},
  confidence = 0.8,
  context = {},
} = {}) {
  ensureStorage()

  const experience = {
    id: `exp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: EXPERIENCE_TYPES.PATTERN,
    timestamp: Date.now(),
    pattern: {
      name: pattern.name || 'unnamed_pattern',
      description: pattern.description || '',
      category: pattern.category || 'general',
      confidence,
    },
    data: {
      sampleSize: data.sampleSize || 0,
      frequency: data.frequency || 0,
      examples: (data.examples || []).slice(0, 5),
    },
    context,
    metadata: {
      importance: confidence,
      tags: ['pattern', pattern.category],
    },
  }

  return writeExperience(experience)
}

/**
 * 批量记录经验（从一次对话中提取）
 */
export function recordDialogueExperiences({
  dialogueId,
  turns = [],
  outcome = {},
  context = {},
} = {}) {
  ensureStorage()

  const experiences = []
  const timestamp = Date.now()

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i]
    if (!turn) continue

    // 分析每个轮次
    if (turn.toolCalls && turn.toolCalls.length > 0) {
      for (const toolCall of turn.toolCalls) {
        experiences.push(recordEfficiencyExperience({
          toolName: toolCall.name,
          duration_ms: toolCall.duration_ms || 0,
          success: toolCall.success !== false,
          resourceUsage: toolCall.resources || {},
          context: {
            batchSize: 1,
            conversationStage: i < turns.length / 2 ? 'early' : 'late',
          },
        }))

        if (toolCall.error) {
          experiences.push(recordFailureExperience({
            action: `tool_call:${toolCall.name}`,
            error: toolCall.error,
            context: {
              toolName: toolCall.name,
              duration_ms: toolCall.duration_ms || 0,
              attemptCount: toolCall.attemptCount || 1,
            },
          }))
        }
      }
    }

    if (turn.userMessage) {
      const sentiment = analyzeSentiment(turn.userMessage)
      if (sentiment === 'negative' || sentiment === 'positive') {
        experiences.push(recordUserFeedbackExperience({
          feedback: turn.userMessage,
          context: {
            conversationId: dialogueId,
            turnCount: i,
          },
        }))
      }
    }
  }

  // 记录整体结果
  if (outcome.success) {
    experiences.push(recordSuccessExperience({
      action: 'dialogue_complete',
      result: outcome.result || 'completed',
      context: {
        duration_ms: outcome.duration_ms || 0,
        messageLength: turns.length,
        conversationStage: 'complete',
      },
      userResponse: outcome.userResponse || null,
    }))
  } else if (outcome.failure) {
    experiences.push(recordFailureExperience({
      action: 'dialogue_complete',
      error: outcome.error,
      context: {
        toolName: null,
        duration_ms: outcome.duration_ms || 0,
        attemptCount: 1,
      },
    }))
  }

  return {
    dialogueId,
    timestamp,
    experiencesCount: experiences.length,
    experiences,
  }
}

/**
 * 查询经验库
 */
export function queryExperiences({
  type = null,
  severity = null,
  toolName = null,
  limit = 20,
  sinceTimestamp = null,
  tags = [],
} = {}) {
  ensureStorage()

  let results = []
  try {
    const content = fs.readFileSync(EXPERIENCE_FILE, 'utf8')
    const lines = content.trim().split('\n').filter(Boolean)

    for (const line of lines) {
      try {
        const exp = JSON.parse(line)
        if (type && exp.type !== type) continue
        if (severity && exp.severity !== severity) continue
        if (toolName && exp.toolName !== toolName) continue
        if (sinceTimestamp && exp.timestamp < sinceTimestamp) continue
        if (tags.length > 0 && !tags.some(t => exp.metadata?.tags?.includes(t))) continue
        results.push(exp)
      } catch {}
    }
  } catch (e) {
    console.error('[经验积累] 查询失败:', e?.message)
  }

  return results.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit)
}

/**
 * 获取经验统计
 */
export function getExperienceStats() {
  ensureStorage()

  try {
    const index = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'))
    return {
      total: index.total || 0,
      byType: index.byType || {},
      bySeverity: index.bySeverity || {},
      lastUpdated: index.lastUpdated,
      storagePath: EXPERIENCE_FILE,
    }
  } catch (e) {
    return {
      total: 0,
      byType: {},
      bySeverity: {},
      error: e?.message,
    }
  }
}

/**
 * 获取经验中的学习点（可用于知识蒸馏）
 */
export function extractLearningPoints({
  limit = 50,
  minConfidence = 0.6,
} = {}) {
  const allExperiences = queryExperiences({ limit: limit * 2 })

  const learningPoints = []

  for (const exp of allExperiences) {
    if (exp.metadata?.confidence < minConfidence) continue

    // 从失败经验中提取教训
    if (exp.type === EXPERIENCE_TYPES.FAILURE) {
      learningPoints.push({
        sourceId: exp.id,
        sourceType: 'failure',
        insight: `操作 "${exp.action}" 失败，原因：${exp.error?.message || 'unknown'}`,
        context: exp.error?.category || 'unknown',
        importance: exp.metadata?.importance || 0.5,
        timestamp: exp.timestamp,
      })
    }

    // 从成功经验中提取模式
    if (exp.type === EXPERIENCE_TYPES.SUCCESS) {
      learningPoints.push({
        sourceId: exp.id,
        sourceType: 'success',
        insight: `操作 "${exp.action}" 成功，结果：${exp.result}`,
        context: 'success_pattern',
        importance: exp.metadata?.importance || 0.5,
        timestamp: exp.timestamp,
      })
    }

    // 从用户反馈中提取偏好
    if (exp.type === EXPERIENCE_TYPES.USER_FEEDBACK) {
      learningPoints.push({
        sourceId: exp.id,
        sourceType: 'user_feedback',
        insight: `用户反馈 (${exp.feedback?.sentiment}): ${exp.feedback?.content?.slice(0, 100)}`,
        context: exp.feedback?.topics?.[0] || 'user_preference',
        importance: exp.metadata?.importance || 0.6,
        timestamp: exp.timestamp,
      })
    }

    // 从效率经验中提取优化点
    if (exp.type === EXPERIENCE_TYPES.EFFICIENCY) {
      const duration = exp.duration_ms || 0
      if (duration > 5000) {
        learningPoints.push({
          sourceId: exp.id,
          sourceType: 'efficiency',
          insight: `工具 "${exp.toolName}" 耗时 ${duration}ms，可能需要优化`,
          context: 'performance',
          importance: 0.7,
          timestamp: exp.timestamp,
        })
      }
    }
  }

  return learningPoints.sort((a, b) => b.importance - a.importance).slice(0, limit)
}

// ========== 内部工具函数 ==========

function writeExperience(experience) {
  try {
    fs.appendFileSync(EXPERIENCE_FILE, JSON.stringify(experience) + '\n', 'utf8')
    updateIndex(experience)
    return { success: true, id: experience.id }
  } catch (e) {
    console.error('[经验积累] 写入失败:', e?.message)
    return { success: false, error: e?.message }
  }
}

function updateIndex(experience) {
  try {
    let index = { total: 0, byType: {}, bySeverity: {}, lastUpdated: null }
    if (fs.existsSync(INDEX_FILE)) {
      index = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'))
    }

    index.total = (index.total || 0) + 1
    index.byType[experience.type] = (index.byType[experience.type] || 0) + 1
    if (experience.severity) {
      index.bySeverity[experience.severity] = (index.bySeverity[experience.severity] || 0) + 1
    }
    index.lastUpdated = new Date().toISOString()

    fs.writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2), 'utf8')
  } catch (e) {
    console.error('[经验积累] 索引更新失败:', e?.message)
  }
}

function analyzeSentiment(text) {
  if (!text) return 'neutral'
  const negativeWords = ['不行', '不好', '失败', '错了', '讨厌', '生气', '失望', '差', '烂', '讨厌', '混蛋', '笨']
  const positiveWords = ['好', '棒', '对', '喜欢', '满意', '感谢', '赞', '优秀', '完美', '聪明', '厉害']

  let negScore = 0
  let posScore = 0

  for (const word of negativeWords) {
    if (text.includes(word)) negScore++
  }
  for (const word of positiveWords) {
    if (text.includes(word)) posScore++
  }

  if (negScore > posScore) return 'negative'
  if (posScore > negScore) return 'positive'
  return 'neutral'
}

function calculateImportance(result, context) {
  if (!result || typeof result !== 'string') return 0.5
  if (result.includes('success') || result.includes('完成')) return 0.8
  if (result.includes('failure') || result.includes('失败')) return 0.9
  return 0.5
}

function classifyErrorSeverity(error) {
  if (!error) return SEVERITY_LEVELS.LOW
  const msg = (error.message || String(error)).toLowerCase()

  if (msg.includes('critical') || msg.includes('fatal') || msg.includes('crash')) {
    return SEVERITY_LEVELS.CRITICAL
  }
  if (msg.includes('timeout') || msg.includes('connection') || msg.includes('network')) {
    return SEVERITY_LEVELS.HIGH
  }
  if (msg.includes('permission') || msg.includes('access denied')) {
    return SEVERITY_LEVELS.HIGH
  }
  if (msg.includes('invalid') || msg.includes('parse') || msg.includes('format')) {
    return SEVERITY_LEVELS.MEDIUM
  }
  return SEVERITY_LEVELS.LOW
}

function classifyErrorType(error) {
  if (!error) return 'unknown'
  const msg = (error.message || String(error)).toLowerCase()

  if (msg.includes('timeout') || msg.includes('etimedout')) return 'timeout'
  if (msg.includes('connection') || msg.includes('econnrefused')) return 'network'
  if (msg.includes('permission') || msg.includes('eacces')) return 'permission'
  if (msg.includes('memory') || msg.includes('oom')) return 'resource'
  if (msg.includes('not found') || msg.includes('enoent')) return 'missing_resource'
  if (msg.includes('invalid') || msg.includes('econnreset')) return 'validation'
  return 'unknown'
}

function detectLearnableError(error) {
  if (!error) return false
  const msg = (error.message || String(error)).toLowerCase()

  // 可学习的错误：不是环境问题，而是逻辑问题
  const learnablePatterns = [
    'invalid', 'wrong', 'expected', 'should', 'must',
    'not allowed', 'cannot', 'undefined', 'null',
  ]

  return learnablePatterns.some(p => msg.includes(p))
}

function calculateEfficiency(duration_ms, success) {
  if (!success) return 0
  if (duration_ms < 500) return 1.0
  if (duration_ms < 2000) return 0.8
  if (duration_ms < 5000) return 0.5
  return 0.2
}

function calculateIntensity(text) {
  if (!text) return 0.5
  const caps = (text.match(/[!！]/g) || []).length
  const caps2 = (text.match(/[?？]/g) || []).length
  const lengthFactor = Math.min(text.length / 100, 1)
  return Math.min(1, 0.3 + (caps * 0.15) + (caps2 * 0.1) + (lengthFactor * 0.3))
}

function extractTopics(text) {
  if (!text) return []
  const topics = []
  const topicKeywords = {
    'performance': ['慢', '卡', '快', '速度', '效率'],
    'accuracy': ['错', '对', '准确', '正确', '误差'],
    'helpfulness': ['帮助', '有用', '没用', '无用', '有用没用'],
    'tone': ['语气', '态度', '温柔', '生硬', '友好'],
    'feature': ['功能', '功能', '能力', '不会', '不能'],
    'knowledge': ['知识', '知道', '不懂', '了解', '解释'],
    'personality': ['性格', '幽默', '无聊', '有趣', '无聊'],
  }

  for (const [topic, keywords] of Object.entries(topicKeywords)) {
    if (keywords.some(k => text.includes(k))) {
      topics.push(topic)
    }
  }

  return topics.slice(0, 3)
}

export {
  EXPERIENCE_TYPES,
  SEVERITY_LEVELS,
  EXPERIENCE_DIR,
  EXPERIENCE_FILE,
  INDEX_FILE,
}
