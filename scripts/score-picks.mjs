/**
 * 行情 → 打分 → 今日买哪只（信息题材候选池 + baostock 行情 + 短线攻击手评分）
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { scoreCandidate } from '../src/analysts/attacker.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const data = JSON.parse(readFileSync(join(__dirname, '..', 'data', 'watchlist-klines.json'), 'utf8'))

const limit = (code) => (/^(30|688)/.test(code) ? 0.20 : 0.10)

const picks = []
for (const [code, info] of Object.entries(data)) {
  const bars = info.bars
  if (bars.length < 25) continue
  const last = bars[bars.length - 1]
  const lim = limit(code)
  const isLimitUp = last.pctChg >= lim - 0.005
  // 连板数
  let streak = 0
  for (let i = bars.length - 1; i >= 0 && bars[i].pctChg >= lim - 0.005; i--) streak++
  // 流通市值 proxy（亿元）
  const floatMcap = last.turnover > 0 ? (last.amount / (last.turnover / 100)) / 1e8 : null
  // 20 日动量
  const mom20 = bars[bars.length - 1].close / bars[bars.length - 21].close - 1

  const sc = scoreCandidate({ price: last.close, floatMcap, turnover: last.turnover, streak, isLimitUp })

  picks.push({
    code, name: info.name, price: last.close, floatMcap, turnover: last.turnover,
    streak, isLimitUp, mom20, pctChg: last.pctChg, score: sc.score, reasons: sc.reasons,
  })
}

picks.sort((a, b) => b.score - a.score)

console.log('='.repeat(64))
console.log('  行情打分 → 今日候选（信息题材池 9 只）')
console.log('='.repeat(64))
console.log(`  ${'代码'.padEnd(7)} ${'名称'.padEnd(5)} ${'现价'.padStart(8)} ${'换手%'.padStart(6)} ${'流通亿'.padStart(9)} ${'连板'.padStart(4)} ${'20日动量'.padStart(8)} ${'评分'.padStart(4)}  理由`)
for (const p of picks) {
  console.log(`  ${p.code.padEnd(7)} ${p.name.padEnd(5)} ${String(p.price?.toFixed(2) ?? '—').padStart(8)} ${String((p.turnover ?? 0).toFixed(2)).padStart(6)} ${String(p.floatMcap ? p.floatMcap.toFixed(0) : '—').padStart(9)} ${String(p.streak).padStart(4)} ${(p.mom20 * 100).toFixed(1).padStart(7)}% ${String(p.score).padStart(4)}  ${p.reasons.join('、')}`)
}

const top = picks[0]
console.log('\n' + '='.repeat(64))
console.log(`  今日最该打：${top.name}(${top.code}) 评分 ${top.score}`)
const strat = top.isLimitUp ? '打板·骑连板（今日涨停，炸板可买则进场骑连板）'
  : top.mom20 < -0.03 ? '低吸（超跌/回落）'
  : '追涨（趋势/动量向上）'
console.log(`  建议策略：${strat}`)
console.log('='.repeat(64))