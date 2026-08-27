/**
 * Gina 启动集成验证 —— 把新旧架构全部模块串起来跑一遍（详细逐节点日志）
 *
 * 运行：node scripts/verify-startup.mjs
 * 覆盖：决策/可解释/进化/认知(CATS-Net)/分析师/金融引擎/伦理/工作流DAG/MCP/A2A/
 *       状态机/工具调度/三层记忆+投影/知识图谱
 */

import { initGinaBrain } from '../src/brain/index.js'
import { initEthicsGate, getEthicsStatus } from '../src/decision/ethics-gate.js'
import { initWorkflowOrchestrator, defineWorkflow } from '../src/workflow/orchestrator.js'
import { createGinaMcpServer } from '../src/mcp/gina-mcp-server.js'
import { createA2AServer } from '../src/a2a/a2a-protocol.js'
import { StateMachine, State, Transition } from '../src/state_machine/index.js'
import { MCPScheduler, Tool } from '../src/tool-scheduler/index.js'
import { MemoryManager } from '../src/layered-memory/index.js'
import { CatsNet } from '../src/cats_net/index.js'
import { getKnowledgeGraph } from '../src/memory/knowledge-distiller.js'

const results = []
async function check(name, fn) {
  try {
    const detail = await fn()
    results.push({ name, ok: true, detail })
    console.log(`  ✅ ${name}${detail ? ' —— ' + detail : ''}`)
  } catch (err) {
    results.push({ name, ok: false, detail: err.message })
    console.log(`  ❌ ${name} —— ${err.message}`)
  }
}

console.log('='.repeat(62))
console.log('  Gina 启动集成验证 (新旧架构全模块)')
console.log('='.repeat(62))

// ── 1. 大脑统一初始化（决策/可解释/进化/认知/分析师/金融引擎） ──
console.log('\n[1] 大脑统一初始化 initGinaBrain')
await check('决策引擎 + 可解释 + 进化 + CATS-Net + 分析师 + 金融引擎', () => {
  const b = initGinaBrain({ decision: { style: 'balanced' }, explainability: { enableTracing: true } })
  if (!b.success) throw new Error('initGinaBrain 返回 success=false')
  return `分析师=${b.analystTeam?.size ?? 0}人 新闻源=${b.financeEngine?.newsSources ?? '-'}`
})

// ── 2. 伦理门禁 ──
console.log('\n[2] 伦理门禁')
await check('initEthicsGate + getEthicsStatus', () => {
  initEthicsGate()
  const s = getEthicsStatus()
  if (!s) throw new Error('getEthicsStatus 返回空')
  return '已就绪'
})

// ── 3. 工作流 DAG ──
console.log('\n[3] 工作流 DAG')
await check('initWorkflowOrchestrator + defineWorkflow', () => {
  initWorkflowOrchestrator()
  const wf = defineWorkflow({ id: 'wf-check', name: '验证流', nodes: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], edges: [{ from: 'a', to: 'b' }] })
  if (!wf || wf.id !== 'wf-check') throw new Error('defineWorkflow 返回异常')
  return `workflow=${wf.id}`
})

// ── 4. MCP 协议（构建 + 注册工具；stdio 握手见 start() 的日志） ──
console.log('\n[4] MCP 协议')
await check('createGinaMcpServer + registerGinaTools', () => {
  const s = createGinaMcpServer({ name: 'gina-check', version: '1.0.0' })
  const tools = s.registerGinaTools()
  if (!Array.isArray(tools) || tools.length === 0) throw new Error('未注册任何工具')
  return `注册 ${tools.length} 个工具`
})

// ── 5. A2A 协议 ──
console.log('\n[5] A2A 协议')
await check('createA2AServer', () => {
  const s = createA2AServer({ name: 'gina-check' })
  if (!s) throw new Error('createA2AServer 返回空')
  return '已构建'
})

// ── 6. 状态机（新迁入） ──
console.log('\n[6] 状态机 StateMachine')
await check('FSM 迁移', () => {
  const sm = new StateMachine({ initialState: 'idle' })
  sm.addState(new State({ id: 'idle' }))
  sm.addState(new State({ id: 'run' }))
  sm.addTransition(new Transition({ from: 'idle', to: 'run', event: 'go' }))
  sm.start()
  const r = sm.transition('go')
  if (!r.ok) throw new Error(`迁移失败 reason=${r.reason}`)
  return 'idle→run'
})

// ── 7. 工具调度（新迁入） ──
console.log('\n[7] 工具调度 MCPScheduler')
await check('Tool 注册 + 动态调用', async () => {
  const sched = new MCPScheduler({ retries: 0 })
  sched.register(new Tool({ name: 'ping', handler: async () => 'pong' }))
  const r = await sched.call('ping', {})
  if (!r.ok || r.result !== 'pong') throw new Error(`调用异常 ${r.reason ?? ''}`)
  return 'ping→pong'
})

// ── 8. 三层记忆 + CATS-Net 投影（新迁入） ──
console.log('\n[8] 三层记忆 + CATS-Net 投影')
await check('MemoryManager 巩固投影', () => {
  const cn = new CatsNet()
  cn.addNode({ id: 'risk', name: '风险' })
  const mm = new MemoryManager({ catsNet: cn })
  mm.addObservation({ id: 'o1', content: '风险', concepts: ['risk'], importance: 1 })
  mm.shiftToShortTerm()
  const c = mm.consolidate({ minStrength: 0.6 })
  if (c.consolidated !== 1 || c.projected !== 1) throw new Error(`巩固/投影异常 ${JSON.stringify(c)}`)
  return `巩固=${c.consolidated} 投影=${c.projected}`
})

// ── 9. 知识图谱 ──
console.log('\n[9] 知识图谱')
await check('getKnowledgeGraph', () => {
  const g = getKnowledgeGraph()
  if (!g) throw new Error('getKnowledgeGraph 返回空')
  return `节点=${Array.isArray(g?.nodes) ? g.nodes.length : Object.keys(g ?? {}).length}`
})

// ── 汇总 ──
const failed = results.filter((r) => !r.ok)
console.log('\n' + '='.repeat(62))
console.log(`  启动集成验证汇总: ${results.length - failed.length}/${results.length} 通过`)
if (failed.length) {
  console.log('  失败项: ' + failed.map((r) => r.name).join(', '))
}
console.log('='.repeat(62))
process.exit(failed.length ? 1 : 0)