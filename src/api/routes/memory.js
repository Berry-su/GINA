import {
  getDB,
  getRecentExtractAudits,
  getRecentRecallAudits,
  getExtractAuditStats,
  getRecallAuditStats,
} from '../../capabilities/db.js'
import { isRunning } from '../../control.js'
import { getQuotaStatus } from '../../quota.js'
import { getSelfEvolutionSnapshot } from '../../memory/self-evolution.js'
import { jsonResponse, safeJsonParse, readJsonBody } from '../utils.js'

function stripAssistantHistoryLabels(content) {
  return String(content || '')
    .trim()
    .replace(/^(?:\s*\[assistant(?:\s+to\s+[^\]\r\n]+)?(?:\s+\d{4}-\d{2}-\d{2}T[^\]\r\n]+)?\]\s*)+/giu, '')
    .trim()
}

async function handleMemories(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/memories') {
    const db = getDB()
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 100)
    const search = url.searchParams.get('search')
    let rows
    if (search) {
      try {
        rows = db.prepare(`
          SELECT m.* FROM memories m
          JOIN memories_fts ON memories_fts.rowid = m.id
          WHERE memories_fts MATCH ? AND m.visibility = 1
          ORDER BY bm25(memories_fts), m.created_at DESC LIMIT ?
        `).all(search, limit)
      } catch {
        rows = db.prepare(`
          SELECT * FROM memories
          WHERE (
            title LIKE ? OR mem_id LIKE ? OR content LIKE ? OR detail LIKE ?
            OR entities LIKE ? OR concepts LIKE ? OR tags LIKE ?
          )
          AND visibility = 1
          ORDER BY created_at DESC LIMIT ?
        `).all(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, limit)
      }
    } else {
      rows = db.prepare('SELECT * FROM memories WHERE visibility = 1 ORDER BY created_at DESC LIMIT ?').all(limit)
    }
    jsonResponse(res, 200, rows)
    return true
  }

  if (req.method === 'DELETE' && url.pathname.startsWith('/memories/')) {
    const id = parseInt(url.pathname.split('/')[2])
    if (!id) {
      jsonResponse(res, 400, { error: 'invalid id' })
      return true
    }
    getDB().prepare('DELETE FROM memories WHERE id = ?').run(id)
    jsonResponse(res, 200, { ok: true })
    return true
  }

  if (req.method === 'PATCH' && url.pathname.startsWith('/memories/')) {
    const id = parseInt(url.pathname.split('/')[2])
    if (!id) {
      jsonResponse(res, 400, { error: 'invalid id' })
      return true
    }
    try {
      const { content, detail } = await readJsonBody(req)
      const db = getDB()
      if (content !== undefined) db.prepare('UPDATE memories SET content = ? WHERE id = ?').run(content, id)
      if (detail !== undefined) db.prepare('UPDATE memories SET detail = ? WHERE id = ?').run(detail, id)
      jsonResponse(res, 200, { ok: true })
    } catch (e) {
      jsonResponse(res, 400, { error: e.message })
    }
    return true
  }

  return false
}

