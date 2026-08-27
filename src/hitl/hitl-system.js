/**
 * 人机协作 (HITL) - 审批工作流与干预机制
 * 
 * 实现生产级 Agent 所需的人类可控机制：
 * - 审批工作流：高风险操作需要人类审批
 * - 干预机制：人类可以随时停止、修改任务
 * - 反馈收集：收集人类反馈用于改进
 * - 技能学习：从人类审批中学习偏好
 */

const DEFAULT_APPROVAL_RULES = [
  { id: 'high_risk', type: 'high_risk', needApproval: true, description: '高风险操作' },
  { id: 'data_deletion', type: 'data_deletion', needApproval: true, description: '数据删除操作' },
  { id: 'external_send', type: 'external_send', needApproval: true, description: '外部数据发送' },
  { id: 'financial_action', type: 'financial_action', needApproval: true, description: '财务相关操作' },
  { id: 'config_change', type: 'config_change', needApproval: false, description: '配置变更' },
  { id: 'query', type: 'query', needApproval: false, description: '查询操作' },
  { id: 'content_generation', type: 'content_generation', needApproval: false, description: '内容生成' },
  { id: 'default', type: 'default', needApproval: false, description: '默认操作' },
]

const RISK_KEYWORDS = {
  high_risk: ['delete', 'destroy', 'drop', 'rm', 'remove', 'wipe', 'format', 'shutdown', 'restart'],
  data_deletion: ['delete', 'remove', 'drop', 'truncate'],
  external_send: ['send', 'submit', 'upload', 'post', 'email', 'export'],
  financial_action: ['payment', 'transfer', 'purchase', 'buy', 'sell', 'invest', 'trade'],
}

export class ApprovalWorkflow {
  constructor(options = {}) {
    this.rules = options.rules || DEFAULT_APPROVAL_RULES
    this.pendingApprovals = new Map()  // approvalId -> approvalRecord
    this.approvalHistory = []  // 审批历史
    this.maxHistory = options.maxHistory || 1000
    this.defaultApprover = options.defaultApprover || 'system'
    this.autoApproveCache = new Map()  // actionHash -> autoApprove
  }

  /**
   * 检查操作是否需要审批
   */
  needsApproval(action, context = {}) {
    const actionType = action?.type || this.inferActionType(action)
    
    // 检查自动批准缓存
    const cacheKey = this.getActionHash(action)
    if (this.autoApproveCache.has(cacheKey)) {
      return false
    }

    // 匹配审批规则
    const rule = this.rules.find(r => r.type === actionType)
    if (rule) {
      return rule.needApproval
    }

    // 使用默认规则
    const defaultRule = this.rules.find(r => r.type === 'default')
    return defaultRule?.needApproval ?? false
  }

  /**
   * 推断操作类型
   */
  inferActionType(action) {
    const description = String(action?.description || action?.name || action?.type || '').toLowerCase()
    
    for (const [type, keywords] of Object.entries(RISK_KEYWORDS)) {
      if (keywords.some(kw => description.includes(kw))) {
        return type
      }
    }
    
    return 'default'
  }

