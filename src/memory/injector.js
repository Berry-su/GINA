import {
  getActiveConstraints,
  getTaskKnowledge,
  getPersonMemory,
  getMemoriesByEntity,
  getRecentConversation,
  getRecentConversationTimeline,
  getRecentActionLogs,
  getValidPrefetchCache,
  getUnconsumedUISignals,
  markUISignalsConsumed,
  getConfig,
  getUserProfile,
  insertRecallAudit,
  searchMemories,
} from '../capabilities/db.js'
import { getInstalledToolNames } from '../capabilities/marketplace/index.js'
import { PRIMARY_USER_ID, isExternalChannel, isVoiceChannel } from '../identity.js'
import { extractKeywords } from './keywords.js'
import { isLikelyOneOffLeaf } from './threads.js'
import { stripTemporalWords } from './temporal-parser.js'
import { selectTools } from './tool-router.js'
import { computeSelfPerception, computeSelfSnapshot, computeEmotionPerception, computeSelfAwareContext } from './self-perception.js'
import { selectActivePolicies } from './active-policies.js'
import { formatSelfEvolutionForPrompt } from './self-evolution.js'
import { getContextWindowConfig } from '../config.js'
import { processEmotionUpdate, getEmotionSnapshot } from './emotion-engine.js'
import { getConsciousnessState, getConsciousnessPrompt } from './consciousness-state.js'
import { formatReflectionForPrompt } from './reflection-executor.js'
import { selectSkillsForMessage, formatSkillsForContext } from '../skills/registry.js'
// C-4.1 self-model + C-4.2 direction（C-4 新基础设施，2026-09-01 落地）
//   两者都是 meta-info 段，跟 emotion 一样严格隔离（不进 LLM tool/决策调用链路）
import { getSelfModel } from '../self/model.js'
import { getDirectionController } from '../learning/direction.js'
// C-4.3 joy emotion（2026-09-01 续篇）—— 只 joy 一个维度，meta-info 段
//   唯一注入出口 = buildContextBlock 的 <emotional-state> 段
//   严格隔离：emotion-isolation.test.js 每 PR 必跑 7 断言
import { getJoyState } from '../emotion/joy-state.js'
// C-3.9 L1/L2 hot path wiring（2026-09-01）—— 把 L1 注入决策 + L2 召回激活
//   写到 CATS-Net 同一张图，失败静默不破主流程
import { getIntegration as getIntegrationSingleton } from '../brain/integration/init.js'

// runInjector 内部用到的检索/选择/解析原语（已拆到 ./injector-retrieval.js）
import {
  parseMessageInput,
  searchRelevantMemories,
  deduplicateMemories,
  selectContextMemories,
  gatherTemporalRecall,
} from './injector-retrieval.js'
import { bfsSpreadActivation } from './bfs-activation.js'
// runInjector 内部用到的渲染函数（已拆到 ./injector-format.js）
import { summarizeUISignals } from './injector-format.js'

// —— 对外门面：保持 injector.js 作为统一入口，原有 import 路径不变 ——
// 旧 import 路径兼容：focus.js / 其他模块也能从 injector 拿到 extractKeywords
export { extractKeywords }
export { selectContextMemories }
export { searchAdditionalMemories } from './injector-retrieval.js'
export {
  formatTemporalRecall,
  formatMemoriesForPrompt,
  formatPrefetchedItems,
  formatSceneManifest,
  formatAIVideoPanel,
  formatTaskKnowledge,
} from './injector-format.js'
export { formatActivePoliciesForPrompt } from './active-policies.js'

const L2_CONTEXT_HOURS = 24 * 7
const SELF_EVOLUTION_CONTEXT_RE = /self[-\s]?evol|evolv|self[-\s]?improv|improve yourself|learn(?:ed|ing)?\s+(?:from|that|this)|lesson|policy|procedure|constraint|failure|feedback|\u81ea\u8fdb\u5316|\u8fdb\u5316|\u81ea\u5b66\u4e60|\u5b66\u5230\u4e86|\u6539\u8fdb|\u6559\u8bad|\u7ecf\u9a8c|\u89c4\u5219|\u7b56\u7565|\u53cd\u601d/i
const API_KEY_RE = /\b(?:sk|ak|rk|pk|ark)-[A-Za-z0-9_\-.]{12,180}\b/i
const API_DOCS_RE = /https?:\/\/|api|docs?|platform|capability|endpoint|base[-_\s]?url|model|auth|\u6587\u6863|\u63a5\u53e3|\u914d\u7f6e|\u80fd\u529b/i
const API_CONFIG_CONFIRM_RE = /^(?:yes|yep|ok|okay|sure|do it|go ahead|\u662f|\u662f\u7684|\u53ef\u4ee5|\u597d|\u597d\u7684|\u5bf9|\u884c|\u914d\u7f6e|\u914d\u4e0a|\u8bbe\u7f6e|\u8bbe\u6210)$/i

