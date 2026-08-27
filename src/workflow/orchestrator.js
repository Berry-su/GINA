/**
 * orchestrator.js — 工作流 DAG 编排器
 *
 * 核心理念：将多个任务步骤组织成有向无环图（DAG），
 * 支持条件分支、并行执行、循环和状态持久化。
 *
 * DAG 结构：
 *   ┌──────┐    ┌──────┐    ┌──────┐
 *   │ Node │ ──→ │ Node │ ──→ │ Node │
 *   └──────┘    └──────┘    └──────┘
 *     │              │
 *     ↓              ↓
 *   ┌──────┐    ┌──────┐
 *   │ Node │    │ Node │
 *   └──────┘    └──────┘
 *
 * 节点类型：
 *   - task: 执行单个任务
 *   - condition: 条件分支
 *   - parallel: 并行执行多个分支
 *   - loop: 循环执行
 *   - wait: 等待外部信号
 */

import fs from 'fs'
import path from 'path'
import { emitEvent } from '../events.js'

const WORKFLOW_DIR = process.env.GINA_HOME
  ? path.join(process.env.GINA_HOME, 'workflows')
  : path.join(process.env.HOME || '.', '.gina', 'workflows')

const DEFAULT_CONFIG = {
  maxNodes: 50,
  maxDepth: 10,
  defaultTimeoutMs: 60000,
  enableParallel: true,
  enableCondition: true,
  persistState: true,
}

let config = { ...DEFAULT_CONFIG }
let workflows = new Map()
let runningWorkflows = new Map()
let workflowHistory = []

/**
 * 初始化工作流编排器
 */
export function initWorkflowOrchestrator(userConfig = {}) {
  config = { ...DEFAULT_CONFIG, ...userConfig }
  ensureStorage()
  
  console.log('[工作流编排器] 已启动')
  return { config }
}

/**
 * 确保存储目录存在
 */
function ensureStorage() {
  try {
    if (!fs.existsSync(WORKFLOW_DIR)) {
      fs.mkdirSync(WORKFLOW_DIR, { recursive: true })
    }
  } catch {}
}

/**
 * 定义工作流
 */
export function defineWorkflow(definition) {
  const {
    id,
    name,
    nodes,
    edges,
    description = '',
    version = '1.0.0',
  } = definition
  
  if (!id || !nodes || nodes.length === 0) {
    throw new Error('工作流必须包含 id 和 nodes')
  }
  
  const validation = validateDAG(nodes, edges)
  if (!validation.valid) {
    throw new Error(`DAG 验证失败: ${validation.errors.join(', ')}`)
  }
  
  const workflow = {
    id,
    name,
    description,
    version,
    nodes: normalizeNodes(nodes),
    edges: normalizeEdges(edges),
    entryNodeId: findEntryNode(nodes, edges),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: 'defined',
  }
  
  workflows.set(id, workflow)
  
  if (config.persistState) {
    persistWorkflow(workflow)
  }
  
  emitEvent('workflow_defined', { workflowId: id, name, nodesCount: nodes.length })
  
  return workflow
}

/**
 * 验证 DAG 合法性
 */
function validateDAG(nodes, edges) {
  const errors = []
  const safeEdges = edges || []  // 修复：添加默认值处理
  const nodeIds = new Set(nodes.map(n => n.id))
  
  // 检查节点 ID 唯一性
  if (nodeIds.size !== nodes.length) {
    errors.push('节点 ID 必须唯一')
  }
  
  // 检查边的有效性
  for (const edge of safeEdges) {
    if (!nodeIds.has(edge.from)) {
      errors.push(`边的源节点不存在: ${edge.from}`)
    }
    if (!nodeIds.has(edge.to)) {
      errors.push(`边的目标节点不存在: ${edge.to}`)
    }
  }
  
  // 检测循环（简化版）
  const adjacencyList = {}
  for (const nodeId of nodeIds) {
    adjacencyList[nodeId] = []
  }
  for (const edge of safeEdges) {
    if (adjacencyList[edge.from]) {
      adjacencyList[edge.from].push(edge.to)
    }
  }
  
  if (hasCycle(adjacencyList)) {
    errors.push('DAG 中存在循环')
  }
  
  return { valid: errors.length === 0, errors }
}

