/**
 * news-adapter.js — 金融新闻数据源适配器
 *
 * 设计：适配器模式，统一不同新闻源的接口
 * 支持源：
 *   1. 新浪财经 RSS (免费，无需Key)
 *   2. 东方财富资讯接口 (免费，无需Key)
 *   3. 财联社电报 (免费，无需Key)
 *   4. Tushare (需Token，可选)
 *
 * 数据结构：
 *   NewsItem {
 *     id, title, summary, source, url,
 *     timestamp, categories, symbols, raw
 *   }
 */

import fs from 'fs'
import path from 'path'

const GINA_HOME = process.env.GINA_HOME
  ? path.join(process.env.GINA_HOME, 'knowledge')
  : path.join(process.env.HOME || '.', '.gina', 'knowledge')

const ADAPTER_VERSION = 1
const CACHE_DIR = path.join(GINA_HOME, 'news-cache')

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true })
  }
}

// ─── 通用 HTTP 请求 ────────────────────────────────────────────────────────────

async function fetchJSON(url, options = {}, timeoutMs = 8000) {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), timeoutMs)
    const res = await fetch(url, { signal: ctrl.signal, ...options })
    clearTimeout(t)
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

async function fetchText(url, options = {}, timeoutMs = 8000) {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), timeoutMs)
    const res = await fetch(url, { signal: ctrl.signal, ...options })
    clearTimeout(t)
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
}

// ─── HTML 解析工具（简单提取文本） ────────────────────────────────────────────

