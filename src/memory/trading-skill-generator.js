/**
 * trading-skill-generator.js —— 交易策略技能专属生成器
 *
 * 解决「反思生成的都是通用 tool-usage/error-recovery 垃圾技能」的问题：
 * 把交易教训（危机前空仓、V 型反弹介入、信号阈值等）固化为可复用的交易 SKILL.md，
 * 存入 skills/trading/，与通用改进技能（skills/improvements/）隔离。
 *
 * 与通用 skill-generator 的区别：
 *   - 技能名稳定（trading-xxx），同名去重，不会像通用技能那样高频 timestamp 刷屏；
 *   - 正文是「什么时候动手 / 怎么动手 / 风控」的交易知识，而非工具调用检查。
 */

import path from 'node:path'
import { generateSkill } from './skill-generator.js'

/**
 * 从一条交易教训生成交易技能。
 * @param {object} lesson
 * @param {string} lesson.name      稳定技能名（英文 slug）
 * @param {string} lesson.description 技能描述
 * @param {string} lesson.when      何时触发（进场/离场条件）
 * @param {string} lesson.how       怎么动手（具体动作）
 * @param {string[]} [lesson.notes] 备注
 * @param {string} skillsDir        技能库根目录
 */
export function generateTradingSkill(lesson, skillsDir) {
  const steps = []
  if (lesson.when) steps.push({ title: '触发条件', description: lesson.when })
  if (lesson.how) steps.push({ title: '执行动作', description: lesson.how })

  return generateSkill({
    name: lesson.name,
    description: lesson.description,
    problem: lesson.description,
    solution: [lesson.when, lesson.how].filter(Boolean).join('\n'),
    prerequisites: ['分析师团队已激活', '风控官可一票否决'],
    steps: steps.length ? steps : [{ title: '执行', description: lesson.description }],
    tags: ['trading', 'alpha', 'risk-control'],
    notes: lesson.notes ?? [],
  }, path.join(skillsDir, 'trading'))
}

/**
 * 从回测结果蒸馏出交易教训（稳定、去重、交易相关）。
 * @param {object} r runBacktest 的返回
 * @param {string} label 回测标签
 */
export function distillTradingLessons(r, label) {
  const lessons = []
  const buyEdge = r.buyFwd5 && r.buyFwd5.length ? (avg(r.buyFwd5) - avg(r.marketFwd5)) : null
  const haltAvg = r.haltFwd5 && r.haltFwd5.length ? avg(r.haltFwd5) : null

  lessons.push({
    name: 'trading-signal-alpha-gate',
    description: '下单前用真实历史数据验证信号前瞻收益（alpha 门），无正向超额不放大仓位',
    when: `买入信号事后前瞻 5 日超额 = ${buyEdge == null ? 'N/A' : (buyEdge * 100).toFixed(2) + '%'}；仅当显著为正且样本充足时才视为有效 alpha`,
    how: '用 node scripts/backtest-astock.mjs 回测；信号无正向 alpha 时保持观望/低仓，只有 alpha 验证通过才提高买入频率',
    notes: [`来源回测：${label}`, '代价：避免把噪声当信号、避免追高被套'],
  })

  if (haltAvg != null) {
    lessons.push({
      name: 'trading-crisis-halt-protects',
      description: '危机/趋势恶化时用暂停清仓控制回撤（防守第一）',
      when: '风控官判定危机级（L3）或趋势跌破多头排列时',
      how: '立即暂停清仓/降仓，宁可错过反弹也不扛单；复盘记录暂停后 5 日实际收益验证是否躲过下跌',
      notes: [`暂停后前瞻 5 日收益 = ${(haltAvg * 100).toFixed(2)}%`, '来源：风控官一票否决'],
    })
  }

  if ((r.dist?.halt ?? 0) + (r.dist?.reduce ?? 0) > (r.dist?.buy ?? 0)) {
    lessons.push({
      name: 'trading-conservative-consensus',
      description: '纪律优先：≥3 分析师看多才买，模糊不清时保持观望',
      when: '多空分歧大或看多人数不足 3 时',
      how: '不强行出手，保持观望；只有技术面/基本面/资金面多维度共振时才进场',
      notes: [`决策分布 buy=${r.dist?.buy ?? 0} hold=${r.dist?.hold ?? 0} halt=${r.dist?.halt ?? 0} reduce=${r.dist?.reduce ?? 0}`],
    })
  }

  return lessons
}

function avg(a) { return a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0 }