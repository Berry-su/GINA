// predictor.js — 下一步意图预判引擎
//
// 定位：GINA 不应只被动回答。她应能基于对话历史 + focus stack + 时间模式
// + 外部情绪 + 知识缺口，预判老板的"下一步意图"。
//
// 输入（5 大信号源）:
//   1. conversationHistory  最近 N 条对话
//   2. focusContext         当前 focus stack（主题+关键词）
//   3. timePattern          用户活跃时段（什么时候活跃）
//   4. externalEmotion      外部情绪（emotion-engine 输出的 12 维 + valence）
//   5. knowledgeGaps        最近搜过但没答案的关键词
//
// 输出: top 3 候选意图（每条带 confidence + 触发信号）
//
// 关键设计:
//   - **不直接发消息**：只输出"预判结果"，由 suggester 决定是否开口
//   - **不读 GINA 内部情绪**（emotion 是 meta-info 隔离，ADR-002）
//   - 预判错时不重复（suggestion dedup + cooldown）

import { keywords } from './keywords.js'

// ─── 常量 ───────────────────────────────────────────────────

const MAX_HISTORY = 30
const DEFAULT_TOP_K = 3
const MAX_OUTPUT_INTENTS = 5
const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000  // 24h 内对话为"近期"

// 意图类型（预定义的分类）
export const INTENT_TYPES = Object.freeze({
  CONTINUE_TOPIC: 'continue_topic',          // 继续当前话题
  FOLLOW_UP_QUESTION: 'follow_up_question',  // 追问细节
  SWITCH_TOPIC: 'switch_topic',              // 切换话题
  TASK_EXEC: 'task_execution',               // 任务执行（"帮我做 X"）
  INFORMATION_LOOKUP: 'information_lookup',  // 查信息
  REFLECTION: 'reflection',                  // 反思/复盘
  STATUS_CHECK: 'status_check',              // 状态查询
  CREATIVE: 'creative',                      // 创意/想法
  UNKNOWN: 'unknown',
})

// 触发信号权重
const SIGNAL_WEIGHTS = {
  recentMessage: 0.40,        // 最近消息匹配
  recentQuestion: 0.30,       // 最近问句
  focusStackMatch: 0.40,      // focus stack 关键词匹配
  timePatternMatch: 0.10,     // 时间模式
  emotionContext: 0.10,       // 情绪上下文
  knowledgeGapMatch: 0.30,    // 知识缺口
  historyPattern: 0.10,       // 历史模式
}

// ─── 内部工具 ───────────────────────────────────────────────

function clamp01(x) {
  if (typeof x !== 'number' || !Number.isFinite(x)) return 0
  return Math.max(0, Math.min(1, x))
}

function normalizeText(s) {
  if (typeof s !== 'string') return ''
  return s.toLowerCase().trim()
}

function extractKeywords(text) {
  if (typeof text !== 'string') return []
  // 简化版：按空格/标点拆分 + 长度过滤
  return text
    .toLowerCase()
    .split(/[\s,。.!?！？；;：:、\n\r\t]+/)
    .filter(w => w.length >= 2 && w.length <= 30)
    .slice(0, 30)
}

function isQuestion(text) {
  if (typeof text !== 'string') return false
  return /[?？]/.test(text) || /^(怎么|如何|为什么|啥|什么|哪|谁|多少|几|是不是|能|会|可以|should|what|why|how|when|where|who|can|could|would|is|are|do|does)/i.test(text.trim())
}

function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || b.length === 0) return 0
  const setA = new Set(a)
  const setB = new Set(b)
  const intersection = [...setA].filter(x => setB.has(x))
  return intersection.length / Math.sqrt(setA.size * setB.size)
}

// ─── 单信号评分 ────────────────────────────────────────────

function scoreRecentMessage(history, focusKeywords, knowledgeGaps) {
  if (!Array.isArray(history) || history.length === 0) return 0
  const recent = history.slice(-3)  // 最近 3 条
  let score = 0
  for (const msg of recent) {
    const text = typeof msg === 'string' ? msg : (msg.text || msg.content || '')
    const kws = extractKeywords(text)
    // focus 关键词匹配（用 Jaccard 风格的"包含率"）
    if (focusKeywords.length > 0) {
      const focusSet = new Set(focusKeywords.map(k => k.toLowerCase()))
      const matches = kws.filter(k => focusSet.has(k)).length
      const focusCoverage = matches / focusSet.size  // focus 关键词被覆盖比例
      const kwsCoverage = matches / Math.max(1, kws.length)
      score += Math.max(focusCoverage, kwsCoverage) * 0.7
    }
    // 知识缺口匹配
    if (Array.isArray(knowledgeGaps) && knowledgeGaps.length > 0) {
      const gapSet = new Set(knowledgeGaps.map(k => k.toLowerCase()))
      const gapMatches = kws.filter(k => gapSet.has(k)).length
      score += Math.min(0.5, gapMatches * 0.2)
    }
  }
  return clamp01(score)
}

