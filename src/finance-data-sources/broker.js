/**
 * 真实数据源 —— 交易经纪商接口 (broker.js)
 *
 * 下单执行层的抽象接口 + 同花顺骨架实现。
 * 权限硬约束：placeOrder 必须显式传入 authorized=true 才可能执行；未授权一律拒绝，
 * 与「只有用户授权 Gina 才能下单」的权限链保持一致（授权闸门在此二次兜底）。
 *
 * 说明：A 股程序化下单通常走券商量化通道（迅投 QMT/miniQMT，多为 Windows）或同花顺 iFinD
 * 交易接口；本骨架仅定义接口与授权门，等确定通道/账号后实现具体下单逻辑。
 */

export class BrokerAdapter {
  get name() { return 'base' }

  /**
   * 下单（买入/卖出）。
   * @param {object} order { symbol, side:'buy'|'sell', size, price }
   * @param {object} [options]
   * @param {boolean} [options.authorized] 用户是否已授权
   * @returns {Promise<object>} { status, reason, orderId? }
   */
  async placeOrder(_order, _options = {}) {
    return { status: 'not_connected', reason: `${this.name} 未接入` }
  }

  /** 撤单。 */
  async cancelOrder(_orderId) {
    return { status: 'not_connected', reason: `${this.name} 未接入` }
  }

  /** 查询持仓。 */
  async getPositions() {
    return []
  }

  /** 查询账户资金。 */
  async getAccount() {
    return null
  }
}

/**
 * 同花顺交易骨架（未接入，仅定义授权门与接口）。
 */
export class TonghuashunBrokerAdapter extends BrokerAdapter {
  get name() { return '同花顺' }

  constructor({ accountId = '' } = {}) {
    super()
    this.accountId = accountId
  }

  async placeOrder(order, { authorized = false } = {}) {
    // 授权硬门：未授权一律拒绝
    if (!authorized) {
      return { status: 'rejected', reason: '未获用户授权，禁止下单' }
    }
    if (!order || !order.symbol || !['buy', 'sell'].includes(order.side)) {
      return { status: 'rejected', reason: '订单非法' }
    }
    // TODO: 接入真实同花顺下单通道（QMT/迅投 或 iFinD），完成后返回真实委托号
    return { status: 'not_connected', reason: '同花顺交易通道未接入（待配置券商账号/授权通道）' }
  }
}

/**
 * 同花顺·迅投 miniQMT 下单适配器（Windows 桥接）。
 *
 * 落地路径：Gina(Mac·Node) → HTTP 桥 → Windows(Python·xtquant) → miniQMT → 券商下单。
 *   - mode='mock' ：本地模拟成交，用于未接 Windows 前验证「选股→授权→下单→成交」全链路；
 *   - mode='http' ：真实调用 Windows 端桥（scripts/miniqmt-bridge.py）下单。
 *
 * 权限硬约束不变：placeOrder 必须 authorized=true 才执行。
 */
export class MiniQMTBrokerAdapter extends BrokerAdapter {
  get name() { return '同花顺·miniQMT' }

  /**
   * @param {object} [options]
   * @param {string} [options.accountId] 资金账号
   * @param {'mock'|'http'} [options.mode]
   * @param {string} [options.bridgeUrl] mode='http' 时的桥地址
   */
  constructor({ accountId = '', mode = 'mock', bridgeUrl = 'http://127.0.0.1:18880' } = {}) {
    super()
    this.accountId = accountId
    this.mode = mode
    this.bridgeUrl = bridgeUrl
  }

  async placeOrder(order, { authorized = false } = {}) {
    if (!authorized) {
      return { status: 'rejected', reason: '未获用户授权，禁止下单' }
    }
    if (!order || !order.symbol || !['buy', 'sell'].includes(order.side)) {
      return { status: 'rejected', reason: '订单非法' }
    }

    if (this.mode === 'mock') {
      // 模拟成交：A 股 T+1 不在此处校验，仅返委托
      return {
        status: 'filled',
        orderId: `mock-${Date.now()}`,
        symbol: order.symbol,
        side: order.side,
        size: order.size ?? 0,
        price: order.price ?? null,
        reason: '模拟成交（未接 Windows miniQMT）',
      }
    }

    try {
      const resp = await fetch(`${this.bridgeUrl}/order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: this.accountId, ...order }),
      })
      const data = await resp.json()
      return data ?? { status: 'error', reason: `桥返回空 ${resp.status}` }
    } catch (e) {
      return { status: 'not_connected', reason: `miniQMT 桥不可达：${e?.message}` }
    }
  }

  async cancelOrder(orderId) {
    if (this.mode === 'mock') return { status: 'cancelled', orderId }
    try {
      const resp = await fetch(`${this.bridgeUrl}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId }),
      })
      return resp.json()
    } catch (e) {
      return { status: 'not_connected', reason: e?.message }
    }
  }

  async getPositions() {
    if (this.mode === 'mock') return []
    try {
      const resp = await fetch(`${this.bridgeUrl}/positions`)
      return resp.json()
    } catch { return [] }
  }
}