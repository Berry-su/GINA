/**
 * Gina 打板选股因子 alpha 扫描（A 股 · 东方财富免费行情）
 *
 * 目的：回答「涨停之后，哪些特征能预测它第二天继续涨/连板」——
 *       这是打板的真正 alpha（选股能力），而不是「涨停就无脑买」。
 *
 * 无幸存者偏差：从全市场 5552 支股票里「随机抽样」一个宇宙（默认 120 支），
 * 对样本内的每一次「涨停」事件计算因子，再统计不同因子分档下的次日表现。
 *
 * 因子：
 *   - 连板数：首板 / 二板 / 三板及以上
 *   - 价格档：<5 / 5-10 / 10-20 / 20-50 / >50 元
 *   - 换手率：<5% / 5-10% / 10-20% / >20%
 *   - 流通市值(proxy=成交额/换手率)：<30 / 30-100 / 100-300 / >300 亿
 *
 * 结果指标（每档）：
 *   - 样本数、次日开盘卖出收益、次日收盘收益、次日连板率（次日也涨停）
 *
 * 运行：node scripts/factor-scan.mjs [样本数] [start] [end]
 */

import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { fetchJson } from '../src/finance-data-sources/http-client.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pnl = (p) => (p >= 0 ? '+' : '') + (p * 100).toFixed(1) + '%'
const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0)

function limitPct(code) { return /^(30|688)/.test(code) ? 0.20 : 0.10 }
const isLimit = (code, pct) => pct >= limitPct(code) - 0.005

/** 全市场股票列表（代码/名称/总市值）。 */
async function fetchClist() {
  const url = 'https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=6000&po=1&np=1&fltt=2&invt=2&fid=f20&fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23&fields=f12,f14,f20'
  const data = await fetchJson(url, {})
  return (data?.data?.diff ?? []).map((d) => ({ code: String(d.f12), name: d.f14, mcap: d.f20 }))
}

/** 确定性随机抽样。 */
function sample(list, n, seed) {
  let s = seed >>> 0
  const rng = () => { s = (1664525 * s + 1013904223) >>> 0; return s / 4294967296 }
  const idx = new Set()
  while (idx.size < Math.min(n, list.length)) idx.add(Math.floor(rng() * list.length))
  return [...idx].map((i) => list[i])
}

