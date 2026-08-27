/**
 * trading.js — 交易域 API 路由
 *
 * 端点（全部只读，下单走授权门不在此层）：
 *   GET /api/trading/quotes?codes=600988,000975  实时行情（新浪直连）
 *   GET /api/trading/picks                        今日盘前 pick（data/daily-logs 真实产出）
 *   GET /api/trading/analysts                     分析师团队观点 + 风控官
 *   GET /api/trading/decisions                    决策建议（权限链：分析师→Gina→用户）
 *   GET /api/trading/status                       交易系统状态 + 大脑健康
 *   GET /api/trading/broker                       券商账户（骨架期 mock 回执，无真实下单）
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { paths } from '../../paths.js'
import { jsonResponse } from '../utils.js'
import { fetchBatchQuotes } from '../../finance-data-engine/sina-quotes.js'
import { getBrainHealth, getAnalystTeam, getFinanceEngine } from '../../brain/index.js'

// 今日盘前 pick 的落盘文件（start-trading.mjs 每日产出）
function todayPickPath(date) {
  return join(paths.dataDir, 'daily-logs', `${date}.json`)
}

function loadTodayPick() {
  const today = new Date().toISOString().slice(0, 10)
  const p = todayPickPath(today)
  if (!existsSync(p)) return { date: today, found: false, picks: [], top: null }
  try {
    const rec = JSON.parse(readFileSync(p, 'utf8'))
    return { date: today, found: true, picks: rec.picks ?? [], top: rec.top ?? null, timing: rec.timing ?? [], orders: rec.orders ?? [] }
  } catch {
    return { date: today, found: false, picks: [], top: null }
  }
}

export async function handleTradingRoutes(req, res, url) {
  const pathname = url.pathname

  // GET /api/trading/quotes?codes=a,b,c
  if (req.method === 'GET' && pathname === '/api/trading/quotes') {
    const codes = (url.searchParams.get('codes') || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 50)
    if (codes.length === 0) return jsonResponse(res, 400, { ok: false, error: 'codes 不能为空' })
    try {
      const quotes = await fetchBatchQuotes(codes)
      const list = codes.map(code => {
        const q = quotes[code]
        if (!q) return { code, name: '', price: null, available: false }
        return {
          code,
          name: q.name,
          price: q.price,
          changePct: q.preClose ? ((q.price - q.preClose) / q.preClose) * 100 : null,
          open: q.open,
          high: q.high,
          low: q.low,
          time: q.time,
          available: true,
        }
      })
      return jsonResponse(res, 200, { ok: true, source: 'sina', quotes: list })
    } catch (e) {
      return jsonResponse(res, 200, { ok: false, error: e.message, source: 'sina' })
    }
  }

  // GET /api/trading/picks
  if (req.method === 'GET' && pathname === '/api/trading/picks') {
    const d = loadTodayPick()
    return jsonResponse(res, 200, {
      ok: true,
      date: d.date,
      found: d.found,
      picks: d.picks,
      top: d.top,
      timing: d.timing,
      orders: d.orders,
    })
  }

  // GET /api/trading/analysts
  if (req.method === 'GET' && pathname === '/api/trading/analysts') {
    const d = loadTodayPick()
    const team = getAnalystTeam()
    // 分析师观点：优先取今日 pick 里真实的分析师逐一看法
    const opinions = d.picks.map(p => ({
      code: p.code,
      name: p.name,
      theme: p.theme,
      bullish: p.bullish,
      bearish: p.bearish,
      neutral: p.neutral,
      action: p.action,
      vetoed: !!p.vetoed,
      analyst: p.analyst,
      reasons: p.reasons,
    }))
    return jsonResponse(res, 200, {
      ok: true,
      date: d.date,
      found: d.found,
      teamSize: team?.size ?? 0,
      opinions,
    })
  }

  // GET /api/trading/decisions
  if (req.method === 'GET' && pathname === '/api/trading/decisions') {
    const d = loadTodayPick()
    // 决策建议：来自今日 top + 各 pick 的 action（权限链最终拍板在用户）
    const decisions = d.picks
      .filter(p => p.action === 'buy' || p.action === 'reduce')
      .map(p => ({
        id: `${d.date}-${p.code}`,
        code: p.code,
        name: p.name,
        theme: p.theme,
        direction: p.action === 'buy' ? 'buy' : 'reduce',
        score: p.score,
        vetoed: !!p.vetoed,
        rationale: p.reasons ?? [],
        status: 'pending',
      }))
    return jsonResponse(res, 200, { ok: true, date: d.date, decisions, top: d.top })
  }

  // GET /api/trading/status
  if (req.method === 'GET' && pathname === '/api/trading/status') {
    const d = loadTodayPick()
    const health = getBrainHealth()
    const fe = getFinanceEngine()
    return jsonResponse(res, 200, {
      ok: true,
      date: d.date,
      pickFound: d.found,
      pickCount: d.picks.length,
      brain: {
        analystCount: getAnalystTeam()?.size ?? 0,
        financeNewsSources: fe?.dataEngine?.newsSources?.length ?? 0,
        financeQuoteSources: fe?.dataEngine?.quoteSources?.length ?? 0,
        catsNetActive: !!health.components?.catsNet?.hasAbstractSpace,
      },
    })
  }

  // GET /api/trading/broker —— 骨架期 mock 回执（真实下单需用户授权 + 券商通道）
  if (req.method === 'GET' && pathname === '/api/trading/broker') {
    return jsonResponse(res, 200, {
      ok: true,
      channel: 'miniQMT',
      channelStatus: 'unconfigured',
      cash: 0,
      positions: [],
      orders: [],
      deals: [],
      mock: true,
      note: 'BrokerAdapter 骨架期仅 mock 回执；真实下单需用户授权 + 券商通道（miniQMT/iFinD）',
    })
  }

  return false
}
