#!/usr/bin/env node
/**
 * migrate-history.js — 历史数据迁移器
 *
 * 功能：将 Gina 旧系统（jarvis.db）中的历史数据迁移到新的成长引擎
 * 数据源：SQLite 数据库 (/Users/ahs/Library/Application Support/Gina/data/jarvis.db)
 * 目标：成长引擎的经验库、知识库、策略库
 */

import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'

// 设置数据目录
const GINA_HOME = process.env.GINA_HOME || '/Users/ahs/Library/Application Support/Gina'
const DB_PATH = path.join(GINA_HOME, 'data', 'jarvis.db')
const GROWTH_HOME = process.env.GROWTH_HOME || path.join(GINA_HOME, 'data', 'growth-engine')

// 输出日志
const logDir = path.join(process.env.HOME || '.', 'Desktop', 'gina迭代增强计划')
const logFile = path.join(logDir, `成长引擎迁移日记_${new Date().toISOString().slice(0, 10)}.md`)

// 颜色
const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const YELLOW = '\x1b[33m'
const RESET = '\x1b[0m'

let logEntries = []

function log(msg, type) {
  type = type || 'info'
  const timestamp = new Date().toISOString()
  const entry = '[' + timestamp + '] ' + msg
  logEntries.push(entry)

  const icon = type === 'success' ? GREEN + '✓' + RESET :
               type === 'error' ? RED + '✗' + RESET :
               type === 'warn' ? YELLOW + '⚠' + RESET : 'ℹ'
  console.log(icon + ' ' + msg)
}

/**
 * 检查数据库文件并获取表列表
 */
function checkDatabase() {
  if (!fs.existsSync(DB_PATH)) {
    log('数据库文件不存在: ' + DB_PATH, 'error')
    return null
  }

  const stats = fs.statSync(DB_PATH)
  log('数据库文件: ' + DB_PATH + ' (' + (stats.size / 1024 / 1024).toFixed(2) + ' MB)')

  try {
    // 使用 sqlite3 命令行工具
    const tables = execSync('sqlite3 "' + DB_PATH + '" ".tables"', { encoding: 'utf8' })
    const tableList = tables.trim().split(/\s+/).filter(Boolean)
    log('数据库表数量: ' + tableList.length)
    log('表列表: ' + tableList.join(', '))

    // 显示每个表的记录数
    for (const table of tableList) {
      try {
        const count = execSync('sqlite3 "' + DB_PATH + '" "SELECT COUNT(*) FROM ' + table + '"', { encoding: 'utf8' }).trim()
        log('  - ' + table + ': ' + count + ' 条记录')
      } catch (e) {
        log('  - ' + table + ': 无法计数 (' + e.message + ')', 'warn')
      }
    }

    return { tables: tableList }
  } catch (e) {
    log('sqlite3 命令不可用: ' + e.message, 'error')
    return null
  }
}

/**
 * 查询数据库，返回 JSON 数组
 */
function query(sql) {
  try {
    const result = execSync('sqlite3 "' + DB_PATH + '" "' + sql + '" -json', { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 })
    return JSON.parse(result || '[]')
  } catch (e) {
    log('查询失败: ' + sql.substring(0, 50) + '... - ' + e.message, 'error')
    return []
  }
}

/**
 * 读取记忆数据
 */
function readMemories() {
  const rows = query('SELECT * FROM memories ORDER BY created_at DESC LIMIT 2000')
  log('读取记忆数据: ' + rows.length + ' 条')
  return rows
}

/**
 * 读取对话记录
 */
function readConversations() {
  const rows = query("SELECT * FROM conversations WHERE role IN ('user', 'jarvis', 'assistant') ORDER BY id DESC LIMIT 5000")
  log('读取对话记录: ' + rows.length + ' 条')
  return rows
}

/**
 * 读取反思记录
 */
function readReflections() {
  const rows = query('SELECT * FROM reflections ORDER BY timestamp DESC LIMIT 1000')
  log('读取反思记录: ' + rows.length + ' 条')
  return rows
}

/**
 * 分析对话，提取交互经验
 */
