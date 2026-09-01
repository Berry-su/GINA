// src/knowledge/ingestion/cli.js —— CLI 入口
//
// 用法：
//   gina-ingest --file PATH [--topic TOPIC] [--source SOURCE]
//
// 输出：JSON 报告 { nodes, facts, relations, duration, errors }
//
// 关联 ADR-004 §3.2.4

import { IngestionPipeline, IngestionError } from './pipeline.js'
import { getLLM } from '../../llm.js'
import { getDB } from '../../db/connection.js'
import { getDirectionController } from '../../learning/direction.js'

/**
 * CLI 入口
 * @param {string[]} args 命令行参数（不含 node 和 script 路径）
 * @returns {Promise<object>} JSON 报告
 */
export async function runCli(args = process.argv.slice(2)) {
  const opts = _parseArgs(args)
  if (!opts.file) {
    return { error: 'missing --file argument' }
  }

  try {
    const llm = getLLM()
    const db = getDB()
    const direction = getDirectionController()
    const pipeline = new IngestionPipeline({ llm, db, direction })
    const result = await pipeline.ingestFile({ path: opts.file, topic: opts.topic, source: opts.source || 'cli' })
    return {
      status: 'done',
      file: opts.file,
      topic: opts.topic || null,
      ...result,
    }
  } catch (err) {
    if (err instanceof IngestionError) {
      return {
        status: 'error',
        step: err.step,
        file: opts.file,
        error: err.message,
        recoverable: err.recoverable,
        suggestion: _suggestion(err.step),
      }
    }
    return {
      status: 'error',
      file: opts.file,
      error: err.message || String(err),
    }
  }
}

function _suggestion(step) {
  switch (step) {
    case 'parsing': return '检查文件格式是否受支持（.pdf .epub .md .txt）；或 pnpm add pdf-parse epub'
    case 'distilling': return 'LLM 调用失败：检查 LLM 是否已激活；或降低 chunk 数；或重试'
    case 'storing': return '存储失败：检查 SQLite 写入权限；或 CATS-Net 是否注入'
    default: return '查看错误详情后重试'
  }
}

function _parseArgs(args) {
  const out = { file: null, topic: null, source: 'cli' }
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--file' || a === '-f') out.file = args[++i]
    else if (a === '--topic' || a === '-t') out.topic = args[++i]
    else if (a === '--source' || a === '-s') out.source = args[++i]
    else if (a === '--help' || a === '-h') out.help = true
  }
  return out
}

// 当以脚本直接运行时
if (import.meta.url === `file://${process.argv[1]}`) {
  runCli().then(r => {
    console.log(JSON.stringify(r, null, 2))
    process.exit(r.error || r.status === 'error' ? 1 : 0)
  })
}
