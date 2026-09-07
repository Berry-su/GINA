// emotion-classifier.js — 基于 prosody 的情绪分类
//
// 定位：从聚合 prosody 特征推断 7 类情绪。
// 两种实现：rule-based（纯规则，0 依赖，但精度有限）+ wav2vec2（生产，注入）。
//
// 7 类（与 face-detector 一致）:
//   neutral / happy / sad / angry / surprised / disgusted / fearful
//
// Rule-based 决策（基于 prosody 文献启发式）:
//   happy      high pitch + high energy + high centroid
//   sad        low pitch + low energy + low centroid + low rate
//   angry      high pitch + high energy + high jitter
//   surprised  high pitch + low pause + high flux
//   fearful    high pitch + low energy + high pitch variance
//   disgusted  low pitch + medium energy + low centroid
//   neutral    其他 / 高 pause ratio

import { EXPRESSIONS } from '../visual-emotion/face-detector.js'

// ─── 常量 ───────────────────────────────────────────────────

const PITCH_HIGH_HZ = 200
const PITCH_LOW_HZ = 130
const ENERGY_HIGH = 0.15
const ENERGY_LOW = 0.05
const CENTROID_HIGH_HZ = 1500
const CENTROID_LOW_HZ = 800
const PAUSE_HIGH = 0.5
const RATE_LOW = 2
const RATE_HIGH = 8

const DEFAULT_PITCH_NORM = 200   // 用于归一化
const MIN_CONFIDENCE = 0.1

// ─── Rule-based 分类器 ─────────────────────────────────────

// 7 类情绪（与 face-detector 一致）
export { EXPRESSIONS }

// 输入: aggregateFeatures() 输出
// 返回: { dominant, scores: {neutral, happy, ...}, confidence, stable }
export function classifyByRules(aggregated) {
  if (!aggregated) {
    return { dominant: 'neutral', scores: null, confidence: 0, stable: false }
  }
  const pitchMean = aggregated.pitch?.mean || 0
  const pitchStd = aggregated.pitch?.std || 0
  const rmsMean = aggregated.rms?.mean || 0
  const centroidMean = aggregated.centroid?.mean || 0
  const fluxMean = aggregated.flux?.mean || 0
  const pauseRatio = aggregated.pauseRatio || 0
  const rate = aggregated.speakingRate || 0
  // 7 类规则评分（每类 0-1 分数）
  const scores = {
    neutral: 0,
    happy: 0,
    sad: 0,
    angry: 0,
    surprised: 0,
    disgusted: 0,
    fearful: 0,
  }
  // happy: 高 pitch + 高 energy + 高 centroid
  if (pitchMean > PITCH_HIGH_HZ) scores.happy += 0.3
  if (rmsMean > ENERGY_HIGH) scores.happy += 0.3
  if (centroidMean > CENTROID_HIGH_HZ) scores.happy += 0.2
  if (rate > RATE_HIGH) scores.happy += 0.2
  // sad: 低 pitch + 低 energy + 低 centroid + 低 rate
  if (pitchMean > 0 && pitchMean < PITCH_LOW_HZ) scores.sad += 0.3
  if (rmsMean < ENERGY_LOW) scores.sad += 0.3
  if (centroidMean > 0 && centroidMean < CENTROID_LOW_HZ) scores.sad += 0.2
  if (rate < RATE_LOW) scores.sad += 0.2
  // angry: 高 pitch + 高 energy + 高 pitch 抖动
  if (pitchMean > PITCH_HIGH_HZ) scores.angry += 0.3
  if (rmsMean > ENERGY_HIGH) scores.angry += 0.3
  if (pitchStd > 30) scores.angry += 0.2
  if (rate > RATE_HIGH) scores.angry += 0.2
  // surprised: 高 pitch + 短停顿 + 高 flux
  if (pitchMean > PITCH_HIGH_HZ) scores.surprised += 0.3
  if (pauseRatio < PAUSE_HIGH) scores.surprised += 0.3
  if (fluxMean > 20) scores.surprised += 0.4
  // fearful: 高 pitch + 低 energy + 高 pitch 变化
  if (pitchMean > PITCH_HIGH_HZ) scores.fearful += 0.3
  if (rmsMean < ENERGY_LOW) scores.fearful += 0.2
  if (pitchStd > 30) scores.fearful += 0.3
  if (rate < RATE_LOW) scores.fearful += 0.2
  // disgusted: 低 pitch + 中能量 + 低 centroid
  if (pitchMean > 0 && pitchMean < PITCH_LOW_HZ) scores.disgusted += 0.3
  if (rmsMean >= ENERGY_LOW && rmsMean <= ENERGY_HIGH) scores.disgusted += 0.3
  if (centroidMean > 0 && centroidMean < CENTROID_LOW_HZ) scores.disgusted += 0.4
  // neutral: 高 pause ratio 或无其他信号
  if (pauseRatio > PAUSE_HIGH) scores.neutral += 0.5
  // 全 0 时默认 neutral
  const totalScore = Object.values(scores).reduce((s, x) => s + x, 0)
  if (totalScore === 0) {
    scores.neutral = 0.5
  } else {
    // neutral 基线 = max(0, 1 - 主导类分数)
    const maxOther = Math.max(scores.happy, scores.sad, scores.angry, scores.surprised, scores.fearful, scores.disgusted)
    scores.neutral = Math.max(0.1, 1 - maxOther) * 0.5
  }
  // 找 dominant
  let dominant = 'neutral'
  let bestScore = -1
  for (const [expr, score] of Object.entries(scores)) {
    if (typeof score === 'number' && score > bestScore) {
      bestScore = score
      dominant = expr
    }
  }
  // 归一化到 [0, 1]
  const sum = Object.values(scores).reduce((s, x) => s + x, 0) || 1
  for (const k of Object.keys(scores)) {
    scores[k] = clamp01(scores[k] / sum)
  }
  const confidence = scores[dominant] || 0
  return {
    dominant,
    scores,
    confidence,
    stable: confidence >= 0.4 && bestScore >= MIN_CONFIDENCE,
  }
}

