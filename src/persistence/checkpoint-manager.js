/**
 * 状态持久化 - 检查点管理与故障恢复
 * 
 * 实现生产级 Agent 所需的状态持久化机制：
 * - 检查点保存：保存任务执行状态
 * - 状态恢复：从检查点恢复任务
 * - 时间旅行：支持恢复到任意历史状态
 * - 自动清理：管理检查点存储
 */

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

const DEFAULT_STORAGE_DIR = '~/.gina/checkpoints'
const DEFAULT_MAX_CHECKPOINTS = 100
const DEFAULT_RETENTION_DAYS = 30

export class CheckpointManager {
  constructor(options = {}) {
    this.storageDir = options.storageDir || this.expandPath(DEFAULT_STORAGE_DIR)
    this.maxCheckpoints = options.maxCheckpoints || DEFAULT_MAX_CHECKPOINTS
    this.retentionDays = options.retentionDays || DEFAULT_RETENTION_DAYS
    this.memoryStore = new Map()  // 内存存储（用于降级）
    this.isMemoryOnly = false
    
    this.initStorage()
  }

  /**
   * 展开路径中的 ~ 符号
   */
  expandPath(p) {
    if (p.startsWith('~')) {
      return path.join(process.env.HOME || process.env.USERPROFILE || '.', p.slice(1))
    }
    return p
  }

  /**
   * 初始化存储
   */
  initStorage() {
    try {
      fs.mkdirSync(this.storageDir, { recursive: true })
      this.isMemoryOnly = false
      console.log(`[CheckpointManager] Storage initialized: ${this.storageDir}`)
    } catch (err) {
      console.warn(`[CheckpointManager] Cannot access storage directory: ${err.message}`)
      console.warn('[CheckpointManager] Falling back to in-memory storage only')
      this.isMemoryOnly = true
    }
  }

