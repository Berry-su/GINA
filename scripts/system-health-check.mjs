#!/usr/bin/env node
/**
 * system-health-check.mjs — Gina 主动巡检脚本（第一批第1项：主动巡检）
 * 只读采集系统健康数据：内存 / 负载 / 磁盘 / 最耗CPU进程(含GPU)
 * 输出：人类可读报告 + JSON（供后续自动化判断）
 * 判定规则（针对佛爷这台 8G 内存 Mac）：
 *   - 内存使用率 > 90% 或空闲 < 0.5GB      → WARN
 *   - 磁盘剩余 < 10%                        → WARN
 *   - loadavg(1min) > CPU核数               → WARN
 *   - 任一进程(含WindowServer/Electron GPU) CPU > 100% → 提示
 */
import os from 'os'
import { execSync } from 'child_process'

const GB = 1024 ** 3

function safeExec(cmd) {
  try {
    return execSync(cmd, { timeout: 8000, encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

function collect() {
  const total = os.totalmem()
  const free = os.freemem()
  const used = total - free
  const memUsedPct = Math.round((used / total) * 1000) / 10
  const freeGb = Math.round((free / GB) * 10) / 10
  const usedGb = Math.round((used / GB) * 10) / 10
  const totalGb = Math.round(total / GB)

  const cpus = os.cpus().length
  const [load1, load5, load15] = os.loadavg()

  // 磁盘：df -k / 取剩余百分比（macOS 支持）
  let disk = null
  const dfOut = safeExec('df -k /')
  if (dfOut) {
    const line = dfOut.split('\n')[1]
    const parts = line.split(/\s+/)
    if (parts.length >= 5) {
      const availKB = parseInt(parts[3], 10)
      const capacityPct = parseInt(parts[4].replace('%', ''), 10)
      disk = {
        availGb: Math.round((availKB / 1024 / 1024) * 10) / 10,
        usedPct: capacityPct,
        freePct: 100 - capacityPct,
      }
    }
  }

  // 最耗 CPU 的 8 个进程（含 GPU：WindowServer / Electron Helper (GPU)）
  const topProc = safeExec('ps -Aceo pid,pcpu,comm -r | head -9')
  const procs = topProc
    ? topProc.split('\n').slice(1).map(l => {
        const m = l.trim().match(/^(\d+)\s+([\d.]+)\s+(.+)$/)
        return m ? { pid: m[1], cpu: parseFloat(m[2]), name: m[3].split('/').pop() } : null
      }).filter(Boolean)
    : []

  // ── 判定 ──────────────────────────────
  const issues = []
  if (memUsedPct > 90 || freeGb < 0.5) issues.push(`内存告急：已用 ${memUsedPct}%，空闲仅 ${freeGb}GB`)
  if (disk && disk.freePct < 10) issues.push(`磁盘告急：剩余仅 ${disk.freePct}% (${disk.availGb}GB)`)
  if (load1 > cpus) issues.push(`负载过高：load1=${load1.toFixed(2)} > ${cpus} 核`)
  const hot = procs.filter(p => p.cpu > 100)
  if (hot.length) issues.push(`高耗进程：${hot.map(p => `${p.name}(${p.cpu}%)`).join('、')}`)

  const level = issues.length === 0 ? 'OK' : issues.length <= 2 ? 'WARN' : 'ALERT'

  return {
    ts: new Date().toISOString(),
    level,
    mem: { totalGb, usedGb, freeGb, usedPct: memUsedPct },
    load: { cpus, load1: +load1.toFixed(2), load5: +load5.toFixed(2), load15: +load15.toFixed(2) },
    disk,
    topProcs: procs.slice(0, 5),
    issues,
  }
}

const r = collect()

// 人类可读报告
const lines = [
  `[${r.level}] 系统巡检 ${new Date(r.ts).toLocaleString('zh-CN', { hour12: false })}`,
  `内存：已用 ${r.mem.usedGb}/${r.mem.totalGb}GB (${r.mem.usedPct}%)，空闲 ${r.mem.freeGb}GB`,
  `负载：${r.load.load1} / ${r.load.load5} / ${r.load.load15}（${r.load.cpus} 核）`,
  `磁盘：剩余 ${r.disk ? r.disk.freePct + '%（' + r.disk.availGb + 'GB）' : '未知'}`,
]
if (r.topProcs.length) {
  lines.push('Top 进程：' + r.topProcs.map(p => `${p.name} ${p.cpu}%`).join('，'))
}
if (r.issues.length) {
  lines.push('⚠ ' + r.issues.join('；'))
} else {
  lines.push('一切正常')
}

console.log(lines.join('\n'))
console.log('---JSON---')
console.log(JSON.stringify(r))