function shouldInjectSelfEvolutionContext(messageBody = '', isTick = false) {
  if (isTick) return true
  return SELF_EVOLUTION_CONTEXT_RE.test(String(messageBody || ''))
}

function hasRecentApiCapabilitySetupNeed(actionLog = []) {
  if (!Array.isArray(actionLog)) return false
  return actionLog.some(entry => {
    const tool = String(entry?.tool || '')
    if (tool !== 'analyze_image' && tool !== 'manage_api_capability') return false
    const text = `${entry?.status || ''} ${entry?.error || ''} ${entry?.result_preview || ''} ${entry?.args_json || ''}`
    return /not_configured|slot_not_found|credential_not_configured|api_key required|configure|capability/i.test(text)
  })
}

// hint：一层思考器的输出文本，用于扩展 L2 的记忆检索范围
export async function runInjector({ message, state, hint = '', currentChannel = '' }) {
  const injectorStartedAt = Date.now()
  const contextWindow = getContextWindowConfig()
  const lastToolResult = contextWindow.toolCallLimit > 0 ? (state?.lastToolResult || null) : null
  if (state && Object.prototype.hasOwnProperty.call(state, 'lastToolResult')) state.lastToolResult = null

  const confidenceHint = state?.pendingConfidenceHint || null
  if (state && 'pendingConfidenceHint' in state) state.pendingConfidenceHint = null  // 消费即焚

  const { isTick: isTickMessage, senderId, messageBody } = parseMessageInput(message)
  const hasTask = !!state?.task

  const constraints = getActiveConstraints()

  let personMemory = null
  let userProfile = null
  let conversationWindow = []
  let senderMemories = []
  if (senderId) {
    personMemory = getPersonMemory(senderId)
    userProfile = getUserProfile(senderId)
    // 纯寒暄（"你好/在吗/谢谢"）只带最近 2 条对话，避免把上一轮任务的长输出（整篇文案/代码）
    // 整个灌进上下文，导致寒暄被旧任务话题带偏。
    const greetingWindow = isLikelyOneOffLeaf(messageBody) ? 2 : contextWindow.chatMessageLimit
    conversationWindow = getRecentConversation(greetingWindow)
    senderMemories = getMemoriesByEntity(senderId, 10)
  } else if (message && /^TICK\s/i.test(message.trim())) {
    personMemory = getPersonMemory(PRIMARY_USER_ID)
    userProfile = getUserProfile(PRIMARY_USER_ID)
    conversationWindow = getRecentConversationTimeline(contextWindow.chatMessageLimit, L2_CONTEXT_HOURS)
    senderMemories = getMemoriesByEntity(PRIMARY_USER_ID, 10)
  }

  // 时间词触发的轮廓注入：除 TICK 心跳外都跑。
  // 用 isTick 而不是 senderId 判断——这样外部渠道未带 [ID:...] 前缀的裸消息也能触发；
  // agent 自言自语不走 runInjector，不必担心循环放大。
  const temporalRecall = isTickMessage ? null : gatherTemporalRecall(messageBody)

  const hintText = hint ? hint.replace(/<think>[\s\S]*?<\/think>/gi, '').slice(0, 800) : ''
  const conversationText = conversationWindow
    .map(item => item.content || '')
    .filter(Boolean)
    .join(' ')
    .slice(0, 4000)

  // messageBody 在送进 FTS5 关键词抽取前，先把"昨天/前天/今天"等时间词剥掉。
  // 否则跨边界 ngram（如"昨天我"）会进入字面搜索，召回所有 content 含"昨天我"的旧记忆，
  // 跟用户真正的"昨天"完全无关。时间窗口召回已经被 gatherTemporalRecall 接管。
  const focusBodyForKeywords = temporalRecall ? stripTemporalWords(messageBody) : messageBody

  const focusText = [
    focusBodyForKeywords,
    hasTask ? state.task : '',
    hintText,
  ].filter(Boolean).join(' ')

  const hasHistory = !!conversationText
  const CONF_MULT = { low: 1.5, medium: 1.0, high: 0.7 }
  const mult = CONF_MULT[confidenceHint] || 1.0
  const scale = (n) => Math.max(1, Math.round(n * mult))

  const baseFocusLimit     = hasHistory ? 15 : (hint ? 12 : 8)
  const baseContextLimit   = hasHistory ? 10 : 0
  const baseFocusKeywords  = hasHistory ? 10 : (hint ? 10 : 8)
  const baseContextKeywords = hasHistory ? 14 : 0

  const focusLimit      = scale(baseFocusLimit)
  const contextLimit    = baseContextLimit === 0 ? 0 : scale(baseContextLimit)   // 0 不放大（hasHistory=false 时 context 路径整体关掉）
  const focusKeywords   = scale(baseFocusKeywords)
  const contextKeywords = baseContextKeywords === 0 ? 0 : scale(baseContextKeywords)
  const relevantMemories = focusText
    ? await searchRelevantMemories({
        focusText,
        contextText: conversationText,
        focusLimit,
        contextLimit,
        focusKeywords,
        contextKeywords,
        perKeyword: 5,
      })
    : []

  const taskKnowledge = hasTask ? getTaskKnowledge(20) : []
  const recallMemories = []
  const directions = []

  if (state?.prev_recall) {
    const query = state.prev_recall
    console.log(`[注入器] 处理 RECALL: ${query}`)

    let hits = searchMemories(query, 5)

    if (hits.length === 0) {
      const keywords = extractKeywords(query)
      const seen = new Set()
      for (const keyword of keywords) {
        for (const memory of searchMemories(keyword, 3)) {
          if (!seen.has(memory.id)) {
            seen.add(memory.id)
            hits.push(memory)
          }
        }
        if (hits.length >= 5) break
      }
    }

    if (hits.length > 0) {
      recallMemories.push(...hits)
      directions.push(`You proactively requested memory recall for "${query}" in the previous moment. Relevant details have been injected.`)
    } else {
      directions.push(`You proactively requested memory recall for "${query}", but no related memory was found.`)
    }
  }

  // 召回上限：有对话历史时放宽到 30，否则 12。
  // 不再按"消息是否 trivial"的正则判定收紧——浅层模式不该替模型决定要不要省召回，
  // 复合意图（如"还有多少电？顺便分析下昨天的 bug"）下这种收紧会误杀需要 reasoning 的部分。
  // 该注入的 context 照常注入，由模型自己决定怎么用。
  const mergeCap = hasHistory ? 30 : 12
  const merged = deduplicateMemories([relevantMemories, senderMemories])
  // 「少即是强」：保留 merged 的相关度序，只给高 salience 锚留窄保留道；
  // 不再用 rerankByImportance 按 salience 整体重排（详见 selectContextMemories 注释）。
  const memories = selectContextMemories(merged, { cap: mergeCap, anchorLane: 2 })

  // BFS 扩散激活：从种子记忆出发拉关联记忆，打破孤立回忆
  let bfsMemories = []
  try {
    bfsMemories = await bfsSpreadActivation(memories, { maxDepth: 2, maxBranching: 4, totalLimit: 10 })
  } catch { /* BFS 失败不影响主流程 */ }
  const allMemories = memories.concat(bfsMemories)
  const actionLog = contextWindow.toolCallLimit > 0
    ? getRecentActionLogs(contextWindow.toolCallLimit)
    : []
  const activePolicies = focusText
    ? selectActivePolicies({
        focusText,
        messageBody,
        contextText: conversationText,
        actionLog,
        baseMemories: memories,
      })
    : []

  // —— 按需注入工具（动态上下文记忆池第 4 步）——
  // 之前把 ~35 个工具全量注入，每轮 6-9K token 大头在这。改成按意图分组：
  // tool-router.js 看消息正文 + 上下文标志 + ActionLog 保活 + Fallback 安全网。
  if (API_KEY_RE.test(messageBody) && API_DOCS_RE.test(messageBody)) {
    directions.push('The current user message includes API documentation/config context plus an API key. Treat it as intent to configure an API-backed capability. Prefer manage_api_capability(action="configure" or action="save_doc") in this turn; for OpenAI-compatible vision APIs, do not build an ad-hoc tool or run raw scripts.')
  } else if (API_CONFIG_CONFIRM_RE.test(messageBody.trim().toLowerCase()) && hasRecentApiCapabilitySetupNeed(actionLog)) {
    directions.push('The user is confirming your immediately previous offer to configure an API capability after a not_configured or missing-credential result. Call manage_api_capability to configure the capability slot using the provider/docs/model/key already in recent context; do not switch to tool factory or an ad-hoc script.')
  }

  const prefetchedItems = getValidPrefetchCache()

  const uiSignals = getUnconsumedUISignals(60_000)
  const uiSignalSummary = summarizeUISignals(uiSignals)
  if (uiSignals.length) markUISignalsConsumed(uiSignals.map(s => s.id))

  const { listCapabilities } = await import('../providers/registry.js')
  const mmCaps = listCapabilities()
  const installedNames = getInstalledToolNames()
  const isTick = !senderId && /^TICK\s/i.test(message?.trim())

  const tools = selectTools({
    messageBody,
    isTick,
    senderId,
    hasTask,
    hasRecall: !!state?.prev_recall,
    isVoiceTurn: isVoiceChannel(currentChannel),
    mmCaps,
    recentActionLog: actionLog,
    installedToolNames: installedNames,
    startupSelfCheckActive: !!state?.startupSelfCheck?.active,
    localVisualTurn: !currentChannel || !isExternalChannel(currentChannel),
    // fastUserPath 留作未来扩展——目前从 state 上拿不到，selectTools 接受未传即 false
  })

  // 自我感知层（增强版）：对当前 user 消息做镜像/风格/循环/情绪检测。
  // 整合 emotion-engine 情绪分析，为 LLM 提供"对方情绪状态"的感知。
  const agentName = getConfig('agent_name') || '小白龙'
  const hasUserMsg = !isTickMessage && senderId && messageBody

  // 情绪分析 + 自我感知（非 TICK 且有用户消息时）
  let emotionProfile = null
  let selfPerception = null
  let emotionPerception = null
  if (hasUserMsg) {
    emotionProfile = processEmotionUpdate({
      messageText: messageBody,
      conversationWindow,
    })
    selfPerception = computeSelfPerception({
      conversationWindow,
      currentMsg: { content: messageBody, fromId: senderId },
    })
    emotionPerception = computeEmotionPerception({
      conversationWindow,
      currentMsg: { content: messageBody, fromId: senderId },
      agentName,
    })
  }

  // 自我快照：常驻的"你刚才是怎样的你"。
  const selfSnapshot = computeSelfSnapshot({ conversationWindow, actionLog, agentName })

  // 意识状态（获取当前状态供 Prompt 使用）
  const consciousnessState = getConsciousnessState()
  const consciousnessPrompt = getConsciousnessPrompt()

  // 情绪快照（供 Prompt 使用）
  const emotionSnapshot = getEmotionSnapshot()

  // 反思状态（供 Prompt 使用）
  const reflectionPrompt = formatReflectionForPrompt()

  // 闭环：技能选择 — 根据用户消息匹配相关技能
  let skillSelection = null
  let skillsPrompt = ''
  if (!isTickMessage && messageBody) {
    try {
      skillSelection = selectSkillsForMessage(messageBody)
      skillsPrompt = formatSkillsForContext(skillSelection)
    } catch (skillErr) {
      console.warn('[injector] Skill selection failed:', skillErr?.message)
    }
  }

  const selfEvolution = shouldInjectSelfEvolutionContext(messageBody, isTickMessage)
    ? formatSelfEvolutionForPrompt({ maxRecent: isTickMessage ? 3 : 5 })
    : ''

  // C-4.1 self-model：4 维运行时显式状态
  //   - tick() 刷新累计时长 / tickCount / learned / loadedTools
  //   - 走 toContextString() 输出 meta-info 字符串
  let selfModelText = ''
  try {
    const sm = getSelfModel()
    sm.tick({ state: state })
    selfModelText = sm.toContextString()
  } catch (err) {
    // self-model 失败不应阻塞主流程（情绪隔离原则：不破主流程）
    selfModelText = ''
  }

  // C-4.2 direction：选项 c 对话触发，injectFor() 渲染
  //   - 在 pushMessage() 阶段已写入 data/direction.json
  //   - 此处只读，渲染成 meta-info 段
  let currentDirectionText = ''
  try {
    const dir = getDirectionController()
    currentDirectionText = dir.injectFor()
  } catch (err) {
    currentDirectionText = ''
  }

  // C-4.3 joy emotion（2026-09-01 续篇）：meta-info 段，紧跟 self-model 之后
  //   - JoyState.injectFor() 渲染 <emotional-state> 段
  //   - 严格隔离：emotion-isolation.test.js 每 PR 必跑
  //   - 失败不阻塞（与 self-model / direction 一致兜底）
  let emotionalStateText = ''
  try {
    const joy = getJoyState()
    joy.tick()
    emotionalStateText = joy.injectFor()
  } catch (err) {
    emotionalStateText = ''
  }

  // Memory-Optimization v0.1 Phase 0：记录这一轮召回的"命中了什么/漏了什么"。
  // 写入 best-effort；任何失败都吞掉，绝不影响主流程。
  // chosen_count = 经过 rerank + topK 截断后真正进 prompt 的条数（含 recall hits）；
  // matched_mem_ids 取真正进 prompt 的那批，便于后续核对"prompt 里到底带了哪些记忆"。
  try {
    const chosenIds = [
      ...allMemories.map(m => m.mem_id || m.id),
      ...recallMemories.map(m => m.mem_id || m.id),
      ...activePolicies.map(m => m.mem_id || m.id),
    ]
    const dist = {}
    for (const m of allMemories) {
      const et = m.event_type || 'unknown'
      dist[et] = (dist[et] || 0) + 1
    }
    insertRecallAudit({
      turn_label: isTickMessage ? 'L2_TICK' : (senderId ? `L1_msg_from_${senderId}` : 'unknown'),
      from_id: senderId,
      channel: null,
      query_text: messageBody || (isTickMessage ? '[TICK]' : ''),
      matched_mem_ids: chosenIds,
      chosen_count: chosenIds.length,
      event_type_dist: dist,
      latency_ms: Date.now() - injectorStartedAt,
      source: 'runInjector',
    })
  } catch {}

  // C-3.9 L1/L2 hot path wiring（2026-09-01）
  //   L1: 每次 runInjector 调 = 1 次"语义记忆预判"完成，写 CATS-Net + aci_injection_log
  //   L2: 召回的 memory 调 activateMemory（不写新节点，只激活；写已在 addObservation 那条路径）
  //   严格隔离：走 l1.recordInjection + l2.activateMemory 已 sanitize，不进 emotion
  //   失败静默：try/catch 包裹，integration 挂掉不影响主流程
  try {
    const integ = getIntegrationSingleton()
    if (integ) {
      // L1: 语义记忆预判（每次 runInjector = 1 次注入决策）
      if (allMemories.length > 0 || recallMemories.length > 0) {
        const targetMem = allMemories[0] || recallMemories[0]
        const target = targetMem?.mem_id || null
        const conf = Math.min(1, 0.4 + Math.min(0.5, allMemories.length * 0.05))
        // C-3.4 方向加权：direction 领域记忆优先级 ×1.5（老板 9-01 拍板 ADR-003 §3.2.6）
        //   失败静默：direction.getCurrent() 返回 null 时跳过加权
        let priority = 1.0
        let directionMatch = false
        try {
          const direction = getDirectionController()
          const currentDir = direction.getCurrent()
          const topic = currentDir?.topic || null
          if (topic) {
            // 用 targetMem 的 mem_id / title / content 跟 topic 做 match
            const probeText = [targetMem?.mem_id, targetMem?.title, targetMem?.content]
              .filter(Boolean).join(' ')
            directionMatch = direction.matchConcept(probeText, topic)
            if (directionMatch) priority = 1.5
          }
        } catch {
          // 静默：direction 模块挂掉不破主循环
        }
        integ.l1.recordInjection({
          strategy: 'semantic_memory_prefetch',
          confidence: conf,
          target,
          context: (messageBody || '').slice(0, 100),
          priority,
          directionMatch,
        })
      }
      // L2: 激活召回的 memory 概念（CATS-Net 后续扩散能用到）
      //   限 10 条避免 P95 爆掉
      for (const m of allMemories.slice(0, 10)) {
        const mid = m.mem_id || m.id
        if (mid) integ.l2.activateMemory(mid, 0.3)
      }
      for (const m of recallMemories.slice(0, 5)) {
        const mid = m.mem_id || m.id
        if (mid) integ.l2.activateMemory(mid, 0.5)
      }
    }
  } catch {
    // 静默：integration 失败不影响 runInjector 主流程
  }

  return {
    memories: allMemories,
    activePolicies,
    recallMemories,
    conversationWindow,
    personMemory,
    userProfile,
    directions,
    constraints,
    thought: null,
    taskKnowledge,
    tools: [...new Set(tools)],
    lastToolResult,
    actionLog,
    prefetchedItems,
    uiSignalSummary,
    temporalRecall,
    selfPerception,
    selfSnapshot,
    selfEvolution,
    // C-4.1 self-model + C-4.2 direction（2026-09-01 新基础设施）
    selfModel: selfModelText ? { text: selfModelText } : null,
    currentDirection: currentDirectionText || null,
    // C-4.3 joy emotion（2026-09-01 续篇）
    emotionalState: emotionalStateText || null,
    emotionProfile,
    emotionPerception,
    emotionSnapshot,
    consciousnessState,
    consciousnessPrompt,
    reflectionPrompt,
    skillSelection,
    skillsPrompt,
    toolCallLimit: contextWindow.toolCallLimit,
  }
}
