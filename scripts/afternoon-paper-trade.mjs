/**
 * Gina 全天模拟交易引擎 (afternoon-paper-trade.mjs)
 *
 * 每天：盘前(09:00)选股 → 开盘(09:30)用「滚动本金」等权建仓 → 中午(11:30)出持仓盈亏日志
 * → 每分钟实时盯盘 → 收盘(15:00)结算全天盈亏、更新滚动本金、发日志 + macOS 通知，
 * 并反思当天「学到什么/吸收什么经验」，蒸馏成交易技能。
 *
 * 本金滚动复利：起始 1 万，每天盈亏计入 `data/paper-trade/capital.json`；次日以「昨日结算余额」
 * 全仓再投（不复位），一直滚到用户喊「结束模拟」为止，看 1 万能滚到多少。
 *
 * 建仓时点裁决：
 *   - 引擎在午休(11:30)前启动 → 全天单边：09:30 开盘价建仓，持有到 15:00。
 *   - 引擎在午休(11:30)后启动（如某天手动补跑/半日）→ 半天：13:00 建仓，持有到 15:00。
 *
 * 数据源：新浪财经（hq.sinajs.cn 实时批量行情 + 1 分钟 K 线），直连、无需代理、不受限流。
 * 全部为模拟盘（纸面成交，不向券商发真单）；正式真实下单需用户授权。
 *
 * 用法：
 *   node scripts/afternoon-paper-trade.mjs --once     # 立即出一份快照（只读，不动滚动本金）
 *   node scripts/afternoon-paper-trade.mjs --watch    # 常驻：建仓 → 11:30 日志 → 盯盘 → 15:00 结算滚动
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'
import { minutesInTimeZone } from '../src/finance-data-engine/market-calendar.js'
import { generateTradingSkill } from '../src/memory/trading-skill-generator.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const OUT_DIR = join(root, 'data', 'afternoon-paper')
const STATE_DIR = join(root, 'data', 'paper-trade')
const STATE_FILE = join(STATE_DIR, 'capital.json')
const SKILLS_DIR = join(root, 'skills')

const INITIAL_CAPITAL = 10000 // 起始模拟本金（元）
const CN_OPEN_MORNING = 9 * 60 + 30 // 09:30 开盘
const CN_LUNCH = 11 * 60 + 30 // 11:30 午休开始（中午收盘）
const CN_OPEN_AFTERNOON = 13 * 60 // 13:00 下午开盘
const CN_CLOSE = 15 * 60 // 15:00 收盘

const sina = (code) => (code.startsWith('6') ? 'sh' : 'sz') + code
const pct = (v) => (v >= 0 ? '+' : '') + (v * 100).toFixed(2) + '%'
const money = (v) => (v >= 0 ? '+' : '') + v.toFixed(0) + '元'

// ---------- 滚动本金状态 ----------
function loadState() {
  if (!existsSync(STATE_FILE)) {
    return { balance: INITIAL_CAPITAL, startedAt: new Date().toISOString().slice(0, 10), history: [] }
  }
  try {
    const s = JSON.parse(readFileSync(STATE_FILE, 'utf8'))
    return { balance: s.balance ?? INITIAL_CAPITAL, startedAt: s.startedAt, history: s.history ?? [] }
  } catch {
    return { balance: INITIAL_CAPITAL, startedAt: new Date().toISOString().slice(0, 10), history: [] }
  }
}

function saveState(state) {
  mkdirSync(STATE_DIR, { recursive: true })
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8')
}

// ---------- 行情 ----------
async function fetchBatchQuotes(codes) {
  const url = `https://hq.sinajs.cn/list=${codes.map(sina).join(',')}`
  const resp = await fetch(url, { headers: { Referer: 'https://finance.sina.com.cn', 'User-Agent': 'Mozilla/5.0' } })
  if (!resp.ok) throw new Error(`HTTP ${resp.status} hq.sinajs.cn`)
  const buf = await resp.arrayBuffer()
  const text = new TextDecoder('gbk').decode(buf)
  const out = {}
  for (const line of text.split('\n')) {
    const m = line.match(/hq_str_(s[hz]\d{6})="(.*)"/)
    if (!m) continue
    const code = m[1].slice(2)
    const f = m[2].split(',')
    out[code] = {
      code,
      name: f[0] ?? '',
      open: Number(f[1]),
      preClose: Number(f[2]),
      price: Number(f[3]),
      high: Number(f[4]),
      low: Number(f[5]),
      time: f[31] ?? '',
    }
  }
  return out
}

async function fetchMinuteKline(code) {
  const url = `https://quotes.sina.cn/cn/api/json_v2.php/CN_MarketDataService.getKLineData?symbol=${sina(code)}&scale=1&ma=no&datalen=250`
  const resp = await fetch(url, { headers: { Referer: 'https://finance.sina.com.cn', 'User-Agent': 'Mozilla/5.0' } })
  if (!resp.ok) throw new Error(`HTTP ${resp.status} kline`)
  const arr = await resp.json()
  const today = new Date().toISOString().slice(0, 10)
  return (Array.isArray(arr) ? arr : [])
    .filter((b) => b.day?.startsWith(today))
    .map((b) => ({ time: b.day.slice(11, 16), open: Number(b.open), close: Number(b.close) }))
    .sort((a, b) => (a.time < b.time ? -1 : 1))
}

/** 建仓价 = 指定时点(entryMin) 起首笔 open；该时点尚未到来则回退其前最后一笔 close。 */
function openEntry(bars, entryMin) {
  const hh = String(Math.floor(entryMin / 60)).padStart(2, '0')
  const mm = String(entryMin % 60).padStart(2, '0')
  const t = `${hh}:${mm}`
  const after = bars.filter((b) => b.time >= t)
  if (after.length) return after[0].open
  const before = bars.filter((b) => b.time < t)
  return before.length ? before[before.length - 1].close : null
}

