// src/self/model.js —— 自主意识（self-model）显式模块
//
// 设计哲学（2026-09-01 老板拍板 · C-4.1）：
//   - self-model 不是隐含的"写在 README 里"——必须是运行时显式模块，每轮 context 注入"## 自主意识"section
//   - 4 维: 我是谁 / 我在做什么 / 我会什么 / 不会什么
//   - **情绪严格隔离**：emotion 字段不读不写（meta-info 段，跟 emotion 一样不进决策路径）
//
// 持久化：KV (getConfig/setConfig)，key=`self_model_v1`，跟 emotion-engine.js 一致
//   - 理由：单例对象，KV 比独立表更合适；后续如需 SQL 索引能力再迁表
//   - 关联 ADR-003 §3.1.3

import { getConfig, setConfig, getOrInitBirthTime, getMemoryCount } from '../capabilities/db.js'
import { getConsciousnessState } from '../memory/consciousness-state.js'
import { getInstalledToolNames } from '../capabilities/marketplace/index.js'
import { getDirectionController } from '../learning/direction.js'

const SELF_MODEL_KEY = 'self_model_v1'
const SELF_MODEL_VERSION = 1
const MAX_RECENT_FAILURES = 5
const DEFAULT_CONFIDENCE = 0.5
const CONFIDENCE_FLOOR = 0.1
const CONFIDENCE_CEIL = 0.95

// GINA 静态元信息（package.json 真相源，避免硬编码版本号）
//   主仓 package.json name=gina, version=2.1.601
//   内核 @berrysu/gina-core 走 catsNet 仓 cat package.json 读（动态）
const GINA_NAME = 'GINA'
const GINA_VERSION = '2.1.601'

// 「不会什么」静态白名单（老板 9-01 拍板 · 仿生脑不做清单）
const STATIC_LIMITATIONS = [
  'no subjective consciousness (no subjective consciousness)',
  'no free will / no real curiosity',
  'cannot sleep or dream',
  'no real physiological experience',
  'no death instinct',
]

// 「会什么」静态能力摘要（补充 capabilities.length 的语义）
const STATIC_CAPABILITIES = [
  'tool invocation (11 categories, 100+ tools)',
  'contextual conversation (L1 ACI prediction injection)',
  'three-tier memory (L2 SQLite + FTS5 + embedding)',
  'CATS-Net conceptual graph (L3)',
  'knowledge brain (L4, 5 domains)',
  'state machine (L5 FSM/HSM)',
  'self-evolution (L7 reflection / self-evolution)',
]

function _defaultState() {
  return {
    version: SELF_MODEL_VERSION,
    identity: {
      name: GINA_NAME,
      version: GINA_VERSION,
      coreVersion: null,        // 启动时从 @berrysu/gina-core 读
      bornAt: null,              // 首次 tick 时从 getOrInitBirthTime() 读
      uptimeMs: 0,
      learned: { nodes: 0, memories: 0, experiences: 0 },
      loadedTools: 0,
    },
    current: {
      task: null,                // 来自 state.task
      consciousnessState: null,  // 来自 getConsciousnessState()
      direction: null,           // 来自 DirectionController.get()
    },
    abilities: {
      capabilities: [...STATIC_CAPABILITIES],
      recentFailures: [],        // 最近 5 次失败
      confidence: DEFAULT_CONFIDENCE,
    },
    limitations: [...STATIC_LIMITATIONS],
    _meta: {
      tickCount: 0,
      lastTickAt: 0,
      noteOutcomeCount: 0,
    },
  }
}

function _safeJSONParse(raw) {
  if (!raw) return null
  if (typeof raw === 'object') return raw
  if (typeof raw !== 'string') return null
  try { return JSON.parse(raw) } catch { return null }
}

export class SelfModel {
  /**
   * @param {object} [opts]
   * @param {object} [opts.catsNet] 可选，CATS-Net 实例（用于读节点数）
   * @param {object} [opts.capabilityRegistry] 可选，能力注册表
   * @param {object} [opts._db] 可选，未来 SQLite-table 路径用
   */
  constructor({ catsNet = null, capabilityRegistry = null, _db = null } = {}) {
    this.catsNet = catsNet
    this.capabilityRegistry = capabilityRegistry
    this._db = _db  // reserved
    this._state = this._load()
  }