export async function handleMemoryRoutes(req, res, url) {
  if (await handleMemories(req, res, url)) return true

  if (req.method === 'GET' && url.pathname === '/audit/recall') {
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 500)
    const rows = getRecentRecallAudits(limit).map(r => ({
      ...r,
      matched_mem_ids: safeJsonParse(r.matched_mem_ids, []),
      event_type_dist: safeJsonParse(r.event_type_dist, {}),
    }))
    jsonResponse(res, 200, rows)
    return true
  }

  if (req.method === 'GET' && url.pathname === '/audit/extract') {
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 500)
    const rows = getRecentExtractAudits(limit).map(r => ({
      ...r,
      extracted_mem_ids: safeJsonParse(r.extracted_mem_ids, []),
      event_type_dist: safeJsonParse(r.event_type_dist, {}),
      skipped: !!r.skipped,
    }))
    jsonResponse(res, 200, rows)
    return true
  }

  if (req.method === 'GET' && url.pathname === '/audit/stats') {
    const hours = Math.max(1, Math.min(parseInt(url.searchParams.get('hours') || '168'), 24 * 30))
    const sinceIso = new Date(Date.now() - hours * 3600_000).toISOString().replace('T', ' ').slice(0, 19)
    jsonResponse(res, 200, {
      windowHours: hours,
      sinceIso,
      recall: getRecallAuditStats({ sinceIso }) || {},
      extract: getExtractAuditStats({ sinceIso }) || {},
    })
    return true
  }

  if (req.method === 'GET' && url.pathname === '/conversations') {
    const db = getDB()
    const requestedLimit = parseInt(url.searchParams.get('limit') || '60', 10)
    const limit = Math.max(1, Math.min(Number.isFinite(requestedLimit) ? requestedLimit : 60, 500))
    const requestedBeforeId = parseInt(url.searchParams.get('before_id') || '', 10)
    const beforeId = Number.isFinite(requestedBeforeId) && requestedBeforeId > 0
      ? requestedBeforeId
      : null
    const includeSystemSignals = url.searchParams.get('includeSystemSignals') === 'true'
    const rows = db.prepare(`
      SELECT id, role, from_id, to_id, content, timestamp, channel, external_party_id, focus_absorbed, focus_topic, open_question
      FROM conversations
      WHERE (? OR NOT (from_id = 'SYSTEM' AND channel = 'APP_SIGNAL'))
        ${beforeId ? 'AND id < ?' : ''}
      ORDER BY id DESC
      LIMIT ?
    `).all(...(
      beforeId
        ? [includeSystemSignals ? 1 : 0, beforeId, limit]
        : [includeSystemSignals ? 1 : 0, limit]
    ))
    jsonResponse(res, 200, rows.reverse().map(row => (
      row.role === 'jarvis'
        ? { ...row, content: stripAssistantHistoryLabels(row.content) }
        : row
    )))
    return true
  }

  if (req.method === 'GET' && url.pathname === '/status') {
    const { n } = getDB().prepare('SELECT COUNT(*) as n FROM memories').get()
    jsonResponse(res, 200, {
      ok: true,
      memory_count: n,
      running: isRunning(),
      self_evolution: getSelfEvolutionSnapshot({ maxRecent: 5 }),
    })
    return true
  }

  if (req.method === 'GET' && (url.pathname === '/self-evolution' || url.pathname === '/memory/self-evolution')) {
    const limit = Math.max(1, Math.min(parseInt(url.searchParams.get('limit') || '20'), 24))
    jsonResponse(res, 200, { ok: true, ...getSelfEvolutionSnapshot({ maxRecent: limit }) })
    return true
  }

  if (req.method === 'GET' && url.pathname === '/quota') {
    jsonResponse(res, 200, getQuotaStatus())
    return true
  }

  // 手动触发反思分析
  if (req.method === 'POST' && url.pathname === '/reflection/analyze') {
    try {
      const mod = await import('../../memory/reflection-executor.js')
      const result = await mod.analyzeReflections(10)
      const state = await mod.getReflectionState()
      jsonResponse(res, 200, { ok: true, analysis_result: result, reflection_state: state })
    } catch (err) {
      console.error('[reflection] /reflection/analyze error:', err?.message || err)
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  // 获取反思状态
  if (req.method === 'GET' && url.pathname === '/reflection/state') {
    try {
      const mod = await import('../../memory/reflection-executor.js')
      const state = await mod.getReflectionState()
      jsonResponse(res, 200, { ok: true, state })
    } catch (err) {
      console.error('[reflection] /reflection/state error:', err?.message || err)
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  // ========== 成长引擎 API ==========

  // 触发一次完整的成长周期
  if (req.method === 'POST' && url.pathname === '/growth/cycle') {
    try {
      const mod = await import('../../memory/growth-engine.js')
      const result = await mod.runGrowthCycle({ auto: false })
      jsonResponse(res, 200, { ok: true, result })
    } catch (err) {
      console.error('[growth] /growth/cycle error:', err?.message || err)
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  // 获取成长状态（综合所有子系统）
  if (req.method === 'GET' && url.pathname === '/growth/status') {
    try {
      const mod = await import('../../memory/growth-engine.js')
      const status = mod.getGrowthStatus()
      jsonResponse(res, 200, { ok: true, status })
    } catch (err) {
      console.error('[growth] /growth/status error:', err?.message || err)
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  // 获取经验积累统计
  if (req.method === 'GET' && url.pathname === '/growth/experiences') {
    try {
      const mod = await import('../../memory/experience-collector.js')
      const stats = mod.getExperienceStats()
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 100)
      const type = url.searchParams.get('type')
      const experiences = mod.queryExperiences({ type: type || null, limit })
      jsonResponse(res, 200, { ok: true, stats, experiences })
    } catch (err) {
      console.error('[growth] /growth/experiences error:', err?.message || err)
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  // 获取知识库
  if (req.method === 'GET' && url.pathname === '/growth/knowledge') {
    try {
      const mod = await import('../../memory/knowledge-distiller.js')
      const stats = mod.getKnowledgeStats()
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 100)
      const type = url.searchParams.get('type')
      const knowledge = mod.queryKnowledge({ type: type || null, limit })
      jsonResponse(res, 200, { ok: true, stats, knowledge })
    } catch (err) {
      console.error('[growth] /growth/knowledge error:', err?.message || err)
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  // 获取知识图谱
  if (req.method === 'GET' && url.pathname === '/growth/knowledge-graph') {
    try {
      const mod = await import('../../memory/knowledge-distiller.js')
      const graph = mod.getKnowledgeGraph()
      jsonResponse(res, 200, { ok: true, graph })
    } catch (err) {
      console.error('[growth] /growth/knowledge-graph error:', err?.message || err)
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  // 获取当前策略
  if (req.method === 'GET' && url.pathname === '/growth/strategies') {
    try {
      const mod = await import('../../memory/strategy-optimizer.js')
      const state = mod.getCurrentStrategies()
      const stats = mod.getStrategyStats()
      jsonResponse(res, 200, { ok: true, state, stats })
    } catch (err) {
      console.error('[growth] /growth/strategies error:', err?.message || err)
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  // 生成系统策略提示词
  if (req.method === 'GET' && url.pathname === '/growth/strategy-prompt') {
    try {
      const mod = await import('../../memory/strategy-optimizer.js')
      const prompt = mod.generateStrategyPrompt()
      jsonResponse(res, 200, { ok: true, prompt })
    } catch (err) {
      console.error('[growth] /growth/strategy-prompt error:', err?.message || err)
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  // 获取思考状态和洞察
  if (req.method === 'GET' && url.pathname === '/growth/thinking') {
    try {
      const mod = await import('../../memory/active-thinker.js')
      const stats = mod.getThinkingStats()
      const insights = mod.getRecentInsights({ limit: 20 })
      jsonResponse(res, 200, { ok: true, stats, insights })
    } catch (err) {
      console.error('[growth] /growth/thinking error:', err?.message || err)
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  // 触发主动思考
  if (req.method === 'POST' && url.pathname === '/growth/thinking') {
    try {
      const mod = await import('../../memory/active-thinker.js')
      const type = url.searchParams.get('type') || 'curiosity'
      const count = Math.min(parseInt(url.searchParams.get('count') || '3'), 10)
      const tasks = mod.generateThinkingTasksForAPI({ type, count })
      jsonResponse(res, 200, { ok: true, tasksCount: tasks.length, tasks })
    } catch (err) {
      console.error('[growth] /growth/thinking POST error:', err?.message || err)
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  // 初始化成长引擎
  if (req.method === 'POST' && url.pathname === '/growth/init') {
    try {
      const mod = await import('../../memory/growth-engine.js')
      const state = mod.initGrowthEngine({ autoStartThinking: true })
      jsonResponse(res, 200, { ok: true, state })
    } catch (err) {
      console.error('[growth] /growth/init error:', err?.message || err)
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  // 记录一次交互
  if (req.method === 'POST' && url.pathname === '/growth/record') {
    try {
      const body = await readJsonBody(req)
      const mod = await import('../../memory/growth-engine.js')
      const result = mod.recordInteraction(body || {})
      jsonResponse(res, 200, { ok: true, result })
    } catch (err) {
      console.error('[growth] /growth/record error:', err?.message || err)
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  // 知识库检索
  if (req.method === 'POST' && url.pathname === '/growth/retrieve') {
    try {
      const body = await readJsonBody(req)
      const mod = await import('../../memory/knowledge-distiller.js')
      const message = body?.message || ''
      const knowledge = mod.retrieveRelevantKnowledge(message, { maxResults: 5 })
      jsonResponse(res, 200, { ok: true, message, knowledge })
    } catch (err) {
      console.error('[growth] /growth/retrieve error:', err?.message || err)
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  return false
}