function stripHtml(html) {
  if (!html) return ''
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractRssItems(xmlText) {
  if (!xmlText) return []
  const items = []
  const itemRegex = /<item>([\s\S]*?)<\/item>/g
  let match
  while ((match = itemRegex.exec(xmlText)) !== null) {
    const block = match[1]
    const title = (block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) || [])[1] || ''
    const link = (block.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || ''
    
    // 尝试多种摘要字段：description、content:encoded、summary
    let desc = (block.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/) || [])[1] || ''
    if (!desc) desc = (block.match(/<content:encoded[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/content:encoded>/) || [])[1] || ''
    if (!desc) desc = (block.match(/<summary[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/summary>/) || [])[1] || ''
    
    const pubDate = (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || ''
    
    items.push({
      title: stripHtml(title),
      summary: stripHtml(desc).slice(0, 300),
      url: link.trim(),
      timestamp: parseDate(pubDate),
    })
  }
  return items
}

function parseDate(str) {
  if (!str) return Date.now()
  const d = new Date(str)
  return isNaN(d.getTime()) ? Date.now() : d.getTime()
}

// ─── 适配器基类 ────────────────────────────────────────────────────────────────

class NewsAdapter {
  constructor(config = {}) {
    this.name = config.name || 'unknown'
    this.enabled = config.enabled !== false
    this.rateLimitMs = config.rateLimitMs || 60000
    this.lastRequestAt = 0
    this.categories = config.categories || ['finance']
  }

  async fetchNews(options = {}) {
    throw new Error('fetchNews must be implemented by subclass')
  }

  isRateLimited() {
    return Date.now() - this.lastRequestAt < this.rateLimitMs
  }

  markRequested() {
    this.lastRequestAt = Date.now()
  }

  normalizeItem(raw, source) {
    return {
      id: `${source}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      title: raw.title || '无标题',
      summary: raw.summary || raw.description || '',
      source,
      url: raw.url || raw.link || '',
      timestamp: raw.timestamp || Date.now(),
      categories: this.categories,
      symbols: raw.symbols || [],
      raw,
    }
  }
}

// ─── 新浪财经适配器 ───────────────────────────────────────────────────────────

class SinaFinanceAdapter extends NewsAdapter {
  constructor() {
    super({
      name: 'sina_finance',
      enabled: true,
      rateLimitMs: 30000,
      categories: ['finance', 'china', 'stock'],
    })
    this.feedUrls = [
      'https://feed.mix.sina.com.cn/api/roll/get?pageid=153&lid=2516&num=20&versionNumber=1.2.4',
      'https://feed.mix.sina.com.cn/api/roll/get?pageid=153&lid=2517&num=20&versionNumber=1.2.4',
    ]
  }

  async fetchNews({ maxItems = 20 } = {}) {
    if (!this.enabled || this.isRateLimited()) return []

    const allItems = []
    
    for (const url of this.feedUrls) {
      const data = await fetchJSON(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Gina/1.0)' },
      })
      
      if (data?.result?.data) {
        for (const item of data.result.data) {
          allItems.push(this.normalizeItem({
            title: item.title,
            summary: item.intro || '',
            url: item.url || item.wapurl || '',
            timestamp: item.ctime ? parseInt(item.ctime) * 1000 : Date.now(),
            symbols: extractStockCodes(item.title + ' ' + (item.intro || '')),
          }, this.name))
        }
      }
    }

    this.markRequested()
    return allItems.slice(0, maxItems)
  }
}

// ─── 东方财富适配器 ───────────────────────────────────────────────────────────

class EastMoneyAdapter extends NewsAdapter {
  constructor() {
    super({
      name: 'eastmoney',
      enabled: true,
      rateLimitMs: 30000,
      categories: ['finance', 'china', 'stock', 'fund'],
    })
    this.apiUrls = [
      'https://np-listapi.eastmoney.com/comm/web/getNewsByColumns?client=web&biz=web_news_col&column=350&order=1&needInteractData=0&page_index=1&page_size=20',
      'https://np-anotice-stock.eastmoney.com/api/security/ann?page_size=20&page_index=1&ann_type=SHA&client_source=web&f_node=0',
    ]
  }

  async fetchNews({ maxItems = 20 } = {}) {
    if (!this.enabled || this.isRateLimited()) return []

    const allItems = []

    for (const url of this.apiUrls) {
      const data = await fetchJSON(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Gina/1.0)' },
      })

      const items = data?.data?.list || data?.data?.news_list || []
      for (const item of items) {
        allItems.push(this.normalizeItem({
          title: item.title || item.ARTICLE_TITLE || '',
          summary: item.content || item.ARTICLE_CONTENT || '',
          url: item.url || item.ARTICLE_URL || '',
          timestamp: item.showTime ? new Date(item.showTime).getTime() : Date.now(),
          symbols: extractStockCodes(item.title + ' ' + (item.content || '')),
        }, this.name))
      }
    }

    this.markRequested()
    return allItems.slice(0, maxItems)
  }
}

// ─── 财联社适配器 ─────────────────────────────────────────────────────────────

class clsAdapter extends NewsAdapter {
  constructor() {
    super({
      name: 'cls_telegraph',
      enabled: true,
      rateLimitMs: 30000,
      categories: ['finance', 'china', 'telegraph'],
    })
    this.apiUrl = 'https://www.cls.cn/nodeapi/updateTelegraph'
  }

  async fetchNews({ maxItems = 30 } = {}) {
    if (!this.enabled || this.isRateLimited()) return []

    const data = await fetchJSON(`${this.apiUrl}?app=CailianpressWeb&os=web&sv=8.4.6&rn=${maxItems}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Gina/1.0)',
        'Referer': 'https://www.cls.cn/',
      },
    })

    const items = data?.data?.roll_data || []
    const normalized = items.map(item => this.normalizeItem({
      title: item.title || item.content?.slice(0, 100) || '',
      summary: item.content || '',
      url: item.share_url || `https://www.cls.cn/detail/${item.id}`,
      timestamp: item.ctime ? item.ctime * 1000 : Date.now(),
      symbols: extractStockCodes(item.title + ' ' + (item.content || '')),
    }, this.name))

    this.markRequested()
    return normalized
  }
}

