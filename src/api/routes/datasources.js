/**
 * datasources.js — 数据源状态 API 路由
 *
 * 端点：
 *   GET /api/datasources           返回各数据源连接状态（配置 + 实时）
 *   GET /api/trading/datasources   别名（DataPage 曾预留的路径）
 *
 * 数据源状态来自真实配置（data/data-sources.json + 环境变量）+ 新闻聚合器实时状态，
 * 供新 UI 的「数据源」页与驾驶舱右列「数据源状态」面板消费。
 */

import { loadDataSourcesConfig } from '../../finance-data-sources/config.js'
import { getFinanceEngine } from '../../brain/index.js'
import { getAggregatorStatus } from '../../data-sources/news-aggregator.js'
import { jsonResponse } from '../utils.js'

export async function handleDataSourcesRoutes(req, res, url) {
  if (req.method !== 'GET') return false
  if (url.pathname !== '/api/datasources' && url.pathname !== '/api/trading/datasources') return false

  const cfg = loadDataSourcesConfig()
  const fe = getFinanceEngine()
  const news = getAggregatorStatus()

  const sources = [
    {
      id: 'tushare',
      name: 'Tushare（A股行情）',
      up: !!cfg.tushareToken,
      detail: cfg.tushareToken ? 'token 已配置' : '未配置 TUSHARE_TOKEN（data-sources.json 或环境变量）',
    },
    {
      id: 'alpaca',
      name: 'Alpaca（美股行情）',
      up: !!(cfg.alpaca.key && cfg.alpaca.secret),
      detail: (cfg.alpaca.key && cfg.alpaca.secret) ? 'key/secret 已配置' : '未配置 ALPACA_KEY / ALPACA_SECRET',
    },
    {
      id: 'yahoo',
      name: 'Yahoo（美股免费行情）',
      up: true,
      detail: '免费行情源，无需密钥（需代理访问）',
    },
    {
      id: 'edgar',
      name: 'SEC EDGAR（美股财报）',
      up: cfg.proxyEnabled,
      detail: cfg.proxyEnabled ? `代理已启用：${cfg.proxy}` : '代理未启用（需 Clash Verge / TUN 模式）',
    },
    {
      id: 'rss',
      name: 'RSS 新闻源（6 路财经）',
      up: cfg.newsFeeds.length > 0 || news.cachedItems > 0,
      detail: `已配置 ${cfg.newsFeeds.length} 个 feed · 缓存 ${news.cachedItems} 条`,
    },
  ]

  return jsonResponse(res, 200, {
    ok: true,
    sources,
    news: {
      lastUpdate: news.lastUpdate,
      lastUpdateAgo: news.lastUpdateAgo,
      totalProcessed: news.totalProcessed,
      cachedItems: news.cachedItems,
    },
    finance: {
      newsSources: fe?.dataEngine?.newsSources?.length ?? 0,
      quoteSources: fe?.dataEngine?.quoteSources?.length ?? 0,
    },
  })
}
