/**
 * finance-data-engine/sina-quotes.js — 新浪财经实时行情（直连，无需代理/不限流）
 *
 * 供 /api/trading/* 路由使用：实时批量行情 + 当日 1 分钟 K 线。
 * 逻辑与 scripts/afternoon-paper-trade.mjs 保持一致，收敛为可复用模块。
 * 数据源：hq.sinajs.cn（GBK 编码实时行情）+ CN_MarketDataService.getKLineData。
 */

function sina(code) {
  return (String(code).startsWith('6') ? 'sh' : 'sz') + code
}

/**
 * 批量拉取实时行情。
 * @param {string[]} codes A 股代码
 * @returns {Promise<Record<string, {code:string,name:string,open:number,preClose:number,price:number,high:number,low:number,time:string}>>}
 */
export async function fetchBatchQuotes(codes = []) {
  const list = codes.filter(Boolean)
  if (list.length === 0) return {}
  const url = `https://hq.sinajs.cn/list=${list.map(sina).join(',')}`
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

/**
 * 拉取当日 1 分钟 K 线。
 * @param {string} code
 * @returns {Promise<Array<{time:string,open:number,close:number}>>}
 */
export async function fetchMinuteKline(code) {
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
