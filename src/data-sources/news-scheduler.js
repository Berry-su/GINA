/**
 * news-scheduler.js — 新闻定时调度器
 *
 * 集成到 Gina 的运行时系统中，定期自动采集新闻
 * 支持：
 *   1. 定时触发（默认每15分钟）
 *   2. 立即手动触发
 *   3. 启停控制
 *   4. 状态监控
 */

import { aggregateNews, getAggregatorStatus } from '../data-sources/news-aggregator.js'

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000 // 15分钟

let _timer = null
let _isRunning = false
let _lastRunAt = 0
let _runCount = 0
let _errorCount = 0

export function startNewsScheduler({ intervalMs = DEFAULT_INTERVAL_MS, config = {} } = {}) {
  if (_isRunning) {
    return { success: false, message: '调度器已在运行' }
  }

  _isRunning = true
  _timer = setInterval(async () => {
    try {
      await aggregateNews(config)
      _lastRunAt = Date.now()
      _runCount++
      _errorCount = 0
    } catch (e) {
      _errorCount++
      console.error('[新闻调度器] 采集失败:', e?.message)
      
      // 连续失败3次后增加间隔
      if (_errorCount >= 3) {
        console.warn('[新闻调度器] 连续失败，暂停调度5分钟')
        stopNewsScheduler()
        setTimeout(() => startNewsScheduler({ intervalMs: 5 * 60 * 1000 }), 5 * 60 * 1000)
      }
    }
  }, intervalMs)

  console.log(`[新闻调度器] 已启动 (间隔: ${intervalMs / 60000}分钟)`)
  return { success: true, intervalMs }
}

export function stopNewsScheduler() {
  if (_timer) {
    clearInterval(_timer)
    _timer = null
  }
  _isRunning = false
  console.log('[新闻调度器] 已停止')
  return { success: true }
}

export function getNewsSchedulerStatus() {
  return {
    isRunning: _isRunning,
    lastRunAt: _lastRunAt ? new Date(_lastRunAt).toISOString() : 'never',
    lastRunAgo: _lastRunAt ? `${Math.floor((Date.now() - _lastRunAt) / 60000)} 分钟前` : 'N/A',
    runCount: _runCount,
    errorCount: _errorCount,
    aggregatedStatus: getAggregatorStatus(),
  }
}

export async function triggerNewsUpdate(config = {}) {
  console.log('[新闻调度器] 手动触发更新...')
  const result = await aggregateNews(config)
  _lastRunAt = Date.now()
  _runCount++
  return result
}

export {
  DEFAULT_INTERVAL_MS,
}