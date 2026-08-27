// emotion-engine.js — 情感计算引擎
//
// 设计哲学：
//   - 情感不是装饰，是决策信号
//   - 从用户消息中提取情绪信号，聚合为情绪画像
//   - 情绪画像影响：回复风格、主动关怀、记忆权重、进化方向
//
// 情绪分类（简化版，对齐 Plutchik 基本情绪）：
//   joy, trust, fear, surprise, sadness, disgust, anger, anticipation
//   + 复合情绪：confidence, confusion, urgency, affection
//
// 输出：EmotionProfile {
//   primary: 主情绪,
//   valence: 效价 (-1 ~ +1),
//   arousal: 唤起度 (0 ~ 1),
//   confidence: 置信度 (0 ~ 1),
//   signals: [{ emotion, weight, source }],
//   trajectory: 情绪轨迹 (最近 N 次),
//   engagement: 对话投入度 (0 ~ 1),
// }

import { getConfig, setConfig } from '../capabilities/db.js'

const EMOTION_STATE_KEY = 'emotion_engine_state_v1'
const EMOTION_STATE_VERSION = 1
const MAX_TRAJECTORY = 20
const DECAY_RATE = 0.85
const RECENT_WINDOW = 5

// 情绪关键词库（中英双语，可扩展）
const EMOTION_LEXICON = {
  joy: {
    zh: ['开心', '高兴', '快乐', '喜欢', '爱', '棒', '好', '赞', '哈哈', '嘻嘻', '耶', '幸福', '愉快', '满足', '兴奋'],
    en: ['happy', 'joy', 'love', 'like', 'great', 'wonderful', 'awesome', 'good', 'nice', 'thanks', 'lol', 'haha', 'yes', 'excited', 'glad'],
    weight: 1.0,
  },
  trust: {
    zh: ['相信', '信任', '依靠', '放心', '靠谱', '稳', '交给你了', '依赖'],
    en: ['trust', 'believe', 'rely', 'depend', 'confident', 'sure', 'safe'],
    weight: 0.8,
  },
  fear: {
    zh: ['害怕', '担心', '恐惧', '紧张', '焦虑', '怕', '不安', '忧虑', '慌张'],
    en: ['afraid', 'fear', 'worried', 'scared', 'anxious', 'nervous', 'terrible', 'panic'],
    weight: 1.2,
  },
  surprise: {
    zh: ['惊讶', '吃惊', '没想到', '意外', '哇', '啊', '想不到', '震惊'],
    en: ['surprise', 'wow', 'unexpected', 'amazing', 'shocked', 'incredible', 'huh'],
    weight: 0.6,
  },
  sadness: {
    zh: ['伤心', '难过', '悲伤', '痛苦', '失望', '沮丧', '孤独', '寂寞', '失落', '哭'],
    en: ['sad', 'sorry', 'cry', 'hurt', 'painful', 'disappointed', 'lonely', 'miss'],
    weight: 1.0,
  },
  disgust: {
    zh: ['讨厌', '烦', '恶心', '反感', '不喜欢', '嫌弃', '厌恶'],
    en: ['disgust', 'hate', 'dislike', 'annoyed', 'gross', 'yuck', 'boring'],
    weight: 0.8,
  },
  anger: {
    zh: ['生气', '愤怒', '气', '怒', '烦', '抓狂', '暴躁', '发火', '不满'],
    en: ['angry', 'furious', 'mad', 'annoyed', 'frustrated', 'rage', 'hate', 'disgusting'],
    weight: 1.3,
  },
  anticipation: {
    zh: ['期待', '希望', '等着', '盼望', '打算', '计划', '想', '准备'],
    en: ['hope', 'expect', 'looking forward', 'plan', 'want', 'wish', 'anticipate'],
    weight: 0.7,
  },
  urgency: {
    zh: ['快', '赶紧', '马上', '立刻', '急', '现在', '尽快', '紧急', '要命'],
    en: ['urgent', 'asap', 'quickly', 'right now', 'immediately', 'hurry', 'emergency'],
    weight: 1.4,
  },
  confidence: {
    zh: ['确定', '肯定', '当然', '绝对', '必须', '一定', '毫无疑问'],
    en: ['sure', 'certain', 'definitely', 'of course', 'must', 'absolutely', 'clearly'],
    weight: 0.9,
  },
  confusion: {
    zh: ['不明白', '不懂', '困惑', '糊涂', '什么意思', '怎么回事', '搞不懂', '懵'],
    en: ['confused', 'puzzled', 'don\'t understand', 'what do you mean', 'huh?', 'lost', 'confusion'],
    weight: 0.6,
  },
  affection: {
    zh: ['想你', '亲亲', '抱抱', '宝贝', '亲爱的', '么么哒', 'mua'],
    en: ['miss you', 'love you', 'dear', 'darling', 'sweetheart', 'hugs', 'kisses'],
    weight: 1.0,
  },
}

