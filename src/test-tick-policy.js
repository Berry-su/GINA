// Run: node src/test-tick-policy.js

import { buildAutonomousTickDirections } from './runtime/tick-policy.js'
import { evaluateToolPolicy, isAutonomousReadOnlyCommand } from './capabilities/tool-policy.js'

let failed = 0
function assert(condition, label) {
  if (condition) {
    console.log(`PASS: ${label}`)
    return
  }
  failed++
  process.exitCode = 1
  console.error(`FAIL: ${label}`)
}

const normal = buildAutonomousTickDirections()
assert(normal.includes('no obligation to act, speak, or remain passive'), 'ordinary Tick has no forced behavioral default')
assert(normal.includes('make your own situational judgment'), 'ordinary Tick delegates semantic judgment to the model')
assert(normal.includes('use find_tool'), 'ordinary Tick preserves on-demand capability discovery')
assert(normal.includes('private working text'), 'ordinary Tick distinguishes private text from external communication')
assert(normal.includes('calling send_message'), 'ordinary Tick lets the model explicitly choose external communication')
assert(normal.includes('do not narrate or justify silence'), 'ordinary Tick defines silent completion without semantic runtime filtering')
assert(normal.includes('Treat unanswered conversation like a person would'), 'ordinary Tick treats unanswered messages as a reason to pause')
assert(normal.includes('several messages in a row'), 'ordinary Tick specifically discourages repeated unanswered pings')
assert(!normal.includes('23:00') && !normal.includes('Things you can proactively do'), 'ordinary Tick has no fixed time rule or action menu')
assert(!normal.includes('HARD RULE') && !normal.includes('forbidden'), 'ordinary Tick contains no behavioral hard-rule wording')

const startup = buildAutonomousTickDirections({ startupSelfCheckActive: true, awakeningTicks: 8 })
assert(!startup.includes('diagnostic goal, not a mandatory checklist'), 'generic tick policy does not own the fixed startup self-check')
assert(startup.includes('early awakening period'), 'fixed self-check is injected separately from generic tick policy')

const awakening = buildAutonomousTickDirections({ awakeningTicks: 3 })
assert(awakening.includes('not a prescribed exploration sequence'), 'awakening no longer forces sequential exploration')
assert(awakening.includes('exploration, reflection, task work, communication, or silence'), 'awakening leaves the outcome to model judgment')

const customCadence = buildAutonomousTickDirections({
  tickerStatus: { active: true, seconds: 10, ttl: 7, reason: 'user asked for fast feelings', revision: 3 },
})
assert(customCadence.includes('10s interval, 7 heartbeat(s) remaining'), 'custom ticker status is visible to Tick context')
assert(customCadence.includes('not an instruction to speak'), 'custom ticker status stays scheduling context')
assert(customCadence.includes('not an instruction to speak or to confirm the setting'), 'custom ticker status does not ask the model to repeat a no-op change')

const discovery = buildAutonomousTickDirections({ delegationDiscovery: '[available collaborators: Codex]' })
assert(discovery.endsWith('[available collaborators: Codex]'), 'neutral discovery context can be appended without changing policy')

const autonomousHighRisk = evaluateToolPolicy('delete_file', { path: 'x' }, { autonomous: true })
assert(autonomousHighRisk.allowed === false, 'autonomous Tick still blocks high-risk execution without user authority')
const autonomousSecurityChange = evaluateToolPolicy('set_security', {}, { autonomous: true })
assert(autonomousSecurityChange.allowed === false, 'autonomous Tick cannot expand or change its own authority')
const autonomousBrowserNavigation = evaluateToolPolicy('browser_navigate', { url: 'https://example.com' }, { autonomous: true })
assert(autonomousBrowserNavigation.allowed === false, 'autonomous Tick cannot navigate the interactive Playwright browser without user authority')
const autonomousSandboxCommand = evaluateToolPolicy('exec_command', { command: 'Get-ChildItem' }, { autonomous: true })
assert(autonomousSandboxCommand.allowed === false, 'autonomous Tick cannot launch a general shell without user authority')
const autonomousBackgroundCommand = evaluateToolPolicy('exec_background_command', { command: 'node worker.js' }, { autonomous: true })
assert(autonomousBackgroundCommand.allowed === false, 'autonomous Tick cannot bypass shell authority through a background command')
const autonomousCommunication = evaluateToolPolicy('send_message', {}, { autonomous: true })
assert(autonomousCommunication.allowed === true, 'model may still judge medium-risk communication during Tick')
const autonomousRuleList = evaluateToolPolicy('manage_rule', { action: 'list' }, { autonomous: true })
assert(autonomousRuleList.allowed === true, 'autonomous Tick may inspect persistent rules')
const autonomousRuleMutation = evaluateToolPolicy('manage_rule', { action: 'upsert' }, { autonomous: true })
assert(autonomousRuleMutation.allowed === false, 'autonomous Tick cannot silently rewrite persistent rules')
const explicitlyAuthorized = evaluateToolPolicy('delete_file', { path: 'x' }, { autonomous: true, allowHighRiskAutonomy: true })
assert(explicitlyAuthorized.allowed === true, 'runtime can represent an explicit high-risk autonomy grant')