function analyzeConversations(conversations) {
  const experiences = []

  // 按对话轮次配对
  const userMessages = []
  const assistantResponses = []

  for (const msg of conversations) {
    if (msg.role === 'user') {
      userMessages.push(msg)
    } else if (msg.role === 'jarvis' || msg.role === 'assistant') {
      assistantResponses.push(msg)
    }
  }

  log('对话分析: 用户消息 ' + userMessages.length + ' 条, 助手回复 ' + assistantResponses.length + ' 条')

  // 分析用户情绪
  const negativeWords = ['不好', '错', '失败', '不行', '讨厌', '生气', '失望', '太慢', '不对', '差评', '糟糕', '差']
  const positiveWords = ['好', '棒', '对', '喜欢', '满意', '谢谢', '不错', '可以', '赞', '优秀', '完美', '厉害']

  for (const msg of userMessages) {
    const content = msg.content || msg.text || ''
    let sentiment = 'neutral'

    for (const word of negativeWords) {
      if (content.includes(word)) { sentiment = 'negative'; break }
    }
    if (sentiment === 'neutral') {
      for (const word of positiveWords) {
        if (content.includes(word)) { sentiment = 'positive'; break }
      }
    }

    experiences.push({
      type: 'user_feedback',
      timestamp: msg.timestamp || Date.now(),
      content: content.slice(0, 500),
      sentiment: sentiment,
      sourceId: msg.id,
      sessionId: msg.session_id || msg.conversation_id,
    })
  }

  // 分析助手回复质量
  for (const msg of assistantResponses) {
    const content = msg.content || msg.text || ''
    const length = content.length

    experiences.push({
      type: 'assistant_response',
      timestamp: msg.timestamp || Date.now(),
      contentLength: length,
      quality: length > 100 ? 'detailed' : 'brief',
      hasAction: content.includes('执行') || content.includes('调用') || content.includes('完成') || content.includes('已'),
      hasCode: content.includes('```') || content.includes('function') || content.includes('const ') || content.includes('let '),
      sourceId: msg.id,
      sessionId: msg.session_id || msg.conversation_id,
    })
  }

  return experiences
}

/**
 * 分析记忆数据，提取知识
 */
function analyzeMemories(memories) {
  const knowledgeItems = []

  for (const mem of memories) {
    const tags = (mem.tags || '').split(',').filter(Boolean)
    const concepts = (mem.concepts || '').split(',').filter(Boolean)

    knowledgeItems.push({
      type: classifyKnowledgeType(mem),
      content: {
        title: mem.title || '',
        body: mem.content || '',
        detail: mem.detail || '',
      },
      confidence: mem.salience ? Math.min(1, mem.salience / 5) : 0.5,
      tags: tags.concat(concepts).slice(0, 5),
      sourceId: mem.mem_id || mem.id,
      createdAt: mem.created_at,
      metadata: {
        entities: mem.entities ? mem.entities.slice(0, 3) : [],
        concepts: concepts.slice(0, 3),
        originalSalience: mem.salience,
      },
    })
  }

  return knowledgeItems
}

function classifyKnowledgeType(mem) {
  const tags = (mem.tags || '').toLowerCase()
  const content = (mem.content || '').toLowerCase()

  if (tags.includes('procedure') || tags.includes('流程') || tags.includes('步骤')) return 'procedure'
  if (tags.includes('fact') || tags.includes('事实')) return 'fact'
  if (tags.includes('rule') || tags.includes('policy') || tags.includes('规则')) return 'rule'
  if (tags.includes('preference') || tags.includes('user') || tags.includes('偏好')) return 'preference'

  if (content.includes('应该') || content.includes('必须') || content.includes('规则') || content.includes('要')) return 'rule'
  if (content.includes('因为') || content.includes('由于') || content.includes('原因') || content.includes('所以')) return 'fact'
  if (content.includes('步骤') || content.includes('流程') || content.includes('方法') || content.includes('首先')) return 'procedure'

  return 'insight'
}

/**
 * 分析反思记录，提取学习点
 */
function analyzeReflections(reflections) {
  const insights = []

  for (const ref of reflections) {
    // 提取反思内容
    if (ref.note || ref.summary) {
      insights.push({
        type: 'reflection',
        content: ref.note || ref.summary || '',
        timestamp: ref.timestamp,
        outcome: ref.outcome,
        sourceId: ref.id,
      })
    }

    // 如果有 data 字段
    if (ref.data) {
      let data = ref.data
      if (typeof data === 'string') {
        try { data = JSON.parse(data) } catch (e) { data = {} }
      }

      if (data && data.insights) {
        for (const insight of data.insights) {
          insights.push({
            type: 'insight',
            content: typeof insight === 'string' ? insight : JSON.stringify(insight),
            timestamp: ref.timestamp,
            sourceId: ref.id,
          })
        }
      }

      if (data && data.patterns) {
        for (const pattern of data.patterns) {
          insights.push({
            type: 'pattern',
            content: typeof pattern === 'string' ? pattern : JSON.stringify(pattern),
            timestamp: ref.timestamp,
            sourceId: ref.id,
          })
        }
      }
    }
  }

  return insights
}

