/**
 * 信息 → 题材 → 个股候选（真实新闻 + 静态题材词典），并验证国内时段覆盖盘前/盘后。
 */
import { loadDataSourcesConfig } from '../src/finance-data-sources/config.js'
import { createRssNewsSources } from '../src/finance-data-sources/rss-news.js'
import { scanThemes, mapThemesToStocks, flatCandidates } from '../src/trading/theme-stock-map.js'
import { getSessionState } from '../src/finance-data-engine/market-calendar.js'

const cfg = loadDataSourcesConfig()
const sources = createRssNewsSources(cfg.newsFeeds, { proxyUrl: cfg.proxyEnabled ? cfg.proxy : null })

console.log('='.repeat(62))
console.log('  国内时段（Asia/Shanghai）覆盖验证')
console.log('='.repeat(62))
// 用固定分钟数看标签：480=08:00 550=09:10 600=10:00 900=15:00 960=16:00
for (const [m, t] of [[480, '08:00'], [550, '09:10'], [600, '10:00'], [900, '15:00'], [960, '16:00']]) {
  const l = sessionLabelCN(m)
  console.log(`  ${t} → ${l}`)
}
function sessionLabelCN(m) {
  if (m < 480) return '休市'; if (m < 555) return '盘前'; if (m < 690) return '上午盘'
  if (m < 780) return '午间休市'; if (m < 900) return '下午盘'; if (m < 990) return '盘后'; return '休市'
}

console.log('\n' + '='.repeat(62))
console.log('  信息 → 题材 → 个股候选（真实新闻）')
console.log('='.repeat(62))

const news = []
for (const s of sources) {
  try { const items = await s.fetch(); news.push(...items.map((x) => ({ ...x, outlet: s.outlet }))) } catch { /* 跳过 */ }
}
const themes = scanThemes(news)
const mapped = mapThemesToStocks(themes, { top: 3, perTheme: 3 })
const stocks = flatCandidates(mapped)

console.log(`  新闻 ${news.length} 条 → 题材 Top3：${themes.slice(0, 3).map(([t, c]) => `${t}(${c})`).join('  ')}\n`)
for (const m of mapped) {
  console.log(`  【${m.theme}】热度 ${m.heat}  →  ${m.stocks.map(([c, n]) => `${n}(${c})`).join('  ')}`)
}
console.log(`\n  今日候选盯盘池（${stocks.length} 只）：${stocks.map((s) => s.name).join('、')}`)
console.log('='.repeat(62))
console.log('  下一步：对这些候选拉 baostock 行情 → scoreCandidate 打分 → 走 RideStreakTrader/多策略 定买谁。')