// ── 自主任意模式 ▸ 只读执行链（2026-08-02）────────────────────────────────────
//  纯心跳：只能跑显式只读 quick 白名单命令（ls/ps/df…），不能跑 node/git/curl
//  定时任务（用户亲手创建的提醒）= 用户驱动 → exec 家族可跑脚本
//
const pureTick = { autonomous: true }
const scheduled = { autonomous: true, scheduledContext: { type: 'reminder', reminderId: 8, targetId: 'ID:000001' } }

// 纯心跳 —— 只读 quick
const quickPs = evaluateToolPolicy('exec_quick_command', { command: 'ps aux' }, pureTick)
assert(quickPs.allowed === true, 'pure Tick allows read-only quick inspection (ps aux)')
const quickDf = evaluateToolPolicy('exec_quick_command', { command: 'df -h' }, pureTick)
assert(quickDf.allowed === true, 'pure Tick allows read-only quick inspection (df -h)')
const quickLs = evaluateToolPolicy('exec_quick_command', { command: 'ls -la' }, pureTick)
assert(quickLs.allowed === true, 'pure Tick allows read-only quick inspection (ls -la)')
const quickCat = evaluateToolPolicy('exec_quick_command', { command: 'cat README.md' }, pureTick)
assert(quickCat.allowed === true, 'pure Tick allows read-only quick inspection (cat file)')

// 纯心跳 —— 拒绝（非白名单头、管道、重定向、破坏性）
const quickRm = evaluateToolPolicy('exec_quick_command', { command: 'rm -rf x' }, pureTick)
assert(quickRm.allowed === false, 'pure Tick blocks rm (mutation verb)')
const quickNode = evaluateToolPolicy('exec_quick_command', { command: 'node script.mjs' }, pureTick)
assert(quickNode.allowed === false, 'pure Tick blocks node (not a read-only head)')
const quickCurl = evaluateToolPolicy('exec_quick_command', { command: 'curl example.com' }, pureTick)
assert(quickCurl.allowed === false, 'pure Tick blocks curl (not a read-only head)')
const quickPipe = evaluateToolPolicy('exec_quick_command', { command: 'ps aux | grep node' }, pureTick)
assert(quickPipe.allowed === false, 'pure Tick blocks pipes (could smuggle writes)')
const quickMv = evaluateToolPolicy('exec_quick_command', { command: 'mv a b' }, pureTick)
assert(quickMv.allowed === false, 'pure Tick blocks mv (mutation verb)')
const quickRedirect = evaluateToolPolicy('exec_quick_command', { command: 'echo x > file' }, pureTick)
assert(quickRedirect.allowed === false, 'pure Tick blocks redirection')

// 纯心跳 —— exec_command 仍锁（不是 quick 不走只读门）
const tickExecNode = evaluateToolPolicy('exec_command', { command: 'node script.mjs' }, pureTick)
assert(tickExecNode.allowed === false, 'pure Tick still blocks general exec_command')
const tickExecQuick = evaluateToolPolicy('exec_command', { command: 'ls' }, pureTick)
assert(tickExecQuick.allowed === false, 'pure Tick blocks exec_command even for read-only content')

// 定时任务（用户驱动）—— exec 家族放行
const schExec = evaluateToolPolicy('exec_command', { command: 'node surfacing.mjs' }, scheduled)
assert(schExec.allowed === true, 'scheduled turn allows exec_command (user-driven)')
const schQuick = evaluateToolPolicy('exec_quick_command', { command: 'ps aux' }, scheduled)
assert(schQuick.allowed === true, 'scheduled turn allows exec_quick_command (user-driven)')
const schTask = evaluateToolPolicy('exec_task_command', { command: 'node build.mjs' }, scheduled)
assert(schTask.allowed === true, 'scheduled turn allows exec_task_command (user-driven)')
// 定时任务 —— 非 exec 高危工具仍锁
const schDelete = evaluateToolPolicy('delete_file', { path: 'x' }, scheduled)
assert(schDelete.allowed === false, 'scheduled turn still blocks delete_file')
const schKill = evaluateToolPolicy('kill_process', { pid: 42 }, scheduled)
assert(schKill.allowed === false, 'scheduled turn still blocks kill_process')
const schSecurity = evaluateToolPolicy('set_security', {}, scheduled)
assert(schSecurity.allowed === false, 'scheduled turn still blocks set_security')

// isAutonomousReadOnlyCommand 单元
assert(isAutonomousReadOnlyCommand('ps aux') === true, 'isAutonomousReadOnlyCommand: ps aux')
assert(isAutonomousReadOnlyCommand('df -h') === true, 'isAutonomousReadOnlyCommand: df -h')
assert(isAutonomousReadOnlyCommand('node script.mjs') === false, 'isAutonomousReadOnlyCommand: node (not in heads)')
assert(isAutonomousReadOnlyCommand('ls -la | grep foo') === false, 'isAutonomousReadOnlyCommand: pipe')
assert(isAutonomousReadOnlyCommand('') === false, 'isAutonomousReadOnlyCommand: empty')
assert(isAutonomousReadOnlyCommand('rm -rf x') === false, 'isAutonomousReadOnlyCommand: rm')

if (failed === 0) console.log('\nAll autonomous Tick policy checks passed.')
