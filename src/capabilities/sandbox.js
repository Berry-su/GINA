import path from 'path'
import os from 'os'
import { config } from '../config.js'
import { paths } from '../paths.js'

export const SANDBOX_ROOT = path.resolve(paths.sandboxDir)

// 不可绕过的逃逸检测：即使 config.security.fileSandbox === false，
// 下列模式仍然必须拒绝（属于「路径逃逸」而非「沙箱外合法访问」）。
//
// 沙箱开关(fileSandbox/execSandbox)只控制「沙箱边界」检查，关闭后允许执行
// 显式的绝对路径；但「逃逸」语义是另一回事——任何包含 `..` 段、指向用户
// SSH/AWS/GitHub 凭据目录、或指向系统敏感目录的输入都是攻击面，必须兜底拦。
//
// 这些前缀以"路径段"为单位判断（前面必须有分隔符或字符串开头），避免误伤
// 像 `mysubdir/foo` 这种恰好以 `etc` 开头的合法文件名。
const SENSITIVE_RELATIVE_SEGMENTS = [
  '.ssh', '.aws', '.config/gh', '.config/git', '.gnupg',
  '.netrc', '.bash_history', '.zsh_history', '.npmrc', '.pypirc',
]
const SENSITIVE_ABSOLUTE_PREFIXES = [
  '/etc/', '/var/', '/usr/', '/private/etc/', '/private/var/', '/root/',
  '/System/', '/Library/Keychains/',
]

// 真实 ~/.ssh 等目录不能写死在列表里——任何 HOME 下的敏感子目录都要拦。
// 用 os.homedir() 拼成绝对路径再匹配，比正则更稳（处理 symlink 也不会被绕）。
const HOME = (() => {
  try { return path.resolve(os.homedir()) }
  catch { return '' }
})()
const HOME_SENSITIVE_ABS = HOME
  ? SENSITIVE_RELATIVE_SEGMENTS.map((seg) => path.join(HOME, seg) + path.sep)
  : []

function _isSep(ch) {
  return ch === '/' || ch === '\\'
}

// 校验"原始路径字符串"（未解析）是否含 `..` 段或 `~/` 逃逸。
// 注意：只对原始字符串形态的逃逸做检测；解析后的绝对路径交给 isPathInside
// 配合 assertInSandbox 处理。两者互补，缺一不可。
function _hasParentSegment(str) {
  if (!str) return false
  // 匹配 token 边界的 `..`：开头 / 分隔符后紧跟 `..` 再跟分隔符 / 结尾
  // 例: "../foo", "a/../b", "a\..\b", "../", ".."
  return /(?:^|[/\\])\.\.(?:[/\\]|$)/.test(str)
}

function _matchesAnyPrefix(str, prefixes) {
  for (const p of prefixes) {
    if (str.startsWith(p)) return true
  }
  return false
}

/**
 * 判断给定路径字符串是否为「逃逸」模式。
 *
 * 逃逸定义（命中任一即为 true）：
 * 1. 字符串中含 `..` 路径段（如 ../foo、a/../b、..\file、a\..\b）
 * 2. 字符串以 ~/ 开头（用户主目录，相对 / 解析为 ~/）
 * 3. 字符串为敏感绝对路径（/etc/、/var/、/private/etc/、/System/ 等）
 * 4. 字符串指向 HOME 下的凭据目录（~/.ssh、~/.aws、~/.config/gh 等）
 *
 * @param {string} filePath
 * @returns {boolean}
 */
export function isPathEscape(filePath) {
  if (!filePath) return false
  const str = String(filePath)

  if (_hasParentSegment(str)) return true
  if (str.startsWith('~/') || str === '~') return true

  // 归一化后再比对绝对路径前缀；macOS 上 /etc 是 /private/etc 的 symlink,
  // 解析后两者等价，但原始字符串 /etc 必须直接拦。
  const normalized = path.normalize(str)
  if (path.isAbsolute(normalized)) {
    if (_matchesAnyPrefix(normalized, SENSITIVE_ABSOLUTE_PREFIXES)) return true
    if (_matchesAnyPrefix(normalized, HOME_SENSITIVE_ABS)) return true
  }

  return false
}

/**
 * 对原始路径字符串做强制逃逸检测。命中即抛出带明确语义的 Error。
 *
 * 这是不可绕过的兜底层：与 config.security.fileSandbox 开关解耦，
 * 即使沙箱被关掉，任何工具调用只要路径含 `..` / `~/` / 指向系统凭据
 * 目录，必须被拒。
 *
 * @param {string} filePath 原始路径（未 normalize 之前）
 * @throws {Error} 命中逃逸模式
 */
export function assertNotEscape(filePath) {
  if (isPathEscape(filePath)) {
    throw new Error(`访问被拒绝：检测到路径逃逸（${String(filePath).slice(0, 200)}）`)
  }
}

export function isPathInside(parentDir, candidatePath) {
  const parent = path.resolve(parentDir)
  const candidate = path.resolve(candidatePath)
  const relative = path.relative(parent, candidate)
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative))
}

/**
 * 沙箱边界校验。可被 config.security.fileSandbox === false 关闭。
 *
 * 注意：逃逸检测（.. / ~ / 敏感绝对路径）由 assertNotEscape 独立承担，
 * 不受 fileSandbox 开关影响。所以这个函数内部不再重复做逃逸检测，
 * 避免双重抛错信息混乱。
 */
export function assertInSandbox(resolvedPath) {
  if (config.security?.fileSandbox === false) return
  if (resolvedPath !== SANDBOX_ROOT && !isPathInside(SANDBOX_ROOT, resolvedPath)) {
    throw new Error(`访问被拒绝：文件操作只允许在 sandbox 目录内（${SANDBOX_ROOT}）`)
  }
}

export function normalizeSandboxPath(filePath) {
  if (path.isAbsolute(filePath)) {
    const rel = path.relative(SANDBOX_ROOT, filePath)
    if (!rel.startsWith('..')) return rel || '.'
  }
  return filePath
    .replace(/^sandbox[\\/]/i, '')
    .replace(/^\.[\\/]/, '')
}