  /**
   * 保存检查点
   */
  saveCheckpoint(taskId, state, metadata = {}) {
    const checkpointId = `cp_${crypto.randomUUID().replace(/-/g, '')}`
    const snapshot = {
      id: checkpointId,
      taskId,
      state,
      metadata,
      createdAt: Date.now(),
      version: 1,
      ginaVersion: '2.1.601',
    }

    // 保存到内存
    this.memoryStore.set(checkpointId, snapshot)

    // 保存到磁盘
    if (!this.isMemoryOnly) {
      try {
        const filePath = this.getCheckpointPath(checkpointId)
        fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2), 'utf-8')
      } catch (err) {
        console.warn(`[CheckpointManager] Failed to save to disk: ${err.message}`)
      }
    }

    // 清理旧检查点
    this.cleanupOldCheckpoints(taskId)

    console.log(`[CheckpointManager] Saved checkpoint: ${checkpointId} for task: ${taskId}`)

    return {
      checkpointId,
      taskId,
      createdAt: snapshot.createdAt,
      stateSnapshot: state,
    }
  }

  /**
   * 从检查点恢复
   */
  restoreCheckpoint(checkpointId) {
    // 先从内存查找
    let checkpoint = this.memoryStore.get(checkpointId)

    // 如果内存没有，尝试从磁盘加载
    if (!checkpoint && !this.isMemoryOnly) {
      try {
        const filePath = this.getCheckpointPath(checkpointId)
        if (fs.existsSync(filePath)) {
          const content = fs.readFileSync(filePath, 'utf-8')
          checkpoint = JSON.parse(content)
          // 缓存到内存
          this.memoryStore.set(checkpointId, checkpoint)
        }
      } catch (err) {
        console.warn(`[CheckpointManager] Failed to load checkpoint: ${err.message}`)
      }
    }

    if (!checkpoint) {
      throw new Error(`Checkpoint "${checkpointId}" not found`)
    }

    console.log(`[CheckpointManager] Restored checkpoint: ${checkpointId}`)

    return {
      id: checkpoint.id,
      taskId: checkpoint.taskId,
      state: checkpoint.state,
      metadata: checkpoint.metadata,
      createdAt: checkpoint.createdAt,
      version: checkpoint.version,
    }
  }

  /**
   * 获取任务的所有检查点
   */
  listCheckpoints(taskId, options = {}) {
    const { limit, offset, sortBy } = options
    
    // 收集所有检查点（内存 + 磁盘）
    const checkpoints = []

    // 从内存收集
    for (const [id, cp] of this.memoryStore) {
      if (!taskId || cp.taskId === taskId) {
        checkpoints.push(this.summarizeCheckpoint(cp))
      }
    }

    // 从磁盘收集（如果不是内存模式）
    if (!this.isMemoryOnly) {
      try {
        const files = fs.readdirSync(this.storageDir)
        for (const file of files) {
          if (file.startsWith('cp_') && file.endsWith('.json')) {
            try {
              const filePath = path.join(this.storageDir, file)
              const content = fs.readFileSync(filePath, 'utf-8')
              const cp = JSON.parse(content)
              
              // 检查是否已在内存中（避免重复）
              if (!this.memoryStore.has(cp.id)) {
                if (!taskId || cp.taskId === taskId) {
                  checkpoints.push(this.summarizeCheckpoint(cp))
                }
              }
            } catch {}
          }
        }
      } catch (err) {
        console.warn(`[CheckpointManager] Failed to list checkpoints: ${err.message}`)
      }
    }

    // 排序
    const sortField = sortBy === 'createdAt' || sortBy === 'created_at' ? 'createdAt' : 'createdAt'
    checkpoints.sort((a, b) => b[sortField] - a[sortField])

    // 分页
    const start = offset || 0
    const end = limit ? start + limit : undefined
    
    return checkpoints.slice(start, end)
  }

  /**
   * 总结检查点信息（不包含完整状态）
   */
  summarizeCheckpoint(cp) {
    return {
      id: cp.id,
      taskId: cp.taskId,
      createdAt: cp.createdAt,
      metadata: cp.metadata,
      stateSummary: this.summarizeState(cp.state),
    }
  }

  /**
   * 简要总结状态
   */
  summarizeState(state) {
    if (!state || typeof state !== 'object') return null
    
    const summary = {}
    
    if (state.progress !== undefined) {
      summary.progress = state.progress
    }
    if (state.status !== undefined) {
      summary.status = state.status
    }
    if (state.subTasks) {
      summary.subTaskCount = state.subTasks.length
      summary.completedSubTasks = state.subTasks.filter(t => 
        typeof t === 'string' ? t.includes('done') : t.status === 'completed'
      ).length
    }
    
    return summary
  }

  /**
   * 保存任务进度（便捷方法）
   */
  saveProgress(taskId, progress, subTasks, metadata = {}) {
    const state = {
      progress,
      subTasks,
      status: 'in_progress',
      updatedAt: Date.now(),
    }
    
    return this.saveCheckpoint(taskId, state, {
      type: 'progress_update',
      ...metadata,
    })
  }

  /**
   * 保存任务完成状态
   */
  saveCompletion(taskId, result, metadata = {}) {
    const state = {
      progress: 100,
      status: 'completed',
      result,
      completedAt: Date.now(),
    }
    
    return this.saveCheckpoint(taskId, state, {
      type: 'task_completed',
      ...metadata,
    })
  }

  /**
   * 保存任务失败状态
   */
  saveFailure(taskId, error, metadata = {}) {
    const state = {
      progress: 0,
      status: 'failed',
      error: error.message || String(error),
      failedAt: Date.now(),
    }
    
    return this.saveCheckpoint(taskId, state, {
      type: 'task_failed',
      errorType: error.name || 'Error',
      ...metadata,
    })
  }

  /**
   * 清理旧检查点
   */
  cleanupOldCheckpoints(taskId) {
    // 清理单个任务的检查点（保留最近 maxCheckpoints 个）
    const allCheckpoints = this.listCheckpoints(taskId)
    
    if (allCheckpoints.length > this.maxCheckpoints) {
      const toRemove = allCheckpoints.slice(this.maxCheckpoints)
      
      for (const cp of toRemove) {
        // 从内存移除
        this.memoryStore.delete(cp.id)
        
        // 从磁盘移除
        if (!this.isMemoryOnly) {
          try {
            const filePath = this.getCheckpointPath(cp.id)
            if (fs.existsSync(filePath)) {
              fs.unlinkSync(filePath)
            }
          } catch {}
        }
      }
      
      console.log(`[CheckpointManager] Cleaned up ${toRemove.length} old checkpoints for task: ${taskId}`)
    }
  }

  /**
   * 按时间清理检查点
   */
  cleanupByAge(retentionDays = this.retentionDays) {
    const cutoff = Date.now() - (retentionDays * 24 * 60 * 60 * 1000)
    let removed = 0

    // 清理内存
    for (const [id, cp] of this.memoryStore) {
      if (cp.createdAt < cutoff) {
        this.memoryStore.delete(id)
        removed++
      }
    }

    // 清理磁盘
    if (!this.isMemoryOnly) {
      try {
        const files = fs.readdirSync(this.storageDir)
        for (const file of files) {
          if (file.startsWith('cp_') && file.endsWith('.json')) {
            try {
              const filePath = path.join(this.storageDir, file)
              const stat = fs.statSync(filePath)
              if (stat.mtimeMs < cutoff) {
                fs.unlinkSync(filePath)
                removed++
              }
            } catch {}
          }
        }
      } catch {}
    }

    console.log(`[CheckpointManager] Cleaned up ${removed} old checkpoints (older than ${retentionDays} days)`)
    return { removed, retentionDays }
  }

  /**
   * 获取检查点文件路径
   */
  getCheckpointPath(checkpointId) {
    return path.join(this.storageDir, `${checkpointId}.json`)
  }

  /**
   * 获取存储统计
   */
  getStats() {
    const memoryCount = this.memoryStore.size
    let diskCount = 0
    let diskSize = 0

    if (!this.isMemoryOnly) {
      try {
        const files = fs.readdirSync(this.storageDir)
        for (const file of files) {
          if (file.startsWith('cp_') && file.endsWith('.json')) {
            diskCount++
            try {
              const stat = fs.statSync(path.join(this.storageDir, file))
              diskSize += stat.size
            } catch {}
          }
        }
      } catch {}
    }

    return {
      storageDir: this.isMemoryOnly ? 'memory-only' : this.storageDir,
      isMemoryOnly: this.isMemoryOnly,
      memoryCheckpoints: memoryCount,
      diskCheckpoints: diskCount,
      diskSizeBytes: diskSize,
      maxCheckpointsPerTask: this.maxCheckpoints,
      retentionDays: this.retentionDays,
    }
  }

  /**
   * 清除所有检查点（危险操作）
   */
  clearAll() {
    this.memoryStore.clear()
    
    if (!this.isMemoryOnly) {
      try {
        const files = fs.readdirSync(this.storageDir)
        for (const file of files) {
          if (file.startsWith('cp_') && file.endsWith('.json')) {
            try {
              fs.unlinkSync(path.join(this.storageDir, file))
            } catch {}
          }
        }
      } catch {}
    }

    console.log('[CheckpointManager] All checkpoints cleared')
    return { cleared: true }
  }

  /**
   * 导出检查点到 JSON
   */
  exportCheckpoints(taskId) {
    const checkpoints = this.listCheckpoints(taskId)
    const fullData = []

    for (const summary of checkpoints) {
      try {
        const full = this.restoreCheckpoint(summary.id)
        fullData.push(full)
      } catch {}
    }

    return {
      taskId,
      exportedAt: Date.now(),
      checkpointCount: fullData.length,
      checkpoints: fullData,
    }
  }
}