function scoreRecentQuestion(history) {
  if (!Array.isArray(history) || history.length === 0) return 0
  const recent = history.slice(-3)
  const questions = recent.filter(m => isQuestion(typeof m === 'string' ? m : (m.text || m.content || '')))
  return clamp01(questions.length / 3)
}

function scoreFocusStack(focusContext) {
  if (!focusContext || typeof focusContext !== 'object') return 0
  // focus stack 深度 1+ 表示老板在某个主题上稳定
  const depth = focusContext.depth || 0
  if (depth === 0) return 0
  return clamp01(depth / 4)  // 深度 4 = 满分
}

function scoreTimePattern(timePattern, now) {
  if (!timePattern || typeof timePattern !== 'object') return 0
  const hour = (typeof now === 'number' ? now : Date.now()) / 3_600_000
  const activeHours = Array.isArray(timePattern.activeHours) ? timePattern.activeHours : []
  if (activeHours.length === 0) return 0
  // 简化：当前小时是否在活跃时段
  const currentHour = new Date(now || Date.now()).getHours()
  if (activeHours.includes(currentHour)) return 1
  return 0
}

function scoreEmotionContext(externalEmotion) {
  // 避免在老板焦虑/愤怒时主动
  if (!externalEmotion || typeof externalEmotion !== 'object') return 1  // 不知道 = 假设安全
  const valence = typeof externalEmotion.valence === 'number' ? externalEmotion.valence : 0
  const arousal = typeof externalEmotion.arousal === 'number' ? externalEmotion.arousal : 0.5
  // 负效价（心情差）或高唤醒度（紧张/愤怒）→ 降低主动开口
  if (valence < -0.4 || arousal > 0.8) return 0
  if (valence < -0.2) return 0.3
  return 1
}

function scoreKnowledgeGap(knowledgeGaps) {
  if (!Array.isArray(knowledgeGaps) || knowledgeGaps.length === 0) return 0
  // 知识缺口越多 → 越可能老板要追问
  return clamp01(Math.min(1, knowledgeGaps.length / 5))
}

function scoreHistoryPattern(history) {
  if (!Array.isArray(history) || history.length < 2) return 0
  // 历史模式：最近对话的多样性（多样性高 → 可能要切换话题）
  const recent = history.slice(-5)
  const kws = recent.map(m => extractKeywords(typeof m === 'string' ? m : (m.text || m.content || ''))).flat()
  const unique = new Set(kws).size
  if (kws.length === 0) return 0
  return clamp01(unique / kws.length)
}

// ─── 主入口 ────────────────────────────────────────────────