/**
 * 兜底：候选若全被风控官否决，回退「短线攻击手」分重选（低价/小盘/连板/涨停优先），
 * 保证交易绝不空仓（用户硬约束）。与 start-trading.mjs 的 reselectPicks 同源规则。
 */
function ensureBuyable(picks) {
  if (!picks.length) return picks
  if (picks.some((p) => !p.vetoed)) return picks
  // 全被否决 → 回退攻击手分重选前 3（即便 0 分也选，绝不空仓）
  return picks
    .slice()
    .sort((a, b) => (b.attacker ?? 0) - (a.attacker ?? 0))
    .slice(0, 3)
    .map((p) => ({ ...p, vetoed: false, reselected: true }))
}

function loadTodayPicks() {
  const today = new Date().toISOString().slice(0, 10)
  const logPath = join(root, 'data', 'daily-logs', `${today}.json`)
  if (!existsSync(logPath)) return { date: today, picks: [] }
  const rec = JSON.parse(readFileSync(logPath, 'utf8'))
  return { date: today, picks: ensureBuyable(rec.picks ?? []), top: rec.top ?? null }
}

async function buildEntries(picks, entryMin) {
  const map = {}
  for (const p of picks) {
    // 风控官否决的票不建仓（一票否决），不去拉 K 线、不给建仓价
    if (p.vetoed) { map[p.code] = { entry: null, vetoed: true }; continue }
    try {
      const bars = await fetchMinuteKline(p.code)
      map[p.code] = { entry: openEntry(bars, entryMin) }
    } catch {
      map[p.code] = { entry: null }
    }
  }
  return map
}

/** 生成一次快照 + 用当日滚动本金等权持仓。 */
async function computeSnapshot({ date, picks, entryMin, capital }, entriesMap) {
  const codes = picks.map((p) => p.code)
  let quotes = {}
  try { quotes = await fetchBatchQuotes(codes) } catch { /* 实时行情失败 */ }

  const rows = picks.map((p) => {
    const q = quotes[p.code]
    const e = entriesMap[p.code] ?? {}
    const close = q?.price > 0 ? q.price : null
    const entry = e.entry ?? null
    const simReturn = entry && close ? close / entry - 1 : null
    const dayPct = q?.preClose && close ? close / q.preClose - 1 : null
    return {
      code: p.code,
      name: q?.name || p.name,
      theme: p.theme ?? '',
      signal: p.signal ?? '',
      vetoed: !!p.vetoed,
      entry, close, simReturn, dayPct,
      preClose: q?.preClose ?? null,
      quoteTime: q?.time ?? '',
      error: q && close != null ? undefined : '实时行情拉取失败或停牌',
    }
  })

  // 可交易 = 风控官未否决 + 有实时行情 + 有建仓价（否决票不参与买入）
  const tradable = rows.filter((r) => !r.vetoed && !r.error && r.entry > 0 && r.close > 0)
  const per = tradable.length ? capital / tradable.length : 0
  for (const r of rows) {
    if (r.vetoed || r.error || !(r.entry > 0) || !(r.close > 0)) {
      r.shares = null; r.cost = 0; r.marketValue = null; r.pnlAmount = null
      continue
    }
    r.shares = per / r.entry
    r.cost = per
    r.marketValue = r.shares * r.close
    r.pnlAmount = r.marketValue - per
  }
  const totalCost = tradable.reduce((s, r) => s + r.cost, 0)
  const positionedValue = tradable.reduce((s, r) => s + (r.marketValue ?? 0), 0)
  const cash = capital - totalCost // 未买掉的资金保留为现金
  const totalMarketValue = positionedValue + cash
  const totalPnl = positionedValue - totalCost
  const totalPnlPct = capital ? totalPnl / capital : 0

  const avg = (arr, key) => (arr.length ? arr.reduce((s, r) => s + r[key], 0) / arr.length : null)
  return {
    date,
    fetchedAt: new Date().toISOString(),
    capital,
    entryMin,
    entries: rows,
    summary: {
      capital: +capital.toFixed(2),
      count: rows.length,
      holdingCount: tradable.length,
      perAlloc: +per.toFixed(2),
      totalMarketValue: +totalMarketValue.toFixed(2),
      totalPnl: +totalPnl.toFixed(2),
      totalPnlPct,
      balanceAfter: +(capital + totalPnl).toFixed(2),
      realDayAvg: avg(rows.filter((r) => r.dayPct != null && !r.error), 'dayPct'),
    },
  }
}

