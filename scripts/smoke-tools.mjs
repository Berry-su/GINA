import { executeTool } from '../src/capabilities/executor.js'

const checks = []

function assert(condition, label, detail = '') {
  checks.push({ ok: !!condition, label, detail })
  if (!condition) {
    console.error(`[FAIL] ${label}${detail ? `\n  ${detail}` : ''}`)
  } else {
    console.log(`[PASS] ${label}`)
  }
}

function parseJsonResult(value) {
  try {
    return JSON.parse(String(value || ''))
  } catch {
    return null
  }
}

const testPath = `smoke/verifiable-${Date.now()}.txt`
const testContent = 'hello verifiable completion'

const writeResultText = await executeTool('write_file', {
  path: testPath,
  content: testContent,
}, { source: 'smoke-test' })
const writeResult = parseJsonResult(writeResultText)
assert(writeResult?.ok === true && writeResult?.verified === true, 'write_file returns verified evidence', writeResultText)
assert(writeResult?.bytes === Buffer.byteLength(testContent, 'utf-8'), 'write_file reports byte count', writeResultText)

const readResult = await executeTool('read_file', { path: testPath }, { source: 'smoke-test' })
assert(readResult === testContent, 'read_file reads back exact content', readResult)

const outsideRead = await executeTool('read_file', { path: '../package.json' }, { source: 'smoke-test' })
assert(/^执行失败：访问被拒绝/.test(String(outsideRead)), 'read_file rejects sandbox escape', outsideRead)

const deniedCommandText = await executeTool('exec_command', {
  command: 'type ..\\package.json',
}, { source: 'smoke-test' })
const deniedCommand = parseJsonResult(deniedCommandText)
assert(deniedCommand?.ok === false && deniedCommand?.error === 'permission denied', 'exec_command rejects parent directory access', deniedCommandText)

const quickCommandText = await executeTool('exec_quick_command', {
  command: 'node -e "console.log(\'quick-ok\')"',
}, { source: 'smoke-test' })
const quickCommand = parseJsonResult(quickCommandText)
assert(quickCommand?.ok === true && quickCommand?.command_profile === 'quick' && /quick-ok/.test(quickCommand?.stdout || ''), 'exec_quick_command uses quick profile', quickCommandText)

const taskCommandText = await executeTool('exec_task_command', {
  command: 'node -e "console.log(\'task-ok\')"',
  timeout: 5,
}, { source: 'smoke-test' })
const taskCommand = parseJsonResult(taskCommandText)
assert(taskCommand?.ok === true && taskCommand?.command_profile === 'task' && /task-ok/.test(taskCommand?.stdout || ''), 'exec_task_command uses task profile', taskCommandText)

const badDownloadText = await executeTool('download_file', {
  url: 'file:///not-allowed',
  output_path: 'smoke/download.txt',
}, { source: 'smoke-test' })
const badDownload = parseJsonResult(badDownloadText)
assert(badDownload?.ok === false && badDownload?.tool === 'download_file', 'download_file validates URL scheme', badDownloadText)

const deleteResultText = await executeTool('delete_file', { path: testPath }, { source: 'smoke-test' })
const deleteResult = parseJsonResult(deleteResultText)
assert(deleteResult?.ok === true && deleteResult?.verified_absent === true, 'delete_file returns absence verification', deleteResultText)

// ── 回归测试:路径逃逸(2026-09-01 P1 安全修复)────────────────────────
// 不依赖沙箱开关:即便 config.security.fileSandbox/execSandbox === false,
// 这些模式也必须被拦。覆盖 ../ / /etc/ / ~/ 三类逃逸 + 命令 token 级逃逸。
const deeperEscapeText = await executeTool('read_file', { path: '../../package.json' }, { source: 'smoke-test' })
assert(/^执行失败：访问被拒绝/.test(String(deeperEscapeText)), 'read_file rejects multi-level parent escape (../../package.json)', deeperEscapeText)

const absoluteEscapeText = await executeTool('read_file', { path: '/etc/passwd' }, { source: 'smoke-test' })
assert(/^执行失败：访问被拒绝/.test(String(absoluteEscapeText)), 'read_file rejects sensitive absolute path (/etc/passwd)', absoluteEscapeText)

const homeEscapeText = await executeTool('read_file', { path: '~/.ssh/id_rsa' }, { source: 'smoke-test' })
assert(/^执行失败：访问被拒绝/.test(String(homeEscapeText)), 'read_file rejects HOME credential escape (~/.ssh/id_rsa)', homeEscapeText)

const cdEscapeText = await executeTool('exec_command', { command: 'cd .. && ls' }, { source: 'smoke-test' })
const cdEscape = parseJsonResult(cdEscapeText)
assert(cdEscape?.ok === false && cdEscape?.error === 'permission denied', 'exec_command rejects `cd ..` escape (compound command)', cdEscapeText)

const catEscapeText = await executeTool('exec_command', { command: 'cat ../package.json' }, { source: 'smoke-test' })
const catEscape = parseJsonResult(catEscapeText)
assert(catEscape?.ok === false && catEscape?.error === 'permission denied', 'exec_command rejects `cat ../...` escape', catEscapeText)

const absExecText = await executeTool('exec_command', { command: 'cat /etc/passwd' }, { source: 'smoke-test' })
const absExec = parseJsonResult(absExecText)
assert(absExec?.ok === false && absExec?.error === 'permission denied', 'exec_command rejects sensitive absolute path (/etc/passwd)', absExecText)

const failed = checks.filter(item => !item.ok)
console.log(`\nSmoke checks: ${checks.length - failed.length}/${checks.length} passed`)
if (failed.length) {
  process.exitCode = 1
}
