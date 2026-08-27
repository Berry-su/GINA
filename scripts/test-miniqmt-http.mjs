/**
 * miniQMT 下单桥 · 模拟测试（研究下单桥 http 接口 + 模拟成交）
 * 起一个 mock HTTP 桥（18880），用 MiniQMTBrokerAdapter(mode='http') 打它，验证下单链路。
 * 真实 miniQMT 桥（scripts/miniqmt-bridge.py 在 Windows）换掉这个 mock 即可。
 */
import http from 'node:http'
import { MiniQMTBrokerAdapter } from '../src/finance-data-sources/broker.js'

// mock 桥：模拟 miniQMT 的 /order /cancel /positions 接口
const server = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', () => {
    let out = { status: 'error', reason: 'unknown' }
    try {
      if (req.method === 'POST' && req.url === '/order') {
        const o = JSON.parse(body || '{}')
        out = { status: 'filled', orderId: 'mock-' + Date.now(), symbol: o.symbol, side: o.side, size: o.size, price: o.price, reason: 'mock 桥成交' }
      } else if (req.method === 'POST' && req.url === '/cancel') {
        const o = JSON.parse(body || '{}')
        out = { status: 'cancelled', orderId: o.orderId }
      } else if (req.method === 'GET' && req.url === '/positions') {
        out = []
      } else if (req.method === 'GET' && req.url === '/account') {
        out = { cash: 2000 }
      }
    } catch (e) { out = { status: 'error', reason: e.message } }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(out))
  })
})

server.listen(18880, async () => {
  const broker = new MiniQMTBrokerAdapter({ mode: 'http', bridgeUrl: 'http://127.0.0.1:18880', accountId: 'DEMO' })
  console.log('未授权下单:', await broker.placeOrder({ symbol: '600776.SH', side: 'buy', size: 100, price: 12 }, { authorized: false }))
  console.log('授权下单:', await broker.placeOrder({ symbol: '600776.SH', side: 'buy', size: 100, price: 12 }, { authorized: true }))
  console.log('持仓:', await broker.getPositions())
  console.log('账户:', await broker.getAccount())
  server.close()
})