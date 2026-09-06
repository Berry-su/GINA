// A/B test statistics: Welch's t-test, 95% confidence interval, sample size calculation.
//
// All functions are pure (no DB, no I/O) — easy to unit test.
//
// Formulas follow standard statistics literature. No external math library needed.

// ─── Summary stats ────────────────────────────────────────────

export function summary(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return { n: 0, mean: 0, variance: 0, stddev: 0, sem: 0, min: 0, max: 0, sum: 0 }
  }
  const n = values.length
  const sum = values.reduce((a, b) => a + b, 0)
  const mean = sum / n
  const min = values.reduce((a, b) => Math.min(a, b), Infinity)
  const max = values.reduce((a, b) => Math.max(a, b), -Infinity)
  let sse = 0
  for (const v of values) {
    const d = v - mean
    sse += d * d
  }
  const variance = n > 1 ? sse / (n - 1) : 0
  const stddev = Math.sqrt(variance)
  const sem = n > 0 ? stddev / Math.sqrt(n) : 0
  return { n, mean, variance, stddev, sem, min, max, sum }
}

// ─── Welch's t-test (two-sample, unequal variance) ────────────

// Returns { t, df, pTwoSided, meanDiff, ciLower, ciUpper, significant }
// ci is for the mean difference at the requested confidence level.
export function welchTTest(aValues, bValues, { confidence = 0.95 } = {}) {
  const a = summary(aValues)
  const b = summary(bValues)
  if (a.n < 2 || b.n < 2) {
    return {
      a, b,
      t: 0, df: 0, pTwoSided: 1,
      meanDiff: a.mean - b.mean,
      ciLower: 0, ciUpper: 0,
      significant: false,
      reason: 'insufficient_samples'
    }
  }
  const varA = a.variance
  const varB = b.variance
  const seDiff = Math.sqrt(varA / a.n + varB / b.n)
  const meanDiff = a.mean - b.mean
  const t = seDiff === 0 ? 0 : meanDiff / seDiff
  // Welch–Satterthwaite degrees of freedom
  const num = (varA / a.n + varB / b.n) ** 2
  const denom = (varA / a.n) ** 2 / (a.n - 1) + (varB / b.n) ** 2 / (b.n - 1)
  const df = denom === 0 ? 0 : num / denom
  const pTwoSided = twoSidedPFromT(t, df)
  // 95% CI for mean diff: t*_df * seDiff
  const tCrit = tCriticalTwoTailed(df, confidence)
  const ciLower = meanDiff - tCrit * seDiff
  const ciUpper = meanDiff + tCrit * seDiff
  const alpha = 1 - confidence
  return {
    a, b,
    t, df, pTwoSided,
    meanDiff,
    seDiff,
    ciLower, ciUpper,
    significant: pTwoSided < alpha,
    confidence
  }
}

// ─── Lift (relative improvement) ──────────────────────────────

// Lift = (b - a) / |a|. Returns null if a is 0 (undefined).
// We use |a| so a negative baseline still produces a meaningful lift.
export function relativeLift(bMean, aMean) {
  if (aMean === 0) return null
  return (bMean - aMean) / Math.abs(aMean)
}

// ─── Minimum sample size (per variant) ───────────────────────

// Standard formula for two-sample t-test, two-sided alpha=0.05, power=0.80.
// Returns per-variant sample size needed to detect effect size `cohensD`
// with the given alpha and power.
//
// Reference: https://stat.ethz.ch/~meier/teaching/anthropologie/SSPS-power.pdf
export function minimumSampleSize({ cohensD = 0.2, alpha = 0.05, power = 0.8 } = {}) {
  if (cohensD <= 0) {
    throw new Error('cohensD must be > 0')
  }
  // z-scores for two-sided alpha
  const zAlpha = inverseNormalCDF(1 - alpha / 2)
  // z-score for power (one-sided)
  const zPower = inverseNormalCDF(power)
  // n per group ≈ 2 * ((zAlpha + zPower) / d)^2
  const n = 2 * Math.pow((zAlpha + zPower) / cohensD, 2)
  return Math.ceil(n)
}

// ─── Statistical helpers (numerical) ─────────────────────────

// Standard normal CDF using Abramowitz & Stegun approximation
export function normalCDF(z) {
  // Save sign
  const sign = z < 0 ? -1 : 1
  const x = Math.abs(z) / Math.sqrt(2)
  // A&S formula 7.1.26
  const t = 1.0 / (1.0 + 0.3275911 * x)
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)
  return 0.5 * (1 + sign * erf)
}

