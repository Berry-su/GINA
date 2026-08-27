#!/usr/bin/env python3
"""
同花顺·迅投 miniQMT 下单桥（运行在 Windows）

把 Gina(Mac·Node) 的 HTTP 下单请求翻译成 xtquant (miniQMT) 的真实下单。
启动前请确认：
  1) Windows 已安装同花顺·迅投 miniQMT 终端并登录资金账号；
  2) 已 pip install xtquant（或使用迅投自带的 xtquant 包）；
  3) 券商已开通量化/程序化交易权限。

用法：
  python miniqmt-bridge.py --port 18880 --account 你的资金账号 --path D:/迅投/miniQMT

接口（供 Gina MiniQMTBrokerAdapter 调用）：
  POST /order     {accountId, symbol, side:buy|sell, size, price}  -> 下单
  POST /cancel    {orderId}                                       -> 撤单
  GET  /positions -> 查询持仓
  GET  /account   -> 查询资金
"""

import argparse
import json
from http.server import BaseHTTPRequestHandler, HTTPServer

# xtquant 在 Windows miniQMT 环境才可用；此处延后导入，便于本文件在 Mac 上也能被 Git 管理/阅读。
xttrader = None
xtconstant = None
STOCK_BUY = 23
STOCK_SELL = 24


def init_xtquant(path):
    """初始化 xtquant 连接（仅在 Windows + miniQMT 环境可执行）。"""
    global xttrader, xtconstant, STOCK_BUY, STOCK_SELL
    import sys
    sys.path.append(path)
    from xtquant import xttrader as _xttrader, xtconstant as _xtconstant
    xttrader = _xttrader
    xtconstant = _xtconstant
    STOCK_BUY = xtconstant.STOCK_BUY
    STOCK_SELL = xtconstant.STOCK_SELL


class Bridge(object):
    def __init__(self, account, path):
        self.account = account
        if path:
            init_xtquant(path)

    def order(self, body):
        # TODO: 用 xttrader 真实下单；下面为待接入的骨架
        # order_id = xttrader.order_stock(account, body['symbol'],
        #     STOCK_BUY if body['side'] == 'buy' else STOCK_SELL,
        #     int(body.get('size') or 0),
        #     xtconstant.FIX_PRICE, float(body.get('price') or 0), 'gina', 'attacker')
        return {"status": "not_connected", "reason": "请在 Windows miniQMT 环境补齐 xtquant 下单逻辑"}

    def cancel(self, body):
        # xttrader.cancel_order_stock(account, int(body['orderId']))
        return {"status": "not_connected", "reason": "待接入"}

    def positions(self):
        return []

    def account(self):
        return None


class Handler(BaseHTTPRequestHandler):
    bridge = None

    def _send(self, obj, code=200):
        data = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _body(self):
        n = int(self.headers.get('Content-Length', 0))
        raw = self.rfile.read(n) if n else b'{}'
        try:
            return json.loads(raw.decode('utf-8'))
        except Exception:
            return {}

    def do_POST(self):
        body = self._body()
        if self.path == '/order':
            self._send(self.bridge.order(body))
        elif self.path == '/cancel':
            self._send(self.bridge.cancel(body))
        else:
            self._send({"status": "error", "reason": "unknown path"}, 404)

    def do_GET(self):
        if self.path == '/positions':
            self._send(self.bridge.positions())
        elif self.path == '/account':
            self._send(self.bridge.account())
        else:
            self._send({"status": "error", "reason": "unknown path"}, 404)

    def log_message(self, *args):
        pass


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--port', type=int, default=18880)
    p.add_argument('--account', default='')
    p.add_argument('--path', default='', help='miniQMT 安装路径（用于导入 xtquant）')
    args = p.parse_args()

    Handler.bridge = Bridge(args.account, args.path)
    srv = HTTPServer(('0.0.0.0', args.port), Handler)
    print(f'miniQMT bridge listening on :{args.port}')
    srv.serve_forever()