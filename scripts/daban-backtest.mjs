/**
 * Gina 极限短炒 · 打板回测（A 股 · 东方财富免费行情）
 *
 * 策略（用户指定）：
 *   - 入场：个股「涨停」（或接近涨停）时，满仓买入；
 *   - 出场：次日开盘必须卖出（T+1 铁律，无论涨停还是亏损）；
 *   - 仓位：始终满仓滚动（单标的同时只持一支）；
 *   - 目标：小资金（2000）超短时间滚到 10 倍。
 *
 * 诚实建模（避免高估）：
 *   - T+1：买入日收盘成交、次日开盘机械卖出；
 *   - 一字板买不进：开盘=最高=最低=收盘（一字封死）的涨停日视为「买不到」，跳过；
 *   - 交易成本：往返约 0.15%（印花税卖出 0.05% + 佣金买卖各 0.025% + 过户费 + 滑点）；
 *   - 涨停幅度：主板 10%、创业板(30)/科创板(688) 20%。
 *
 * 运行：
 *   node scripts/daban-backtest.mjs [600776.SH,000957.SZ,...] [start] [end]
 *
 * 注：免费数据只按给定标的池回测，非全市场涨停池；全市场打板期望需涨停池数据（Tushare 2000 积分）。
 */

import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { fetchJson } from '../src/finance-data-sources/http-client.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const round = (v, d = 2) => { const f = 10 ** d; return Math.round(v * f) / f }
const pnl = (p) => (p >= 0 ? '+' : '') + (p * 100).toFixed(2) + '%'
const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length
const COST = 0.0015 // 往返成本 0.15%

function limitPct(code) {
  return /^(30|688)/.test(code) ? 0.20 : 0.10
}

/** 东方财富免费个股历史日 K（返回按日期升序的 bar 数组）。 */
async function fetchEastmoney(tsCode, startDate, endDate, proxyUrl) {
  const [code, mkt] = tsCode.split('.')
  const secid = ((mkt ?? '').toUpperCase() === 'SH' ? '1' : '0') + '.' + code
  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=101&fqt=0&beg=${startDate}&end=${endDate}`
  const data = await fetchJson(url, { proxyUrl })
  const klines = data?.data?.klines ?? []
  return klines.map((line) => {
    const p = String(line).split(',')
    const close = Number(p[2])
    const change = Number(p[9])
    return {
      date: p[0].replace(/-/g, ''),
      open: Number(p[1]), close, high: Number(p[3]), low: Number(p[4]),
      preClose: close - change,
      pctChg: Number(p[8]) / 100,
    }
  }).sort((a, b) => a.date.localeCompare(b.date))
}

async function main() {
  const args = process.argv.slice(2)
  const poolArg = args.find((a) => a.includes('.')) ?? '600776.SH,000957.SZ,002432.SZ,300313.SZ,002771.SZ'
  const pool = poolArg.split(',').map((s) => s.trim())
  const dates = args.filter((a) => /^\d{8}$/.test(a))
  const startDate = dates[0] ?? '20200101'
  const endDate = dates[1] ?? '20231231'

  console.log('='.repeat(88))
  console.log(`  Gina 极限短炒 · 打板回测 · 标的池 ${pool.length} 支 · ${startDate}~${endDate}`)
  console.log('='.repeat(88))

  // 拉取全池日 K
  const stocks = []
  for (const ts of pool) {
    try {
      const bars = await fetchEastmoney(ts, startDate, endDate, null)
      if (bars.length) stocks.push({ ts, code: ts.split('.')[0], bars })
    } catch (e) {
      console.log(`  ⚠ ${ts} 拉取失败：${e?.message}`)
    }
  }
  console.log(`  有效标的 ${stocks.length} 支\n`)

  // 生成每个标的的 涨停买入事件（非一字）
  const events = [] // { ts, buyDate, buyPrice, nextOpen, ret }
  for (const s of stocks) {
    const lim = limitPct(s.code)
    for (let i = 0; i < s.bars.length - 1; i++) {
      const b = s.bars[i]
      if (b.pctChg < lim - 0.005) continue // 未接近涨停
      const isYiZi = b.open === b.high && b.high === b.low && b.low === b.close
      if (isYiZi) continue // 一字板买不进
      const nextOpen = s.bars[i + 1].open
      events.push({
        ts: s.ts, buyDate: b.date, buyPrice: b.close, nextOpen,
        ret: nextOpen / b.close - 1 - COST,
      })
    }
  }
  events.sort((a, b) => a.buyDate.localeCompare(b.buyDate))

  if (events.length === 0) {
    console.log('  该标的池在此区间没有出现「非一字涨停」的买入机会，换一批妖股池再试。')
    return
  }

  // 满仓滚动：每次涨停买入，次日开盘卖出后立即复利
  let equity = 2000
  let wins = 0, totalRet = 0, maxWin = -Infinity, maxLoss = Infinity
  const equityPath = [equity]
  for (const e of events) {
    equity *= (1 + e.ret)
    if (e.ret > 0) wins++
    totalRet += e.ret
    if (e.ret > maxWin) maxWin = e.ret
    if (e.ret < maxLoss) maxLoss = e.ret
    equityPath.push(equity)
  }

  const n = events.length
  const winRate = wins / n
  const avgRet = totalRet / n
  const hitFor10x = avgRet > 0 ? Math.ceil(Math.log(10) / Math.log(1 + avgRet)) : Infinity
  const maxDD = (() => {
    let peak = equityPath[0], dd = 0
    for (const v of equityPath) { if (v > peak) peak = v; dd = Math.max(dd, (peak - v) / peak) }
    return dd
  })()

  console.log('  ── 打板「追首板·次日开盘必卖」全池统计 ──')
  console.log(`  涨停买入机会: ${n} 次   胜率(次日盈利): ${(winRate * 100).toFixed(1)}%`)
  console.log(`  单笔平均收益: ${pnl(avgRet)}   最大单笔盈利 ${pnl(maxWin)}   最大单笔亏损 ${pnl(maxLoss)}`)
  console.log(`  满仓滚动: 2000 → ${round(equity)}（${pnl(equity / 2000 - 1)}）   最大回撤 ${(maxDD * 100).toFixed(1)}%`)
  console.log('')
  console.log('  ── 10 倍可行性（数学） ──')
  if (avgRet <= 0) {
    console.log(`  单笔平均 ${pnl(avgRet)}，为负 → 满仓滚动「永不」到 10 倍（越滚越少）。`)
  } else {
    console.log(`  单笔平均 ${pnl(avgRet)} → 需「连续命中 ${hitFor10x} 次」才到 10 倍；实际单笔胜率仅 ${(winRate * 100).toFixed(1)}%。`)
  }
  console.log('='.repeat(88))
}

main().catch((e) => { console.error(e); process.exit(1) })