/** 东方财富个股历史日 K（含成交额、换手率）。 */
async function fetchEastmoney(code, startDate, endDate) {
  const market = code.startsWith('6') || code.startsWith('9') ? '1' : '0'
  const secid = market + '.' + code
  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=101&fqt=0&beg=${startDate}&end=${endDate}`
  const data = await fetchJson(url, {})
  const klines = data?.data?.klines ?? []
  return klines.map((line) => {
    const p = String(line).split(',')
    const close = Number(p[2])
    const change = Number(p[9])
    return {
      date: p[0].replace(/-/g, ''),
      open: Number(p[1]), close, high: Number(p[3]), low: Number(p[4]),
      volume: Number(p[5]), amount: Number(p[6]),
      turnover: Number(p[10]),
      preClose: close - change,
      pctChg: Number(p[8]) / 100,
    }
  }).sort((a, b) => a.date.localeCompare(b.date))
}

function bucket(val, bounds) {
  for (const b of bounds) if (val < b.max) return b.label
  return bounds[bounds.length - 1].label
}

async function main() {
  const args = process.argv.slice(2)
  const nn = args.find((a) => /^\d+$/.test(a))
  const N = nn ? Number(nn) : 120
  const dates = args.filter((a) => /^\d{8}$/.test(a))
  const startDate = dates[0] ?? '20200101'
  const endDate = dates[1] ?? '20231231'

  console.log('='.repeat(88))
  console.log(`  Gina 打板选股因子 alpha 扫描 · 全市场随机抽样 ${N} 支 · ${startDate}~${endDate}`)
  console.log('='.repeat(88))

  const universe = sample(await fetchClist(), N, 20260822)
  console.log(`  宇宙抽样 ${universe.length} 支，拉取历史日 K ...`)

  // 分批并发拉取（限流）
  const CONC = 6
  const barsByCode = new Map()
  for (let i = 0; i < universe.length; i += CONC) {
    const batch = universe.slice(i, i + CONC)
    await Promise.all(batch.map(async (u) => {
      try {
        const bars = await fetchEastmoney(u.code, startDate, endDate)
        if (bars.length >= 40) barsByCode.set(u.code, { ...u, bars })
      } catch { /* 跳过该标的 */ }
    }))
    if ((i + CONC) % 60 === 0) console.log(`    ...${Math.min(i + CONC, universe.length)}/${universe.length}`)
  }
  console.log(`  有效标的 ${barsByCode.size} 支\n`)

  // 遍历每个标的的涨停事件，计算因子 + 次日结果
  const PRICE_B = [{ max: 5, label: '<5元' }, { max: 10, label: '5-10元' }, { max: 20, label: '10-20元' }, { max: 50, label: '20-50元' }, { max: Infinity, label: '>50元' }]
  const TURN_B = [{ max: 5, label: '<5%' }, { max: 10, label: '5-10%' }, { max: 20, label: '10-20%' }, { max: Infinity, label: '>20%' }]
  const MCAP_B = [{ max: 30, label: '<30亿' }, { max: 100, label: '30-100亿' }, { max: 300, label: '100-300亿' }, { max: Infinity, label: '>300亿' }]

  const groups = {
    连板数: { '首板': [], '二板': [], '三板及以上': [] },
    价格档: { '<5元': [], '5-10元': [], '10-20元': [], '20-50元': [], '>50元': [] },
    换手率: { '<5%': [], '5-10%': [], '10-20%': [], '>20%': [] },
    流通市值: { '<30亿': [], '30-100亿': [], '100-300亿': [], '>300亿': [] },
  }

  let totalEvents = 0
  for (const [, s] of barsByCode) {
    const lim = limitPct(s.code)
    for (let i = 0; i < s.bars.length - 1; i++) {
      const b = s.bars[i]
      if (!isLimit(s.code, b.pctChg)) continue
      const isYiZi = b.open === b.high && b.high === b.low && b.low === b.close
      if (isYiZi) continue // 一字买不进，跳过

      // 连板数
      let streak = 0
      for (let k = i; k >= 0 && isLimit(s.code, s.bars[k].pctChg); k--) streak++
      const streakLabel = streak >= 3 ? '三板及以上' : streak === 2 ? '二板' : '首板'

      const priceL = bucket(b.close, PRICE_B)
      const turnL = bucket(b.turnover, TURN_B)
      const mcap = b.turnover > 0 ? (b.amount / (b.turnover / 100)) / 1e8 : null // 亿
      const mcapL = mcap == null ? '>300亿' : bucket(mcap, MCAP_B)

      const next = s.bars[i + 1]
      const retOpen = next.open / b.close - 1
      const retClose = next.close / b.close - 1
      const cont = isLimit(s.code, next.pctChg) // 次日连板

      const rec = { retOpen, retClose, cont }
      groups.连板数[streakLabel].push(rec)
      groups.价格档[priceL].push(rec)
      groups.换手率[turnL].push(rec)
      groups.流通市值[mcapL].push(rec)
      totalEvents++
    }
  }

  console.log(`  全样本涨停事件（非一字）：${totalEvents} 次\n`)
  for (const [factor, buckets] of Object.entries(groups)) {
    console.log(`  ── 因子「${factor}」──`)
    console.log(`  ${'分档'.padEnd(12)} ${'样本'.padStart(5)} ${'次日开盘卖'.padStart(10)} ${'次日收盘'.padStart(10)} ${'连板率'.padStart(8)}`)
    for (const [label, arr] of Object.entries(buckets)) {
      if (!arr.length) { console.log(`  ${label.padEnd(12)} ${String(0).padStart(5)}  —`); continue }
      const o = avg(arr.map((r) => r.retOpen))
      const c = avg(arr.map((r) => r.retClose))
      const contRate = arr.filter((r) => r.cont).length / arr.length
      console.log(`  ${label.padEnd(12)} ${String(arr.length).padStart(5)} ${pnl(o).padStart(10)} ${pnl(c).padStart(10)} ${(contRate * 100).toFixed(1).padStart(7)}%`)
    }
    console.log('')
  }
  console.log('='.repeat(88))
}

main().catch((e) => { console.error(e); process.exit(1) })