/**
 * 真实信息接收 → 题材/宏观 扫描（活数据：Google News RSS 经 Clash 代理）
 * 这是「第一时间收华尔街/全球信息」的免费落地；配合 startDaily 即每日自动跑。
 */
import { loadDataSourcesConfig } from '../src/finance-data-sources/config.js'
import { createRssNewsSources } from '../src/finance-data-sources/rss-news.js'
import { analyzeMarketNews } from '../src/finance-data-engine/snapshot-builder.js'

const THEMES = {
  '半导体/芯片': ['半导体', '芯片', '晶圆', '光刻', '存储', 'chip'],
  '新能源/锂电': ['新能源', '锂电', '锂矿', '光伏', '储能', '电池'],
  '人工智能/AI': ['AI', '人工智能', '大模型', '算力', 'GPU', '英伟达', '人工智能'],
  '医药生物': ['医药', '生物', '疫苗', '创新药', '医疗'],
  '白酒/消费': ['白酒', '消费', '茅台', '食品', '零售'],
  '金融/券商': ['券商', '银行', '保险', '金融', '降准'],
  '军工': ['军工', '国防', '导弹', '船舶'],
  '房地产': ['房地产', '地产', '楼市', '房贷'],
  '原油/能源': ['原油', '石油', '能源', '天然气', '油'],
  '美联储/利率': ['美联储', '利率', '加息', '降息', 'Fed', 'rate', '通胀'],
}

function themeScan(news) {
  const heat = {}
  for (const n of news) {
    const text = `${n.title ?? ''} ${n.summary ?? ''} ${(n.tags ?? []).join(' ')}`
    for (const [theme, kws] of Object.entries(THEMES)) {
      for (const kw of kws) {
        if (text.toLowerCase().includes(kw.toLowerCase())) {
          heat[theme] = (heat[theme] ?? 0) + 1
          break
        }
      }
    }
  }
  return Object.entries(heat).sort((a, b) => b[1] - a[1])
}

const cfg = loadDataSourcesConfig()
const proxyUrl = cfg.proxyEnabled ? cfg.proxy : null
const sources = createRssNewsSources(cfg.newsFeeds, { proxyUrl })

console.log('='.repeat(62))
console.log(`  信息接收（真实源 ${sources.length} 个 · 代理 ${proxyUrl ? '开' : '关'}）`)
console.log('='.repeat(62))

const news = []
for (const s of sources) {
  try {
    const items = await s.fetch()
    for (const it of items) news.push({ ...it, outlet: s.outlet })
    console.log(`  ✓ ${s.outlet}: ${items.length} 条`)
  } catch (e) {
    console.log(`  ✗ ${s.outlet}: ${e?.message}`)
  }
}

console.log(`\n  合计 ${news.length} 条\n`)

if (news.length) {
  const themes = themeScan(news)
  const macro = analyzeMarketNews(news)
  console.log('  ── 题材热度（信息 → 板块候选） ──')
  console.log('  ' + (themes.length ? themes.slice(0, 8).map(([t, c]) => `${t}(${c})`).join('  ') : '—'))
  console.log(`\n  ── 宏观/情绪 ──`)
  console.log(`  流动性=${macro.liquidity} 政策=${macro.policyBias} 地缘=${macro.geopoliticalRisk} 板块=${macro.sectorHeat} 题材=${macro.themeHeat}`)
  console.log('\n  样例标题：')
  for (const n of news.slice(0, 3)) console.log(`    · [${n.outlet}] ${String(n.title).slice(0, 60)}`)
}
console.log('='.repeat(62))