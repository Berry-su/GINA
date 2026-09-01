#!/usr/bin/env node
// scripts/smoke-ingestion-pipeline.mjs —— 知识 ingestion 烟测
//
// 用 mock LLM 跑完整 5 阶段 pipeline（PDF 优先，缺 PDF 时回退到 MD）
// 输出 JSON 报告
//
// 运行：GINA_USER_DIR=/tmp/gina-smoke node scripts/smoke-ingestion-pipeline.mjs

import { writeFileSync, mkdtempSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { IngestionPipeline } from '../src/knowledge/ingestion/pipeline.js'
import { getDB, closeDBForTest } from '../src/db/connection.js'

const TEST_DIR = process.env.GINA_USER_DIR || mkdtempSync(join(tmpdir(), 'gina-smoke-ingest-'))
process.env.GINA_USER_DIR = TEST_DIR

// 准备一个 mock MD 文件
const sampleMd = `# 第一章：交易心理学概述

交易市场是人类心理的镜子。价格波动背后是无数交易者的情绪、恐惧与贪婪的交锋。本章从认知偏差、情绪周期、群体行为三个维度构建交易心理学的分析框架。

认知偏差方面，常见的包括确认偏差（只关注支持自己判断的信息）、锚定效应（过度依赖第一印象）、损失厌恶（亏损的痛苦是盈利快感的 2.5 倍）。这些偏差导致交易者频繁犯错。

## 第二章：止损纪律

止损是交易者的生命线。统计显示，90% 的爆仓源于没有严格执行止损。止损的三大原则：预设阈值、立即执行、不抱幻想。

止损策略可以分为固定比例止损（账户资金的 1-2%）、波动率止损（ATR 倍数）、技术位止损（关键支撑阻力）。

# 第三章：顺势而为

趋势是朋友。识别趋势的方法：移动平均线、趋势线、动量指标。在上升趋势中只做多，下降趋势中只做空，震荡市观望。
`

const sampleFile = join(TEST_DIR, 'sample.md')
writeFileSync(sampleFile, sampleMd, 'utf-8')

// Mock LLM
const mockLlm = {
  chat: async ({ system, user }) => {
    // 简单 mock：返回 3 facts + 2 concepts（基于章节数）
    const chapterMatch = user.match(/章节：(.+)/)
    const chapter = chapterMatch?.[1] || 'unknown'
    return {
      facts: [
        { text: `[${chapter}] 核心事实 1：交易心理学是研究交易者心理的学科`, importance: 0.8 },
        { text: `[${chapter}] 核心事实 2：认知偏差影响交易决策`, importance: 0.7 },
        { text: `[${chapter}] 核心事实 3：止损纪律是交易的关键`, importance: 0.9 },
      ],
      concepts: ['交易心理学', '止损纪律', '认知偏差'],
    }
  }
}

async function main() {
  console.log('=== GINA 知识 Ingestion 烟测 ===\n')
  console.log(`测试目录: ${TEST_DIR}`)
  console.log(`样本文件: ${sampleFile}\n`)

  const pipeline = new IngestionPipeline({ llm: mockLlm, db: getDB() })
  const t0 = Date.now()
  const r = await pipeline.ingestFile({
    path: sampleFile,
    topic: '交易心理学',
    source: 'smoke',
  })
  const totalMs = Date.now() - t0

  console.log('--- 5 阶段 pipeline 报告 ---')
  console.log(JSON.stringify(r, null, 2))
  console.log(`\n--- 总耗时 ${totalMs}ms ---`)

  // 验证 status
  const st = pipeline.status()
  console.log(`\n--- 状态机最终: ${st.state} ---`)
  console.log(`进度: ${(st.progress * 100).toFixed(0)}%`)

  // 验证写入
  const memCount = getDB().prepare("SELECT COUNT(*) AS c FROM memories WHERE event_type = 'knowledge_ingested'").get()
  console.log(`\n--- SQLite memories 表行数: ${memCount.c} ---`)

  closeDBForTest()
  try { rmSync(TEST_DIR, { recursive: true, force: true }) } catch {}

  // 通过判定
  const passed = r.facts > 0 && r.chunks > 0 && r.duration > 0 && r.duration < 60000
  console.log(`\n=== ${passed ? 'PASS' : 'FAIL'} ===`)
  process.exit(passed ? 0 : 1)
}

main().catch(err => {
  console.error('Smoke test failed:', err)
  process.exit(1)
})
