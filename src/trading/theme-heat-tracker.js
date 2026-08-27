/**
 * 题材热度时间序列追踪 —— 信息选时 (theme-heat-tracker.js)
 *
 * 「什么时候买」的关键：只看「今天最热题材」等于追高；要赢在题材爆发前，
 * 必须追踪题材热度随时间的变化，识别「从冷到热」的升温/爆发前先手信号。
 *
 * 职责：
 *   - 把每日题材热度快照落盘为时间序列（data/theme-heat-history.json）；
 *   - 用近期基线判断每个题材处于哪个阶段：
 *       EMERGE 爆发前先手（从冷/无 → 首次显著升温）  ← 最该押的「买什么+什么时候买」
 *       RISE   持续升温（热度明显高于近期基线）
 *       HOT    已爆发（已高位，追高风险大）
 *       QUIET  平静（无信息催化）
 *
 * 落盘历史可日后复盘：看她标记 EMERGE/RISE 的题材，是否领先于后续涨幅。
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
export const DEFAULT_HISTORY_PATH = join(__dirname, '..', '..', 'data', 'theme-heat-history.json')

/** 读取历史时间序列。返回 [{ date, themes: {theme: heat} }]（按日期升序）。 */
export function loadHistory(path = DEFAULT_HISTORY_PATH) {
  if (!existsSync(path)) return []
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'))
    const days = Array.isArray(data?.days) ? data.days : []
    return days
      .filter((d) => d && typeof d.date === 'string')
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  } catch {
    return []
  }
}

/** 保存历史时间序列。 */
export function saveHistory(days, path = DEFAULT_HISTORY_PATH) {
  mkdirSync(dirname(path), { recursive: true })
  const sorted = [...days].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  writeFileSync(path, JSON.stringify({ days: sorted }, null, 2), 'utf8')
  return sorted
}

/**
 * 写入/更新「今天」的题材热度快照（同日多次运行覆盖式更新，避免刷屏）。
 * @param {string} date YYYY-MM-DD
 * @param {Record<string, number>} themes {题材: 热度}
 * @returns {Array} 更新后的完整时间序列
 */
export function appendSnapshot(date, themes, path = DEFAULT_HISTORY_PATH) {
  const days = loadHistory(path)
  const i = days.findIndex((d) => d.date === date)
  const snap = { date, themes: { ...themes } }
  if (i >= 0) days[i] = snap
  else days.push(snap)
  return saveHistory(days, path)
}

/** 近期（不含今天）基线：对某题材取最近 N 天热度均值；无历史则 0。 */
export function baselineHeat(history, theme, n = 3) {
  const vals = []
  for (let i = history.length - 1; i >= 0 && vals.length < n; i--) {
    const h = history[i]?.themes?.[theme]
    if (typeof h === 'number') vals.push(h)
  }
  if (!vals.length) return 0
  return vals.reduce((a, b) => a + b, 0) / vals.length
}

/** 某题材最近一次（不含今天）热度；无历史则 0。 */
export function prevHeat(history, theme) {
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i]?.themes?.[theme]
    if (typeof h === 'number') return h
  }
  return 0
}

/**
 * 判断单个题材所处的「选时阶段」。
 * @param {number} heat 今日热度
 * @param {number} baseline 近期基线热度
 * @param {number} prev 最近一次热度
 * @returns {{signal:string, delta:number, label:string}}
 */
export function classifyTheme(heat, baseline, prev) {
  const delta = heat - baseline
  if (heat < 2) return { signal: 'QUIET', delta, label: '平静' }
  if (baseline < 1 && prev <= 1) return { signal: 'EMERGE', delta, label: '爆发前先手' }
  if (heat >= 2 && delta >= 2) return { signal: 'RISE', delta, label: '持续升温' }
  if (heat >= 5) return { signal: 'HOT', delta, label: '已爆发(追高风险)' }
  return { signal: 'QUIET', delta, label: '平静' }
}

/** 选时信号优先级（数值越大越该押注）。 */
export const SIGNAL_PRIORITY = { EMERGE: 3, RISE: 2, HOT: 1, QUIET: 0 }

/**
 * 对今日题材热度做选时分析。
 * @param {Record<string, number>} themes 今日 {题材: 热度}
 * @param {Array} [history] 历史时间序列（不含或含今天均可，基线只取更早日期）
 * @param {{baselineDays?:number}} [options]
 * @returns {Array<{theme:string, heat:number, baseline:number, prev:number, delta:number, signal:string, label:string}>}
 */
export function analyzeTiming(themes = {}, history = [], { baselineDays = 3, asOfDate = null } = {}) {
  const today = asOfDate ?? new Date().toISOString().slice(0, 10)
  const prior = history.filter((d) => d.date < today)
  return Object.entries(themes)
    .map(([theme, heat]) => {
      const baseline = baselineHeat(prior, theme, baselineDays)
      const prev = prevHeat(prior, theme)
      const { signal, delta, label } = classifyTheme(heat, baseline, prev)
      return { theme, heat, baseline: Math.round(baseline * 100) / 100, prev, delta: Math.round(delta * 100) / 100, signal, label }
    })
    .sort((a, b) => (SIGNAL_PRIORITY[b.signal] - SIGNAL_PRIORITY[a.signal]) || (b.heat - a.heat))
}