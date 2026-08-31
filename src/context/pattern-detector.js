// L1 · ACI 预判注入器 —— 工具链模式识别器
//
// 职责:在主循环调用 LLM 前 <1.5s 硬预算内,从用户消息里识别"是否在调用某条工具链"。
// 出口:{ pattern, confidence, source },供 runtime-injector 决定是否预判激活对应工具。
//
// 双轨识别:
//   规则轨 —— O(1) 正则,命令前缀(/>get /show /create 等)立即识别,confidence≈0.95
//   频率轨 —— O(N) 滑动窗口,N ≤ 100,同 pattern 在 windowMs 内 ≥ threshold 次触发,
//             confidence 随命中次数 0.5 → 0.95 线性增长
//
// 不做的事(显式拒绝):
//   - 不调 LLM 意图分类(800ms+ 直接击穿 L1 预算)
//   - 不持久化命中(只内存;主循环进程重启即清空,符合"识别器是短期会话状态")
//   - 不与 episodic 表耦合(那是 Y-02 职责)
//
// 引用:
//   - 路线图 §1 L1 / §3 Phase Y Y-01
//   - ADR-20260831-001-Y01(双轨识别决策)

const COMMAND_PREFIX_RE = /^\s*\/(get|set|show|toggle|create|update|delete|list|find|search|run|start|stop|help)\b/i

const DEFAULT_WINDOW_MS = 60 * 60 * 1000      // 1h 滑动窗口
const DEFAULT_THRESHOLD = 3                    // 1h 内同模式 ≥ 3 次触发
const MAX_HITS_PER_PATTERN = 100              // 内存上限,防极端情况 OOM
const RULE_CONFIDENCE = 0.95                   // 规则轨命中固定高置信度

export class PatternDetector {
  constructor({ windowMs = DEFAULT_WINDOW_MS, threshold = DEFAULT_THRESHOLD, now } = {}) {
    this.windowMs = windowMs
    this.threshold = threshold
    // now 注入便于测试;不传 = Date.now()
    this.now = typeof now === 'function' ? now : () => Date.now()
    // pattern -> [ts, ts, ...] 按时间升序
    this.hits = new Map()
  }

  // 标准化:同语义变体折叠为同一 pattern。
  // 规则:trim + lowercase + 去首尾标点
  normalize(pattern) {
    if (pattern == null) return ''
    return String(pattern)
      .trim()
      .toLowerCase()
      .replace(/^[^\w\u4e00-\u9fa5]+|[^\w\u4e00-\u9fa5]+$/g, '')
  }

  // 规则轨:静态方法,无副作用,纯函数
  static extractRulePattern(input) {
    const m = String(input == null ? '' : input).match(COMMAND_PREFIX_RE)
    return m ? '/' + m[1].toLowerCase() : null
  }

  // 频率轨累计。一次调用 = 一次命中。
  // at 默认 = now(),允许外部注入(测试/批量回放)
  recordHit(pattern, at) {
    const key = this.normalize(pattern)
    if (!key) return
    const ts = typeof at === 'number' ? at : this.now()
    const list = this.hits.get(key) || []
    list.push(ts)
    // 内存上限:超了就丢最旧的
    if (list.length > MAX_HITS_PER_PATTERN) list.shift()
    this.hits.set(key, list)
  }

  // 清理窗口外数据。可手动调(测试)也可定时调(主循环每分钟)。
  pruneOld(now) {
    const t = typeof now === 'number' ? now : this.now()
    const cutoff = t - this.windowMs
    for (const [key, list] of this.hits) {
      const fresh = []
      for (const ts of list) {
        if (ts > cutoff) fresh.push(ts)
      }
      if (fresh.length === 0) this.hits.delete(key)
      else this.hits.set(key, fresh)
    }
  }

  // 探测入口。规则轨优先,失败回退频率轨。
  // 返回: { pattern, confidence, source: 'rule' | 'frequency' | 'none', count?, lastSeen? }
  detect(input) {
    const rulePattern = PatternDetector.extractRulePattern(input)
    if (rulePattern) {
      // 规则轨命中:自动 recordHit(命令就是模式信号)
      this.recordHit(rulePattern)
      return { pattern: rulePattern, confidence: RULE_CONFIDENCE, source: 'rule' }
    }

    // 频率轨:先清理,再扫窗口
    this.pruneOld()
    let best = null
    for (const [key, list] of this.hits) {
      if (!best || list.length > best.times.length) {
        best = { pattern: key, times: list }
      }
    }
    if (!best || best.times.length < this.threshold) {
      return { pattern: null, confidence: 0, source: 'none' }
    }
    // 置信度:门槛 = 0.5;每多 1 次 +0.05,上限 0.95
    const overShoot = best.times.length - this.threshold
    const confidence = Math.min(0.5 + 0.05 * overShoot, 0.95)
    return {
      pattern: best.pattern,
      confidence,
      source: 'frequency',
      count: best.times.length,
      lastSeen: best.times[best.times.length - 1],
    }
  }

  // 调试辅助:返回当前窗口内所有 pattern 的命中数
  snapshot() {
    this.pruneOld()
    const out = {}
    for (const [key, list] of this.hits) out[key] = list.length
    return out
  }
}

export const __test_internals = {
  COMMAND_PREFIX_RE,
  DEFAULT_WINDOW_MS,
  DEFAULT_THRESHOLD,
  MAX_HITS_PER_PATTERN,
  RULE_CONFIDENCE,
}
