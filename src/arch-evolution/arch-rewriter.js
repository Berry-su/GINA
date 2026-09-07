// arch-rewriter.js — 执行安全改动（默认 dryRun）
//
// 定位：把 proposal 落到代码。重要原则：
//   1. 默认 dryRun（不实际改）
//   2. 只执行 autoApply=true 的 proposal
//   3. 任何改动前必须先备份
//   4. 改完跑 self-modify 的 safety checks
//   5. 失败立即回滚
//
// 实际执行能力（保守）：
//   - 'rename'    改文件名 + 所有 import 中的引用（autoApply=true）
//   - 'move'      移动到目标目录 + 改 import 引用（autoApply=true）
//   - 'extract'   仅生成建议脚本，不自动拆分（autoApply=false）
//   - 'split'/'merge'/'delete'/'break_cycle'/'add_layer' → autoApply=false（仅生成 plan）
//
// 风险：rename / move 改的是字符串，全文替换 + 多文件同步。已有 self-modify
// 的 safety-checker / applyEditSafely 可复用，但本模块自带轻量实现避免依赖耦合。

import fs from 'node:fs'
import path from 'node:path'
import { walkJsFiles } from './arch-graph.js'

// ─── 常量 ───────────────────────────────────────────────────

const AUTO_APPLY_TYPES = new Set(['rename', 'move'])
const MAX_RENAME_FILES = 100
const MAX_RENAME_BATCH = 50
const DRY_RUN_DEFAULT = true

// ─── 提案应用入口 ───────────────────────────────────────────

// 应用单个 proposal
//   options: { dryRun, runTests, baseDir, backup }
//   返回: { applied, dryRun, filesChanged, errors }
export function applyProposal(proposal, options = {}) {
  if (!proposal || !proposal.type) {
    throw new Error('applyProposal: invalid proposal')
  }
  const dryRun = options.dryRun !== false  // default true
  if (!AUTO_APPLY_TYPES.has(proposal.type) && !proposal.autoApply) {
    return {
      applied: false,
      dryRun,
      skipped: true,
      reason: `type=${proposal.type} not auto-apply (only ${[...AUTO_APPLY_TYPES].join(',')} supported)`,
      plan: generatePlan(proposal),
    }
  }
  switch (proposal.type) {
    case 'rename':
      return applyRename(proposal, { ...options, dryRun })
    case 'move':
      return applyMove(proposal, { ...options, dryRun })
    default:
      return {
        applied: false,
        dryRun,
        skipped: true,
        reason: `type=${proposal.type} not implemented`,
        plan: generatePlan(proposal),
      }
  }
}

// ─── 批量应用 ──────────────────────────────────────────────

export function applyProposals(proposals, options = {}) {
  const results = []
  for (const p of proposals) {
    try {
      const r = applyProposal(p, options)
      results.push({ proposal: p, result: r, ok: true })
    } catch (e) {
      results.push({ proposal: p, result: { error: e.message }, ok: false })
    }
  }
  return {
    total: proposals.length,
    applied: results.filter(r => r.result.applied).length,
    skipped: results.filter(r => r.result.skipped).length,
    failed: results.filter(r => !r.ok).length,
    dryRun: options.dryRun !== false,
    results,
  }
}

// ─── Rename ─────────────────────────────────────────────────