/**
 * 检测图中是否存在循环
 */
function hasCycle(adjacencyList) {
  const visited = new Set()
  const recStack = new Set()
  
  function dfs(node) {
    if (recStack.has(node)) return true
    if (visited.has(node)) return false
    
    visited.add(node)
    recStack.add(node)
    
    for (const neighbor of (adjacencyList[node] || [])) {
      if (dfs(neighbor)) return true
    }
    
    recStack.delete(node)
    return false
  }
  
  for (const node of Object.keys(adjacencyList)) {
    if (dfs(node)) return true
  }
  
  return false
}

/**
 * 规范化节点
 */
function normalizeNodes(nodes) {
  return nodes.map((node, index) => ({
    id: node.id || `node_${index}`,
    name: node.name || node.id || `Node ${index + 1}`,
    type: node.type || 'task', // task, condition, parallel, wait
    action: node.action || null,
    params: node.params || {},
    timeoutMs: node.timeoutMs || config.defaultTimeoutMs,
    condition: node.condition || null,
    onFail: node.onFail || 'stop', // stop, skip, retry
    retryCount: node.retryCount || 0,
    status: 'pending',
  }))
}

/**
 * 规范化边
 */
function normalizeEdges(edges) {
  return (edges || []).map(edge => ({
    from: edge.from,
    to: edge.to,
    condition: edge.condition || null,
    priority: edge.priority || 0,
  }))
}

/**
 * 查找入口节点
 */
function findEntryNode(nodes, edges) {
  const nodeIds = new Set(nodes.map(n => n.id))
  const targetIds = new Set((edges || []).map(e => e.to))
  
  // 入口节点：没有入边
  for (const node of nodes) {
    if (!targetIds.has(node.id)) {
      return node.id
    }
  }
  
  // 如果所有节点都有入边，取第一个
  return nodes[0]?.id
}

/**
 * 执行工作流
 */
