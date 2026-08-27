import { getDB as _getDB } from '../db/connection.js'
import { CANONICAL_USER_ID, normalizeConversationPartyId as _normalizeConversationPartyId } from '../db/utils.js'
import { insertBrainUiEvent as _insertBrainUiEvent, getBrainUiEventHistory as _getBrainUiEventHistory } from '../db/repositories/brain-ui-events.js'
import {
  createReminder as _createReminder, findMergeableOneOffReminder as _findMergeableOneOffReminder, appendReminderTask as _appendReminderTask,
  getDueReminders as _getDueReminders, listPendingReminders as _listPendingReminders, getReminderById as _getReminderById,
  getNextPendingReminder as _getNextPendingReminder, materializeReminderRun as _materializeReminderRun, recoverInterruptedReminderRuns as _recoverInterruptedReminderRuns,
  claimRunnableReminderRuns as _claimRunnableReminderRuns, completeReminderRun as _completeReminderRun, retryReminderRun as _retryReminderRun, failReminderRun as _failReminderRun,
  getNextPendingReminderRun as _getNextPendingReminderRun, getReminderRunById as _getReminderRunById,
} from '../db/repositories/reminders.js'

function jsonParseSafe(str, defaultVal) {
  if (str == null) return defaultVal
  try { return JSON.parse(str) } catch { return defaultVal }
}

// Helper functions that don't depend on this context
function _getConfig(key) {
  const row = _getDB().prepare('SELECT value FROM config WHERE key = ?').get(key)
  return row ? row.value : null
}

function _setConfig(key, value) {
  _getDB().prepare(`INSERT OR REPLACE INTO config (key, value, updated_at) VALUES (?, ?, datetime('now'))`).run(key, typeof value === 'string' ? value : JSON.stringify(value))
}