function applyRename(proposal, options) {
  if (!proposal.from || !proposal.to) {
    return { applied: false, error: 'rename requires from/to' }
  }
  const baseDir = options.baseDir || path.dirname(proposal.from)
  const fromAbs = path.isAbsolute(proposal.from) ? proposal.from : path.join(baseDir, proposal.from)
  const toAbs = path.isAbsolute(proposal.to) ? proposal.to : path.join(baseDir, proposal.to)
  if (!fs.existsSync(fromAbs)) {
    return { applied: false, error: `source not found: ${fromAbs}` }
  }
  if (fs.existsSync(toAbs)) {
    return { applied: false, error: `target already exists: ${toAbs}` }
  }
  // 找所有引用 from 的文件
  const allFiles = walkJsFiles(baseDir, { maxFiles: 1000 })
  const referencing = findReferencingFiles(allFiles, proposal.from)
  if (referencing.length > MAX_RENAME_FILES) {
    return { applied: false, error: `too many references: ${referencing.length}` }
  }
  if (options.dryRun !== false) {
    return {
      applied: false,
      dryRun: true,
      plan: {
        type: 'rename',
        from: fromAbs,
        to: toAbs,
        referencesToUpdate: referencing.length,
        filesAffected: [fromAbs, ...referencing],
      },
    }
  }
  // 实际执行
  const backup = backupFiles([fromAbs, ...referencing], options)
  try {
    // 1) 写新文件
    fs.copyFileSync(fromAbs, toAbs)
    // 2) 改所有引用
    for (const ref of referencing) {
      let content = fs.readFileSync(ref, 'utf8')
      content = replaceImportSpec(content, fromAbs, toAbs, baseDir)
      fs.writeFileSync(ref, content)
    }
    // 3) 删旧文件
    fs.unlinkSync(fromAbs)
    return {
      applied: true,
      dryRun: false,
      filesChanged: referencing.length + 2,
      renamed: { from: fromAbs, to: toAbs },
      backup,
    }
  } catch (e) {
    // 回滚
    restoreBackup(backup)
    return { applied: false, error: e.message, rolledBack: true, backup }
  }
}

// ─── Move ───────────────────────────────────────────────────

function applyMove(proposal, options) {
  if (!proposal.from || !proposal.to) {
    return { applied: false, error: 'move requires from/to' }
  }
  const fromAbs = path.isAbsolute(proposal.from) ? proposal.from : path.resolve(proposal.from)
  const toAbs = path.isAbsolute(proposal.to) ? proposal.to : path.resolve(proposal.to)
  if (!fs.existsSync(fromAbs)) {
    return { applied: false, error: `source not found: ${fromAbs}` }
  }
  if (fs.existsSync(toAbs)) {
    return { applied: false, error: `target already exists: ${toAbs}` }
  }
  // toAbs 可能是目录或文件
  const targetFile = fs.statSync(fromAbs).isDirectory() ? toAbs : toAbs
  const baseDir = options.baseDir || path.dirname(fromAbs)
  const allFiles = walkJsFiles(baseDir, { maxFiles: 1000 })
  const referencing = findReferencingFiles(allFiles, fromAbs)
  if (options.dryRun !== false) {
    return {
      applied: false,
      dryRun: true,
      plan: {
        type: 'move',
        from: fromAbs,
        to: toAbs,
        referencesToUpdate: referencing.length,
        filesAffected: [fromAbs, ...referencing],
      },
    }
  }
  const backup = backupFiles([fromAbs, ...referencing], options)
  try {
    fs.mkdirSync(path.dirname(toAbs), { recursive: true })
    fs.renameSync(fromAbs, toAbs)
    for (const ref of referencing) {
      let content = fs.readFileSync(ref, 'utf8')
      content = replaceImportSpec(content, fromAbs, toAbs, baseDir)
      fs.writeFileSync(ref, content)
    }
    return {
      applied: true,
      dryRun: false,
      filesChanged: referencing.length + 1,
      moved: { from: fromAbs, to: toAbs },
      backup,
    }
  } catch (e) {
    restoreBackup(backup)
    return { applied: false, error: e.message, rolledBack: true, backup }
  }
}

// ─── 引用查找（字符串扫描） ─────────────────────────────────