function printSnapshot(snap, title = 'Gina 全天模拟交易') {
  const s = snap.summary
  console.log('='.repeat(84))
  console.log(`  ${title} · ${snap.date} · 快照 ${snap.fetchedAt}`)
  console.log('='.repeat(84))
  console.log(`  说明：全程纸面成交（不向券商发真单）；滚动本金，盈亏累计到下个交易日。`)
  console.log(`  ── 持仓（当日本金 ${s.capital} 元，等权买入 ${s.holdingCount} 只）──`)
  console.log(`  ${'代码'.padEnd(8)}${'名称'.padEnd(8)}${'题材'.padEnd(10)}${'建仓'.padStart(8)}${'最新'.padStart(8)}${'股数'.padStart(8)}${'市值'.padStart(9)}${'盈亏'.padStart(9)}${'盈亏率'.padStart(9)}`)
  for (const r of snap.entries) {
    if (r.error && r.close == null) { console.log(`  ${r.code.padEnd(8)}${(r.name ?? '').padEnd(8)}  ${r.error}`); continue }
    if (r.vetoed) { console.log(`  ${r.code.padEnd(8)}${(r.name ?? '').padEnd(8)}${(r.theme ?? '').padEnd(10)}  风控官否决，未买入`); continue }
    console.log(
      `  ${r.code.padEnd(8)}${(r.name ?? '').padEnd(8)}${(r.theme ?? '').padEnd(10)}` +
      `${(r.entry ?? 0).toFixed(2).padStart(8)}${(r.close ?? 0).toFixed(2).padStart(8)}` +
      `${(r.shares ?? 0).toFixed(0).padStart(8)}${(r.marketValue ?? 0).toFixed(0).padStart(9)}` +
      `${money(r.pnlAmount ?? 0).padStart(9)}${pct(r.simReturn ?? 0).padStart(9)}`,
    )
  }
  console.log('  ' + '-'.repeat(76))
  console.log(`  当日：本金 ${s.capital.toFixed(0)} 元 → 市值 ${s.totalMarketValue.toFixed(0)} 元 → 盈亏 ${money(s.totalPnl)}（${pct(s.totalPnlPct)}）· 结算余额 ${s.balanceAfter.toFixed(0)} 元`)
  console.log(`  真实市场·当日（昨收→收盘）等权: ${pct(s.realDayAvg ?? 0)}`)
  console.log('='.repeat(84))
}

async function writeSnapshot(snap) {
  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(join(OUT_DIR, `${snap.date}.json`), JSON.stringify(snap, null, 2), 'utf8')
}

/** 中午收盘(11:30)持仓盈亏日志（缩略）。 */
function logMidday(snap) {
  const s = snap.summary
  const live = snap.entries.filter((r) => r.simReturn != null && !r.error)
  const top = live.slice().sort((a, b) => b.simReturn - a.simReturn)[0]
  const bottom = live.slice().sort((a, b) => a.simReturn - b.simReturn)[0]
  console.log('='.repeat(74))
  console.log(`  Gina 午后开盘前·中午持仓盈亏 · ${snap.date}`)
  console.log(`  本金 ${s.capital.toFixed(0)} 元 → 市值 ${s.totalMarketValue.toFixed(0)} 元 → 午间盈亏 ${money(s.totalPnl)}（${pct(s.totalPnlPct)}）`)
  if (top) console.log(`  领涨: ${top.name}(${top.code}) ${pct(top.simReturn)} · 领跌: ${bottom.name}(${bottom.code}) ${pct(bottom.simReturn)}`)
  console.log('='.repeat(74))
}