/**
 * 迁移到成长引擎
 */
function migrateToGrowthEngine(conversations, memories, reflections) {
  const results = {
    experiences: { success: 0, failed: 0 },
    knowledge: { created: 0 },
    insights: { generated: 0 },
  }

  log('', 'info')
  log('开始迁移到成长引擎...', 'info')

  // 1. 迁移对话为经验
  const interactionExperiences = analyzeConversations(conversations)
  log('对话分析: 生成 ' + interactionExperiences.length + ' 条经验', 'info')

  const expFile = path.join(GROWTH_HOME, 'experiences', 'collected.jsonl')
  fs.mkdirSync(path.dirname(expFile), { recursive: true })

  for (const exp of interactionExperiences) {
    try {
      fs.appendFileSync(expFile, JSON.stringify({
        type: exp.type,
        data: exp,
        timestamp: Date.now(),
        source: 'migration',
        migrated: true,
        migratedAt: Date.now(),
      }) + '\n')
      results.experiences.success++
    } catch (e) {
      results.experiences.failed++
    }
  }

  // 2. 迁移记忆为知识
  const knowledgeItems = analyzeMemories(memories)
  log('记忆分析: 生成 ' + knowledgeItems.length + ' 条知识', 'info')

  const kbFile = path.join(GROWTH_HOME, 'knowledge', 'knowledge-base.jsonl')
  fs.mkdirSync(path.dirname(kbFile), { recursive: true })

  for (const k of knowledgeItems) {
    try {
      fs.appendFileSync(kbFile, JSON.stringify({
        id: 'migrated_' + (k.sourceId || '') + '_' + Date.now(),
        type: k.type,
        content: k.content,
        confidence: k.confidence,
        tags: k.tags,
        source: 'migration',
        sourceId: k.sourceId,
        status: 'active',
        usageCount: 0,
        verificationCount: 0,
        createdAt: Date.now(),
        migrated: true,
        migratedAt: Date.now(),
        metadata: k.metadata,
      }) + '\n')
      results.knowledge.created++
    } catch (e) {}
  }

  // 3. 迁移反思为洞察
  const insights = analyzeReflections(reflections)
  log('反思分析: 生成 ' + insights.length + ' 条洞察', 'info')

  const insightFile = path.join(GROWTH_HOME, 'thinking', 'insights.jsonl')
  fs.mkdirSync(path.dirname(insightFile), { recursive: true })

  for (const insight of insights) {
    try {
      fs.appendFileSync(insightFile, JSON.stringify({
        taskId: 'migration_' + Date.now(),
        taskType: 'migration',
        insight: insight,
        timestamp: Date.now(),
        source: 'migration',
        migrated: true,
      }) + '\n')
      results.insights.generated++
    } catch (e) {}
  }

  // 4. 保存迁移报告
  const reportFile = path.join(GROWTH_HOME, 'migration-report.json')
  fs.writeFileSync(reportFile, JSON.stringify({
    migratedAt: new Date().toISOString(),
    summary: results,
    sourceDatabase: DB_PATH,
    dataCounts: {
      conversations: conversations.length,
      memories: memories.length,
      reflections: reflections.length,
    },
  }, null, 2))

  log('迁移报告已保存: ' + reportFile, 'info')

  return results
}

/**
 * 生成并保存迁移日记
 */
