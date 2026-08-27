/**
 * 题材 → 个股 映射（信息驱动选股）
 *
 * 把「信息扫出的题材热度」落到「具体该盯哪些龙头」。v1 用静态题材→龙头词典；
 * 生产可替换为「板块成分数据源」（东财/同花顺板块成分，或 Tushare 板块）。
 * 打分/买卖仍走：baostock 行情 → scoreCandidate → RideStreakTrader/多策略。
 */

/** 题材关键词（用于从新闻文本扫描题材热度）。 */
const THEME_KEYWORDS = {
  '半导体/芯片': ['半导体', '芯片', '晶圆', '光刻', '存储', 'chip'],
  '人工智能/AI': ['AI', '人工智能', '大模型', '算力', 'GPU', '英伟达'],
  '新能源/锂电': ['新能源', '锂电', '锂矿', '光伏', '储能', '电池'],
  '医药生物': ['医药', '生物', '疫苗', '创新药', '医疗'],
  '白酒/消费': ['白酒', '消费', '茅台', '食品', '零售'],
  '金融/券商': ['券商', '银行', '保险', '金融', '降准', '证券'],
  '军工': ['军工', '国防', '导弹', '船舶'],
  '房地产': ['房地产', '地产', '楼市', '房贷'],
  '原油/能源': ['原油', '石油', '能源', '天然气'],
  '美联储/利率': ['美联储', '利率', '加息', '降息', 'Fed', 'rate', '通胀'],
}

/** 扫描新闻 → 题材热度（按命中数降序）。 */
export function scanThemes(news = []) {
  const heat = {}
  for (const n of news) {
    const text = `${n.title ?? ''} ${n.summary ?? ''} ${(n.tags ?? []).join(' ')}`.toLowerCase()
    for (const [theme, kws] of Object.entries(THEME_KEYWORDS)) {
      for (const kw of kws) {
        if (text.includes(kw.toLowerCase())) {
          heat[theme] = (heat[theme] ?? 0) + 1
          break
        }
      }
    }
  }
  return Object.entries(heat).sort((a, b) => b[1] - a[1])
}

/**
 * 题材 → 高弹性小票 映射（打板/短炒标靶，不是龙头蓝筹）
 *
 * 高弹性小票才有连板/涨停空间，才能把「信息先手」转成「骑连板」收益。
 * 当前为静态词典（桥接版），生产应换成「板块/概念成分 + 低价小盘筛选」动态化。
 */
export const THEME_STOCKS = {
  '美联储/利率': [
    ['600988', '赤峰黄金'], ['002155', '湖南黄金'], ['000975', '银泰黄金'], ['600111', '北方稀土'], ['300748', '金力永磁'],
  ],
  '人工智能/AI': [
    ['300229', '拓尔思'], ['300364', '中文在线'], ['300624', '万兴科技'], ['300418', '昆仑万维'], ['300781', '因赛集团'],
  ],
  '半导体/芯片': [
    ['300661', '圣邦股份'], ['603986', '兆易创新'], ['688536', '思瑞浦'], ['300567', '精测电子'], ['688120', '华海清科'],
  ],
  '新能源/锂电': [
    ['300014', '亿纬锂能'], ['300568', '星源材质'], ['002709', '天赐材料'], ['300390', '天华新能'], ['300274', '阳光电源'],
  ],
  '医药生物': [
    ['300347', '泰格医药'], ['300759', '康龙化成'], ['300363', '博腾股份'], ['300601', '康泰生物'], ['688266', '泽璟制药'],
  ],
  '金融/券商': [
    ['300059', '东方财富'], ['300033', '同花顺'], ['300803', '指南针'], ['688318', '财富趋势'], ['601136', '首创证券'],
  ],
  '军工': [
    ['300699', '光威复材'], ['000733', '振华科技'], ['300777', '新余国科'], ['300775', '三角防务'], ['688122', '西部超导'],
  ],
  '房地产': [
    ['600266', '城建发展'], ['002244', '滨江集团'], ['600322', '天房发展'], ['000736', '中交地产'], ['600791', '京能置业'],
  ],
  '原油/能源': [
    ['600256', '广汇能源'], ['600938', '中国海油'], ['600470', '六国化工'], ['600295', '鄂尔多斯'], ['601699', '潞安环能'],
  ],
}

/** 宏观/利率题材也按弹性标的（黄金/稀土）映射；本集合留空以共享受映射逻辑。 */
export const MACRO_THEMES = new Set()

/** 把题材拆成「进攻题材 + 宏观环境」（当前全部归进攻，宏观保留空位）。 */
export function splitThemes(themes = []) {
  const attack = []
  const macro = []
  for (const [theme, heat] of themes) {
    if (MACRO_THEMES.has(theme)) macro.push([theme, heat])
    else attack.push([theme, heat])
  }
  return { attack, macro }
}

/**
 * 题材热度 → 候选个股。
 * @param {Array<[string, number]>} themes 题材热度（已按热度降序）
 * @param {{top?:number, perTheme?:number}} [options]
 * @returns {Array<{theme:string, heat:number, stocks:Array<[string,string]>}>}
 */
export function mapThemesToStocks(themes = [], { top = 3, perTheme = 3 } = {}) {
  const out = []
  for (const [theme, heat] of themes.slice(0, top)) {
    const stocks = THEME_STOCKS[theme] ?? []
    if (stocks.length) out.push({ theme, heat, stocks: stocks.slice(0, perTheme) })
  }
  return out
}

/** 展平为唯一个股清单（去重，保留题材归属）。 */
export function flatCandidates(mapped) {
  const seen = new Set()
  const out = []
  for (const m of mapped) {
    for (const [code, name] of m.stocks) {
      if (seen.has(code)) continue
      seen.add(code)
      out.push({ code, name, theme: m.theme })
    }
  }
  return out
}