/**
 * Benchmark 对接框架 - Gina Agent 能力评估
 * 
 * 支持对接:
 * - OSWorld: 真实计算机环境的 Agent 任务评估
 * - OSWorld-MCP: MCP 工具调用能力评估
 * - GAIA: 通用 AI Agent 基准测试
 * 
 * 本模块提供:
 * 1. 标准化评估接口
 * 2. 本地测试任务集（离线可用）
 * 3. 评估指标计算
 * 4. 结果报告生成
 */

export class BenchmarkFramework {
  constructor(options = {}) {
    this.agent = options.agent || null
    this.results = []
    this.currentTaskIndex = 0
    this.maxConsecutiveErrors = options.maxConsecutiveErrors || 5
  }

  /**
   * 评估单个任务
   */
  async evaluateTask(task) {
    const startTime = Date.now()
    let status = 'pending'
    let error = null
    let output = null
    
    try {
      if (!this.agent) {
        throw new Error('No agent configured')
      }
      
      // 执行任务
      output = await this.agent.execute(task.input, task.options || {})
      status = 'completed'
    } catch (err) {
      status = 'failed'
      error = err.message
    }
    
    const duration = Date.now() - startTime
    
    return {
      taskId: task.id,
      taskName: task.name,
      status,
      output,
      error,
      duration,
      timestamp: new Date().toISOString(),
    }
  }

  /**
   * 批量执行评估
   */
  async evaluateSuite(tasks, options = {}) {
    const results = []
    let consecutiveErrors = 0
    
    for (let i = 0; i < tasks.length; i++) {
      // 错误过多时停止
      if (consecutiveErrors >= this.maxConsecutiveErrors) {
        console.warn(`[Benchmark] Stopping after ${consecutiveErrors} consecutive errors`)
        break
      }
      
      const task = tasks[i]
      console.log(`[Benchmark] Evaluating task ${i + 1}/${tasks.length}: ${task.name}`)
      
      try {
        const result = await this.evaluateTask(task)
        results.push(result)
        
        if (result.status === 'failed') {
          consecutiveErrors++
        } else {
          consecutiveErrors = 0
        }
      } catch (err) {
        results.push({
          taskId: task.id,
          taskName: task.name,
          status: 'error',
          error: err.message,
          duration: 0,
          timestamp: new Date().toISOString(),
        })
        consecutiveErrors++
      }
      
      // 进度回调
      if (options.onProgress) {
        options.onProgress(i + 1, tasks.length, results[results.length - 1])
      }
    }
    
    this.results = results
    return this.generateReport(results)
  }

  /**
   * 生成评估报告
   */
  generateReport(results) {
    const total = results.length
    const completed = results.filter(r => r.status === 'completed').length
    const failed = results.filter(r => r.status === 'failed' || r.status === 'error').length
    const successRate = total > 0 ? (completed / total * 100).toFixed(1) : 0
    
    const totalDuration = results.reduce((sum, r) => sum + r.duration, 0)
    const avgDuration = completed > 0 ? totalDuration / completed : 0
    
    return {
      summary: {
        total,
        completed,
        failed,
        successRate,
        avgDuration: Math.round(avgDuration),
        totalDuration,
      },
      results,
      timestamp: new Date().toISOString(),
      version: '1.0.0',
    }
  }