// ─── 华尔街见闻适配器 ─────────────────────────────────────────────────────────

class WallstreetcnAdapter extends NewsAdapter {
  constructor() {
    super({
      name: 'wallstreetcn',
      enabled: true,
      rateLimitMs: 60000,
      categories: ['finance', 'global', 'macro'],
    })
    this.apiUrl = 'https://api-one.wallstcn.com/apiv1/content/articles'
  }

  async fetchNews({ maxItems = 20 } = {}) {
    if (!this.enabled || this.isRateLimited()) return []

    const data = await fetchJSON(`${this.apiUrl}?channel=global&limit=${maxItems}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Gina/1.0)' },
    })

    const items = data?.data?.items || []
    const normalized = items.map(item => this.normalizeItem({
      title: item.title || '',
      summary: item.summary || item.description || '',
      url: item.uri ? `https://wallstreetcn.com/articles/${item.uri}` : '',
      timestamp: item.display_time ? item.display_time * 1000 : Date.now(),
      symbols: extractStockCodes(item.title + ' ' + (item.summary || '')),
    }, this.name))

    this.markRequested()
    return normalized
  }
}

// ─── 36kr 适配器（AI/科技/创投） ───────────────────────────────────────────────

class Kr36Adapter extends NewsAdapter {
  constructor() {
    super({
      name: 'kr36',
      enabled: true,
      rateLimitMs: 60000,
      categories: ['ai', 'tech', 'startup', 'china'],
    })
    this.rssUrl = 'https://36kr.com/feed'
  }

  async fetchNews({ maxItems = 20 } = {}) {
    if (!this.enabled || this.isRateLimited()) return []

    const xmlText = await fetchText(this.rssUrl, {
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
    })

    if (!xmlText || !xmlText.includes('<item>')) return []

    const rssItems = extractRssItems(xmlText)
    const items = rssItems.map(item => this.normalizeItem({
      title: item.title,
      summary: item.summary,
      url: item.url,
      timestamp: item.timestamp,
      symbols: [],
    }, this.name))

    this.markRequested()
    return items.slice(0, maxItems)
  }
}

// ─── arXiv 适配器（AI 论文预印本） ─────────────────────────────────────────────

class ArxivAdapter extends NewsAdapter {
  constructor() {
    super({
      name: 'arxiv',
      enabled: true,
      rateLimitMs: 120000,
      categories: ['ai', 'tech', 'agent', 'research'],
    })
    this.apiUrl = 'https://export.arxiv.org/api/query'
  }

  async fetchNews({ maxItems = 10 } = {}) {
    if (!this.enabled || this.isRateLimited()) return []

    const params = new URLSearchParams({
      search_query: 'cat:cs.AI OR cat:cs.CL OR cat:cs.MA',
      start: '0',
      max_results: String(maxItems),
      sortBy: 'submittedDate',
      sortOrder: 'descending',
    })

    const xmlText = await fetchText(`${this.apiUrl}?${params}`, {
      headers: { 'User-Agent': 'Gina/1.0 (academic research aggregator)' },
    })

    if (!xmlText) return []

    const items = []
    const entryRegex = /<entry>([\s\S]*?)<\/entry>/g
    let match
    
    while ((match = entryRegex.exec(xmlText)) !== null) {
      const block = match[1]
      const title = (block.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || ''
      const summary = (block.match(/<summary>([\s\S]*?)<\/summary>/) || [])[1] || ''
      const id = (block.match(/<id>([\s\S]*?)<\/id>/) || [])[1] || ''
      const updated = (block.match(/<updated>([\s\S]*?)<\/updated>/) || [])[1] || ''
      
      // 提取 PDF 链接
      const links = [...block.matchAll(/<link href="([^"]*)"[^>]*>/g)]
      const pdfLink = links.find(l => l[1].includes('pdf'))?.[1] || id.replace('abs', 'pdf')
      
      if (title.trim()) {
        items.push(this.normalizeItem({
          title: `[arXiv] ${title.trim().replace(/\s+/g, ' ')}`,
          summary: summary.trim().replace(/\s+/g, ' ').slice(0, 300),
          url: pdfLink || id,
          timestamp: new Date(updated).getTime() || Date.now(),
          symbols: [],
        }, this.name))
      }
    }

    this.markRequested()
    return items.slice(0, maxItems)
  }
}

// ─── InfoQ 适配器（AI/Agent/开发） ─────────────────────────────────────────────

class InfoQAdapter extends NewsAdapter {
  constructor() {
    super({
      name: 'infoq',
      enabled: true,
      rateLimitMs: 60000,
      categories: ['ai', 'tech', 'agent', 'china'],
    })
    this.rssUrl = 'https://www.infoq.cn/feed'
  }

