/**
 * 闭环回看器 —— 验证「信息选时」的领先 alpha (eval-lead-lag.mjs)
 *
 * 回答：她标记 EMERGE/RISE 的题材，是否领先于后续涨幅？
 *
 * 做法（无未来函数）：
 *   1. 取题材池全部候选代码 → 拉 baostock 全历史日线（后复权）；
 *   2. 按日回放「选时信号」：只允许用「当天之前」的题材热度作基线；
 *   3. 对每个「标记日 + 题材」，算该题材个股「后续 1/5/10 日」涨幅（均值）；
 *   4. 分两组对比：信号组（EMERGE/RISE）vs 对照组（HOT/QUIET），得命中率与领先 alpha。
 *
 * 用法：node scripts/eval-lead-lag.mjs
 * 预热：跳过历史前 3 天（无基线时全部误判 EMERGE），从第 4 天起才评估。
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'
import { THEME_STOCKS } from '../src/trading/theme-stock-map.js'
import { analyzeTiming, loadHistory } from '../src/trading/theme-heat-tracker.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const WINDOWS = [1, 5, 10]
const WARMUP_DAYS = 3

// ── 1. 题材池全部候选代码 → 拉全历史后复权日线 ─────────────────────────
const themeCodes = {}
const codeName = {}
for (const [theme, stocks] of Object.entries(THEME_STOCKS)) {
  themeCodes[theme] = stocks.map(([code]) => code)
  for (const [code, name] of stocks) codeName[code] = name
}
writeFileSync(join(root, 'data', 'eval-codes.json'), JSON.stringify(Object.entries(codeName).map(([code, name]) => ({ code, name }))), 'utf8')
try {
  execSync('python3 scripts/fetch-eval-klines.py', { cwd: root, stdio: 'inherit' })
} catch (e) {
  console.error('✗ 行情拉取失败：', e?.message)
}

// ── 2. 载入行情 + 热度历史 ─────────────────────────────────────────────
const kPath = join(root, 'data', 'eval-klines.json')
if (!existsSync(kPath)) { console.error('✗ 缺少 data/eval-klines.json'); process.exit(1) }
const kd = JSON.parse(readFileSync(kPath, 'utf8')) // {code: {name, bars:[{date,open,close,pctChg}]}}
const barsByCode = {}
for (const [code, info] of Object.entries(kd)) barsByCode[code] = info.bars ?? []

// 自测：用几天合成热度验证「回放 + 后续涨幅 + 分桶统计」完整链路（不落真实历史）
const buildSyntheticDays = () => [
  { date: '2025-03-03', themes: { '人工智能/AI': 0, '半导体/芯片': 1 } },
  { date: '2025-03-04', themes: { '人工智能/AI': 0, '半导体/芯片': 1 } },
  { date: '2025-03-05', themes: { '人工智能/AI': 0, '半导体/芯片': 1 } },
  { date: '2025-03-06', themes: { '人工智能/AI': 5, '半导体/芯片': 1 } },
  { date: '2025-03-07', themes: { '人工智能/AI': 6, '半导体/芯片': 1 } },
]

const selftest = process.argv.includes('--selftest')
const days = selftest ? buildSyntheticDays() : loadHistory() // 升序 [{date, themes}]

// 某代码在某标记日后第 N 个交易日的涨幅；无足够未来数据则 null。
const fwd = (code, D, N) => {
  const bars = barsByCode[code]
  if (!bars?.length) return null
  const dkey = String(D).replace(/-/g, '')
  let i = 0
  while (i < bars.length && bars[i].date < dkey) i++
  if (i >= bars.length) return null
  const j = i + N
  if (j >= bars.length) return null
  return bars[j].close / bars[i].close - 1
}

// ── 3. 按日回放信号 + 计算后续涨幅 ─────────────────────────────────────
// 汇总：按信号分桶，每个「题材×日」标记算一组后续涨幅样本
const buckets = { EMERGE: [], RISE: [], HOT: [], QUIET: [] }
const marks = [] // 明细

for (let i = WARMUP_DAYS; i < days.length; i++) {
  const asOf = days[i].date
  const prior = days.slice(0, i)
  const timing = analyzeTiming(days[i].themes, prior, { baselineDays: 3, asOfDate: asOf })
  for (const t of timing) {
    const codes = themeCodes[t.theme]
    if (!codes?.length) continue
    // 该题材该日：所有个股后续涨幅的均值
    const sample = { date: asOf, theme: t.theme, signal: t.signal, heat: t.heat, baseline: t.baseline, fwd: {} }
    const valid = []
    for (const code of codes) {
      const row = {}
      let ok = true
      for (const N of WINDOWS) {
        const r = fwd(code, asOf, N)
        if (r == null) { ok = false; break }
        row[N] = r
      }
      if (ok) valid.push(row)
    }
    if (!valid.length) continue
    const avg = {}
    for (const N of WINDOWS) avg[N] = valid.reduce((s, row) => s + row[N], 0) / valid.length
    sample.fwd = avg
    sample.nstocks = valid.length
    buckets[t.signal].push(avg)
    marks.push(sample)
  }
}

// ── 4. 汇总输出 ────────────────────────────────────────────────────────
const stat = (arr) => {
  if (!arr.length) return { n: 0, avg: null, hit: null }
  const avg = {}
  for (const N of WINDOWS) {
    const vs = arr.map((x) => x[N])
    avg[N] = vs.reduce((a, b) => a + b, 0) / vs.length
  }
  const hit5 = arr.filter((x) => x[5] > 0).length / arr.length
  return { n: arr.length, avg, hit5 }
}

const sig = stat([...buckets.EMERGE, ...buckets.RISE]) // 信号组
const ctl = stat([...buckets.HOT, ...buckets.QUIET])   // 对照组
const lead = (sig.avg && ctl.avg) ? { 1: sig.avg[1] - ctl.avg[1], 5: sig.avg[5] - ctl.avg[5], 10: sig.avg[10] - ctl.avg[10] } : null

const pct = (x) => (x == null ? '—' : `${(x * 100).toFixed(2)}%`)

console.log('='.repeat(66))
console.log('  题材选时 · 领先 alpha 回看（无未来函数）')
console.log('='.repeat(66))
console.log(`  热度历史 ${days.length} 天（跳过前 ${WARMUP_DAYS} 天预热） | 可评估标记 ${marks.length} 个`)
console.log('')
console.log('  ── 后续 N 日平均涨幅（题材内个股均值） ──')
console.log(`  信号组 EMERGE+RISE : ${sig.n} 个  |  +1日 ${pct(sig.avg?.[1])}  +5日 ${pct(sig.avg?.[5])}  +10日 ${pct(sig.avg?.[10])}  | 5日命中率 ${pct(sig.hit5)}`)
console.log(`  对照组 HOT+QUIET   : ${ctl.n} 个  |  +1日 ${pct(ctl.avg?.[1])}  +5日 ${pct(ctl.avg?.[5])}  +10日 ${pct(ctl.avg?.[10])}  | 5日命中率 ${pct(ctl.hit5)}`)
if (lead) console.log(`  领先 alpha（信号-对照）: +1日 ${pct(lead[1])}  +5日 ${pct(lead[5])}  +10日 ${pct(lead[10])}`)
console.log('')
console.log('  ── 各信号分桶 ──')
for (const s of ['EMERGE', 'RISE', 'HOT', 'QUIET']) {
  const st = stat(buckets[s])
  console.log(`    ${s.padEnd(6)} : ${st.n} 个  |  +5日 ${pct(st.avg?.[5])}  | 命中率 ${pct(st.hit5)}`)
}
console.log('')
if (marks.length) {
  console.log('  ── 最近标记明细（题材 × 日 → +5日） ──')
  for (const m of marks.slice(-15)) {
    console.log(`    ${m.date} [${m.signal}] ${m.theme} 热度${m.heat} → +5日 ${pct(m.fwd[5])}`)
  }
}
console.log('')
console.log(`  结论: ${sig.n && ctl.n ? (lead && lead[5] > 0 ? '信号组 5 日涨幅领先对照组 → 选时有效 ✓' : '信号组未领先对照组 → 选时无效（需继续观察/修因子）') : '样本不足，需继续积累至少 4 天历史'} `)
console.log('='.repeat(66))

const report = {
  generated: new Date().toISOString(),
  historyDays: days.length,
  warmupDays: WARMUP_DAYS,
  windows: WINDOWS,
  signalGroup: sig,
  controlGroup: ctl,
  leadAlpha: lead,
  bySignal: Object.fromEntries(['EMERGE', 'RISE', 'HOT', 'QUIET'].map((s) => [s, stat(buckets[s])])),
  marks,
}
if (selftest) {
  console.log('  [自测模式] 合成历史，仅验证链路，不写真实报告')
  console.log('='.repeat(66))
  process.exit(0)
}
writeFileSync(join(root, 'data', 'eval-lead-lag.json'), JSON.stringify(report, null, 2), 'utf8')
console.log(`  已落盘: data/eval-lead-lag.json`)