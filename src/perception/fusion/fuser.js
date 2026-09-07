// fuser.js — 多模态情绪融合（视觉 + 声纹 + 文本）
//
// 定位：把 3 个模态的 emotion 推断融合成统一输出。
// 策略：投票（vote）+ confidence 动态加权（老板 9-07 13:31 拍板 a+c 组合）
//
// 3 模态:
//   - 视觉 (face-detector)     — 7 类表情 + confidence
//   - 声纹 (voice-emotion)      — 7 类 prosody + confidence
//   - 文本 (emotion-engine)     — 12 维 → 7 类映射 + confidence
//
// 算法:
//   1. 文本 → 7 类映射（top emotion）
//   2. 投票检查一致性（2/3 一致 / 3/3 一致 / 全不一）
//   3. confidence 加权（每个模态 scores × confidence × modality weight）
//   4. 输出：dominant + scores + confidence + voting 标记

import { EXPRESSIONS } from '../visual-emotion/face-detector.js'

// ─── 常量 ───────────────────────────────────────────────────

// 模态权重（视觉=声纹 > 文本，因为前两者是直接信号）
const DEFAULT_MODALITY_WEIGHTS = {
  visual: 1.0,    // 视觉（脸）
  voice: 1.0,     // 声纹（音）
  text: 0.6,      // 文本（字）
}

// 文本 12 维 → 7 类映射
const TEXT_TO_7 = {
  joy: 'happy',
  trust: 'neutral',
  fear: 'fearful',
  surprise: 'surprised',
  sadness: 'sad',
  disgust: 'disgusted',
  anger: 'angry',
  anticipation: 'neutral',  // 期待不是清晰情绪
  urgency: 'angry',         // 急躁偏愤怒
  confidence: 'neutral',    // 自信不是情绪
  confusion: 'neutral',     // 困惑不是情绪
  affection: 'happy',       // 爱 → 高兴
}

const MIN_MODALITY_CONFIDENCE = 0.2  // 低于此视为不可信
const HIGH_AGREEMENT = 0.7           // 2/3 一致 + 平均 confidence
const VERY_HIGH_AGREEMENT = 0.85     // 3/3 一致
const DEFAULT_CONFIDENCE = 0.5

// ─── 内部工具 ───────────────────────────────────────────────

function clamp01(x) {
  if (typeof x !== 'number' || !isFinite(x)) return 0
  return Math.max(0, Math.min(1, x))
}

function clamp(x, lo, hi) {
  if (typeof x !== 'number' || !isFinite(x)) return lo
  return Math.max(lo, Math.min(hi, x))
}

function emptyScores() {
  const out = {}
  for (const e of EXPRESSIONS) out[e] = 0
  return out
}

// 把文本 12 维 emotion-engine 输出转 7 类
//   options.textScores: { joy: 0.5, fear: 0.3, ... }
//   options.textConfidence: 0-1
//   返回: { scores: {7 类}, dominant, confidence }
export function textTo7Class(options = {}) {
  const textScores = options.textScores || {}
  const textConfidence = typeof options.textConfidence === 'number' ? options.textConfidence : DEFAULT_CONFIDENCE
  const out = emptyScores()
  for (const [k, v] of Object.entries(textScores)) {
    if (typeof v !== 'number' || !isFinite(v)) continue
    const target = TEXT_TO_7[k] || 'neutral'
    // 累加（多个 12 维可能映射到同一 7 类）
    out[target] = (out[target] || 0) + v
  }
  // 归一化
  const sum = Object.values(out).reduce((s, x) => s + x, 0) || 1
  for (const k of Object.keys(out)) out[k] = clamp01(out[k] / sum)
  // 找 dominant
  let dominant = 'neutral'
  let best = -1
  for (const [e, s] of Object.entries(out)) {
    if (s > best) {
      best = s
      dominant = e
    }
  }
  return {
    scores: out,
    dominant,
    confidence: clamp01(textConfidence),
  }
}

// 投票检查一致性
//   modalities: { visual: 'happy', voice: 'happy', text: 'sad' }
//   返回: { agreement, dominant }
//     agreement: 'all' | 'majority' | 'split' | 'insufficient'
//     dominant: 多数派情绪 / split 时取第一个非空 / insufficient 时 null
export function checkAgreement(modalities) {
  const validMods = ['visual', 'voice', 'text']
  const present = []
  for (const m of validMods) {
    const e = modalities[m]
    if (typeof e === 'string' && e.length > 0 && e !== 'unknown') {
      present.push({ mod: m, emotion: e })
    }
  }
  if (present.length === 0) return { agreement: 'insufficient', dominant: null, count: 0 }
  if (present.length < 2) {
    // 只有 1 个模态 → insufficient（无法做投票）
    return { agreement: 'insufficient', dominant: present[0].emotion, count: 1, all: [present[0].emotion] }
  }
  // 计数
  const counts = {}
  for (const p of present) {
    counts[p.emotion] = (counts[p.emotion] || 0) + 1
  }
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1])
  const [topEmotion, topCount] = sorted[0]
  if (present.length === 3 && topCount === 3) {
    return { agreement: 'all', dominant: topEmotion, count: topCount, all: [topEmotion] }
  }
  if (topCount >= 2) {
    return { agreement: 'majority', dominant: topEmotion, count: topCount, all: [topEmotion] }
  }
  // 全不一：取 confidence 最高的（由调用方传）
  return { agreement: 'split', dominant: present[0].emotion, count: 1, all: present.map(p => p.emotion) }
}