// 情绪效价映射 (positive → +, negative → -)
const EMOTION_VALENCE = {
  joy: 0.8, trust: 0.6, surprise: 0.15,
  sadness: -0.7, disgust: -0.6, anger: -0.85,
  fear: -0.65, anticipation: 0.3,
  urgency: -0.2, confidence: 0.7, confusion: -0.1, affection: 0.85,
}

// 情绪唤起度映射
const EMOTION_AROUSAL = {
  joy: 0.7, trust: 0.3, surprise: 0.9,
  sadness: 0.5, disgust: 0.7, anger: 0.9,
  fear: 0.8, anticipation: 0.5,
  urgency: 0.95, confidence: 0.6, confusion: 0.4, affection: 0.6,
}

function defaultState() {
  return {
    version: EMOTION_STATE_VERSION,
    enabled: true,
    trajectory: [],
    lastEmotion: null,
    lastUpdated: null,
    userProfile: {
      dominantEmotion: 'neutral',
      averageValence: 0,
      averageArousal: 0,
      engagementLevel: 'normal',
      interactionCount: 0,
      positiveRatio: 0.5,
    },
  }
}

function safeJsonObject(value) {
  if (!value) return null
  if (typeof value === 'object') return value
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function normalizeState(raw) {
  const parsed = safeJsonObject(raw) || {}
  const trajectory = Array.isArray(parsed.trajectory) ? parsed.trajectory : []
  const up = parsed.userProfile || {}
  return {
    ...defaultState(),
    ...parsed,
    version: EMOTION_STATE_VERSION,
    trajectory: trajectory.slice(-MAX_TRAJECTORY),
    userProfile: { ...defaultState().userProfile, ...up },
  }
}

function loadState() {
  return normalizeState(getConfig(EMOTION_STATE_KEY))
}

function saveState(state) {
  const normalized = normalizeState(state)
  setConfig(EMOTION_STATE_KEY, JSON.stringify(normalized))
  return normalized
}

// 计算单条消息的情绪信号
export function analyzeEmotion(text) {
  const msg = String(text || '').toLowerCase()
  if (!msg) return null

  const signals = []
  const matchedEmotions = new Map()

  for (const [emotion, config] of Object.entries(EMOTION_LEXICON)) {
    let count = 0
    for (const keyword of config.zh) {
      const regex = new RegExp(escapeRegex(keyword), 'g')
      const matches = msg.match(regex)
      if (matches) count += matches.length
    }
    for (const keyword of config.en) {
      const regex = new RegExp(escapeRegex(keyword), 'g')
      const matches = msg.match(regex)
      if (matches) count += matches.length
    }
    if (count > 0) {
      const weight = Math.min(1.0, count * 0.2) * config.weight
      matchedEmotions.set(emotion, {
        emotion,
        count,
        weight,
        valence: EMOTION_VALENCE[emotion] || 0,
        arousal: EMOTION_AROUSAL[emotion] || 0.5,
      })
    }
  }

  if (matchedEmotions.size === 0) return null

  const sorted = [...matchedEmotions.values()].sort((a, b) => b.weight - a.weight)
  const primary = sorted[0]

  const totalWeight = sorted.reduce((sum, s) => sum + s.weight, 0)
  const avgValence = sorted.reduce((sum, s) => sum + s.valence * s.weight, 0) / totalWeight
  const avgArousal = sorted.reduce((sum, s) => sum + s.arousal * s.weight, 0) / totalWeight
  const confidence = Math.min(1.0, totalWeight / 3)

  return {
    primary: primary.emotion,
    valence: clamp(avgValence, -1, 1),
    arousal: clamp(avgArousal, 0, 1),
    confidence,
    signals: sorted.slice(0, 5),
    isPositive: avgValence > 0.2,
    isNegative: avgValence < -0.2,
    isIntense: avgArousal > 0.7,
  }
}

// 分析对话的投入度
export function analyzeEngagement(conversationWindow = []) {
  if (!Array.isArray(conversationWindow) || conversationWindow.length === 0) {
    return { score: 0, signals: [] }
  }

  const userMsgs = conversationWindow.filter(m => m?.role === 'user')
  const signals = []
  let score = 0.5

  if (userMsgs.length === 0) {
    return { score: 0.2, signals: ['no_user_messages'] }
  }

  const recentUserMsgs = userMsgs.slice(-RECENT_WINDOW)
  const avgLength = recentUserMsgs.reduce((sum, m) => sum + String(m?.content || '').length, 0) / recentUserMsgs.length
  const hasQuestions = recentUserMsgs.some(m => /[?？]/.test(m?.content || ''))
  const hasLongMessages = avgLength > 50
  const hasMultipleTopics = new Set(recentUserMsgs.map(m => extractTopic(m?.content || ''))).size > 2
  const responseFrequency = recentUserMsgs.length >= 3

  if (avgLength > 100) { score += 0.2; signals.push('detailed_messages') }
  if (avgLength > 50 && avgLength <= 100) { score += 0.1; signals.push('moderate_length') }
  if (hasQuestions) { score += 0.15; signals.push('asking_questions') }
  if (hasMultipleTopics) { score += 0.1; signals.push('multiple_topics') }
  if (responseFrequency) { score += 0.15; signals.push('frequent_responses') }

  const shortMsgRatio = recentUserMsgs.filter(m => String(m?.content || '').length <= 3).length / recentUserMsgs.length
  if (shortMsgRatio > 0.6) { score -= 0.3; signals.push('short_responses') }

  return { score: clamp(score, 0, 1), signals }
}

// 分析对话质量
export function analyzeDialogueQuality(conversationWindow = []) {
  if (!Array.isArray(conversationWindow) || conversationWindow.length < 2) {
    return { score: 0.5, issues: [] }
  }

  const issues = []
  let score = 0.7

  const pairs = []
  for (let i = 0; i < conversationWindow.length - 1; i++) {
    if (conversationWindow[i]?.role === 'jarvis' && conversationWindow[i + 1]?.role === 'user') {
      pairs.push({
        jarvis: conversationWindow[i],
        user: conversationWindow[i + 1],
      })
    }
  }

  if (pairs.length === 0) return { score, issues: ['no_valid_pairs'] }

  const shortReplyCount = pairs.filter(p =>
    String(p.user?.content || '').length <= 5
  ).length
  const shortReplyRatio = shortReplyCount / pairs.length
  if (shortReplyRatio > 0.5) {
    score -= 0.2
    issues.push('disengage_short_replies')
  }

  const negativeSignals = ['无聊', '没意思', '不想', '别烦', '算了', 'stop', 'boring', 'not interested']
  const hasNegativity = pairs.some(p =>
    negativeSignals.some(s => String(p.user?.content || '').toLowerCase().includes(s.toLowerCase()))
  )
  if (hasNegativity) {
    score -= 0.3
    issues.push('user_negativity')
  }

  const topicDrift = detectTopicDrift(pairs)
  if (topicDrift > 0.7) {
    score -= 0.15
    issues.push('topic_drift')
  }

  const avgJarvisLen = pairs.reduce((sum, p) => sum + String(p.jarvis?.content || '').length, 0) / pairs.length
  if (avgJarvisLen > 500) {
    score -= 0.1
    issues.push('overly_long_responses')
  }

  return { score: clamp(score, 0, 1), issues, avgJarvisLen }
}

// 主入口：处理一轮交互，更新情绪状态
export function processEmotionUpdate({ messageText = '', conversationWindow = [], timestamp = Date.now() } = {}) {
  const state = loadState()
  if (state.enabled === false) return { profile: null, state }

  const emotion = analyzeEmotion(messageText)
  const engagement = analyzeEngagement(conversationWindow)
  const dialogueQuality = analyzeDialogueQuality(conversationWindow)

  if (!emotion) {
    return {
      profile: null,
      state,
      engagement,
      dialogueQuality,
    }
  }

  const trajectoryEntry = {
    timestamp,
    primary: emotion.primary,
    valence: emotion.valence,
    arousal: emotion.arousal,
    engagement: engagement.score,
    confidence: emotion.confidence,
  }

  const trajectory = [...state.trajectory, trajectoryEntry].slice(-MAX_TRAJECTORY)

  const recentValences = trajectory.map(t => t.valence)
  const avgValence = recentValences.reduce((a, b) => a + b, 0) / recentValences.length
  const recentArousals = trajectory.map(t => t.arousal)
  const avgArousal = recentArousals.reduce((a, b) => a + b, 0) / recentArousals.length

  const positiveCount = trajectory.filter(t => t.valence > 0.2).length
  const positiveRatio = trajectory.length > 0 ? positiveCount / trajectory.length : 0.5

  let engagementLevel = 'normal'
  if (engagement.score > 0.7) engagementLevel = 'high'
  else if (engagement.score < 0.3) engagementLevel = 'low'

  const emotionCounts = {}
  for (const t of trajectory) {
    emotionCounts[t.primary] = (emotionCounts[t.primary] || 0) + 1
  }
  const dominantEmotion = Object.entries(emotionCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'neutral'

  const newState = saveState({
    ...state,
    trajectory,
    lastEmotion: emotion,
    lastUpdated: timestamp,
    userProfile: {
      dominantEmotion,
      averageValence: round(avgValence, 2),
      averageArousal: round(avgArousal, 2),
      engagementLevel,
      interactionCount: state.userProfile.interactionCount + 1,
      positiveRatio: round(positiveRatio, 2),
    },
  })

  const profile = {
    primary: emotion.primary,
    valence: emotion.valence,
    arousal: emotion.arousal,
    confidence: emotion.confidence,
    signals: emotion.signals,
    trajectory,
    engagement: engagement.score,
    engagementLevel,
    dialogueQuality,
    dominantEmotion,
    trend: computeTrend(trajectory),
    recommendation: generateRecommendation(emotion, engagement, dialogueQuality),
  }

  return { profile, state: newState, engagement, dialogueQuality }
}

// 获取当前情绪状态
export function getEmotionState() {
  return loadState()
}

// 获取情绪快照（供注入器使用）
export function getEmotionSnapshot() {
  const state = loadState()
  if (state.enabled === false) return ''

  const { userProfile, lastEmotion, trajectory } = state
  const parts = []

  parts.push(`Emotion engine active. User emotional profile:`)
  parts.push(`- Dominant emotion (recent ${trajectory.length} interactions): ${userProfile.dominantEmotion}`)
  parts.push(`- Average valence: ${userProfile.averageValence > 0 ? 'positive' : userProfile.averageValence < 0 ? 'negative' : 'neutral'} (${userProfile.averageValence.toFixed(2)})`)
  parts.push(`- Engagement level: ${userProfile.engagementLevel}`)
  parts.push(`- Positive interaction ratio: ${Math.round(userProfile.positiveRatio * 100)}%`)
  parts.push(`- Total interactions tracked: ${userProfile.interactionCount}`)

  if (lastEmotion) {
    parts.push(``)
    parts.push(`Last detected emotion: ${lastEmotion.primary} (confidence: ${Math.round(lastEmotion.confidence * 100)}%)`)
  }

  if (userProfile.averageValence < -0.3) {
    parts.push(``)
    parts.push(`[ATTENTION] User shows persistent negative valence. Consider: (1) acknowledging their feelings, (2) offering help or support, (3) switching to a lighter topic if appropriate.`)
  }

  if (userProfile.engagementLevel === 'low') {
    parts.push(``)
    parts.push(`[ATTENTION] User engagement is low. Consider: (1) asking an open-ended question, (2) offering choices, (3) checking if they are still interested in the current topic.`)
  }

  return parts.join('\n')
}

// 生成情绪建议
function generateRecommendation(emotion, engagement, dialogueQuality) {
  const recs = []

  if (emotion.isIntense && emotion.isNegative) {
    recs.push('情绪强烈且负面：建议先共情，再温和引导')
  } else if (emotion.isNegative) {
    recs.push('负面情绪：建议温和回应，给予支持')
  }

  if (engagement.score < 0.3) {
    recs.push('投入度低：建议换话题或主动提问')
  } else if (engagement.score > 0.7) {
    recs.push('投入度高：可以深入讨论或提出更高阶的内容')
  }

  if (dialogueQuality.score < 0.4) {
    recs.push('对话质量下降：建议总结已达成的内容，重新聚焦')
  }

  return recs
}

// 计算情绪趋势
function computeTrend(trajectory) {
  if (trajectory.length < 3) return 'insufficient_data'

  const recent = trajectory.slice(-3)
  const firstHalf = trajectory.slice(0, Math.floor(trajectory.length / 2))
  const secondHalf = trajectory.slice(Math.floor(trajectory.length / 2))

  if (firstHalf.length === 0 || secondHalf.length === 0) return 'stable'

  const firstAvg = firstHalf.reduce((s, t) => s + t.valence, 0) / firstHalf.length
  const secondAvg = secondHalf.reduce((s, t) => s + t.valence, 0) / secondHalf.length

  const diff = secondAvg - firstAvg

  if (diff > 0.15) return 'improving'
  if (diff < -0.15) return 'declining'

  return 'stable'
}

function detectTopicDrift(pairs) {
  if (pairs.length < 3) return 0
  const topics = pairs.map(p => extractTopic(p.user?.content || ''))
  const uniqueCount = new Set(topics).size
  return uniqueCount / topics.length
}

function extractTopic(text) {
  const clean = String(text || '').replace(/[\s\p{P}]/gu, '')
  if (clean.length <= 2) return clean
  return clean.slice(0, 8)
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function round(value, decimals = 2) {
  const factor = Math.pow(10, decimals)
  return Math.round(value * factor) / factor
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}