  /**
   * 提交审批请求
   */
  requestApproval(action, requester, context = {}) {
    const approvalId = `approval_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const actionType = action?.type || this.inferActionType(action)
    
    const approval = {
      id: approvalId,
      action,
      actionType,
      requester: requester || 'gina',
      context,
      status: 'pending',
      approver: null,
      decision: null,
      createdAt: Date.now(),
      resolvedAt: null,
      reason: null,
    }

    this.pendingApprovals.set(approvalId, approval)
    
    console.log(`[HITL] Approval requested: ${approvalId} (${actionType})`)
    
    return approval
  }

  /**
   * 批准审批
   */
  approve(approvalId, approver, reason = '') {
    return this.resolveApproval(approvalId, 'approved', approver, reason)
  }

  /**
   * 拒绝审批
   */
  reject(approvalId, approver, reason = '') {
    return this.resolveApproval(approvalId, 'rejected', approver, reason)
  }

  /**
   * 处理审批结果
   */
  resolveApproval(approvalId, decision, approver, reason = '') {
    const approval = this.pendingApprovals.get(approvalId)
    if (!approval) {
      throw new Error(`Approval "${approvalId}" not found`)
    }

    if (approval.status !== 'pending') {
      throw new Error(`Approval "${approvalId}" is already ${approval.status}`)
    }

    approval.status = decision
    approval.decision = decision
    approval.approver = approver || this.defaultApprover
    approval.resolvedAt = Date.now()
    approval.reason = reason

    this.pendingApprovals.delete(approvalId)
    
    // 添加到历史
    this.addToHistory(approval)

    console.log(`[HITL] Approval ${decision}: ${approvalId} by ${approval.approver}`)
    
    return approval
  }

  /**
   * 批量处理审批
   */
  batchResolve(approvalIds, decision, approver) {
    const results = []
    for (const id of approvalIds) {
      try {
        const result = this.resolveApproval(id, decision, approver)
        results.push({ id, success: true, result })
      } catch (err) {
        results.push({ id, success: false, error: err.message })
      }
    }
    return results
  }

  /**
   * 获取待处理的审批
   */
  getPendingApprovals(filter = {}) {
    let approvals = [...this.pendingApprovals.values()]

    if (filter.actionType) {
      approvals = approvals.filter(a => a.actionType === filter.actionType)
    }
    if (filter.requester) {
      approvals = approvals.filter(a => a.requester === filter.requester)
    }

    return approvals.sort((a, b) => b.createdAt - a.createdAt)
  }

  /**
   * 获取审批历史
   */
  getHistory(filter = {}) {
    let history = [...this.approvalHistory]

    if (filter.actionType) {
      history = history.filter(h => h.actionType === filter.actionType)
    }
    if (filter.decision) {
      history = history.filter(h => h.decision === filter.decision)
    }
    if (filter.since) {
      history = history.filter(h => h.createdAt >= filter.since)
    }

    return history
  }

  /**
   * 添加到历史
   */
  addToHistory(approval) {
    this.approvalHistory.push({
      id: approval.id,
      actionType: approval.actionType,
      decision: approval.decision,
      approver: approval.approver,
      createdAt: approval.createdAt,
      resolvedAt: approval.resolvedAt,
      reason: approval.reason,
    })

    // 保持历史数量限制
    if (this.approvalHistory.length > this.maxHistory) {
      this.approvalHistory = this.approvalHistory.slice(-this.maxHistory)
    }
  }

  /**
   * 设置自动批准规则（人类偏好学习）
   */
  setAutoApprove(actionPattern, approver) {
    this.autoApproveCache.set(actionPattern, {
      approver,
      createdAt: Date.now(),
    })
    console.log(`[HITL] Auto-approve rule set for: ${actionPattern}`)
  }

  /**
   * 从审批历史学习偏好
   */  learnFromHistory() {
    // 分析审批历史，识别人类的批准/拒绝模式
    const stats = {
      byType: {},
      commonDecisions: [],
      learnedPatterns: [],
    }

    for (const record of this.approvalHistory) {
      if (!stats.byType[record.actionType]) {
        stats.byType[record.actionType] = { approved: 0, rejected: 0 }
      }
      if (record.decision === 'approved') {
        stats.byType[record.actionType].approved++
      } else {
        stats.byType[record.actionType].rejected++
      }
    }

    // 识别批准率超过 90% 的操作类型，可以考虑自动批准
    for (const [type, counts] of Object.entries(stats.byType)) {
      const total = counts.approved + counts.rejected
      if (total >= 10 && counts.approved / total > 0.9) {
        stats.learnedPatterns.push({
          type,
          autoApproveCandidate: true,
          approvalRate: counts.approved / total,
          sampleSize: total,
        })
      }
    }

    return stats
  }

  /**
   * 获取统计信息
   */
  getStats() {
    const pending = [...this.pendingApprovals.values()]
    const byType = {}
    
    for (const record of this.approvalHistory) {
      if (!byType[record.actionType]) {
        byType[record.actionType] = { approved: 0, rejected: 0 }
      }
      if (record.decision === 'approved') {
        byType[record.actionType].approved++
      } else {
        byType[record.actionType].rejected++
      }
    }

    return {
      pendingCount: pending.length,
      historyCount: this.approvalHistory.length,
      byType,
      autoApproveRules: this.autoApproveCache.size,
    }
  }

  /**
   * 生成操作哈希用于自动批准缓存
   */
  getActionHash(action) {
    const key = JSON.stringify({
      type: action?.type || '',
      description: action?.description || action?.name || '',
      pattern: action?.pattern || '',
    })
    return key
  }
}

/**
 * 干预控制器 - 允许人类干预 Gina 的任务执行
 */
export class InterventionController {
  constructor(approvalWorkflow) {
    this.approvalWorkflow = approvalWorkflow
    this.activeInterventions = []
    this.taskStates = new Map()  // taskId -> state
  }

  /**
   * 强制停止任务
   */
  forceStop(taskId, reason, operator) {
    const intervention = {
      type: 'force_stop',
      taskId,
      reason,
      operator: operator || 'human',
      timestamp: Date.now(),
    }

    this.activeInterventions.push(intervention)
    this.taskStates.set(taskId, 'stopped')

    console.log(`[HITL] Force stop task "${taskId}": ${reason}`)
    
    return {
      success: true,
      taskId,
      status: 'stopped',
      reason,
      intervention,
    }
  }

  /**
   * 修改任务参数
   */
  modifyTask(taskId, modifications, operator) {
    const intervention = {
      type: 'modify',
      taskId,
      modifications,
      operator: operator || 'human',
      timestamp: Date.now(),
    }

    this.activeInterventions.push(intervention)
    this.taskStates.set(taskId, 'modified')

    console.log(`[HITL] Modify task "${taskId}": ${JSON.stringify(modifications)}`)
    
    return {
      success: true,
      taskId,
      status: 'modified',
      modifications,
      intervention,
    }
  }

  /**
   * 暂停任务
   */
  pauseTask(taskId, reason, operator) {
    const intervention = {
      type: 'pause',
      taskId,
      reason,
      operator: operator || 'human',
      timestamp: Date.now(),
    }

    this.activeInterventions.push(intervention)
    this.taskStates.set(taskId, 'paused')

    return {
      success: true,
      taskId,
      status: 'paused',
      reason,
    }
  }

  /**
   * 恢复暂停的任务
   */
  resumeTask(taskId, operator) {
    const intervention = {
      type: 'resume',
      taskId,
      operator: operator || 'human',
      timestamp: Date.now(),
    }

    this.activeInterventions.push(intervention)
    this.taskStates.set(taskId, 'running')

    return {
      success: true,
      taskId,
      status: 'running',
    }
  }

  /**
   * 添加人类输入到任务上下文
   */
  addHumanInput(taskId, input, context = {}) {
    const intervention = {
      type: 'human_input',
      taskId,
      input,
      context,
      timestamp: Date.now(),
    }

    this.activeInterventions.push(intervention)

    return {
      success: true,
      taskId,
      input,
      message: 'Human input added to task context',
    }
  }

  /**
   * 检查任务是否有未解决的干预
   */
  hasActiveIntervention(taskId) {
    return this.activeInterventions.some(i => 
      i.taskId === taskId && 
      ['force_stop', 'pause', 'modify'].includes(i.type)
    )
  }

  /**
   * 获取任务干预状态
   */
  getInterventionStatus(taskId) {
    const interventions = this.activeInterventions.filter(i => i.taskId === taskId)
    const state = this.taskStates.get(taskId) || 'unknown'

    return {
      taskId,
      state,
      interventions: interventions.slice(-10), // 最近10条
      hasActiveIntervention: this.hasActiveIntervention(taskId),
    }
  }

  /**
   * 获取所有活跃的干预
   */
  getActiveInterventions() {
    return this.activeInterventions.filter(i => 
      ['force_stop', 'pause'].includes(i.type)
    )
  }

  /**
   * 清除已完成的干预记录
   */
  clearInterventions(olderThanMs = 24 * 60 * 60 * 1000) {
    const cutoff = Date.now() - olderThanMs
    const before = this.activeInterventions.length
    this.activeInterventions = this.activeInterventions.filter(i => i.timestamp >= cutoff)
    const removed = before - this.activeInterventions.length
    
    return { removed, remaining: this.activeInterventions.length }
  }
}

/**
 * 创建 HITL 系统的便捷函数
 */
export function createHitlSystem(options = {}) {
  const approvalWorkflow = new ApprovalWorkflow(options?.approvalRules)
  const interventionController = new InterventionController(approvalWorkflow)
  
  return {
    approvalWorkflow,
    interventionController,
    
    // 便捷方法
    async checkAndApprove(action, operator) {
      if (approvalWorkflow.needsApproval(action)) {
        const approval = approvalWorkflow.requestApproval(action, 'gina')
        console.log(`[HITL] Action requires approval: ${approval.id}`)
        return approval
      }
      return { needsApproval: false, autoApproved: true }
    },
    
    getStatus() {
      return {
        approvals: approvalWorkflow.getStats(),
        interventions: {
          active: interventionController.getActiveInterventions().length,
          trackedTasks: interventionController.taskStates.size,
        },
      }
    },
  }
}