// 主导出：融合 3 模态
//   options: {
//     visual: { dominant, scores, confidence } | null,
//     voice: { dominant, scores, confidence } | null,
//     textScores: { joy, fear, ... } | { 7-class scores } | null,
//     textConfidence: 0-1,
//     weights: { visual, voice, text },
//   }
//   返回: { dominant, scores, confidence, agreement, modalities, timestamp, ambiguous }
export function fuse(options = {}) {
  const weights = { ...DEFAULT_MODALITY_WEIGHTS, ...(options.weights || {}) }
  const now = typeof options.now === 'number' ? options.now : Date.now()
  // 1) 视觉
  const v = options.visual || null
  // 2) 声纹
  const a = options.voice || null
  // 3) 文本（如果是 7 类 scores，直接用；如果是 12 维，先转）
  let t = null
  if (options.textScores) {
    if (options.textScores.joy != null || options.textScores.fear != null) {
      // 12 维
      t = textTo7Class({
        textScores: options.textScores,
        textConfidence: options.textConfidence,
      })
    } else {
      // 7 类
      const scores = emptyScores()
      for (const e of EXPRESSIONS) {
        if (typeof options.textScores[e] === 'number') {
          scores[e] = options.textScores[e]
        }
      }
      let dom = 'neutral', best = -1
      for (const [k, v] of Object.entries(scores)) {
        if (v > best) { best = v; dom = k }
      }
      t = {
        scores,
        dominant: dom,
        confidence: clamp01(options.textConfidence != null ? options.textConfidence : DEFAULT_CONFIDENCE),
      }
    }
  }
  // 4) 投票
  const modalities = {
    visual: v?.dominant || null,
    voice: a?.dominant || null,
    text: t?.dominant || null,
  }
  const vote = checkAgreement(modalities)
  // 5) 加权融合 scores
  const fusedScores = emptyScores()
  let totalWeight = 0
  const modalitiesUsed = []
  const modalityConfidences = {}
  // 视觉
  if (v && v.scores && clamp01(v.confidence) >= MIN_MODALITY_CONFIDENCE) {
    const w = weights.visual * clamp01(v.confidence)
    for (const e of EXPRESSIONS) {
      if (typeof v.scores[e] === 'number') {
        fusedScores[e] += v.scores[e] * w
      }
    }
    totalWeight += w
    modalitiesUsed.push('visual')
    modalityConfidences.visual = clamp01(v.confidence)
  }
  // 声纹
  if (a && a.scores && clamp01(a.confidence) >= MIN_MODALITY_CONFIDENCE) {
    const w = weights.voice * clamp01(a.confidence)
    for (const e of EXPRESSIONS) {
      if (typeof a.scores[e] === 'number') {
        fusedScores[e] += a.scores[e] * w
      }
    }
    totalWeight += w
    modalitiesUsed.push('voice')
    modalityConfidences.voice = clamp01(a.confidence)
  }
  // 文本
  if (t && t.scores && t.confidence >= MIN_MODALITY_CONFIDENCE) {
    const w = weights.text * t.confidence
    for (const e of EXPRESSIONS) {
      if (typeof t.scores[e] === 'number') {
        fusedScores[e] += t.scores[e] * w
      }
    }
    totalWeight += w
    modalitiesUsed.push('text')
    modalityConfidences.text = t.confidence
  }
  // 归一化
  if (totalWeight > 0) {
    for (const k of Object.keys(fusedScores)) {
      fusedScores[k] = fusedScores[k] / totalWeight
    }
  } else {
    // 全无信号
    return {
      dominant: 'neutral',
      scores: emptyScores(),
      confidence: 0,
      agreement: 'insufficient',
      modalities,
      modalityConfidences,
      modalitiesUsed: [],
      ambiguous: true,
      timestamp: now,
    }
  }
  // 找 dominant
  let dominant = 'neutral'
  let best = -1
  for (const [k, v] of Object.entries(fusedScores)) {
    if (v > best) {
      best = v
      dominant = k
    }
  }
  // 6) confidence 调整（按一致性）
  let confidence = fusedScores[dominant]
  let finalDominant = dominant
  let ambiguous = false
  if (vote.agreement === 'all') {
    confidence = clamp(confidence * 1.15, 0, 1)  // +15% boost
  } else if (vote.agreement === 'majority') {
    confidence = clamp(confidence * 1.05, 0, 1)  // +5% boost
    // 2/3 一致时，dominant 用投票结果（防止 confidence 最高的模态是少数派）
    if (vote.dominant && vote.dominant !== dominant) {
      // 如果投票的 dominant 比 confidence 最高的更一致（2/3 多数），用投票结果
      // 但 fused scores 可能仍然倾向 confidence 高的 → 看具体大小
      if (fusedScores[vote.dominant] > fusedScores[dominant] * 0.7) {
        finalDominant = vote.dominant
      }
    }
  } else if (vote.agreement === 'split') {
    ambiguous = true
    confidence = clamp(confidence * 0.7, 0, 1)  // -30%
  } else {  // insufficient
    ambiguous = true
  }
  return {
    dominant: finalDominant,
    scores: fusedScores,
    confidence,
    agreement: vote.agreement,
    modalities,
    modalityConfidences,
    modalitiesUsed,
    ambiguous,
    timestamp: now,
  }
}

export {
  DEFAULT_MODALITY_WEIGHTS,
  TEXT_TO_7,
  MIN_MODALITY_CONFIDENCE,
  HIGH_AGREEMENT,
  VERY_HIGH_AGREEMENT,
  EXPRESSIONS,
}