/** 反思当天交易：领涨/领跌共性 → 蒸馏交易技能。 */
function distillDailyLesson(snap) {
  const rows = snap.entries.filter((r) => r.simReturn != null && !r.error)
  if (!rows.length) return null
  const winners = rows.filter((r) => r.simReturn > 0).sort((a, b) => b.simReturn - a.simReturn)
  const losers = rows.filter((r) => r.simReturn <= 0).sort((a, b) => a.simReturn - b.simReturn)
  const s = snap.summary
  const ok = s.totalPnl > 0
  const themeOf = (r) => r.theme || r.signal || '无题材'
  return {
    name: 'trading-paper-intraday',
    description: `每日全天模拟盘复盘(${snap.date})：本金${s.capital.toFixed(0)} 持有${s.holdingCount}只 盈亏${money(s.totalPnl)}(${pct(s.totalPnlPct)}) 赢${winners.length}/输${losers.length}`,
    when: ok
      ? '整体为正：复盘领涨票的题材/信号共性，次日优先延续同类'
      : '整体为负：复盘领跌票的进场理由，收紧阈值、次日少追高',
    how: ok
      ? `延续领涨：${winners.slice(0, 3).map((w) => `${w.name}(${themeOf(w)})`).join('、') || '无'}`
      : `规避领跌：${losers.slice(0, 3).map((l) => `${l.name}(${themeOf(l)})`).join('、') || '无'}`,
    notes: [
      `赢家: ${winners.slice(0, 4).map((w) => `${w.name}+${(w.simReturn * 100).toFixed(1)}%`).join(' ') || '无'}`,
      `输家: ${losers.slice(0, 4).map((l) => `${l.name}${(l.simReturn * 100).toFixed(1)}%`).join(' ') || '无'}`,
    ],
  }
}

function writeLearning(snap, lesson, state) {
  const s = snap.summary
  const rows = snap.entries.filter((r) => r.simReturn != null && !r.error)
  const winners = rows.filter((r) => r.simReturn > 0).sort((a, b) => b.simReturn - a.simReturn)
  const losers = rows.filter((r) => r.simReturn <= 0).sort((a, b) => a.simReturn - b.simReturn)
  const curve = state.history.map((h) => `${h.date}:${h.balanceAfter.toFixed(0)}`).join(' → ')
  const lines = [
    `# Gina 全天模拟交易 · 学到什么 · ${snap.date}`,
    '',
    `- 当日：本金 ${s.capital.toFixed(0)} 元 → 市值 ${s.totalMarketValue.toFixed(0)} 元 → 盈亏 ${money(s.totalPnl)}（${pct(s.totalPnlPct)}）`,
    `- 滚动净值：${curve || `起始 ${INITIAL_CAPITAL} → ${s.balanceAfter.toFixed(0)}`}`,
    `- 持有 ${s.holdingCount} 只　赢 ${winners.length} / 输 ${losers.length}`,
    '',
    '## 领涨（吸收：什么在涨）',
    ...(winners.length ? winners.map((w) => `- ${w.name}(${w.code}) ${w.theme || w.signal || '无题材'} 持仓收益 ${pct(w.simReturn)}`) : ['- 无']),
    '',
    '## 领跌（教训：什么不该追）',
    ...(losers.length ? losers.map((l) => `- ${l.name}(${l.code}) ${l.theme || l.signal || '无题材'} 持仓收益 ${pct(l.simReturn)}`) : ['- 无']),
    '',
    '## 结论/动作',
    `- ${lesson.when}`,
    `- ${lesson.how}`,
    '',
  ]
  writeFileSync(join(OUT_DIR, `${snap.date}.learning.md`), lines.join('\n'), 'utf8')
}