  async fetchNews({ maxItems = 20 } = {}) {
    if (!this.enabled || this.isRateLimited()) return []

    const xmlText = await fetchText(this.rssUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Gina/1.0)' },
    })

    if (!xmlText) return []

    const rssItems = extractRssItems(xmlText)
    const items = rssItems.map(item => this.normalizeItem({
      title: item.title,
      summary: item.summary,
      url: item.url,
      timestamp: item.timestamp,
      symbols: [],
    }, this.name))

    this.markRequested()
    return items.slice(0, maxItems)
  }
}

// ─── TechCrunch AI 适配器（国际AI/前沿技术） ────────────────────────────────────

class TechCrunchAIAdapter extends NewsAdapter {
  constructor() {
    super({
      name: 'techcrunch_ai',
      enabled: true,
      rateLimitMs: 60000,
      categories: ['ai', 'tech', 'agent', 'global'],
    })
    this.rssUrl = 'https://techcrunch.com/category/artificial-intelligence/feed/'
  }

  async fetchNews({ maxItems = 20 } = {}) {
    if (!this.enabled || this.isRateLimited()) return []

    const xmlText = await fetchText(this.rssUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Gina/1.0)' },
    })

    if (!xmlText) return []

    const rssItems = extractRssItems(xmlText)
    const items = rssItems.map(item => this.normalizeItem({
      title: item.title,
      summary: item.summary,
      url: item.url,
      timestamp: item.timestamp,
      symbols: extractStockCodes(item.title + ' ' + (item.summary || '')),
    }, this.name))

    this.markRequested()
    return items.slice(0, maxItems)
  }
}

// ─── Hacker News 适配器（技术社区/AI讨论） ──────────────────────────────────────

class HackerNewsAdapter extends NewsAdapter {
  constructor() {
    super({
      name: 'hackernews',
      enabled: true,
      rateLimitMs: 30000,
      categories: ['tech', 'ai', 'agent', 'global'],
    })
    this.apiUrl = 'https://hacker-news.firebaseio.com/v0'
  }

  async fetchNews({ maxItems = 15 } = {}) {
    if (!this.enabled || this.isRateLimited()) return []

    const storyIds = await fetchJSON(`${this.apiUrl}/topstories.json`)
    if (!storyIds) return []

    const items = []
    const targetCount = Math.min(maxItems, 30)
    
    // 并行获取前N条故事详情
    const detailPromises = storyIds.slice(0, targetCount).map(async (id) => {
      const detail = await fetchJSON(`${this.apiUrl}/item/${id}.json`)
      if (!detail || detail.type !== 'story' || !detail.title) return null
      return this.normalizeItem({
        title: detail.title,
        summary: detail.text ? stripHtml(detail.text).slice(0, 300) : '',
        url: detail.url || `https://news.ycombinator.com/item?id=${id}`,
        timestamp: detail.time ? detail.time * 1000 : Date.now(),
        symbols: extractStockCodes(detail.title),
      }, this.name)
    })

    const results = await Promise.all(detailPromises)
    for (const r of results) {
      if (r) items.push(r)
    }

    this.markRequested()
    return items.slice(0, maxItems)
  }
}