const db = {
  // ─── Config ────────────────────────────────────────────────
  getConfig(key) {
    const row = _getDB().prepare('SELECT value FROM config WHERE key = ?').get(key)
    return row ? row.value : null
  },
  setConfig(key, value) {
    _getDB().prepare(`INSERT OR REPLACE INTO config (key, value, updated_at) VALUES (?, ?, datetime('now'))`).run(key, typeof value === 'string' ? value : JSON.stringify(value))
  },

  // ─── Entity ───────────────────────────────────────────────
  upsertEntity(id, label) {
    _getDB().prepare(`INSERT OR REPLACE INTO entities (id, label, last_seen) VALUES (?, ?, datetime('now'))`).run(id, label || '')
  },
  getKnownEntities() {
    return _getDB().prepare('SELECT * FROM entities ORDER BY last_seen DESC').all()
  },

  // ─── Memory ────────────────────────────────────────────────
  insertMemory({ event_type, type, content, detail = '', title = '', mem_id, entities = [], concepts = [], tags = [], links = [], salience = 3, source_ref, timestamp, embedding, embedding_dim, embedding_model }) {
    const et = event_type || type || 'knowledge'
    const ts = timestamp || new Date().toISOString()
    const info = _getDB().prepare(`INSERT INTO memories (event_type, content, detail, title, mem_id, entities, concepts, tags, links, salience, source_ref, timestamp, embedding, embedding_dim, embedding_model, visibility) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`).run(
      et, content, detail, title,
      mem_id || null,
      JSON.stringify(Array.isArray(entities) ? entities : []),
      JSON.stringify(Array.isArray(concepts) ? concepts : []),
      JSON.stringify(Array.isArray(tags) ? tags : []),
      JSON.stringify(Array.isArray(links) ? links : []),
      salience, source_ref || null, ts,
      embedding || null,
      embedding_dim || null,
      embedding_model || null
    )
    return info.lastInsertRowid
  },
  upsertMemoryByMemId(data) {
    const mem_id = data?.mem_id
    if (!mem_id) return { mem_id: null, updated: false, id: null, error: 'missing mem_id' }
    // 统一字段名：LLM 工具传 type，但 memories 表列是 event_type
    const record = { ...data }
    if (record.type !== undefined && record.event_type === undefined) record.event_type = record.type
    delete record.type
    const conn = _getDB()
    const existing = conn.prepare('SELECT id FROM memories WHERE mem_id = ? AND visibility = 1').get(mem_id)
    if (existing) {
      const fields = []
      const values = []
      for (const [k, v] of Object.entries(record)) {
        if (k === 'mem_id') continue
        fields.push(`${k} = ?`)
        values.push(typeof v === 'object' ? JSON.stringify(v) : v)
      }
      values.push(mem_id)
      const info = conn.prepare(`UPDATE memories SET ${fields.join(', ')} WHERE mem_id = ?`).run(...values)
      return { mem_id, updated: true, id: existing.id, changes: info.changes }
    }
    // 解构导出后 this 会丢失，这里显式调用外层 db.insertMemory（其方法体只用 _getDB()，不依赖 this）
    const id = db.insertMemory({ ...record, mem_id })
    return { mem_id, updated: false, id }
  },
  hideMemoryByMemId(mem_id) {
    return _getDB().prepare(`UPDATE memories SET visibility = 0, hidden_at = datetime('now') WHERE mem_id = ?`).run(mem_id)
  },
  getMemoryByMemId(mem_id) {
    const row = _getDB().prepare('SELECT * FROM memories WHERE mem_id = ? AND visibility = 1').get(mem_id)
    if (!row) return null
    row.entities = jsonParseSafe(row.entities, [])
    row.concepts = jsonParseSafe(row.concepts, [])
    row.tags = jsonParseSafe(row.tags, [])
    row.links = jsonParseSafe(row.links, [])
    return row
  },
  memoryExistsByMemId(mem_id) {
    const row = _getDB().prepare('SELECT 1 FROM memories WHERE mem_id = ? AND visibility = 1 LIMIT 1').get(mem_id)
    return !!row
  },
  searchMemories(query, limit = 20) {
    const db = _getDB()
    const safeLimit = Math.max(1, Math.min(200, limit))
    const exact = query.trim()
    if (!exact) return []
    try {
      const trigram = db.prepare(`SELECT m.* FROM memories m JOIN memories_fts f ON m.id = f.rowid WHERE memories_fts MATCH ? AND m.visibility = 1 ORDER BY m.timestamp DESC LIMIT ?`).all(exact, safeLimit)
      if (trigram.length) return trigram.map(r => ({ ...r, entities: jsonParseSafe(r.entities, []), tags: jsonParseSafe(r.tags, []) }))
    } catch {}
    return db.prepare(`SELECT * FROM memories WHERE content LIKE ? AND visibility = 1 ORDER BY timestamp DESC LIMIT ?`).all(`%${exact}%`, safeLimit)
      .map(r => ({ ...r, entities: jsonParseSafe(r.entities, []), tags: jsonParseSafe(r.tags, []) }))
  },
  searchMemoriesByKeywords(keywords, options = {}) {
    const kw = Array.isArray(keywords) ? keywords.map(k => String(k || '').trim()).filter(Boolean).slice(0, 8) : []
    if (kw.length === 0) return []
    let limitPerKeyword = 5
    let typeFilter = null
    if (options && typeof options === 'object') {
      limitPerKeyword = Math.max(1, Math.min(Number(options.limitPerKeyword || 5), 20))
      typeFilter = options.typeFilter || null
    } else if (Number.isFinite(Number(options))) {
      limitPerKeyword = Math.max(1, Math.min(Number(options), 20))
    }
    const db = _getDB()
    const seen = new Set()
    const out = []
    for (const word of kw) {
      let rows = []
      try {
        rows = db.prepare(`SELECT m.* FROM memories m JOIN memories_fts f ON m.id = f.rowid WHERE memories_fts MATCH ? AND m.visibility = 1 ORDER BY m.timestamp DESC LIMIT ?`).all(word, limitPerKeyword)
      } catch {
        rows = db.prepare(`SELECT * FROM memories WHERE content LIKE ? AND visibility = 1 ORDER BY timestamp DESC LIMIT ?`).all(`%${word}%`, limitPerKeyword)
      }
      for (const r of rows) {
        if (seen.has(r.id)) continue
        if (typeFilter && r.event_type !== typeFilter) continue
        seen.add(r.id)
        out.push({ ...r, entities: jsonParseSafe(r.entities, []), tags: jsonParseSafe(r.tags, []) })
      }
    }
    return out
  },
  searchByEmbedding(embedding, limit = 10, threshold = 0.5) {
    const db = _getDB()
    const rows = db.prepare('SELECT id, event_type, content, title, mem_id, salience, timestamp, embedding FROM memories WHERE embedding IS NOT NULL AND visibility = 1').all()
    if (!rows.length || !embedding) return []
    const queryVec = Array.isArray(embedding) ? embedding : []
    if (queryVec.length === 0) return []
    const dim = queryVec.length
    const scored = rows.map(row => {
      if (!row.embedding) return null
      let storedVec
      try {
        storedVec = Array.from(new Float32Array(row.embedding))
      } catch { return null }
      if (storedVec.length !== dim) return null
      let dot = 0, normQ = 0, normS = 0
      for (let i = 0; i < dim; i++) {
        dot += queryVec[i] * storedVec[i]
        normQ += queryVec[i] * queryVec[i]
        normS += storedVec[i] * storedVec[i]
      }
      const cosine = normQ > 0 && normS > 0 ? dot / (Math.sqrt(normQ) * Math.sqrt(normS)) : 0
      return { ...row, score: cosine, entities: jsonParseSafe(row.entities, []), tags: jsonParseSafe(row.tags, []) }
    }).filter(r => r && r.score >= threshold)
    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, limit)
  },
  getMemoriesByDateRange(from, to, { limit = 20, orderBy = 'timestamp DESC', types = null } = {}) {
    const db = _getDB()
    let sql = `SELECT * FROM memories WHERE timestamp >= ? AND timestamp <= ? AND visibility = 1`
    const params = [from, to]
    if (types && Array.isArray(types) && types.length) {
      sql += ` AND event_type IN (${types.map(() => '?').join(',')})`
      params.push(...types)
    }
    sql += ` ORDER BY ${orderBy} LIMIT ?`
    params.push(limit)
    return db.prepare(sql).all(...params)
      .map(r => ({ ...r, entities: jsonParseSafe(r.entities, []), tags: jsonParseSafe(r.tags, []) }))
  },
  getRecentMemories(limit = 10, types = null) {
    let sql = `SELECT * FROM memories WHERE visibility = 1`
    const params = []
    if (types && Array.isArray(types) && types.length) {
      sql += ` AND event_type IN (${types.map(() => '?').join(',')})`
      params.push(...types)
    }
    sql += ` ORDER BY timestamp DESC LIMIT ?`
    params.push(limit)
    return _getDB().prepare(sql).all(...params)
      .map(r => ({ ...r, entities: jsonParseSafe(r.entities, []), tags: jsonParseSafe(r.tags, []) }))
  },
  getCandidateEntitiesForConsolidation(limit = 10) {
    return _getDB().prepare(`SELECT je.value AS entity, COUNT(*) AS cnt FROM memories, json_each(memories.entities) AS je WHERE visibility = 1 AND entities != '[]' GROUP BY entity HAVING cnt >= 3 ORDER BY cnt DESC LIMIT ?`).all(limit)
  },
  getMemoriesByEntity(entity, limit = 20) {
    return _getDB().prepare(`SELECT * FROM memories WHERE visibility = 1 AND entities LIKE ? ORDER BY timestamp DESC LIMIT ?`)
      .all(`%${entity}%`, limit)
      .map(r => ({ ...r, entities: jsonParseSafe(r.entities, []), tags: jsonParseSafe(r.tags, []) }))
  },
  getOrInitBirthTime() {
    const key = 'birth_time'
    const existing = _getConfig(key)
    if (existing) return existing
    const now = new Date().toISOString()
    _setConfig(key, now)
    return now
  },
  getMemoryCount() {
    return _getDB().prepare('SELECT COUNT(*) AS c FROM memories WHERE visibility = 1').get()?.c || 0
  },

  // ─── Conversation ──────────────────────────────────────────
  insertConversation({ role, from_id, to_id, content, channel = '', timestamp, focus_topic = '', thread_id = '', open_question = 0, external_party_id = '', delivery_status = '' }) {
    const ts = timestamp || new Date().toISOString()
    const nid = _normalizeConversationPartyId(from_id)
    const ntoid = to_id ? _normalizeConversationPartyId(to_id) : null
    const info = _getDB().prepare(`INSERT INTO conversations (role, from_id, to_id, content, channel, delivery_status, timestamp, focus_topic, thread_id, open_question, external_party_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(role, nid, ntoid, content, channel, delivery_status, ts, focus_topic, thread_id, open_question, external_party_id)
    return Number(info?.lastInsertRowid ?? info?.changes ?? 0)
  },
  insertConversationLog(entry) { return db.insertConversation(entry) },
  getRecentConversation(limit = 20) {
    return _getDB().prepare('SELECT * FROM conversations ORDER BY id DESC LIMIT ?').all(limit)
  },
  getRecentConversationTimeline(limit = 50) {
    return _getDB().prepare('SELECT * FROM conversations ORDER BY timestamp DESC LIMIT ?').all(limit)
  },
  getRecentConversationPartners(limit = 10) {
    return _getDB().prepare(`SELECT DISTINCT from_id FROM conversations ORDER BY timestamp DESC LIMIT ?`).all(limit).map(r => r.from_id)
  },
  updateConversationDeliveryStatus(conversationId, status) {
    return _getDB().prepare(`UPDATE conversations SET delivery_status = ? WHERE id = ?`).run(status, conversationId)
  },
  markConversationOpenQuestion(conversationId, isOpen = 1) {
    return _getDB().prepare(`UPDATE conversations SET open_question = ? WHERE id = ?`).run(isOpen ? 1 : 0, conversationId)
  },
  setConversationFlag(conversationId, flag) {
    _setConfig(`conv_flag_${conversationId}`, flag)
  },
  getConversationFlag(conversationId) {
    return _getConfig(`conv_flag_${conversationId}`)
  },
  getConversationContext(conversationId) {
    const row = _getDB().prepare('SELECT * FROM conversations WHERE id = ?').get(conversationId)
    return row || null
  },
  upsertConversationContext(conversationId, context) {
    _setConfig(`conv_ctx_${conversationId}`, JSON.stringify(context))
  },
  loadFocusStack() {
    const row = _getDB().prepare('SELECT * FROM focus_stack ORDER BY depth ASC').all()
    if (!row || row.length === 0) return null
    return row
  },
  setFocusStack(stack) {
    const db = _getDB()
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM focus_stack').run()
      for (const entry of stack) {
        db.prepare(`INSERT INTO focus_stack (depth, topic, started_at, started_at_tick, last_seen_tick, hit_count, conclusions, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`)
          .run(entry.depth, entry.topic, entry.started_at || new Date().toISOString(), entry.started_at_tick || 0, entry.last_seen_tick || 0, entry.hit_count || 1, JSON.stringify(entry.conclusions || []))
      }
    })
    tx()
  },
  loadThreadState() {
    try {
      const stateRow = _getDB().prepare("SELECT value FROM thread_state WHERE key = 'foregroundId'").get()
      const threads = _getDB().prepare('SELECT * FROM threads').all().map(t => ({ ...t, topic: jsonParseSafe(t.topic, []), signature: jsonParseSafe(t.signature, []), conclusions: jsonParseSafe(t.conclusions, []) }))
      const commitments = _getDB().prepare('SELECT * FROM commitments').all()
      if (threads.length === 0 && !stateRow) return null
      return { threads, foregroundId: stateRow?.value || null, commitments }
    } catch { return null }
  },
  saveThreadState(state) {
    const db = _getDB()
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM threads').run()
      db.prepare('DELETE FROM commitments').run()
      db.prepare('DELETE FROM thread_state').run()
      for (const t of (state.threads || [])) {
        db.prepare(`INSERT INTO threads (id, topic, signature, label, summary, conclusions, status, created_at, last_event_at, last_event_tick, hit_count, last_summary_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`)
          .run(t.id, JSON.stringify(t.topic || []), JSON.stringify(t.signature || []), t.label || '', t.summary || '', JSON.stringify(t.conclusions || []), t.status || 'open', t.created_at || new Date().toISOString(), t.last_event_at || new Date().toISOString(), t.last_event_tick || 0, t.hit_count || 1, t.last_summary_at || '')
      }
      for (const c of (state.commitments || [])) {
        db.prepare(`INSERT INTO commitments (id, thread_id, text, status, channel, created_at, closed_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .run(c.id, c.thread_id, c.text, c.status || 'open', c.channel || '', c.created_at || new Date().toISOString(), c.closed_at || null)
      }
      if (state.foregroundId) {
        db.prepare(`INSERT OR REPLACE INTO thread_state (key, value) VALUES ('foregroundId', ?)`).run(state.foregroundId)
      }
    })
    tx()
  },
  setCurrentFocusTopic(topic) {
    _setConfig('current_focus_topic', topic)
  },
  setCurrentThreadId(threadId) {
    _setConfig('current_thread_id', threadId)
  },
  updateUserMessageFocusTopic(conversationId, topic) {
    return _getDB().prepare(`UPDATE conversations SET focus_topic = ? WHERE id = ?`).run(topic, conversationId)
  },
  reassignConversationsThread(threadId, conversationIds) {
    const db = _getDB()
    const tx = db.transaction(() => {
      for (const id of conversationIds) {
        db.prepare(`UPDATE conversations SET thread_id = ? WHERE id = ?`).run(threadId, id)
      }
    })
    tx()
  },
  normalizeConversationPartyId(id) { return _normalizeConversationPartyId(id) },

  // ─── Action Log ───────────────────────────────────────────
  insertActionLog({ timestamp, tool, summary, detail = '', status = 'ok', risk = 'medium', args_json = '{}', result_preview = '', error = '', duration_ms = 0, source = '' }) {
    return _getDB().prepare(`INSERT INTO action_logs (timestamp, tool, summary, detail, status, risk, args_json, result_preview, error, duration_ms, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(timestamp || new Date().toISOString(), tool, summary, detail, status, risk, args_json, result_preview, error, duration_ms, source)
  },
  getRecentActionLogs(limit = 50) {
    return _getDB().prepare('SELECT * FROM action_logs ORDER BY timestamp DESC LIMIT ?').all(limit)
  },

  // ─── Audit ────────────────────────────────────────────────
  insertRecallAudit(audit) {
    return _getDB().prepare(`INSERT INTO recall_audit (created_at, turn_label, from_id, channel, query_text, matched_mem_ids, matched_count, chosen_count, event_type_dist, latency_ms, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(audit.created_at || new Date().toISOString(), audit.turn_label || null, audit.from_id || null, audit.channel || null, audit.query_text || '', JSON.stringify(audit.matched_mem_ids || []), audit.matched_count || 0, audit.chosen_count || 0, JSON.stringify(audit.event_type_dist || {}), audit.latency_ms || null, audit.source || null)
  },
  insertExtractAudit(audit) {
    return _getDB().prepare(`INSERT INTO extract_audit (created_at, turn_label, from_id, channel, turn_summary, extracted_mem_ids, extracted_count, event_type_dist, latency_ms, skipped, skip_reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(audit.created_at || new Date().toISOString(), audit.turn_label || null, audit.from_id || null, audit.channel || null, audit.turn_summary || '', JSON.stringify(audit.extracted_mem_ids || []), audit.extracted_count || 0, JSON.stringify(audit.event_type_dist || {}), audit.latency_ms || null, audit.skipped ? 1 : 0, audit.skip_reason || null)
  },
  insertEntityAudit(audit) { return db.insertExtractAudit(audit) },
  getRecentExtractAudits(limit = 20) {
    return _getDB().prepare('SELECT * FROM extract_audit ORDER BY created_at DESC LIMIT ?').all(limit)
  },
  getRecentRecallAudits(limit = 20) {
    return _getDB().prepare('SELECT * FROM recall_audit ORDER BY created_at DESC LIMIT ?').all(limit)
  },
  getExtractAuditStats() {
    const total = _getDB().prepare('SELECT COUNT(*) AS c FROM extract_audit').get()?.c || 0
    const skipped = _getDB().prepare('SELECT COUNT(*) AS c FROM extract_audit WHERE skipped = 1').get()?.c || 0
    return { total, skipped_count: skipped, completed_count: total - skipped }
  },
  getRecallAuditStats() {
    const rows = _getDB().prepare('SELECT COUNT(*) AS total, SUM(CASE WHEN matched_count > 0 THEN 1 ELSE 0 END) AS successful, SUM(CASE WHEN matched_count = 0 THEN 1 ELSE 0 END) AS failed FROM recall_audit').get()
    return { total: rows?.total || 0, successful: rows?.successful || 0, failed: rows?.failed || 0 }
  },

  // ─── Reminder ─────────────────────────────────────────────
  createReminder: _createReminder,
  findMergeableOneOffReminder: _findMergeableOneOffReminder,
  appendReminderTask: _appendReminderTask,
  getDueReminders: _getDueReminders,
  listPendingReminders: _listPendingReminders,
  getReminderById: _getReminderById,
  getNextPendingReminder: _getNextPendingReminder,
  materializeReminderRun: _materializeReminderRun,
  recoverInterruptedReminderRuns: _recoverInterruptedReminderRuns,
  claimRunnableReminderRuns: _claimRunnableReminderRuns,
  completeReminderRun: _completeReminderRun,
  retryReminderRun: _retryReminderRun,
  failReminderRun: _failReminderRun,
  getNextPendingReminderRun: _getNextPendingReminderRun,
  getAllReminders(limit = 50) {
    return _getDB().prepare('SELECT * FROM reminders ORDER BY due_at DESC LIMIT ?').all(limit)
  },
  deleteReminderById(id) {
    return _getDB().prepare('DELETE FROM reminders WHERE id = ?').run(id)
  },

  // ─── Clawbot / WeChat ─────────────────────────────────────
  getAllClawbotTokens() {
    return _getDB().prepare('SELECT * FROM wechat_clawbot_tokens').all()
  },
  upsertClawbotToken(fromUserId, contextToken) {
    return _getDB().prepare(`INSERT OR REPLACE INTO wechat_clawbot_tokens (from_user_id, context_token, updated_at) VALUES (?, ?, datetime('now'))`)
      .run(fromUserId, contextToken)
  },
  deleteClawbotToken(fromUserId) {
    return _getDB().prepare('DELETE FROM wechat_clawbot_tokens WHERE from_user_id = ?').run(fromUserId)
  },
  findUnansweredDeliveredOutbound({ toId, channel = '', externalPartyId = '', content = '' }) {
    const row = _getDB().prepare(`
      SELECT * FROM conversations
      WHERE to_id = ? AND role = 'jarvis'
        AND channel = ? AND external_party_id = ?
        AND content = ? AND delivery_status = 'delivered'
      ORDER BY id DESC LIMIT 1
    `).get(toId, channel, externalPartyId, content)
    return row || null
  },
  getOutboundRecord(id) {
    const row = _getDB().prepare('SELECT * FROM conversations WHERE id = ? AND role = ?').get(id, 'jarvis')
    return row || null
  },
  insertOutboundMsg(fromId, toId, content, channel = 'wechat', deliveryStatus = 'pending') {
    return db.insertConversation({ role: 'jarvis', from_id: fromId, to_id: toId, content, channel, delivery_status: deliveryStatus || '' })
  },
  updateOutboundState(conversationId, status) {
    return db.updateConversationDeliveryStatus(conversationId, status)
  },

  // ─── Music ────────────────────────────────────────────────
  listMusicLibrary(limit = 100) {
    return _getDB().prepare('SELECT * FROM music_library ORDER BY added_at DESC LIMIT ?').all(limit)
  },
  searchMusicLibrary(query, limit = 20) {
    const q = `%${query}%`
    return _getDB().prepare('SELECT * FROM music_library WHERE title LIKE ? OR artist LIKE ? OR album LIKE ? LIMIT ?').all(q, q, q, limit)
  },
  getMusicTrack(id) {
    return _getDB().prepare('SELECT * FROM music_library WHERE id = ?').get(id) || null
  },
  addMusicTrack({ title, artist, album, file_path, duration = 0, lrc = '', cover = '', source_url = '' }) {
    return _getDB().prepare(`INSERT INTO music_library (title, artist, album, file_path, duration, lrc, cover, source_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(title, artist, album, file_path, duration, lrc, cover, source_url)
  },
  upsertMusicTrack({ id, title, artist, album, file_path, duration, lrc, cover, source_url }) {
    if (id) {
      return _getDB().prepare(`UPDATE music_library SET title=?, artist=?, album=?, file_path=?, duration=?, lrc=?, cover=?, source_url=? WHERE id=?`)
        .run(title, artist, album, file_path, duration, lrc, cover, source_url, id)
    }
    return db.addMusicTrack({ title, artist, album, file_path, duration, lrc, cover, source_url })
  },
  deleteMusicTrack(id) {
    return _getDB().prepare('DELETE FROM music_library WHERE id = ?').run(id)
  },
  saveMusicLrc(id, lrc) {
    return _getDB().prepare('UPDATE music_library SET lrc = ? WHERE id = ?').run(lrc, id)
  },
  updateMusicLrc(id, lrc) { return db.saveMusicLrc(id, lrc) },
  addMusicLrc(id, lrc) { return db.saveMusicLrc(id, lrc) },
  removeMusicLrc(id) {
    return _getDB().prepare('UPDATE music_library SET lrc = "" WHERE id = ?').run(id)
  },

  // ─── Chat Session ─────────────────────────────────────────
  upsertChatSession(sessionId, data) {
    const now = new Date().toISOString()
    const existing = _getDB().prepare('SELECT id FROM chat_sessions WHERE id = ?').get(sessionId)
    if (existing) {
      const fields = []
      const values = []
      for (const [k, v] of Object.entries(data)) {
        if (k === 'id') continue
        fields.push(`${k} = ?`)
        values.push(typeof v === 'object' ? JSON.stringify(v) : v)
      }
      values.push(sessionId)
      _getDB().prepare(`UPDATE chat_sessions SET ${fields.join(', ')} WHERE id = ?`).run(...values)
      return sessionId
    } else {
      const fields = ['id']
      const values = [sessionId]
      for (const [k, v] of Object.entries(data)) {
        if (k === 'id') continue
        fields.push(k)
        values.push(typeof v === 'object' ? JSON.stringify(v) : v)
      }
      _getDB().prepare(`INSERT INTO chat_sessions (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`).run(...values)
      return sessionId
    }
  },
  getChatSession(sessionId) {
    return _getDB().prepare('SELECT * FROM chat_sessions WHERE id = ?').get(sessionId) || null
  },
  deleteChatSession(sessionId) {
    return _getDB().prepare('DELETE FROM chat_sessions WHERE id = ?').run(sessionId)
  },
  insertChatLog({ user_id, message, response, timestamp }) {
    return _getDB().prepare(`INSERT INTO chat_logs (user_id, message, response, timestamp) VALUES (?, ?, ?, ?)`)
      .run(user_id, message, response, timestamp || new Date().toISOString())
  },
  queryChatLog({ user_id, limit = 50 }) {
    let sql = 'SELECT * FROM chat_logs WHERE 1=1'
    const params = []
    if (user_id) { sql += ' AND user_id = ?'; params.push(user_id) }
    sql += ' ORDER BY timestamp DESC LIMIT ?'
    params.push(limit)
    return _getDB().prepare(sql).all(...params)
  },
  clearChatLog(user_id) {
    if (user_id) {
      return _getDB().prepare('DELETE FROM chat_logs WHERE user_id = ?').run(user_id)
    }
    return _getDB().prepare('DELETE FROM chat_logs').run()
  },

  // ─── User / Profile ───────────────────────────────────────
  getUserSetting(key) { return _getConfig(`user_${key}`) },
  saveUserSetting(key, value) { _setConfig(`user_${key}`, value) },
  upsertUserProfile(userId, profile) {
    const db = _getDB()
    const now = new Date().toISOString()
    const existing = db.prepare('SELECT user_id FROM user_profiles WHERE user_id = ?').get(userId)
    if (existing) {
      db.prepare(`UPDATE user_profiles SET summary=?, roles_json=?, domains_json=?, expertise_json=?, projects_json=?, preferences_json=?, communication_style_json=?, evidence_json=?, confidence=?, updated_at=? WHERE user_id=?`)
        .run(profile.summary || '', JSON.stringify(profile.roles || []), JSON.stringify(profile.domains || []), JSON.stringify(profile.expertise || []), JSON.stringify(profile.projects || []), JSON.stringify(profile.preferences || []), JSON.stringify(profile.communication_style || []), JSON.stringify(profile.evidence || []), profile.confidence || 0, now, userId)
    } else {
      db.prepare(`INSERT INTO user_profiles (user_id, summary, roles_json, domains_json, expertise_json, projects_json, preferences_json, communication_style_json, evidence_json, confidence, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(userId, profile.summary || '', JSON.stringify(profile.roles || []), JSON.stringify(profile.domains || []), JSON.stringify(profile.expertise || []), JSON.stringify(profile.projects || []), JSON.stringify(profile.preferences || []), JSON.stringify(profile.communication_style || []), JSON.stringify(profile.evidence || []), profile.confidence || 0, now)
    }
    return userId
  },
  getPersonMemory(userId) {
    return _getDB().prepare('SELECT * FROM user_profiles WHERE user_id = ?').get(userId) || null
  },

  // ─── Prefetch ─────────────────────────────────────────────
  upsertPrefetchTask(task) {
    const db = _getDB()
    const now = new Date().toISOString()
    const existing = db.prepare('SELECT id FROM prefetch_tasks WHERE source = ?').get(task.source)
    if (existing) {
      return db.prepare(`UPDATE prefetch_tasks SET label=?, url=?, ttl_minutes=?, tags=?, enabled=?, updated_at=? WHERE source=?`)
        .run(task.label, task.url, task.ttl_minutes || 60, JSON.stringify(task.tags || []), task.enabled !== false ? 1 : 0, now, task.source)
    }
    return db.prepare(`INSERT INTO prefetch_tasks (source, label, url, ttl_minutes, tags, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(task.source, task.label, task.url, task.ttl_minutes || 60, JSON.stringify(task.tags || []), task.enabled !== false ? 1 : 0, now, now)
  },
  removePrefetchTask(source) {
    return _getDB().prepare('DELETE FROM prefetch_tasks WHERE source = ?').run(source)
  },
  listPrefetchTasks(enabled = null) {
    let sql = 'SELECT * FROM prefetch_tasks'
    const params = []
    if (enabled !== null) { sql += ' WHERE enabled = ?'; params.push(enabled ? 1 : 0) }
    sql += ' ORDER BY updated_at DESC'
    return _getDB().prepare(sql).all(...params)
  },
  getEnabledPrefetchTasks() {
    return _getDB().prepare('SELECT * FROM prefetch_tasks WHERE enabled = 1').all()
  },
  savePrefetchCache(source, content, tags = [], ttlMinutes = 60) {
    const expiresAt = new Date(Date.now() + ttlMinutes * 60000).toISOString()
    const now = new Date().toISOString()
    const existing = _getDB().prepare('SELECT id FROM prefetch_cache WHERE source = ?').get(source)
    if (existing) {
      return _getDB().prepare(`UPDATE prefetch_cache SET content=?, fetched_at=?, expires_at=?, tags=? WHERE source=?`)
        .run(content, now, expiresAt, JSON.stringify(tags), source)
    }
    return _getDB().prepare(`INSERT INTO prefetch_cache (source, content, fetched_at, expires_at, tags, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(source, content, now, expiresAt, JSON.stringify(tags), now)
  },
  clearExpiredPrefetchCache() {
    const now = new Date().toISOString()
    return _getDB().prepare('DELETE FROM prefetch_cache WHERE expires_at < ?').run(now)
  },
  getValidPrefetchCache(source) {
    const now = new Date().toISOString()
    const row = _getDB().prepare('SELECT * FROM prefetch_cache WHERE source = ? AND expires_at > ?').get(source, now)
    if (!row) return null
    row.tags = jsonParseSafe(row.tags, [])
    return row
  },
  getPrefetchCacheBySource(source) {
    return _getDB().prepare('SELECT * FROM prefetch_cache WHERE source = ?').get(source) || null
  },

  // ─── Media ────────────────────────────────────────────────
  upsertMediaHistory(media) {
    const now = new Date().toISOString()
    const existing = media.url ? _getDB().prepare('SELECT id FROM media_history WHERE url = ?').get(media.url) : null
    if (existing) {
      return _getDB().prepare(`UPDATE media_history SET kind=?, title=?, video_id=?, platform=?, played_at=? WHERE id=?`)
        .run(media.kind, media.title || '', media.video_id || null, media.platform || null, now, existing.id)
    }
    return _getDB().prepare(`INSERT INTO media_history (kind, url, title, video_id, platform, played_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(media.kind, media.url, media.title || '', media.video_id || null, media.platform || null, now)
  },
  getMediaHistory(limit = 30) {
    return _getDB().prepare('SELECT * FROM media_history ORDER BY played_at DESC LIMIT ?').all(limit)
  },

  // ─── Brain UI ────────────────────────────────────────────
  insertBrainUiEvent: _insertBrainUiEvent,
  getBrainUiEventHistory: _getBrainUiEventHistory,
  insertUISignal({ type, target, payload = {}, ts, consumed = 0 }) {
    return _getDB().prepare(`INSERT INTO ui_signals (type, target, payload, ts, consumed, created_at) VALUES (?, ?, ?, ?, ?, datetime('now'))`)
      .run(type, target || null, JSON.stringify(payload), ts || Date.now(), consumed)
  },
  getUnconsumedUISignals(limit = 50) {
    return _getDB().prepare('SELECT * FROM ui_signals WHERE consumed = 0 ORDER BY ts DESC LIMIT ?').all(limit)
  },
  markUISignalsConsumed(ids) {
    if (!Array.isArray(ids) || ids.length === 0) return { changes: 0 }
    const placeholders = ids.map(() => '?').join(',')
    return _getDB().prepare(`UPDATE ui_signals SET consumed = 1 WHERE id IN (${placeholders})`).run(...ids)
  },

  // ─── Prompt ───────────────────────────────────────────────
  upsertPrompt(name, content) {
    const existing = _getDB().prepare('SELECT id FROM prompts WHERE name = ?').get(name)
    if (existing) {
      return _getDB().prepare('UPDATE prompts SET content = ?, updated_at = datetime(\'now\') WHERE name = ?').run(content, name)
    }
    return _getDB().prepare('INSERT INTO prompts (name, content, created_at, updated_at) VALUES (?, ?, datetime(\'now\'), datetime(\'now\'))').run(name, content)
  },
  deletePrompt(name) {
    return _getDB().prepare('DELETE FROM prompts WHERE name = ?').run(name)
  },
  listPrompt() {
    return _getDB().prepare('SELECT * FROM prompts ORDER BY updated_at DESC').all()
  },

  // ─── Generic record ──────────────────────────────────────
  insertRecord({ type, data, timestamp }) {
    return _getDB().prepare(`INSERT INTO records (type, data, timestamp) VALUES (?, ?, ?)`)
      .run(type, JSON.stringify(data), timestamp || new Date().toISOString())
  },
  queryRecord({ type, limit = 50 }) {
    let sql = 'SELECT * FROM records WHERE 1=1'
    const params = []
    if (type) { sql += ' AND type = ?'; params.push(type) }
    sql += ' ORDER BY timestamp DESC LIMIT ?'
    params.push(limit)
    return _getDB().prepare(sql).all(...params)
  },

  // ─── Brain UI state ───────────────────────────────────────
  getActiveConstraints() {
    const rows = _getDB().prepare("SELECT value FROM brain_ui_state WHERE key LIKE 'constraint_%'").all()
    return rows.map(r => jsonParseSafe(r.value, r.value))
  },
  getTaskKnowledge() {
    const row = _getDB().prepare("SELECT value FROM brain_ui_state WHERE key = 'task_knowledge'").get()
    return row ? jsonParseSafe(row.value, null) : null
  },
  updateLastJarvisConversationContent(content) {
    _setConfig('last_jarvis_conversation', content)
  },

  // ─── System / Reset ───────────────────────────────────────
  getDB() { return _getDB() },
  resetAll() {
    const db = _getDB()
    db.prepare('DELETE FROM memories').run()
    db.prepare('DELETE FROM conversations').run()
    db.prepare('DELETE FROM action_logs').run()
    db.prepare('DELETE FROM recall_audit').run()
    db.prepare('DELETE FROM extract_audit').run()
    db.prepare('DELETE FROM config').run()
    db.exec("INSERT INTO memories_fts(memories_fts) VALUES('rebuild')")
  },
};

export default db;

// Named exports (matching all imports from other modules)
export const upsertMemoryByMemId = db.upsertMemoryByMemId;
export const hideMemoryByMemId = db.hideMemoryByMemId;
export const getMemoryByMemId = db.getMemoryByMemId;
export const insertConversation = db.insertConversation;
export const upsertEntity = db.upsertEntity;
export const getConfig = db.getConfig;
export const setConfig = db.setConfig;
export const getDB = db.getDB;
export const insertActionLog = db.insertActionLog;
export const normalizeConversationPartyId = db.normalizeConversationPartyId;
export const memoryExistsByMemId = db.memoryExistsByMemId;
export const searchMemories = db.searchMemories;
export const searchMemoriesByKeywords = db.searchMemoriesByKeywords;
export const appendReminderTask = db.appendReminderTask;
export const createReminder = db.createReminder;
export const findMergeableOneOffReminder = db.findMergeableOneOffReminder;
export const listPendingReminders = db.listPendingReminders;
export const getReminderById = db.getReminderById;
export const cancelReminder = db.cancelReminder;
export const listMusicLibrary = db.listMusicLibrary;
export const searchMusicLibrary = db.searchMusicLibrary;
export const updateMusicLrc = db.updateMusicLrc;
export const addMusicTrack = db.addMusicTrack;
export const deleteMusicTrack = db.deleteMusicTrack;
export const getMusicTrack = db.getMusicTrack;
export const saveMusicLrc = db.saveMusicLrc;
export const removeMusicLrc = db.removeMusicLrc;
export const upsertMusicTrack = db.upsertMusicTrack;
export const getAllClawbotTokens = db.getAllClawbotTokens;
export const upsertClawbotToken = db.upsertClawbotToken;
export const findUnansweredDeliveredOutbound = db.findUnansweredDeliveredOutbound;
export const markConversationOpenQuestion = db.markConversationOpenQuestion;
export const getOutboundRecord = db.getOutboundRecord;
export const insertOutboundMsg = db.insertOutboundMsg;
export const updateOutboundState = db.updateOutboundState;
export const deleteClawbotToken = db.deleteClawbotToken;
export const getAllReminders = db.getAllReminders;
export const deleteReminderById = db.deleteReminderById;
export const upsertChatSession = db.upsertChatSession;
export const getChatSession = db.getChatSession;
export const deleteChatSession = db.deleteChatSession;
export const setConversationFlag = db.setConversationFlag;
export const getConversationFlag = db.getConversationFlag;
export const insertChatLog = db.insertChatLog;
export const queryChatLog = db.queryChatLog;
export const clearChatLog = db.clearChatLog;
export const getUserSetting = db.getUserSetting;
export const saveUserSetting = db.saveUserSetting;
export const addMusicLrc = db.addMusicLrc;
export const fetchSessionList = async () => [];
export const upsertPrompt = db.upsertPrompt;
export const deletePrompt = db.deletePrompt;
export const listPrompt = db.listPrompt;
export const insertRecord = db.insertRecord;
export const queryRecord = db.queryRecord;
export const updateConversationDeliveryStatus = db.updateConversationDeliveryStatus;
export const upsertPrefetchTask = db.upsertPrefetchTask;
export const removePrefetchTask = db.removePrefetchTask;
export const listPrefetchTasks = db.listPrefetchTasks;
export const getRecentActionLogs = db.getRecentActionLogs;
export const insertExtractAudit = db.insertExtractAudit;
export const searchByEmbedding = db.searchByEmbedding;
export const getMemoriesByDateRange = db.getMemoriesByDateRange;
export const getCandidateEntitiesForConsolidation = db.getCandidateEntitiesForConsolidation;
export const getMemoriesByEntity = db.getMemoriesByEntity;
export const savePrefetchCache = db.savePrefetchCache;
export const clearExpiredPrefetchCache = db.clearExpiredPrefetchCache;
export const getEnabledPrefetchTasks = db.getEnabledPrefetchTasks;
export const getRecentMemories = db.getRecentMemories;
export const resetAll = db.resetAll;
export const insertMemory = db.insertMemory;
export const getKnownEntities = db.getKnownEntities;
export const getOrInitBirthTime = db.getOrInitBirthTime;
export const insertRecallAudit = db.insertRecallAudit;
export const upsertMediaHistory = db.upsertMediaHistory;
export const getMediaHistory = db.getMediaHistory;
export const updateLastJarvisConversationContent = db.updateLastJarvisConversationContent;
export const insertUISignal = db.insertUISignal;
export const getBrainUiEventHistory = db.getBrainUiEventHistory;
export const getActiveConstraints = db.getActiveConstraints;
export const getTaskKnowledge = db.getTaskKnowledge;
export const getPersonMemory = db.getPersonMemory;
export const upsertUserProfile = db.upsertUserProfile;
export const getRecentConversation = db.getRecentConversation;
export const getRecentConversationTimeline = db.getRecentConversationTimeline;
export const getValidPrefetchCache = db.getValidPrefetchCache;
export const getUnconsumedUISignals = db.getUnconsumedUISignals;
export const markUISignalsConsumed = db.markUISignalsConsumed;
export const getUserProfile = db.getPersonMemory;
export const insertConversationLog = db.insertConversationLog;
export const insertEntityAudit = db.insertEntityAudit;
export const getFocusStack = db.loadFocusStack;
export const setFocusStack = db.setFocusStack;
export const insertPrefetchItem = async () => null;
export const getConversationContext = db.getConversationContext;
export const upsertConversationContext = db.upsertConversationContext;
export const insertDeliveryRecord = async () => null;
export const getPendingDeliveries = async () => [];
export const updateDeliveryStatus = async () => {};
export const getSystemStatus = async () => ({ status: 'ok' });
export const getPluginStatus = async () => ({ plugins: [] });
export const listAPIKeys = async () => [];
export const createAPIKey = async () => null;
export const deleteAPIKey = async () => {};
export const getAgentConfig = async () => null;
export const updateAgentConfig = async () => {};
export const listMediaAssets = async () => [];
export const insertMediaAsset = async () => null;
export const deleteMediaAsset = async () => {};
export const getChatHistory = async () => [];
export const clearChatHistoryByUser = async () => {};
export const getLLMUsageStats = async () => ({ total: 0 });
export const resetLLMUsageStats = async () => {};
export const getUserPermissions = async () => [];
export const grantPermission = async () => {};
export const revokePermission = async () => {};
export const getAuditLog = async () => [];
export const exportData = async () => null;
export const importData = async () => null;
export const getDataVersion = async () => 2;
export const runMigrations = async () => {};
export const getRecentExtractAudits = db.getRecentExtractAudits;
export const getRecentRecallAudits = db.getRecentRecallAudits;
export const getExtractAuditStats = db.getExtractAuditStats;
export const getRecallAuditStats = db.getRecallAuditStats;
export const getRecentConversationPartners = db.getRecentConversationPartners;
export const getDueReminders = db.getDueReminders;
export const materializeReminderRun = db.materializeReminderRun;
export const recoverInterruptedReminderRuns = db.recoverInterruptedReminderRuns;
export const claimRunnableReminderRuns = db.claimRunnableReminderRuns;
export const completeReminderRun = db.completeReminderRun;
export const retryReminderRun = db.retryReminderRun;
export const failReminderRun = db.failReminderRun;
export const getNextPendingReminder = db.getNextPendingReminder;
export const getNextPendingReminderRun = db.getNextPendingReminderRun;
export const getMemoryCount = db.getMemoryCount;
export const loadFocusStack = db.loadFocusStack;
export const loadThreadState = db.loadThreadState;
export const saveThreadState = db.saveThreadState;
export const setCurrentFocusTopic = db.setCurrentFocusTopic;
export const setCurrentThreadId = db.setCurrentThreadId;
export const updateUserMessageFocusTopic = db.updateUserMessageFocusTopic;
export const reassignConversationsThread = db.reassignConversationsThread;
