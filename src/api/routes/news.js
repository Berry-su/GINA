/**
 * news.js — 财经新闻 API 路由
 *
 * 端点：
 *   GET  /api/news/latest        获取最新新闻
 *   GET  /api/news/category/:cat 按类别获取新闻
 *   GET  /api/news/summary       获取新闻摘要（用于prompt注入）
 *   GET  /api/news/status        获取新闻系统状态
 *   POST /api/news/refresh       手动触发新闻更新
 */

import { 
  getLatestNews, 
  getNewsByCategory, 
  getNewsSummary,
  getAggregatorStatus,
  forceUpdate,
  NEWS_CATEGORIES,
} from '../../data-sources/news-aggregator.js'
import { startNewsScheduler, stopNewsScheduler, getNewsSchedulerStatus, triggerNewsUpdate } from '../../data-sources/news-scheduler.js'
import { jsonResponse, readJsonBody } from '../utils.js'

export async function handleNews(req, res, url) {
  const pathname = url.pathname

  // GET /api/news/latest
  if (req.method === 'GET' && pathname === '/api/news/latest') {
    const limit = parseInt(url.searchParams.get('limit') || '20')
    const category = url.searchParams.get('category')
    const minImportance = parseFloat(url.searchParams.get('importance') || '0')
    
    const items = getLatestNews({ limit, category, minImportance })
    return jsonResponse(res, 200, {
      success: true,
      count: items.length,
      items: items.map(item => ({
        title: item.title,
        summary: item.summary,
        source: item.source,
        url: item.url,
        timestamp: item.timestamp,
        category: item.category,
        importance: item.importance,
        symbols: item.symbols,
      })),
    })
  }

  // GET /api/news/category/:cat
  const categoryMatch = pathname.match(/^\/api\/news\/category\/([^/]+)$/)
  if (req.method === 'GET' && categoryMatch) {
    const category = decodeURIComponent(categoryMatch[1])
    const limit = parseInt(url.searchParams.get('limit') || '10')
    const items = getNewsByCategory(category, { limit })
    return jsonResponse(res, 200, {
      success: true,
      category,
      count: items.length,
      items: items.map(item => ({
        title: item.title,
        source: item.source,
        timestamp: item.timestamp,
        importance: item.importance,
      })),
    })
  }

  // GET /api/news/summary
  if (req.method === 'GET' && pathname === '/api/news/summary') {
    const maxItems = parseInt(url.searchParams.get('maxItems') || '10')
    const minImportance = parseFloat(url.searchParams.get('importance') || '0.25')
    const summary = getNewsSummary({ maxItems, minImportance })
    return jsonResponse(res, 200, {
      success: true,
      summary,
      hasNews: summary.length > 0,
    })
  }

  // GET /api/news/status
  if (req.method === 'GET' && pathname === '/api/news/status') {
    const aggregatorStatus = getAggregatorStatus()
    const schedulerStatus = getNewsSchedulerStatus()
    const categories = Object.entries(NEWS_CATEGORIES).map(([key, value]) => ({
      key,
      value,
      label: getCategoryLabel(key),
    }))
    return jsonResponse(res, 200, {
      success: true,
      aggregator: aggregatorStatus,
      scheduler: schedulerStatus,
      categories,
    })
  }

  // POST /api/news/refresh
  if (req.method === 'POST' && pathname === '/api/news/refresh') {
    try {
      const config = await readJsonBody(req) || {}
      const result = await triggerNewsUpdate(config)
      return jsonResponse(res, 200, {
        success: result.success,
        itemsProcessed: result.items?.length || 0,
        knowledgeInjected: result.injectedCount || 0,
        durationMs: result.durationMs || 0,
      })
    } catch (e) {
      return jsonResponse(res, 500, { success: false, error: e.message })
    }
  }

  // POST /api/news/scheduler/start
  if (req.method === 'POST' && pathname === '/api/news/scheduler/start') {
    const body = await readJsonBody(req) || {}
    const intervalMs = body.intervalMs || 900000
    const result = startNewsScheduler({ intervalMs, config: body.config || {} })
    return jsonResponse(res, 200, { success: true, ...result })
  }

  // POST /api/news/scheduler/stop
  if (req.method === 'POST' && pathname === '/api/news/scheduler/stop') {
    stopNewsScheduler()
    return jsonResponse(res, 200, { success: true })
  }

  // 404
  jsonResponse(res, 404, { success: false, error: 'Not found' })
}

function getCategoryLabel(key) {
  const labels = {
    macro: '宏观经济',
    policy: '政策法规',
    stock: '股票市场',
    bond: '债券市场',
    forex: '外汇市场',
    commodity: '大宗商品',
    real_estate: '房地产',
    tech: '科技',
    ai: '人工智能',
    crypto: '加密货币',
    company: '公司动态',
    economy: '经济数据',
    international: '国际市场',
    other: '其他',
  }
  return labels[key] || key
}