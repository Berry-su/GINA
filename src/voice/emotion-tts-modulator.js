/**
 * emotion-tts-modulator.js — 情感→TTS调制器
 *
 * 核心理念：让 Gina 的声音带有情感温度。
 * 根据情感引擎分析的情绪状态，动态调整 TTS 语音参数。
 *
 * 调制维度：
 *   1. 语速（rate）: 快→兴奋/紧张，慢→悲伤/平静
 *   2. 音调（pitch）: 高→开心/惊讶，低→悲伤/愤怒
 *   3. 音量（volume）: 大→兴奋/紧急，小→温柔/平静
 *   4. 停顿（pause）: 停顿长度根据情绪调整
 *   5. 语气（voice）: 根据情绪推荐合适的语音角色
 */

import { 
  getEmotionSnapshot, 
  analyzeEmotion,
  processEmotionUpdate 
} from '../memory/emotion-engine.js'

// 情感→TTS参数映射配置
const EMOTION_TTS_PROFILES = {
  joy: {
    rate: 1.15,        // 语速加快 15%
    pitch: 1.1,        // 音调提高
    volume: 1.1,        // 音量稍大
    pauseMs: 150,       // 停顿短
    voiceRecommend: '活跃女声',
    description: '开心的语气，语速稍快，音调高',
  },
  trust: {
    rate: 1.0,
    pitch: 0.95,
    volume: 0.95,
    pauseMs: 250,
    voiceRecommend: '稳重大男声',
    description: '信任的语气，平稳可靠',
  },
  fear: {
    rate: 0.9,
    pitch: 0.85,
    volume: 0.85,
    pauseMs: 350,
    voiceRecommend: '温柔女声',
    description: '安慰的语气，稍慢轻柔',
  },
  surprise: {
    rate: 1.2,
    pitch: 1.3,
    volume: 1.05,
    pauseMs: 100,
    voiceRecommend: '年轻女声',
    description: '惊讶的语气，快速高八度',
  },
  sadness: {
    rate: 0.85,
    pitch: 0.8,
    volume: 0.8,
    pauseMs: 400,
    voiceRecommend: '低沉男声',
    description: '悲伤的语气，缓慢低沉',
  },
  disgust: {
    rate: 0.9,
    pitch: 0.9,
    volume: 0.9,
    pauseMs: 300,
    voiceRecommend: '中性男声',
    description: '克制的语气',
  },
  anger: {
    rate: 1.1,
    pitch: 1.05,
    volume: 1.15,
    pauseMs: 200,
    voiceRecommend: '有力男声',
    description: '坚定的语气，有力但克制',
  },
  anticipation: {
    rate: 1.05,
    pitch: 1.0,
    volume: 1.0,
    pauseMs: 200,
    voiceRecommend: '期待女声',
    description: '期待的语气',
  },
  urgency: {
    rate: 1.3,
    pitch: 1.1,
    volume: 1.2,
    pauseMs: 100,
    voiceRecommend: '有力男声',
    description: '紧急的语气，快速有力',
  },
  confidence: {
    rate: 1.0,
    pitch: 1.0,
    volume: 1.0,
    pauseMs: 200,
    voiceRecommend: '自信男声',
    description: '自信的语气，平稳有力',
  },
  confusion: {
    rate: 0.95,
    pitch: 0.95,
    volume: 0.9,
    pauseMs: 250,
    voiceRecommend: '普通女声',
    description: '思考的语气',
  },
  affection: {
    rate: 0.9,
    pitch: 1.1,
    volume: 0.9,
    pauseMs: 300,
    voiceRecommend: '温柔女声',
    description: '温柔的语气',
  },
  neutral: {
    rate: 1.0,
    pitch: 1.0,
    volume: 1.0,
    pauseMs: 200,
    voiceRecommend: '默认语音',
    description: '中性的语气',
  },
}

// 复合情绪加权配置
const COMPOUND_EMOTION_CONFIG = {
  // 情绪混合时的主情绪判定权重
  dominantWeight: 0.6,
  secondaryWeight: 0.3,
  tertiaryWeight: 0.1,
}