/** 收盘结算：更新滚动本金 + 打印总结 + 学习蒸馏 + 通知。 */
async function settle(snap, state) {
  const s = snap.summary
  printSnapshot(snap, 'Gina 全天模拟交易 · 收盘总结')
  // 滚动本金
  const dayPnl = s.totalPnl
  state.balance = s.balanceAfter
  state.history.push({ date: snap.date, entry: _fmtEntry(snap.entryMin), dayPnl: +dayPnl.toFixed(2), dayPnlPct: +s.totalPnlPct.toFixed(4), balanceAfter: s.balanceAfter })
  saveState(state)

  const lesson = distillDailyLesson(snap)
  let learned = ''
  if (lesson) {
    writeLearning(snap, lesson, state)
    try { generateTradingSkill(lesson, SKILLS_DIR); learned = '，已蒸馏技能 skills/trading/' } catch { /* 忽略 */ }
  }
  console.log(`  全天学到：${lesson ? lesson.when : '样本不足，等待更多交易日'}${learned}`)
  console.log(`  滚动净值：${state.history.map((h) => `${h.date} ${h.balanceAfter.toFixed(0)}元`).join(' → ')}`)
  console.log(`  已落盘: data/paper-trade/capital.json / data/afternoon-paper/${snap.date}.json / ${snap.date}.learning.md`)
  const msg = `模拟盘 ${money(dayPnl)}(${pct(s.totalPnlPct)}) · 累计 ${s.balanceAfter.toFixed(0)}元`
  try {
    execSync(`/usr/bin/osascript -e "display notification \\"${msg}\\" with title \\"Gina 全天模拟结算\\"" >/dev/null 2>&1 || true`)
  } catch { /* 通知可失败 */ }
}

function _fmtEntry(entryMin) {
  return `${String(Math.floor(entryMin / 60)).padStart(2, '0')}:${String(entryMin % 60).padStart(2, '0')}`
}

/** 建仓时点裁决：午休前启动→全天(09:30)，午休后启动→半天(13:00)。 */
function resolveEntryMin(nowMin) {
  return nowMin < CN_LUNCH ? CN_OPEN_MORNING : CN_OPEN_AFTERNOON
}

async function runOnce() {
  const { date, picks } = loadTodayPicks()
  if (!picks.length) { console.log('今日暂无候选票（data/daily-logs/<今日>.json 为空）。'); return }
  const state = loadState()
  const entryMin = resolveEntryMin(minutesInTimeZone(new Date(), 'Asia/Shanghai'))
  const entriesMap = await buildEntries(picks, entryMin)
  const snap = await computeSnapshot({ date, picks, entryMin, capital: state.balance }, entriesMap)
  await writeSnapshot(snap)
  printSnapshot(snap)
  console.log(`  已落盘: data/afternoon-paper/${snap.date}.json`)
}

async function runWatch() {
  const { date, picks } = loadTodayPicks()
  if (!picks.length) { console.log('今日暂无候选票，模拟盘中止。'); return }

  const state = loadState()
  const bj = () => minutesInTimeZone(new Date(), 'Asia/Shanghai')
  const fmt = (d = new Date()) => new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(d)
  const waitUntil = async (targetMin, label) => {
    const waitMs = (targetMin - bj()) * 60000
    if (waitMs > 0) {
      console.log(`[${fmt()}] ${label}，约 ${Math.floor(waitMs / 60000)} 分钟后执行…`)
      await new Promise((res) => setTimeout(res, waitMs))
    }
  }

  const entryMin = resolveEntryMin(bj())
  const fullDay = entryMin === CN_OPEN_MORNING
  console.log(`[${fmt()}] Gina 全天模拟交易启动 · ${fullDay ? '全天(09:30 建仓)' : '半天(13:00 建仓)'} · 滚动本金 ${state.balance.toFixed(0)} 元 · 候选 ${picks.length} 只`)

  // 等到建仓时点（全天则等 09:30 开盘）
  await waitUntil(entryMin, fullDay ? '等待开盘(09:30)建仓' : '等待下午开盘(13:00)建仓')

  const entriesMap = await buildEntries(picks, entryMin)
  let snap = await computeSnapshot({ date, picks, entryMin, capital: state.balance }, entriesMap)
  await writeSnapshot(snap)
  printSnapshot(snap, fullDay ? 'Gina 全天模拟交易 · 09:30 建仓' : 'Gina 全天模拟交易 · 13:00 建仓')

  // 每分钟盯盘，午间(11:30)出持仓盈亏日志，收盘(15:00)结算滚动
  let middayLogged = false
  const tick = async () => {
    snap = await computeSnapshot({ date, picks, entryMin, capital: state.balance }, entriesMap)
    await writeSnapshot(snap)
    const s = snap.summary
    if (fullDay && !middayLogged && bj() >= CN_LUNCH) { logMidday(snap); middayLogged = true }
    console.log(`[${fmt()}] 盯盘 · 盈亏 ${money(s.totalPnl)}（${pct(s.totalPnlPct)}）· 市值 ${s.totalMarketValue.toFixed(0)}`)
    if (bj() >= CN_CLOSE) {
      await settle(snap, state)
      return
    }
    setTimeout(tick, 60000)
  }
  await tick()
}

const mode = process.argv.includes('--watch') ? 'watch' : 'once'
if (mode === 'watch') await runWatch()
else await runOnce()