// ─── Zillow Research 适配器（美国地产市场） ─────────────────────────────────────

class ZillowResearchAdapter extends NewsAdapter {
  constructor() {
    super({
      name: 'zillow_research',
      enabled: true,
      rateLimitMs: 120000,
      categories: ['real_estate', 'global', 'market'],
    })
    this.rssUrl = 'https://www.zillow.com/research/rss/'
  }

  async fetchNews({ maxItems = 15 } = {}) {
    if (!this.enabled || this.isRateLimited()) return []

    const xmlText = await fetchText(this.rssUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Gina/1.0)' },
    })

    if (!xmlText) return []

    const rssItems = extractRssItems(xmlText)
    const items = rssItems.map(item => this.normalizeItem({
      title: item.title,
      summary: item.summary,
      url: item.url,
      timestamp: item.timestamp,
      symbols: [],
    }, this.name))

    this.markRequested()
    return items.slice(0, maxItems)
  }
}

// ─── 新浪地产适配器（中国地产行业） ─────────────────────────────────────────────

class SinaRealEstateAdapter extends NewsAdapter {
  constructor() {
    super({
      name: 'sina_realestate',
      enabled: true,
      rateLimitMs: 60000,
      categories: ['real_estate', 'china', 'policy'],
    })
    this.apiUrls = [
      'https://feed.mix.sina.com.cn/api/roll/get?pageid=153&lid=2516&num=20&versionNumber=1.2.4',
      'https://feed.mix.sina.com.cn/api/roll/get?pageid=153&lid=2517&num=20&versionNumber=1.2.4',
    ]
  }

  async fetchNews({ maxItems = 20 } = {}) {
    if (!this.enabled || this.isRateLimited()) return []

    const allItems = []
    const realEstateKeywords = [
      '地产', '房产', '楼市', '房价', '住房', '土地', '开发商', '物业', 
      '楼盘', '购房', '房贷', '公积金', 'REITs', '房产税', '不动产', 
      '家居', '装修', '建材', '房地产', '商品房', '二手房', '新房',
      'housing', 'mortgage', 'property', 'real estate', 'home price',
    ]

    for (const url of this.apiUrls) {
      const data = await fetchJSON(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Gina/1.0)' },
      })

      if (data?.result?.data) {
        for (const item of data.result.data) {
          const title = item.title || ''
          const content = (title + ' ' + (item.intro || '')).toLowerCase()
          const isRealEstate = realEstateKeywords.some(kw => content.includes(kw.toLowerCase()))
          
          if (isRealEstate) {
            allItems.push(this.normalizeItem({
              title,
              summary: item.intro || '',
              url: item.url || item.wapurl || '',
              timestamp: item.ctime ? parseInt(item.ctime) * 1000 : Date.now(),
              symbols: [],
            }, this.name))
          }
        }
      }
    }

    // 如果没有地产相关内容，返回空（不返回无关内容）
    if (allItems.length > 0) {
      this.markRequested()
    }
    return allItems.slice(0, maxItems)
  }
}

// ─── 股票代码提取 ─────────────────────────────────────────────────────────────