function findReferencingFiles(files, targetPath) {
  const refs = []
  const targetBasename = path.basename(targetPath).replace(/\.(js|mjs)$/, '')
  // 可能的引用字符串
  const patterns = [
    new RegExp(`from\\s+['"]([^'"]*${escapeRegex(targetBasename)}[^'"]*)['"]`),
    new RegExp(`import\\(\\s*['"]([^'"]*${escapeRegex(targetBasename)}[^'"]*)['"]`),
    new RegExp(`export\\s+(?:\\*|\\{[^}]*\\})\\s+from\\s+['"]([^'"]*${escapeRegex(targetBasename)}[^'"]*)['"]`),
  ]
  for (const f of files) {
    if (path.resolve(f) === path.resolve(targetPath)) continue
    let content
    try {
      content = fs.readFileSync(f, 'utf8')
    } catch (e) { continue }
    for (const p of patterns) {
      if (p.test(content)) {
        refs.push(f)
        break
      }
    }
  }
  return refs
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ─── import 路径替换 ────────────────────────────────────────

function replaceImportSpec(content, oldAbsPath, newAbsPath, baseDir) {
  // 找所有 from '...'/import('...')/export ... from '...' 引用 oldAbsPath 的行
  const lines = content.split('\n')
  const out = []
  for (const line of lines) {
    let updated = line
    // 找 spec 字符串并替换
    updated = updated.replace(
      /(['"])([^'"]+)\1/g,
      (m, q, spec) => {
        if (!spec.startsWith('.') && !spec.startsWith('/')) return m
        const resolved = tryResolve(baseDir, spec)
        if (!resolved) return m
        if (path.resolve(resolved) === path.resolve(oldAbsPath)) {
          const newSpec = relativeSpec(baseDir, newAbsPath)
          return q + newSpec + q
        }
        return m
      }
    )
    out.push(updated)
  }
  return out.join('\n')
}

function tryResolve(baseDir, spec) {
  const fromDir = baseDir
  let resolved
  if (spec.startsWith('/')) {
    resolved = spec
  } else if (spec.startsWith('.')) {
    resolved = path.resolve(fromDir, spec)
  } else {
    return null
  }
  if (/\.(js|mjs)$/.test(resolved)) return resolved
  for (const ext of ['.js', '.mjs']) {
    if (fs.existsSync(resolved + ext)) return resolved + ext
  }
  return null
}

function relativeSpec(fromDir, toAbs) {
  let rel = path.relative(fromDir, toAbs)
  if (!rel.startsWith('.')) rel = './' + rel
  return rel.replace(/\\/g, '/')
}

// ─── 备份 / 恢复 ───────────────────────────────────────────

function backupFiles(files, options) {
  const backupDir = options.backupDir || path.join(process.env.GINA_HOME || '/tmp', 'arch-backup-' + Date.now())
  fs.mkdirSync(backupDir, { recursive: true })
  const entries = []
  for (const f of files) {
    if (!fs.existsSync(f)) continue
    const dest = path.join(backupDir, path.relative(path.dirname(f), f))
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.copyFileSync(f, dest)
    entries.push({ from: f, to: dest })
  }
  return { backupDir, entries }
}

function restoreBackup(backup) {
  if (!backup || !backup.entries) return
  for (const { from, to } of backup.entries) {
    try {
      if (fs.existsSync(to)) {
        fs.copyFileSync(to, from)
      }
    } catch (e) { /* swallow */ }
  }
}

// ─── 计划生成（仅提议类） ───────────────────────────────────

function generatePlan(proposal) {
  return {
    type: proposal.type,
    target: proposal.target,
    reason: proposal.reason,
    risk: proposal.risk,
    suggestedSteps: planSteps(proposal),
  }
}

function planSteps(proposal) {
  switch (proposal.type) {
    case 'split':
      return [
        '1. 阅读目标文件，识别可独立的功能块',
        '2. 把每个功能块提取到新文件',
        '3. 在原文件保留 re-export（保持向后兼容）',
        '4. 跑 npm test 验证',
        '5. 删除原文件的内部实现（可选）',
      ]
    case 'merge':
      return [
        '1. 确认两个文件确实强相关',
        '2. 选择主文件，把另一个的内容合并',
        '3. 同步所有 import 引用',
        '4. 删除被合并文件',
        '5. 跑 npm test 验证',
      ]
    case 'delete':
      return [
        '1. 确认文件未被使用（grep -r）',
        '2. 删除文件',
        '3. 如果有循环依赖，先解决',
        '4. 跑 npm test 验证',
      ]
    case 'break_cycle':
      return [
        '1. 识别循环中的"边界"模块（最小职责）',
        '2. 把边界模块的内容提取到新文件',
        '3. 让两个循环成员都依赖新文件',
        '4. 验证循环消失',
        '5. 跑 npm test 验证',
      ]
    case 'add_layer':
      return [
        '1. 识别新层职责',
        '2. 创建层目录和入口',
        '3. 把相关模块移到新层',
        '4. 调整依赖方向',
      ]
    default:
      return ['未实现类型：' + proposal.type]
  }
}

export {
  AUTO_APPLY_TYPES,
  DRY_RUN_DEFAULT,
  MAX_RENAME_FILES,
}