// Inverse normal CDF (probit).
// Uses bisection on normalCDF for robustness. 80 iterations gives ~1e-12 accuracy.
export function inverseNormalCDF(p) {
  if (p <= 0) return -Infinity
  if (p >= 1) return Infinity
  if (Math.abs(p - 0.5) < 1e-15) return 0
  let lo = -10
  let hi = 10
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2
    const cdf = normalCDF(mid)
    if (cdf < p) lo = mid
    else hi = mid
    if (hi - lo < 1e-12) break
  }
  return (lo + hi) / 2
}

// Two-sided p-value from t-statistic and df
// Uses normal approximation for large |t| (numerically stable) and
// incomplete beta for small |t| (accurate for low df).
export function twoSidedPFromT(t, df) {
  if (df <= 0) return 1
  if (t === 0) return 1
  const absT = Math.abs(t)
  // For |t| > 6, normal approximation is essentially exact
  if (absT > 6) {
    return Math.max(0, 2 * (1 - normalCDF(absT)))
  }
  const x = df / (df + t * t)
  const p = 0.5 * incompleteBeta(x, df / 2, 0.5)
  return Math.max(0, Math.min(1, p))
}

// Critical t-value for two-tailed test
export function tCriticalTwoTailed(df, confidence) {
  if (df <= 0) return Infinity
  // For large df (>30), t critical approaches normal z
  if (df > 100) return inverseNormalCDF((1 + confidence) / 2)
  // Use bisection on two-sided p
  const target = (1 + confidence) / 2
  let lo = 0
  let hi = 20
  let mid = 0
  for (let i = 0; i < 60; i++) {
    mid = (lo + hi) / 2
    const cdf = studentTCDF(mid, df)
    if (cdf < target) lo = mid
    else hi = mid
  }
  return mid
}

// Student t CDF (cumulative)
export function studentTCDF(t, df) {
  if (df <= 0) return t >= 0 ? 1 : 0
  const x = df / (df + t * t)
  const tail = 0.5 * incompleteBeta(x, df / 2, 0.5)
  return t >= 0 ? 1 - tail : tail
}

// Regularized incomplete beta function I_x(a, b) via continued fraction
export function incompleteBeta(x, a, b) {
  if (x < 0 || x > 1) throw new Error('x must be in [0, 1]')
  if (x === 0) return 0
  if (x === 1) return 1
  // Use symmetry relation
  if (x > (a + 1) / (a + b + 2)) {
    return 1 - incompleteBeta(1 - x, b, a)
  }
  const lbeta = logGamma(a) + logGamma(b) - logGamma(a + b)
  const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lbeta) / a
  // Lentz's continued fraction
  let c = 1
  let d = 1 - (a + b) * x / (a + 1)
  if (Math.abs(d) < 1e-30) d = 1e-30
  d = 1 / d
  let result = d
  for (let m = 1; m <= 200; m++) {
    const m2 = 2 * m
    let aa = m * (b - m) * x / ((a + m2 - 1) * (a + m2))
    d = 1 + aa * d
    if (Math.abs(d) < 1e-30) d = 1e-30
    c = 1 + aa / c
    if (Math.abs(c) < 1e-30) c = 1e-30
    d = 1 / d
    result *= d * c
    aa = -(a + m) * (a + b + m) * x / ((a + m2) * (a + m2 + 1))
    d = 1 + aa * d
    if (Math.abs(d) < 1e-30) d = 1e-30
    c = 1 + aa / c
    if (Math.abs(c) < 1e-30) c = 1e-30
    d = 1 / d
    const delta = d * c
    result *= delta
    if (Math.abs(delta - 1) < 1e-10) break
  }
  return front * result
}

// log-Gamma function (Lanczos approximation)
export function logGamma(z) {
  if (z < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z)
  }
  const g = 7
  const c = [
    0.99999999999980993,
    676.5203681218851,
    -1259.1392167224028,
    771.32342877765313,
    -176.61502916214059,
    12.507343278686905,
    -0.13857109526572012,
    9.9843695780195716e-6,
    1.5056327351493116e-7
  ]
  z -= 1
  let x = c[0]
  for (let i = 1; i < g + 2; i++) {
    x += c[i] / (z + i)
  }
  const t = z + g + 0.5
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x)
}
