// 接单队列工具 schema：enqueue_order / list_orders / complete_order
// 让 gina 管理不同平台进来的接单任务：排队、标优先级、逐个交付。
export const ordersSchemas = {
  enqueue_order: {
    type: 'function',
    function: {
      name: 'enqueue_order',
      description: '登记一个新接单到队列。当用户转发某个平台的需求让你接单干活时调用。队列按优先级自动排序，gina 逐个交付。',
      parameters: {
        type: 'object',
        properties: {
          platform: { type: 'string', description: '来源平台，如 闲鱼/淘宝/猪八戒/程序员客栈/Upwork/Fiverr。' },
          client: { type: 'string', description: '客户昵称或标识（可选）。' },
          requirement: { type: 'string', description: '这单要做什么，写清楚交付标准。' },
          priority: { type: 'number', description: '优先级 1-10，数字越大越优先，默认 5。急单/高价单调高。' },
          deliverable: { type: 'string', description: '预期交付物描述（可选，如"一份爬虫脚本"）。' },
          notes: { type: 'string', description: '备注（可选）。' },
        },
        required: ['requirement']
      }
    }
  },

  list_orders: {
    type: 'function',
    function: {
      name: 'list_orders',
      description: '查看接单队列。可按状态过滤（pending/in_progress/done/cancelled），默认返回全部，按优先级降序排列。',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', description: '按状态过滤，留空返回全部。可选：pending/in_progress/done/cancelled。' },
        },
        required: []
      }
    }
  },

  complete_order: {
    type: 'function',
    function: {
      name: 'complete_order',
      description: '标记一个接单已完成，并记录交付物。做完一单后调用，队列里该单状态变为 done。',
      parameters: {
        type: 'object',
        properties: {
          order_id: { type: 'string', description: '要完成的接单 id（来自 enqueue_order 或 list_orders 的返回）。' },
          deliverable: { type: 'string', description: '实际交付物说明（可选）。' },
          summary: { type: 'string', description: '交付总结（可选）。' },
        },
        required: ['order_id']
      }
    }
  },
}