const US_STOP_WORDS = new Set([
  'THE', 'AND', 'FOR', 'ARE', 'BUT', 'NOT', 'ALL', 'CAN', 'HER', 'WAS',
  'ONE', 'OUR', 'OUT', 'YOU', 'HAS', 'HAVE', 'FROM', 'THAT', 'THIS',
  'WITH', 'BY', 'AT', 'TO', 'IN', 'ON', 'OF', 'AS', 'IS', 'IT',
  'BE', 'OR', 'AN', 'SO', 'IF', 'NO', 'DO', 'UP', 'GO', 'MY',
  'ME', 'WE', 'THEY', 'SAID', 'NEW', 'YEARS', 'AFTER', 'BEFORE',
  'WHEN', 'ITS', 'MAY', 'WILL', 'WOULD', 'COULD', 'SHOULD', 'WHAT',
  'WHICH', 'THEIR', 'BEEN', 'BEING', 'EACH', 'EVER', 'HAVE', 'JUST',
  'LIKE', 'LONG', 'MAKE', 'MADE', 'MANY', 'MUCH', 'MOST', 'ONLY',
  'OVER', 'SUCH', 'TAKE', 'THAN', 'THEM', 'THEN', 'THERE', 'THESE',
  'UNDER', 'VERY', 'WELL', 'WERE', 'YOUR', 'BEING', 'HAVING',
  'AI', 'API', 'APP', 'CUP', 'DAD', 'EACH', 'FREE', 'GAS', 'HOT',
  'ICE', 'JOB', 'KEY', 'LAB', 'MIX', 'NET', 'OIL', 'PAY', 'QUIT',
  'RUG', 'SUN', 'TOP', 'USE', 'VAN', 'WIN', 'YES', 'ZOO',
  'AMP', 'BTU', 'CAT', 'DOG', 'ELE', 'FOX', 'GOAT', 'HEN', 'INK',
  'JET', 'KID', 'LID', 'MOM', 'NAP', 'ODD', 'POT', 'RAT', 'SIP',
  'TIP', 'URN', 'VOW', 'BOX', 'CRY', 'DRY', 'FLY', 'GUY', 'HUG',
  'JOG', 'KISS', 'LOVE', 'MISS', 'NOSE', 'OPEN', 'PULL', 'RACE',
  'SNOW', 'TRIP', 'UNIT', 'VALUE', 'WATER', 'XRAY', 'YIELD', 'ZEST',
])

// 已知热门股票代码（用于验证美股代码）
const KNOWN_US_STOCKS = new Set([
  'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'NVDA', 'TSLA', 'AMD', 'NFLX',
  'INTC', 'ORCL', 'CRM', 'ADBE', 'PYPL', 'CMCSA', 'CSCO', 'ACN', 'ABT',
  'LLY', 'UNH', 'PFE', 'JNJ', 'MRK', 'TMO', 'ABBV', 'BMY', 'AMGN', 'GILD',
  'XOM', 'CVX', 'COP', 'SLB', 'EOG', 'MPC', 'PSX', 'VLO', 'OXY', 'HAL',
  'BA', 'CAT', 'GE', 'HON', 'LMT', 'RTX', 'NOC', 'GD', 'HWM', 'EMR',
  'WMT', 'COST', 'HD', 'LOW', 'NKE', 'SBUX', 'MCD', 'DIS', 'CMG', 'YUM',
  'GOOG', 'BRK', 'SPY', 'QQQ', 'DIA', 'ARKK', 'PLTR', 'SOFI', 'HOOD',
  'COIN', 'MARA', 'RIOT', 'SMCI', 'ON', 'ANET', 'NOW', 'WDAY', 'SNOW',
  'CRWD', 'NET', 'DDOG', 'ZS', 'PANW', 'FTNT', 'MDB', 'TWLO', 'SHOP',
  'UBER', 'LYFT', 'DASH', 'ABNB', 'BKNG', 'EXPE', 'MAR', 'HLT', 'RCL',
  'NIO', 'XPEV', 'LI', 'BIDU', 'TCEHY', 'JPM', 'GS', 'MS', 'BAC', 'WFC',
  'C', 'AXP', 'BLK', 'SCHW', 'TFC', 'BK', 'PNC', 'COF', 'USB', 'Citi',
  'V', 'MA', 'PYPL', 'AXP', 'Diners', 'DFS', 'GPN', 'FIS', 'FISV',
])

