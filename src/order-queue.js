// 接单队列：让 gina 把不同平台进来的单子排队、标优先级、逐个交付。
//
// 设计约束：
//   - 轻量：不常驻内存，每次读写直接从 config 表同步读取/写回，零后台定时器、零预热。
//   - 持久化：存 config 表，gina 进程重启后队列自动恢复（断点续传的承重墙）。
//   - 单线程：gina 本身是单线程串行，队列只提供「排序 + 状态」，不引入并发。
//
// 状态机：pending → in_progress → done
// 优先级：数字越大越优先（默认 5，范围 1-10）。

import { getConfig, setConfig } from './capabilities/db.js'

const QUEUE_KEY = 'order_queue'

function loadQueue() {
  const raw = getConfig(QUEUE_KEY)
  if (!raw) return []
  try {
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

function saveQueue(orders) {
  setConfig(QUEUE_KEY, JSON.stringify(orders))
}

function makeId(now = Date.now()) {
  return `order_${now}_${Math.random().toString(36).slice(2, 8)}`
}

// 入队：登记一个新接单
export function enqueueOrder({ platform, client = '', requirement, priority = 5, deliverable = '', notes = '' } = {}) {
  const req = String(requirement || '').trim()
  if (!req) return { ok: false, error: 'requirement 不能为空：至少写清这单要做什么' }
  const orders = loadQueue()
  const order = {
    id: makeId(),
    platform: String(platform || 'unknown').trim() || 'unknown',
    client: String(client || '').trim(),
    requirement: req,
    priority: Math.max(1, Math.min(10, Number(priority) || 5)),
    status: 'pending',
    deliverable: String(deliverable || '').trim(),
    notes: String(notes || '').trim(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  orders.push(order)
  saveQueue(orders)
  return { ok: true, order }
}

// 列出队列：可按状态过滤，默认全部；按优先级降序 + 先入先做排序
export function listOrders(status = '') {
  const orders = loadQueue()
  const filtered = status ? orders.filter(o => o.status === status) : orders
  return [...filtered].sort((a, b) =>
    (b.priority - a.priority) || (a.createdAt < b.createdAt ? -1 : 1)
  )
}

// 取下一个待办（最高优先级且 pending），无则返回 null
export function nextPendingOrder() {
  return listOrders('pending')[0] || null
}

// 标记开工：pending → in_progress
export function startOrder(id) {
  const orders = loadQueue()
  const order = orders.find(o => o.id === id)
  if (!order) return { ok: false, error: `order ${id} not found` }
  order.status = 'in_progress'
  order.updatedAt = new Date().toISOString()
  saveQueue(orders)
  return { ok: true, order }
}

// 标记完成：in_progress/pending → done，记录交付物
export function completeOrder(id, { deliverable = '', summary = '' } = {}) {
  const orders = loadQueue()
  const order = orders.find(o => o.id === id)
  if (!order) return { ok: false, error: `order ${id} not found` }
  order.status = 'done'
  if (deliverable) order.deliverable = String(deliverable).trim()
  if (summary) order.summary = String(summary).trim()
  order.updatedAt = new Date().toISOString()
  saveQueue(orders)
  return { ok: true, order }
}

// 取消/放弃一单：pending/in_progress → cancelled
export function cancelOrder(id, { reason = '' } = {}) {
  const orders = loadQueue()
  const order = orders.find(o => o.id === id)
  if (!order) return { ok: false, error: `order ${id} not found` }
  order.status = 'cancelled'
  if (reason) order.notes = `${order.notes ? order.notes + ' | ' : ''}cancelled: ${reason}`.trim()
  order.updatedAt = new Date().toISOString()
  saveQueue(orders)
  return { ok: true, order }
}

export function getOrderQueueStats() {
  const orders = loadQueue()
  const count = (s) => orders.filter(o => o.status === s).length
  return {
    total: orders.length,
    pending: count('pending'),
    inProgress: count('in_progress'),
    done: count('done'),
    cancelled: count('cancelled'),
  }
}