/**
 * 创建检查点管理器的便捷函数
 */
export function createCheckpointManager(options = {}) {
  return new CheckpointManager(options)
}

/**
 * 任务进度追踪器 - 便捷的任务进度追踪
 */
export class TaskProgressTracker {
  constructor(checkpointManager, taskId) {
    this.checkpointManager = checkpointManager
    this.taskId = taskId
    this.currentStep = 0
    this.totalSteps = 0
    this.startedAt = null
    this.completedAt = null
  }

  /**
   * 开始任务追踪
   */
  start(totalSteps = 0) {
    this.startedAt = Date.now()
    this.totalSteps = totalSteps
    this.currentStep = 0

    return this.checkpointManager.saveCheckpoint(this.taskId, {
      status: 'started',
      progress: 0,
      currentStep: 0,
      totalSteps,
      startedAt: this.startedAt,
    }, { type: 'task_started' })
  }

  /**
   * 记录步骤完成
   */
  completeStep(stepIndex, stepResult = {}) {
    this.currentStep = stepIndex + 1
    const progress = this.totalSteps > 0 
      ? Math.round((this.currentStep / this.totalSteps) * 100) 
      : 0

    return this.checkpointManager.saveCheckpoint(this.taskId, {
      status: 'in_progress',
      progress,
      currentStep: this.currentStep,
      totalSteps: this.totalSteps,
      stepResult,
      startedAt: this.startedAt,
    }, { 
      type: 'step_completed',
      stepIndex,
      progress,
    })
  }

  /**
   * 完成任务
   */
  complete(result = {}) {
    this.completedAt = Date.now()
    
    return this.checkpointManager.saveCheckpoint(this.taskId, {
      status: 'completed',
      progress: 100,
      result,
      startedAt: this.startedAt,
      completedAt: this.completedAt,
      duration: this.completedAt - this.startedAt,
    }, { type: 'task_completed' })
  }

  /**
   * 记录任务失败
   */
  fail(error, partialResult = {}) {
    this.completedAt = Date.now()
    
    return this.checkpointManager.saveCheckpoint(this.taskId, {
      status: 'failed',
      progress: Math.round((this.currentStep / Math.max(this.totalSteps, 1)) * 100),
      error: error.message || String(error),
      errorType: error.name || 'Error',
      partialResult,
      startedAt: this.startedAt,
      failedAt: this.completedAt,
      duration: this.completedAt - this.startedAt,
    }, { type: 'task_failed' })
  }

  /**
   * 获取任务状态
   */
  getStatus() {
    const history = this.checkpointManager.listCheckpoints(this.taskId, { limit: 1 })
    const latest = history[0]
    
    return {
      taskId: this.taskId,
      startedAt: this.startedAt,
      completedAt: this.completedAt,
      currentStep: this.currentStep,
      totalSteps: this.totalSteps,
      latestCheckpoint: latest,
    }
  }
}
