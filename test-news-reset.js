/**
 * test-news-reset.js — 重置新闻聚合器状态
 */

import fs from 'fs'
import path from 'path'

const GINA_HOME = process.env.GINA_HOME
  ? path.join(process.env.GINA_HOME, 'knowledge')
  : path.join(process.env.HOME || '.', '.gina', 'knowledge')

const stateFile = path.join(GINA_HOME, 'news-aggregator-state.json')
const cacheFile = path.join(GINA_HOME, 'news-cache', 'latest-news.json')

if (fs.existsSync(stateFile)) {
  fs.writeFileSync(stateFile, JSON.stringify({
    version: 1,
    lastUpdateAt: 0,
    totalItemsProcessed: 0,
    totalKnowledgeInjected: 0,
    seenTitles: [],
    adapters: {},
  }, null, 2))
  console.log('✓ 状态文件已重置')
}

if (fs.existsSync(cacheFile)) {
  fs.writeFileSync(cacheFile, JSON.stringify({
    items: [],
    adapters: [],
    totalItems: 0,
  }, null, 2))
  console.log('✓ 缓存文件已重置')
}

console.log('完成')