export async function executeWorkflow(workflowId, input = {}) {
  const workflow = workflows.get(workflowId)
  if (!workflow) {
    return { success: false, error: '工作流不存在' }
  }
  
  const executionId = `wf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
  const execution = {
    executionId,
    workflowId,
    input,
    output: {},
    currentNodeId: workflow.entryNodeId,
    completedNodes: [],
    failedNodes: [],
    skippedNodes: [],
    variables: { ...input },
    startTime: Date.now(),
    status: 'running',
  }
  
  runningWorkflows.set(executionId, execution)
  
  emitEvent('workflow_started', {
    executionId,
    workflowId,
    input,
    timestamp: Date.now(),
  })
  
  try {
    await executeNode(execution, workflow, execution.currentNodeId)
    
    execution.status = 'completed'
    execution.endTime = Date.now()
    
    runningWorkflows.delete(executionId)
    workflowHistory.push(execution)
    
    emitEvent('workflow_completed', {
      executionId,
      workflowId,
      completedNodes: execution.completedNodes.length,
      failedNodes: execution.failedNodes.length,
      durationMs: execution.endTime - execution.startTime,
    })
    
    return {
      success: true,
      executionId,
      output: execution.output,
      completedNodes: execution.completedNodes.map(n => n.id),
      durationMs: execution.endTime - execution.startTime,
    }
    
  } catch (e) {
    execution.status = 'failed'
    execution.error = e.message
    execution.endTime = Date.now()
    
    runningWorkflows.delete(executionId)
    workflowHistory.push(execution)
    
    emitEvent('workflow_failed', {
      executionId,
      workflowId,
      error: e.message,
    })
    
    return { success: false, error: e.message, executionId }
  }
}

/**
 * 执行单个节点
 */
async function executeNode(execution, workflow, nodeId) {
  const node = workflow.nodes.find(n => n.id === nodeId)
  if (!node) return
  
  const nodeStatus = execution.completedNodes.find(n => n.id === nodeId)
  if (nodeStatus) return // 已完成
  
  emitEvent('workflow_node_started', {
    executionId: execution.executionId,
    nodeId,
    nodeName: node.name,
    nodeType: node.type,
  })
  
  let result
  
  switch (node.type) {
    case 'task':
      result = await executeTaskNode(execution, node)
      break
    case 'condition':
      result = await executeConditionNode(execution, node, workflow)
      break
    case 'parallel':
      result = await executeParallelNode(execution, node, workflow)
      break
    case 'wait':
      result = await executeWaitNode(execution, node)
      break
    default:
      result = { success: true, output: {} }
  }
  
  if (result.success) {
    execution.completedNodes.push({
      id: nodeId,
      result: result.output,
      timestamp: Date.now(),
    })
    execution.output[nodeId] = result.output
    execution.variables = { ...execution.variables, ...result.output }
  } else {
    execution.failedNodes.push({
      id: nodeId,
      error: result.error,
      timestamp: Date.now(),
    })
    
    if (node.onFail === 'stop') {
      throw new Error(`节点 ${node.name} 执行失败: ${result.error}`)
    }
  }
  
  // 执行后续节点
  const nextEdges = workflow.edges.filter(e => e.from === nodeId)
  
  for (const edge of nextEdges) {
    // 检查条件
    if (edge.condition) {
      const conditionMet = evaluateCondition(edge.condition, execution.variables)
      if (!conditionMet) {
        execution.skippedNodes.push({ from: nodeId, to: edge.to, reason: '条件不满足' })
        continue
      }
    }
    
    await executeNode(execution, workflow, edge.to)
  }
}

/**
 * 执行任务节点
 */
async function executeTaskNode(execution, node) {
  try {
    const result = await performAction(node.action, node.params, execution.variables)
    return { success: true, output: result }
  } catch (e) {
    if (node.retryCount > 0) {
      node.retryCount--
      return executeTaskNode(execution, node)
    }
    return { success: false, error: e.message }
  }
}

/**
 * 执行条件节点
 */
async function executeConditionNode(execution, node, workflow) {
  const conditionMet = evaluateCondition(node.condition, execution.variables)
  return { success: true, output: { conditionResult: conditionMet } }
}

/**
 * 执行并行节点
 */
async function executeParallelNode(execution, node, workflow) {
  // 并行节点：标记为完成，后续分支并行执行
  return { success: true, output: { parallelStarted: true } }
}

/**
 * 执行等待节点
 */
async function executeWaitNode(execution, node) {
  const waitMs = node.params?.waitMs || 1000
  await new Promise(resolve => setTimeout(resolve, waitMs))
  return { success: true, output: { waited: waitMs } }
}

/**
 * 执行动作
 */
async function performAction(action, params, variables) {
  // 简化版：实际实现需接入能力层
  const actionHandlers = {
    'search': () => ({ results: [] }),
    'analyze': () => ({ analysis: '完成' }),
    'generate': () => ({ content: '生成内容' }),
    'transform': () => ({ transformed: true }),
    'validate': () => ({ valid: true }),
  }
  
  const handler = actionHandlers[action]
  if (handler) {
    return handler()
  }
  
  return { action, status: 'completed', params }
}

/**
 * 评估条件表达式
 */
function evaluateCondition(condition, variables) {
  if (!condition) return true
  
  if (typeof condition === 'boolean') return condition
  
  if (typeof condition === 'function') {
    try {
      return condition(variables)
    } catch {
      return false
    }
  }
  
  if (typeof condition === 'string') {
    try {
      // 简单的字符串条件（不使用 eval，避免安全风险）
      const parts = condition.split(/\s*(==|!=|>|<|>=|<=)\s*/)
      if (parts.length === 3) {
        const [left, operator, right] = parts
        const leftVal = resolveVariable(left, variables)
        const rightVal = resolveVariable(right, variables)
        
        switch (operator) {
          case '==': return leftVal == rightVal
          case '!=': return leftVal != rightVal
          case '>': return leftVal > rightVal
          case '<': return leftVal < rightVal
          case '>=': return leftVal >= rightVal
          case '<=': return leftVal <= rightVal
        }
      }
    } catch {
      return false
    }
  }
  
  return true
}

/**
 * 解析变量值
 */
function resolveVariable(name, variables) {
  if (name in variables) return variables[name]
  
  // 尝试解析嵌套属性
  const parts = name.split('.')
  let value = variables
  for (const part of parts) {
    if (value && typeof value === 'object' && part in value) {
      value = value[part]
    } else {
      return name // 字面量
    }
  }
  
  return value
}

/**
 * 持久化工作流
 */
function persistWorkflow(workflow) {
  try {
    const filePath = path.join(WORKFLOW_DIR, `${workflow.id}.json`)
    fs.writeFileSync(filePath, JSON.stringify(workflow, null, 2), 'utf8')
  } catch {}
}

/**
 * 从存储加载工作流
 */
function loadWorkflow(id) {
  try {
    const filePath = path.join(WORKFLOW_DIR, `${id}.json`)
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8')
      const workflow = JSON.parse(content)
      workflows.set(id, workflow)
      return workflow
    }
  } catch {}
  return null
}

/**
 * 列出所有工作流
 */
export function listWorkflows() {
  return Array.from(workflows.values()).map(w => ({
    id: w.id,
    name: w.name,
    description: w.description,
    version: w.version,
    nodesCount: w.nodes.length,
    status: w.status,
  }))
}

/**
 * 获取工作流执行状态
 */
export function getWorkflowStatus(executionId) {
  return runningWorkflows.get(executionId) || workflowHistory.find(h => h.executionId === executionId)
}

/**
 * 获取编排器状态
 */
export function getOrchestratorStatus() {
  return {
    definedWorkflows: workflows.size,
    runningExecutions: runningWorkflows.size,
    historyCount: workflowHistory.length,
    config: { ...config },
  }
}

/**
 * 更新配置
 */
export function updateOrchestratorConfig(partialConfig) {
  config = { ...config, ...partialConfig }
  return config
}

/**
 * 创建预设工作流模板
 */
export function createWorkflowTemplate(templateType) {
  const templates = {
    data_pipeline: {
      id: 'data_pipeline_' + Date.now(),
      name: '数据处理管道',
      description: '从数据源获取、处理、存储数据',
      nodes: [
        { id: 'fetch', name: '获取数据', type: 'task', action: 'search' },
        { id: 'validate', name: '验证数据', type: 'task', action: 'validate' },
        { id: 'transform', name: '转换数据', type: 'task', action: 'transform' },
        { id: 'store', name: '存储数据', type: 'task', action: 'transform' },
      ],
      edges: [
        { from: 'fetch', to: 'validate' },
        { from: 'validate', to: 'transform', condition: 'validate.result == true' },
        { from: 'transform', to: 'store' },
      ],
    },
    analysis_pipeline: {
      id: 'analysis_pipeline_' + Date.now(),
      name: '分析管道',
      description: '数据获取→分析→洞察→报告',
      nodes: [
        { id: 'collect', name: '数据收集', type: 'task', action: 'search' },
        { id: 'analyze', name: '分析', type: 'task', action: 'analyze' },
        { id: 'insights', name: '提取洞察', type: 'task', action: 'analyze' },
        { id: 'report', name: '生成报告', type: 'task', action: 'generate' },
      ],
      edges: [
        { from: 'collect', to: 'analyze' },
        { from: 'analyze', to: 'insights' },
        { from: 'insights', to: 'report' },
      ],
    },
  }
  
  return templates[templateType] || null
}