const KNOWN_A_STOCKS = new Set([
  '600519', '601318', '600036', '601398', '601988', '601288', '601939', '601328',
  '600900', '601166', '601818', '601601', '601628', '601688', '601857', '601919',
  '000858', '000651', '000333', '002415', '002594', '002714', '002475',
  '300750', '300059', '300760', '300015', '300014', '300012', '300017', '300018',
])

const KNOWN_HK_STOCKS = new Set([
  '00700', '09988', '09618', '01810', '00981', '02015', '03690', '09999',
  '01024', '01211', '09995', '02020', '00005', '00388', '00941', '01109',
  '01398', '00939', '02628', '01177', '09698', '01060', '00883', '01088',
])

const YEAR_REGEX = /^(19|20)\d{2}$/

function extractStockCodes(text) {
  if (!text) return []
  const codes = new Set()

  // A股代码: 必须是已知热门股票（避免误报）
  const aShareRegex = /\b(60[0-5]\d{4}|68[0-9]\d{4}|00[0-3]\d{4}|30[0-1]\d{4})\b/g
  let aMatch
  while ((aMatch = aShareRegex.exec(text)) !== null) {
    const code = aMatch[0]
    if (KNOWN_A_STOCKS.has(code)) {
      codes.add(code)
    }
  }

  // 港股代码: 已知5位数字
  const hkShareRegex = /\b\d{5}\b/g
  let hkMatch
  while ((hkMatch = hkShareRegex.exec(text)) !== null) {
    const code = hkMatch[0]
    if (YEAR_REGEX.test(code)) continue
    if (KNOWN_HK_STOCKS.has(code)) {
      codes.add(code)
    }
  }

  // 美股代码: 2-5位字母，必须是已知股票
  const usShareRegex = /\b[A-Z]{2,5}\b/g
  let usMatch
  while ((usMatch = usShareRegex.exec(text.toUpperCase())) !== null) {
    const code = usMatch[0]
    if (US_STOP_WORDS.has(code)) continue
    if (KNOWN_US_STOCKS.has(code)) {
      codes.add(code)
    }
  }

  return [...codes].slice(0, 10)
}

// ─── 适配器注册表 ─────────────────────────────────────────────────────────────

const ADAPTER_REGISTRY = {
  sina: () => new SinaFinanceAdapter(),
  eastmoney: () => new EastMoneyAdapter(),
  cls: () => new clsAdapter(),
  wallstreetcn: () => new WallstreetcnAdapter(),
  kr36: () => new Kr36Adapter(),
  arxiv: () => new ArxivAdapter(),
  infoq: () => new InfoQAdapter(),
  techcrunch_ai: () => new TechCrunchAIAdapter(),
  hackernews: () => new HackerNewsAdapter(),
  zillow_research: () => new ZillowResearchAdapter(),
  sina_realestate: () => new SinaRealEstateAdapter(),
}

export function createAdapter(name) {
  const factory = ADAPTER_REGISTRY[name]
  if (!factory) {
    throw new Error(`Unknown adapter: ${name}. Available: ${Object.keys(ADAPTER_REGISTRY).join(', ')}`)
  }
  return factory()
}

export function listAdapters() {
  return Object.entries(ADAPTER_REGISTRY).map(([name, factory]) => {
    const adapter = factory()
    return {
      name,
      enabled: adapter.enabled,
      rateLimitMs: adapter.rateLimitMs,
      categories: adapter.categories,
    }
  })
}

export {
  SinaFinanceAdapter,
  EastMoneyAdapter,
  clsAdapter,
  WallstreetcnAdapter,
  Kr36Adapter,
  ArxivAdapter,
  InfoQAdapter,
  TechCrunchAIAdapter,
  HackerNewsAdapter,
  ZillowResearchAdapter,
  SinaRealEstateAdapter,
  NewsAdapter,
  extractStockCodes,
  stripHtml,
  extractRssItems,
  fetchJSON,
  fetchText,
  CACHE_DIR,
}