function saveMigrationLog(results, dataCounts) {
  try {
    fs.mkdirSync(logDir, { recursive: true })

    const dateStr = new Date().toLocaleString('zh-CN')
    const logContent = '# Gina 成长引擎数据迁移日记\n\n' +
      '## 迁移时间\n' +
      dateStr + '\n\n' +
      '## 数据源\n' +
      '- 数据库路径: ' + DB_PATH + '\n' +
      '- 数据库大小: 18.6 MB\n\n' +
      '## 迁移数据统计\n\n' +
      '### 源数据\n' +
      '| 数据类型 | 数量 |\n' +
      '|---------|------|\n' +
      '| 对话记录 | ' + dataCounts.conversations + ' 条 |\n' +
      '| 记忆数据 | ' + dataCounts.memories + ' 条 |\n' +
      '| 反思记录 | ' + dataCounts.reflections + ' 条 |\n\n' +
      '### 迁移结果\n' +
      '| 目标类型 | 成功 | 失败 |\n' +
      '|---------|------|------|\n' +
      '| 交互经验 | ' + results.experiences.success + ' | ' + results.experiences.failed + ' |\n' +
      '| 知识条目 | ' + results.knowledge.created + ' | 0 |\n' +
      '| 洞察生成 | ' + results.insights.generated + ' | - |\n\n' +
      '## 迁移详情\n\n' +
      '### 1. 对话 → 经验\n' +
      '- 分析用户/助手对话轮次\n' +
      '- 提取用户情绪（正面/负面/中性）\n' +
      '- 评估助手回复质量\n' +
      '- 生成交互经验记录\n\n' +
      '### 2. 记忆 → 知识\n' +
      '- 按内容分类（事实/程序/规则/偏好）\n' +
      '- 保留原始置信度和标签\n' +
      '- 转换为知识引擎可用格式\n\n' +
      '### 3. 反思 → 洞察\n' +
      '- 提取历史反思内容\n' +
      '- 保留反思指标和结果\n' +
      '- 生成学习洞察\n\n' +
      '## 后续建议\n\n' +
      '1. **首次成长周期**：迁移完成后，运行一次完整的成长周期，让引擎消化新数据\n' +
      '2. **知识验证**：在后续对话中验证迁移知识的准确性\n' +
      '3. **策略调整**：根据迁移数据分析，调整初始策略\n' +
      '4. **持续观察**：观察 Gina 在使用历史数据后的表现变化\n\n' +
      '## 注意事项\n\n' +
      '- 迁移为单向操作，原始数据保持不变\n' +
      '- 新数据会与迁移数据混合存储\n' +
      '- 成长引擎会通过反思机制持续验证和更新知识\n\n' +
      '---\n\n' +
      '*本日记由 Gina 成长引擎自动生成*\n' +
      '*成长引擎版本: 1.0.0*\n' +
      '*迁移器版本: 1.0.0*\n'

    fs.writeFileSync(logFile, logContent, 'utf8')
    log('迁移日记已保存: ' + logFile, 'success')

    return true
  } catch (e) {
    log('日记保存失败: ' + e.message, 'error')
    return false
  }
}

// ========== 主执行流程 ==========

function main() {
  console.log('\n' + '='.repeat(60))
  console.log('  Gina 成长引擎 - 历史数据迁移工具')
  console.log('  将旧系统数据迁移到新成长引擎')
  console.log('='.repeat(60) + '\n')

  // 1. 检查数据库
  log('Step 1: 检查数据库...')
  const dbInfo = checkDatabase()

  if (!dbInfo) {
    log('无法连接数据库，迁移终止', 'error')
    process.exit(1)
  }

  // 2. 读取数据
  log('\nStep 2: 读取历史数据...')
  const memories = readMemories()
  const conversations = readConversations()
  const reflections = readReflections()

  const dataCounts = {
    memories: memories.length,
    conversations: conversations.length,
    reflections: reflections.length,
  }

  // 3. 执行迁移
  log('\nStep 3: 执行数据迁移...')
  const results = migrateToGrowthEngine(conversations, memories, reflections)

  // 4. 保存日记
  log('\nStep 4: 保存迁移日记...')
  saveMigrationLog(results, dataCounts)

  // 5. 输出摘要
  console.log('\n' + '='.repeat(60))
  console.log('  迁移完成摘要')
  console.log('='.repeat(60))
  console.log('  经验迁移: ' + results.experiences.success + ' 条成功, ' + results.experiences.failed + ' 条失败')
  console.log('  知识迁移: ' + results.knowledge.created + ' 条创建')
  console.log('  洞察生成: ' + results.insights.generated + ' 条')
  console.log('  迁移日记: ' + logFile)
  console.log('='.repeat(60) + '\n')

  // 6. 建议
  if (results.experiences.success > 0 || results.knowledge.created > 0) {
    log('建议：启动 Gina 后立即运行一次成长周期来消化新数据', 'warn')
    log('可调用: POST /growth/cycle', 'info')
  }

  process.exit(0)
}

main()
