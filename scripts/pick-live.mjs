/**
 * 每日真实选股 · 全链路（真实新闻 → 题材 → 进攻个股 → 行情 → 打分 → 今日买哪只）
 * 运行一次即：收信息 → 分题材 → 选进攻票 → 拉行情 → 评分 → 出结论。
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'
import { loadDataSourcesConfig } from '../src/finance-data-sources/config.js'
import { createRssNewsSources } from '../src/finance-data-sources/rss-news.js'
import { scanThemes, splitThemes, mapThemesToStocks, flatCandidates } from '../src/trading/theme-stock-map.js'
import { scoreCandidate } from '../src/analysts/attacker.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const limit = (code) => (/^(30|688)/.test(code) ? 0.20 : 0.10)

// ① 真实新闻 → 题材
const cfg = loadDataSourcesConfig()
const sources = createRssNewsSources(cfg.newsFeeds, { proxyUrl: cfg.proxyEnabled ? cfg.proxy : null })
const news = []
for (const s of sources) { try { news.push(...(await s.fetch())) } catch { /* 跳过 */ } }
const themes = scanThemes(news)
const { attack, macro } = splitThemes(themes)
console.log('① 信息：', news.length, '条 | 宏观环境:', macro.map(([t, c]) => `${t}(${c})`).join(' ') || '—')

// ② 进攻题材 → 个股候选
const mapped = mapThemesToStocks(attack, { top: 3, perTheme: 3 })
const candidates = flatCandidates(mapped)
writeFileSync(join(root, 'data', 'picks-candidates.json'), JSON.stringify(candidates), 'utf8')

// ③ 拉行情（Python/baostock）
try {
  execSync('python3 scripts/fetch-picks.py', { cwd: root, stdio: 'ignore' })
} catch { /* 行情拉取失败则退而用空 */ }

// ④ 打分 → 买哪只
const kPath = join(root, 'data', 'picks-klines.json')
const picks = []
if (existsSync(kPath)) {
  const data = JSON.parse(readFileSync(kPath, 'utf8'))
  for (const [code, info] of Object.entries(data)) {
    const bars = info.bars
    if (bars.length < 25) continue
    const last = bars[bars.length - 1]
    const lim = limit(code)
    const isLimitUp = last.pctChg >= lim - 0.005
    let streak = 0
    for (let i = bars.length - 1; i >= 0 && bars[i].pctChg >= lim - 0.005; i--) streak++
    const floatMcap = last.turnover > 0 ? (last.amount / (last.turnover / 100)) / 1e8 : null
    const mom20 = bars[bars.length - 1].close / bars[bars.length - 21].close - 1
    const sc = scoreCandidate({ price: last.close, floatMcap, turnover: last.turnover, streak, isLimitUp })
    picks.push({ code, name: info.name, theme: candidates.find((x) => x.code === code)?.theme ?? '', price: last.close, mom20, score: sc.score, reasons: sc.reasons })
  }
}
picks.sort((a, b) => b.score - a.score)

console.log('② 今日进攻题材:', mapped.map((m) => `${m.theme}(${m.heat})`).join('  '))
console.log('③ 候选票:', candidates.map((c) => c.name).join('、'))
console.log('\n④ 行情打分排名：')
for (const p of picks) console.log(`   ${p.code} ${p.name}（${p.theme}）现价 ${p.price?.toFixed(2)} 20日动量 ${(p.mom20 * 100).toFixed(1)}% 评分 ${p.score} ${p.reasons.join('、')}`)
if (picks.length) {
  const t = picks[0]
  console.log(`\n★ 今日最该打：${t.name}(${t.code})·${t.theme} 评分 ${t.score}`)
  console.log(`  策略：${t.theme ? '题材进攻(信息驱动)' : ''}${t.score >= 4 ? ' → 打板/骑连板/多策略入场' : ' → 加入盯盘，等低吸/追涨/涨停信号'}`)
}
console.log('=' .repeat(62))