import { nowTimestamp } from './time.js'
import { normalizeConversationPartyId, upsertEntity, insertConversation } from './capabilities/db.js'
import { resolveCanonicalUserId } from './identity.js'
import { enqueueMessage } from './queue.js'
// C-4.2 方向控制器（对话触发 · 选项 c）
//   「接下来你主攻 X」等表达 → 自动落 data/direction.json
//   LLM 兜底异步跑（不阻塞 pushMessage 主路径）
import { getDirectionController } from './learning/direction.js'
// C-4.3 joy emotion（2026-09-01 续篇）—— 用户认可 / 否决时调 joy.bump
import { getJoyState } from './emotion/joy-state.js'

// 老板认可关键词（中英双语，与 emotion-engine.js 关键词去重）
const APPROVAL_RE = /(对|很好|不错|OK|ok|确认|赞|同意|完美|棒|good|nice|great|yes|approved|agreed|👍|✅|✓)/i
// 老板否决关键词
const REJECTION_RE = /(取消|撤回|不要|不行|错了|错|fail|wrong|error|cancel|reject|no|不|🙅|❌|✗)/i

const PRIORITY = {
  user: 100,
  background: 50,
}

function resolvePriority(fromId, channel, meta = {}) {
  if (typeof meta.priority === 'number') return meta.priority
  if (meta.queue === 'background') return PRIORITY.background
  if (channel === 'REMINDER' || channel === 'SYSTEM' || normalizeConversationPartyId(fromId) === 'SYSTEM') {
    return PRIORITY.background
  }
  return PRIORITY.user
}

function resolveQueueName(priority, meta = {}) {
  if (meta.queue === 'background') return 'background'
  return priority >= PRIORITY.user ? 'user' : 'background'
}

export function pushMessage(rawFromId, content, channel = 'TUI', meta = {}) {
  const normalizedRaw = normalizeConversationPartyId(rawFromId)
  const canonicalId = resolveCanonicalUserId({ rawFromId: normalizedRaw, channel })
  const externalPartyId = canonicalId !== normalizedRaw ? normalizedRaw : ''
  const timestamp = nowTimestamp()
  const priority = resolvePriority(canonicalId, channel, meta)
  const queueName = resolveQueueName(priority, meta)
  upsertEntity(canonicalId)

  // Persist on arrival so interrupted turns still keep the user message in
  // conversation history for the next context window.
  const conversationId = meta.persist !== false ? insertConversation({
    role: 'user',
    from_id: canonicalId,
    to_id: 'jarvis',
    content,
    timestamp,
    channel: channel || '',
    external_party_id: externalPartyId,
    focus_topic: '',
    thread_id: '',
  }) : 0

  // C-4.2 方向检测：仅对真实 user 消息触发（不处理 SYSTEM/REMINDER 内部消息）
  //   - 同步 regex 快路径（80%+ 场景）：> 0.85 直接落库
  //   - 异步 LLM 兜底（不阻塞 pushMessage）：
  //       > 0.85 落库
  //       0.5-0.85 仅 console.log（等下个版本加确认弹窗）
  //       < 0.5 不动
  if (canonicalId !== 'SYSTEM' && content && meta?.directionDetect !== false) {
    try {
      const direction = getDirectionController()
      const regexResult = direction.detectRegex(content)
      if (regexResult && regexResult.confidence >= 0.85) {
        direction.set({ topic: regexResult.topic, setBy: 'user' })
      } else if (regexResult === null) {
        // 异步 LLM 兜底；不 await
        direction.detectLLM(content).then(llmResult => {
          if (llmResult && llmResult.confidence >= 0.85) {
            direction.set({ topic: llmResult.topic, setBy: 'user' })
            console.log(`[direction] set via LLM: ${llmResult.topic} (confidence ${llmResult.confidence})`)
          } else if (llmResult && llmResult.confidence >= 0.5) {
            console.log(`[direction] ambiguous: ${llmResult.topic} (confidence ${llmResult.confidence}), awaiting user confirmation`)
          }
        }).catch(() => { /* 静默失败 */ })
      }
    } catch {
      // 方向检测失败不应阻塞消息入队
    }

    // C-4.3 joy emotion：用户认可 / 否决时调 joy.bump
    //   老板认可（命中 APPROVAL_RE）→ +0.1
    //   老板否决（命中 REJECTION_RE 但非认可）→ -0.3
    //   fire-and-forget 写 joy 表（不阻塞消息入队）
    if (meta?.joyDetect !== false) {
      try {
        const text = String(content || '')
        const isApproval = APPROVAL_RE.test(text)
        const isRejection = !isApproval && REJECTION_RE.test(text)
        if (isApproval) {
          getJoyState().bump({ amount: 0.1, reason: 'user_approval', context: { snippet: text.slice(0, 60) } })
        } else if (isRejection) {
          getJoyState().bump({ amount: -0.3, reason: 'user_reject', context: { snippet: text.slice(0, 60) } })
        }
      } catch {
        // joy 检测失败不应阻塞消息入队
      }
    }
  }

  const entry = {
    raw: `[${canonicalId}${externalPartyId ? ` via ${externalPartyId}` : ''}] ${timestamp} [${channel}] ${content}`,
    fromId: canonicalId,
    externalPartyId,
    content,
    timestamp,
    conversationId,
    channel,
    priority,
    queueName,
    ...meta,
  }

  return enqueueMessage(entry, queueName)
}