// 预判 top-K 候选意图
//   options: {
//     conversationHistory: string[] | [{role, text, content}],
//     focusContext: { depth, topic, keywords },
//     timePattern: { activeHours: [9, 10, 14, ...] },
//     externalEmotion: { valence, arousal, primary } | null,
//     knowledgeGaps: string[],
//     now: number,
//     topK: number
//   }
//   返回: { intents: [{type, confidence, reason, signals}], context: {...} }
export function predict(options = {}) {
  const now = typeof options.now === 'number' ? options.now : Date.now()
  const topK = options.topK || DEFAULT_TOP_K
  const history = Array.isArray(options.conversationHistory) ? options.conversationHistory.slice(-MAX_HISTORY) : []
  const focusContext = options.focusContext || null
  const focusKeywords = Array.isArray(focusContext?.keywords) ? focusContext.keywords : []
  const timePattern = options.timePattern || null
  const externalEmotion = options.externalEmotion || null
  const knowledgeGaps = Array.isArray(options.knowledgeGaps) ? options.knowledgeGaps : []

  // 5 信号评分
  const signals = {
    recentMessage: scoreRecentMessage(history, focusKeywords, knowledgeGaps),
    recentQuestion: scoreRecentQuestion(history),
    focusStack: scoreFocusStack(focusContext),
    timePattern: scoreTimePattern(timePattern, now),
    emotionContext: scoreEmotionContext(externalEmotion),
    knowledgeGap: scoreKnowledgeGap(knowledgeGaps),
    historyPattern: scoreHistoryPattern(history),
  }

  // 派生 5 个候选意图
  const candidates = []
  // 1) 继续话题（focus + recent message）
  if (signals.focusStack > 0.3 && signals.recentMessage > 0.2) {
    candidates.push({
      type: INTENT_TYPES.CONTINUE_TOPIC,
      confidence: clamp01(
        signals.focusStack * SIGNAL_WEIGHTS.focusStackMatch +
        signals.recentMessage * SIGNAL_WEIGHTS.recentMessage
      ) * signals.emotionContext,
      reason: `当前 focus stack 深度 ${focusContext?.depth || 0}，最近消息匹配主题关键词`,
      signals: ['focusStack', 'recentMessage'],
    })
  }
  // 2) 追问细节（recent question + knowledge gap）
  if (signals.recentQuestion > 0.3) {
    candidates.push({
      type: INTENT_TYPES.FOLLOW_UP_QUESTION,
      confidence: clamp01(
        signals.recentQuestion * SIGNAL_WEIGHTS.recentQuestion +
        signals.knowledgeGap * SIGNAL_WEIGHTS.knowledgeGapMatch
      ) * signals.emotionContext,
      reason: `最近对话有 ${Math.round(signals.recentQuestion * 3)} 个问句`,
      signals: ['recentQuestion', 'knowledgeGap'],
    })
  }
  // 3) 切换话题（history pattern 高 + focus 浅）
  if (signals.historyPattern > 0.6 && signals.focusStack < 0.5) {
    candidates.push({
      type: INTENT_TYPES.SWITCH_TOPIC,
      confidence: clamp01(signals.historyPattern * SIGNAL_WEIGHTS.historyPattern) * signals.emotionContext,
      reason: `最近对话关键词多样性 ${signals.historyPattern.toFixed(2)}，focus 较浅`,
      signals: ['historyPattern'],
    })
  }
  // 4) 信息查询（knowledge gap 高）
  if (signals.knowledgeGap > 0.4) {
    candidates.push({
      type: INTENT_TYPES.INFORMATION_LOOKUP,
      confidence: clamp01(signals.knowledgeGap * SIGNAL_WEIGHTS.knowledgeGapMatch) * signals.emotionContext,
      reason: `知识缺口 ${knowledgeGaps.length} 个: ${knowledgeGaps.slice(0, 3).join(', ')}`,
      signals: ['knowledgeGap'],
    })
  }
  // 5) 状态查询（focus 稳定 + 无 question + 活跃时段）
  if (signals.focusStack > 0.3 && signals.recentQuestion < 0.3 && signals.timePattern > 0.5) {
    candidates.push({
      type: INTENT_TYPES.STATUS_CHECK,
      confidence: clamp01(
        signals.focusStack * 0.3 +
        signals.timePattern * 0.4 +
        0.3
      ) * signals.emotionContext,
      reason: `focus 稳定 + 当前是活跃时段`,
      signals: ['focusStack', 'timePattern'],
    })
  }
  // 6) 反思（外部情绪平静 + focus 深）
  if (signals.emotionContext > 0.7 && signals.focusStack > 0.5) {
    candidates.push({
      type: INTENT_TYPES.REFLECTION,
      confidence: clamp01(signals.focusStack * 0.6 + 0.2) * signals.emotionContext,
      reason: `情绪平静 + focus 深，适合反思`,
      signals: ['emotionContext', 'focusStack'],
    })
  }
  // 排序
  candidates.sort((a, b) => b.confidence - a.confidence)
  const top = candidates.slice(0, Math.min(topK, MAX_OUTPUT_INTENTS))
  return {
    intents: top,
    signals,
    context: {
      historyLength: history.length,
      focusDepth: focusContext?.depth || 0,
      timePatternActive: signals.timePattern > 0.5,
      emotionSafe: signals.emotionContext > 0.7,
      knowledgeGapCount: knowledgeGaps.length,
    },
  }
}

export {
  scoreRecentMessage,
  scoreRecentQuestion,
  scoreFocusStack,
  scoreTimePattern,
  scoreEmotionContext,
  scoreKnowledgeGap,
  scoreHistoryPattern,
  SIGNAL_WEIGHTS,
  MAX_HISTORY,
  RECENT_WINDOW_MS,
  DEFAULT_TOP_K,
}