// TTS参数平滑过渡（避免参数突变）
let currentTTSSettings = null
let targetTTSSettings = null
const SMOOTHING_FACTOR = 0.3

/**
 * 初始化情感TTS调制器
 */
export function initEmotionTTSModulator() {
  currentTTSSettings = { ...EMOTION_TTS_PROFILES.neutral }
  targetTTSSettings = { ...EMOTION_TTS_PROFILES.neutral }
  
  console.log('[情感TTS调制] 已启动')
  return { initialized: true }
}

/**
 * 根据文本内容分析情感并返回TTS参数
 */
export function modulateTTSFromText(text, options = {}) {
  const { 
    useEmotionEngine = true, 
    defaultProfile = 'neutral',
    smooth = true 
  } = options
  
  let emotionProfile = null
  
  if (useEmotionEngine && text) {
    try {
      const emotionResult = analyzeEmotion(text)
      emotionProfile = getTTSProfileFromEmotion(emotionResult)
    } catch {}
  }
  
  if (!emotionProfile) {
    emotionProfile = EMOTION_TTS_PROFILES[defaultProfile] || EMOTION_TTS_PROFILES.neutral
  }
  
  if (smooth && currentTTSSettings) {
    targetTTSSettings = emotionProfile
    return smoothTransition(currentTTSSettings, targetTTSSettings)
  }
  
  currentTTSSettings = emotionProfile
  return { ...emotionProfile }
}

/**
 * 根据当前情感状态获取TTS参数
 */
export function modulateTTSFromState(options = {}) {
  const { smooth = true } = options
  
  try {
    const snapshot = getEmotionSnapshot()
    if (!snapshot?.emotion?.primary) {
      return { ...EMOTION_TTS_PROFILES.neutral }
    }
    
    const profile = getTTSProfileFromEmotion(snapshot)
    
    if (smooth && currentTTSSettings) {
      targetTTSSettings = profile
      return smoothTransition(currentTTSSettings, targetTTSSettings)
    }
    
    currentTTSSettings = profile
    return { ...profile }
  } catch {
    return { ...EMOTION_TTS_PROFILES.neutral }
  }
}

/**
 * 直接设置TTS参数（用于主动控制）
 */
export function setTTSProfile(profileName, options = {}) {
  const profile = EMOTION_TTS_PROFILES[profileName]
  if (!profile) {
    console.warn(`[情感TTS调制] 未知配置: ${profileName}`)
    return currentTTSSettings
  }
  
  const { smooth = true } = options
  
  if (smooth && currentTTSSettings) {
    targetTTSSettings = profile
    return smoothTransition(currentTTSSettings, targetTTSSettings)
  }
  
  currentTTSSettings = { ...profile }
  return { ...profile }
}

/**
 * 获取适合当前情绪的语音推荐
 */
export function recommendVoiceForEmotion(emotionType) {
  const profile = EMOTION_TTS_PROFILES[emotionType] || EMOTION_TTS_PROFILES.neutral
  return {
    recommended: profile.voiceRecommend,
    emotion: emotionType,
    description: profile.description,
  }
}

/**
 * 根据情感分析结果获取TTS配置
 */
function getTTSProfileFromEmotion(emotionResult) {
  if (!emotionResult) return EMOTION_TTS_PROFILES.neutral
  
  const primaryEmotion = emotionResult.primary || 'neutral'
  let profile = EMOTION_TTS_PROFILES[primaryEmotion]
  
  if (!profile) {
    profile = EMOTION_TTS_PROFILES.neutral
  }
  
  // 如果有多个情绪信号，进行混合加权
  const signals = emotionResult.signals || []
  if (signals.length >= 2) {
    profile = blendProfiles(profile, signals)
  }
  
  return profile
}

/**
 * 混合多个情绪的TTS配置
 */