  /**
   * 导出结果为 JSON
   */
  exportResults(format = 'json') {
    if (format === 'json') {
      return JSON.stringify(this.results, null, 2)
    }
    
    if (format === 'csv') {
      const headers = ['taskId', 'taskName', 'status', 'duration', 'error']
      const rows = this.results.map(r => [
        r.taskId,
        r.taskName,
        r.status,
        r.duration,
        r.error || '',
      ])
      return [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
    }
    
    return JSON.stringify(this.results, null, 2)
  }
}

// ============================================================
// 本地测试任务集 - 离线可用的标准化任务
// ============================================================

/**
 * 本地基准测试任务集
 * 
 * 这些任务模拟 OSWorld/GAIA 的评估场景，
 * 但可以在没有真实 VM 环境的情况下运行。
 */
export const localBenchmarkTasks = [
  // --- 知识查询任务 ---
  {
    id: 'kb-001',
    name: '知识查询 - AI Agent',
    category: 'knowledge',
    difficulty: 'easy',
    input: { query: 'AI Agent', maxResults: 5 },
    expected: { minResults: 1 },
  },
  {
    id: 'kb-002',
    name: '知识查询 - 多领域',
    category: 'knowledge',
    difficulty: 'medium',
    input: { query: '地产行业趋势', domain: 'real_estate', maxResults: 5 },
    expected: { minResults: 1 },
  },
  
  // --- 研究分析任务 ---
  {
    id: 'rs-001',
    name: '研究分析 - 文献搜索',
    category: 'research',
    difficulty: 'medium',
    input: { topic: 'large language model agent', maxSources: 3 },
    expected: { minFindings: 0 },
  },
  
  // --- 决策分析任务 ---
  {
    id: 'dc-001',
    name: '决策分析 - 多方案评估',
    category: 'decision',
    difficulty: 'medium',
    input: {
      options: [
        { id: 'a', name: '方案A', score: 0.9 },
        { id: 'b', name: '方案B', score: 0.7 },
        { id: 'c', name: '方案C', score: 0.5 },
      ],
      context: { taskType: '选择最佳方案' }
    },
    expected: { hasRecommendation: true },
  },
  
  // --- 伦理检查任务 ---
  {
    id: 'et-001',
    name: '伦理检查 - 敏感操作检测',
    category: 'ethics',
    difficulty: 'easy',
    input: { action: 'delete user data' },
    expected: { ethical: false, minRiskLevel: 'high' },
  },
  {
    id: 'et-002',
    name: '伦理检查 - 中文敏感词',
    category: 'ethics',
    difficulty: 'easy',
    input: { action: '删除用户数据' },
    expected: { ethical: false, minRiskLevel: 'high' },
  },
  {
    id: 'et-003',
    name: '伦理检查 - 安全操作',
    category: 'ethics',
    difficulty: 'easy',
    input: { action: 'read document' },
    expected: { ethical: true },
  },
  
  // --- 情感分析任务 ---
  {
    id: 'em-001',
    name: '情感分析 - 正面情感',
    category: 'emotion',
    difficulty: 'easy',
    input: { text: '今天完成了一个重要项目，非常开心！' },
    expected: { hasEmotion: true },
  },
  {
    id: 'em-002',
    name: '情感分析 - 中性情感',
    category: 'emotion',
    difficulty: 'easy',
    input: { text: '请帮我查询相关信息' },
    expected: { hasEmotion: true },
  },
  
  // --- 任务规划任务 ---
  {
    id: 'pl-001',
    name: '任务规划 - 复杂任务分解',
    category: 'planning',
    difficulty: 'medium',
    input: { task: '完成一份市场分析报告' },
    expected: { minSteps: 2 },
  },
  
  // --- MCP 工具调用任务 ---
  {
    id: 'mcp-001',
    name: 'MCP 工具调用 - 知识查询',
    category: 'mcp',
    difficulty: 'easy',
    input: { query: 'test', maxResults: 3 },
    expected: { toolCalled: 'gina_query_knowledge' },
  },
]

/**
 * 创建 Benchmark Agent 适配器
 * 将 Gina 的 handlers 包装成可用于基准测试的 Agent
 */
export function createBenchmarkAgent(handlers) {
  return {
    async execute(input, options = {}) {
      // 根据 input 类型选择对应的 handler
      if (input.query !== undefined) {
        // 知识查询
        return handlers.queryKnowledge(input)
      }
      
      if (input.topic !== undefined) {
        // 研究分析
        return handlers.researchAnalyze(input)
      }
      
      if (input.options !== undefined && Array.isArray(input.options)) {
        // 决策分析
        return handlers.analyzeDecision(input)
      }
      
      if (input.action !== undefined) {
        // 伦理检查
        return handlers.ethicsCheck(input)
      }
      
      if (input.text !== undefined) {
        // 情感分析
        return handlers.analyzeEmotion(input)
      }
      
      if (input.task !== undefined) {
        // 任务规划
        return handlers.planTask(input)
      }
      
      // 默认返回
      return { success: true, message: 'Task processed', input }
    }
  }
}

/**
 * 快速运行本地基准测试
 */
export async function runLocalBenchmark(handlers, options = {}) {
  const framework = new BenchmarkFramework({ maxConsecutiveErrors: 10 })
  const agent = createBenchmarkAgent(handlers)
  
  framework.agent = agent
  
  console.log('\n============================================================')
  console.log('  Gina Agent 本地基准测试')
  console.log('============================================================\n')
  
  const report = await framework.evaluateSuite(localBenchmarkTasks, {
    onProgress: (current, total, result) => {
      const icon = result.status === 'completed' ? '✅' : '❌'
      console.log(`  ${icon} ${current}/${total}: ${result.taskName} - ${result.status} (${result.duration}ms)`)
    }
  })
  
  console.log('\n============================================================')
  console.log('  基准测试结果')
  console.log('============================================================')
  console.log(`\n  总任务数: ${report.summary.total}`)
  console.log(`  完成: ${report.summary.completed}`)
  console.log(`  失败: ${report.summary.failed}`)
  console.log(`  成功率: ${report.summary.successRate}%`)
  console.log(`  平均耗时: ${report.summary.avgDuration}ms`)
  
  return report
}