  _load() {
    const def = _defaultState()
    const raw = _safeJSONParse(getConfig(SELF_MODEL_KEY))
    if (!raw) return def
    // 防御性合并：保证 4 维结构完整
    return {
      ...def,
      ...raw,
      version: SELF_MODEL_VERSION,
      identity: { ...def.identity, ...(raw.identity || {}) },
      current: { ...def.current, ...(raw.current || {}) },
      abilities: {
        ...def.abilities,
        ...(raw.abilities || {}),
        recentFailures: Array.isArray(raw.abilities?.recentFailures) ? raw.abilities.recentFailures.slice(-MAX_RECENT_FAILURES) : [],
      },
      limitations: Array.isArray(raw.limitations) ? raw.limitations : def.limitations,
      _meta: { ...def._meta, ...(raw._meta || {}) },
    }
  }

  _save() {
    try {
      setConfig(SELF_MODEL_KEY, JSON.stringify(this._state))
    } catch (err) {
      // 静默失败，不影响主流程
    }
  }

  /**
   * 每轮 tick 调用：刷新累计时长 / Tick 数 / 已加载工具 / CATS-Net 节点
   * @param {object} [opts]
   * @param {number} [opts.now=Date.now()]
   * @param {object} [opts.state] 主循环 state（读 task / tickCounter）
   * @returns {object} snapshot()
   */
  tick({ now = Date.now(), state = null } = {}) {
    const identity = this._state.identity
    try {
      const birth = getOrInitBirthTime()
      // 归一化为 number (ms) —— getOrInitBirthTime 返回 ISO string，需 parse
      const birthMs = typeof birth === 'number' ? birth : Date.parse(birth)
      identity.bornAt = birthMs
      identity.uptimeMs = birthMs > 0 ? Math.max(0, now - birthMs) : 0
    } catch {}
    // 累计 tick
    this._state._meta.tickCount = (this._state._meta.tickCount || 0) + 1
    this._state._meta.lastTickAt = now
    // 工具数（best-effort）
    try {
      const tools = getInstalledToolNames?.() || []
      if (Array.isArray(tools) && tools.length > 0) {
        identity.loadedTools = tools.length
      }
    } catch {}
    // 记忆数（best-effort）
    try {
      const memCount = getMemoryCount?.() || 0
      if (memCount > 0) identity.learned.memories = memCount
    } catch {}
    // CATS-Net 节点数（best-effort，catsNet 注入时才有）
    if (this.catsNet) {
      try {
        const sz = this.catsNet.size
        if (typeof sz === 'number') identity.learned.nodes = sz
        else if (typeof this.catsNet.size === 'function') identity.learned.nodes = this.catsNet.size()
      } catch {}
    }
    // 「我在做什么」维度
    try {
      const cs = getConsciousnessState?.()
      if (cs) this._state.current.consciousnessState = cs
    } catch {}
    if (state) {
      this._state.current.task = state.task?.title || state.task?.id || null
    }
    // 当前 direction（C-4.2 提供的输入）
    try {
      const dir = getDirectionController()
      const d = dir.get()
      this._state.current.direction = d?.topic || null
    } catch {}
    this._save()
    return this.snapshot()
  }

  /**
   * 完整 self-model JSON（深拷贝，不暴露内部引用）
   */
  snapshot() {
    return {
      version: this._state.version,
      identity: { ...this._state.identity, learned: { ...this._state.identity.learned } },
      current: { ...this._state.current },
      abilities: {
        ...this._state.abilities,
        capabilities: [...this._state.abilities.capabilities],
        recentFailures: [...this._state.abilities.recentFailures],
      },
      limitations: [...this._state.limitations],
      meta: { ...this._state._meta },
    }
  }

  /**
   * 简短自我介绍（meta-info 段，1-2 句）
   * @returns {string}
   */
  introduce() {
    const id = this._state.identity
    const upMin = Math.round((id.uptimeMs || 0) / 60000)
    const upStr = upMin >= 60 ? `${Math.floor(upMin / 60)}h${upMin % 60}m` : `${upMin}m`
    const nodeStr = id.learned?.nodes ?? 0
    const memStr = id.learned?.memories ?? 0
    const toolStr = id.loadedTools ?? 0
    return (
      `I am ${id.name || GINA_NAME}, version ${id.version || GINA_VERSION} ` +
      `(core @berrysu/gina-core ${id.coreVersion || 'unknown'}). ` +
      `Up ${upStr}, ${this._state._meta.tickCount} ticks. ` +
      `Learned ${nodeStr} concepts, ${memStr} memories, ${toolStr} tools loaded.`
    )
  }