function blendProfiles(baseProfile, signals) {
  const sortedSignals = [...signals].sort((a, b) => b.weight - a.weight)
  const topSignals = sortedSignals.slice(0, 3)
  
  if (topSignals.length < 2) return baseProfile
  
  const factors = ['rate', 'pitch', 'volume']
  const blended = { ...baseProfile }
  
  for (const factor of factors) {
    let weightedSum = 0
    let totalWeight = 0
    
    for (const signal of topSignals) {
      const profile = EMOTION_TTS_PROFILES[signal.emotion]
      if (profile?.[factor]) {
        weightedSum += profile[factor] * signal.weight
        totalWeight += signal.weight
      }
    }
    
    if (totalWeight > 0) {
      blended[factor] = weightedSum / totalWeight
    }
  }
  
  // 停顿时间取平均
  const pauseValues = topSignals
    .map(s => EMOTION_TTS_PROFILES[s.emotion]?.pauseMs)
    .filter(Boolean)
  if (pauseValues.length) {
    blended.pauseMs = Math.round(pauseValues.reduce((a, b) => a + b, 0) / pauseValues.length)
  }
  
  // 语音推荐取主情绪
  blended.voiceRecommend = EMOTION_TTS_PROFILES[topSignals[0].emotion]?.voiceRecommend || baseProfile.voiceRecommend
  
  return blended
}

/**
 * 平滑过渡到目标配置
 */
function smoothTransition(current, target) {
  const smoothed = {}
  
  for (const key of Object.keys(target)) {
    if (typeof target[key] === 'number' && typeof current[key] === 'number') {
      smoothed[key] = current[key] + (target[key] - current[key]) * SMOOTHING_FACTOR
    } else {
      smoothed[key] = target[key]
    }
  }
  
  currentTTSSettings = smoothed
  return { ...smoothed, smoothed: true }
}

/**
 * 获取当前TTS设置
 */
export function getCurrentTTSSettings() {
  return {
    ...currentTTSSettings,
    target: targetTTSSettings,
    smoothingFactor: SMOOTHING_FACTOR,
  }
}

/**
 * 获取所有情感配置
 */
export function getAllEmotionProfiles() {
  return Object.entries(EMOTION_TTS_PROFILES).map(([key, profile]) => ({
    emotion: key,
    ...profile,
  }))
}

/**
 * 根据情感生成TTS SSML标签
 */
export function generateEmotionalSSML(text, emotionType = 'neutral') {
  const profile = EMOTION_TTS_PROFILES[emotionType] || EMOTION_TTS_PROFILES.neutral
  
  const prosodyOpen = `<prosody rate="${profile.rate}x" pitch="${profile.pitch > 1 ? '+' + ((profile.pitch - 1) * 100).toFixed(0) + '%' : ((profile.pitch - 1) * 100).toFixed(0) + '%'}" volume="${profile.volume > 1 ? '+' + ((profile.volume - 1) * 100).toFixed(0) + '%' : ((profile.volume - 1) * 100).toFixed(0) + '%'}">`
  
  const prosodyClose = '</prosody>'
  
  return `${prosodyOpen}${text}${prosodyClose}`
}

/**
 * 生成情感响应的配置指令
 */
export function generateEmotionResponseConfig(userMessage, context = {}) {
  const baseConfig = {
    rate: 1.0,
    pitch: 1.0,
    volume: 1.0,
    pauseMs: 200,
    emotion: 'neutral',
    voiceRecommendation: 'default',
    description: '中性响应',
  }
  
  try {
    const emotionResult = analyzeEmotion(userMessage)
    const profile = getTTSProfileFromEmotion(emotionResult)
    
    return {
      ...baseConfig,
      rate: profile.rate,
      pitch: profile.pitch,
      volume: profile.volume,
      pauseMs: profile.pauseMs,
      emotion: emotionResult?.primary || 'neutral',
      voiceRecommendation: profile.voiceRecommend,
      description: profile.description,
      context,
      timestamp: Date.now(),
    }
  } catch {
    return { ...baseConfig }
  }
}