function clamp01(x) {
  if (typeof x !== 'number' || !isFinite(x)) return 0
  return Math.max(0, Math.min(1, x))
}

// ─── Mock 分类器（测试用） ─────────────────────────────────

export function createMockClassifier(options = {}) {
  const fixedScores = options.scores || null
  const fixedDominant = options.dominant || null
  return {
    type: 'mock',
    classify(aggregated) {
      if (fixedScores) {
        return {
          dominant: fixedDominant || 'neutral',
          scores: { ...fixedScores },
          confidence: fixedScores[fixedDominant] || 0.5,
          stable: true,
        }
      }
      return classifyByRules(aggregated)
    },
  }
}

// ─── Wav2Vec2 包装（生产用，注入） ─────────────────────────

export function createWav2Vec2Classifier(options = {}) {
  const inner = options.classifier
  if (!inner || typeof inner.classify !== 'function') {
    throw new Error('createWav2Vec2Classifier: options.classifier must have classify() method')
  }
  return {
    type: 'wav2vec2',
    async classify(aggregated) {
      const r = await inner.classify(aggregated)
      if (!r || typeof r !== 'object') {
        return classifyByRules(aggregated)
      }
      // 适配标准输出
      const scores = {}
      for (const expr of EXPRESSIONS) {
        if (typeof r[expr] === 'number') scores[expr] = r[expr]
        else if (typeof r.scores?.[expr] === 'number') scores[expr] = r.scores[expr]
      }
      if (Object.keys(scores).length === 0) return classifyByRules(aggregated)
      // 归一化
      const sum = Object.values(scores).reduce((s, x) => s + x, 0) || 1
      for (const k of Object.keys(scores)) scores[k] = clamp01(scores[k] / sum)
      let dominant = 'neutral'
      let bestScore = -1
      for (const [expr, score] of Object.entries(scores)) {
        if (score > bestScore) {
          bestScore = score
          dominant = expr
        }
      }
      return {
        dominant,
        scores,
        confidence: scores[dominant] || 0,
        stable: (scores[dominant] || 0) >= 0.4,
      }
    },
  }
}

// ─── 主入口 ────────────────────────────────────────────────

//   options: { classifier, aggregated }
//   返回: classify result
export function classifyEmotion(options = {}) {
  if (!options.classifier || typeof options.classifier.classify !== 'function') {
    return classifyByRules(options.aggregated)
  }
  return options.classifier.classify(options.aggregated)
}

export {
  PITCH_HIGH_HZ,
  PITCH_LOW_HZ,
  ENERGY_HIGH,
  ENERGY_LOW,
  CENTROID_HIGH_HZ,
  CENTROID_LOW_HZ,
  PAUSE_HIGH,
  RATE_LOW,
  RATE_HIGH,
}