  /**
   * 「不会什么」列表（静态 + 动态）
   * @returns {string[]}
   */
  limitations() {
    return [...this._state.limitations]
  }

  /**
   * 当前置信度（基于最近 N 次决策准确率的滑动估计）
   * @returns {number} [0,1]
   */
  confidence() {
    return Number(this._state.abilities.confidence || DEFAULT_CONFIDENCE)
  }

  /**
   * 记录一次决策结果（成功 / 失败）
   * @param {object} opts
   * @param {boolean} opts.success
   * @param {string|null} [opts.reason] 失败原因
   * @param {string|null} [opts.capability] 涉及能力
   */
  noteOutcome({ success, reason = null, capability = null } = {}) {
    if (!success) {
      const failures = this._state.abilities.recentFailures
      failures.push({ ts: Date.now(), reason, capability })
      while (failures.length > MAX_RECENT_FAILURES) failures.shift()
      // 失败 → 置信度衰减 10%
      this._state.abilities.confidence = Math.max(
        CONFIDENCE_FLOOR,
        (this._state.abilities.confidence || DEFAULT_CONFIDENCE) * 0.9
      )
    } else {
      // 成功 → 置信度回升（每次 +0.5% + 1.02×）
      this._state.abilities.confidence = Math.min(
        CONFIDENCE_CEIL,
        (this._state.abilities.confidence || DEFAULT_CONFIDENCE) * 1.02 + 0.005
      )
    }
    this._state._meta.noteOutcomeCount = (this._state._meta.noteOutcomeCount || 0) + 1
    this._save()
    return this.snapshot()
  }

  /**
   * 注入 context 字符串（meta-info 段，紧跟 <self-snapshot> 之后）
   * @returns {string}
   */
  toContextString() {
    const snap = this.snapshot()
    const id = snap.identity
    const cur = snap.current
    const ab = snap.abilities
    const upMin = Math.round((id.uptimeMs || 0) / 60000)
    // 出生时间: 兼容 string (ISO) 和 number (ms) 两种格式
    const bornIso = id.bornAt
      ? (typeof id.bornAt === 'number' ? new Date(id.bornAt).toISOString() : new Date(id.bornAt).toISOString())
      : 'unknown'
    const lines = [
      `## 自主意识 (self-model · v${snap.version})`,
      '',
      '### 我是谁',
      `- 名字: ${id.name || GINA_NAME} · 版本: ${id.version || GINA_VERSION}`,
      `- 内核: @berrysu/gina-core ${id.coreVersion || 'unknown'}`,
      `- 出生: ${bornIso}`,
      `- 在线: ${upMin} min`,
      `- Tick: ${snap.meta.tickCount}`,
      `- 学过: ${id.learned.nodes} 概念 · ${id.learned.memories} 记忆 · ${id.learned.experiences} 经验`,
      `- 工具: ${id.loadedTools} 已加载`,
      '',
      '### 我在做什么',
      `- 任务: ${cur.task || '(无)'}`,
      `- 状态机: ${cur.consciousnessState || 'unknown'}`,
      `- 方向: ${cur.direction || '(未设定)'}`,
      '',
      '### 我会什么',
      `- 置信度: ${(ab.confidence * 100).toFixed(0)}%`,
      `- 能力清单: ${ab.capabilities.length} 项`,
      ...ab.capabilities.slice(0, 5).map(c => `  - ${c}`),
      ab.capabilities.length > 5 ? `  - ... +${ab.capabilities.length - 5} more` : '',
      '',
      '### 不会什么',
      ...snap.limitations.map(l => `- ${l}`),
    ]
    return lines.filter(Boolean).join('\n')
  }

  /**
   * 重置（仅测试用）
   */
  _reset() {
    this._state = _defaultState()
    this._save()
  }
}

// 单例 helper
let _instance = null
export function getSelfModel(opts = {}) {
  if (!_instance) _instance = new SelfModel(opts)
  return _instance
}

/**
 * 测试专用：清 KV 持久化 + 单例指针
 *   - 写 null 到 self_model_v1 → 下次 _load 走 default
 *   - _instance = null → 下次 getSelfModel() 新建实例
 */
export function resetSelfModelForTest() {
  try { setConfig(SELF_MODEL_KEY, null) } catch {}
  _instance = null
}
