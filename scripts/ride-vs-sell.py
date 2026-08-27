#!/usr/bin/env python3
"""
「骑连板 vs 隔日卖」分层回测（baostock 免费 5 分钟线）

入场：每个连板 run 的「首个可买涨停」（炸板回封＝盘中打开过，即真实能买到）。
退出两种：
  - 隔日卖：次日开盘必卖；
  - 骑连板：一路持有到连板结束，首个不再涨停的交易日开盘卖出（吃整段连板）。
再加选股子集：只买「炸 1 次回封」的首板。

目的：看允许她「骑连板」后，能否把真实成交的收益从 ~1.5 倍往上抬、触及 10 倍。
"""

import json
import baostock as bs

POOL_FILE = 'data/baostock-klines.json'


def prefix(code):
    return 'sh.' + code if code.startswith('6') else 'sz.' + code


def limit_pct(code):
    return 0.20 if code.startswith(('30', '688')) else 0.10


def limit_price(preclose, limit):
    return round(preclose * (1 + limit), 2)


def is_limit(b, lim):
    return b['pctChg'] >= lim - 0.005


def fetch_breaks(code, date, lim):
    d = f'{date[:4]}-{date[4:6]}-{date[6:8]}'
    rs = bs.query_history_k_data_plus(
        prefix(code), 'time,close', start_date=d, end_date=d, frequency='5', adjustflag='3')
    sealed = False
    breaks = 0
    while rs.error_code == '0' and rs.next():
        r = rs.get_row_data()
        at_limit = float(r[1]) >= lim - 0.001
        if at_limit and not sealed:
            sealed = True
        elif not at_limit and sealed:
            breaks += 1
            sealed = False
    return breaks


def main():
    bs.login()
    data = json.load(open(POOL_FILE, encoding='utf-8'))
    klines = data['klines']

    # 4 组合的交易日持仓交易：每笔 (买入收盘价, 卖出开盘价)
    combos = {
        '隔日卖·无差别': [],
        '隔日卖·炸1次': [],
        '骑连板·无差别': [],
        '骑连板·炸1次': [],
    }

    n_limits = 0
    for code, bars in klines.items():
        lim = limit_pct(code)
        bars = sorted(bars, key=lambda b: b['date'])

        # 标注每个涨停日的炸板次数
        for b in bars:
            if is_limit(b, lim):
                b['_breaks'] = fetch_breaks(code, b['date'], limit_price(b['preClose'], lim))
            else:
                b['_breaks'] = -1

        # 切分连板 run
        i = 0
        N = len(bars)
        while i < N:
            if bars[i]['_breaks'] < 0:
                i += 1
                continue
            run = [i]
            j = i + 1
            while j < N and bars[j]['_breaks'] >= 0:
                run.append(j)
                j += 1
            # 找 run 内首个可买（炸板>0）涨停作为入场
            entry = next((k for k in run if bars[k]['_breaks'] > 0), None)
            if entry is not None and entry + 1 < N:
                n_limits += 1
                buy_close = bars[entry]['close']
                entry_date = bars[entry]['date']
                # 隔日卖：次日开盘
                next_open = bars[entry + 1]['open']
                next_date = bars[entry + 1]['date']
                combos['隔日卖·无差别'].append((buy_close, next_open, entry_date, next_date))
                if bars[entry]['_breaks'] == 1:
                    combos['隔日卖·炸1次'].append((buy_close, next_open, entry_date, next_date))
                # 骑连板：run 结束后的首个非涨停日开盘
                last = run[-1]
                if last + 1 < N:
                    exit_open = bars[last + 1]['open']
                    exit_date = bars[last + 1]['date']
                    combos['骑连板·无差别'].append((buy_close, exit_open, entry_date, exit_date))
                    if bars[entry]['_breaks'] == 1:
                        combos['骑连板·炸1次'].append((buy_close, exit_open, entry_date, exit_date))
            i = j

    print(f'真实可买入场（首板炸板回封）：{n_limits} 次\n')

    def run_calc(trades):
        if not trades:
            return 0, 0, 0
        eq = 2000.0
        rets = [sell / buy - 1 for buy, sell, *_ in trades]
        for r in rets:
            eq *= (1 + r)
        avg = sum(rets) / len(rets)
        win = sum(1 for r in rets if r > 0) / len(rets)
        return eq, avg, win

    def time_report(trades):
        """返回 (日历跨度天数, 在仓交易日数, 首次达10倍时的日历天数)。"""
        ts = sorted(trades, key=lambda t: t[2])
        if not ts:
            return 0, 0, 0
        first_date = ts[0][2]
        last_date = ts[-1][3]
        from datetime import date
        f = date(int(first_date[:4]), int(first_date[4:6]), int(first_date[6:8]))
        l = date(int(last_date[:4]), int(last_date[4:6]), int(last_date[6:8]))
        span = (l - f).days
        hold_days = sum((date(int(t[3][:4]), int(t[3][4:6]), int(t[3][6:8])) - date(int(t[2][:4]), int(t[2][4:6]), int(t[2][6:8]))).days for t in ts)
        # 首次达 10 倍（20000）的日历天数
        eq = 2000.0
        tenx_days = None
        for buy, sell, ed, xd in ts:
            eq *= sell / buy
            if eq >= 20000 and tenx_days is None:
                d = date(int(xd[:4]), int(xd[4:6]), int(xd[6:8]))
                tenx_days = (d - f).days
        return span, hold_days, tenx_days

    def best_window(trades, ndays=30):
        """满仓滚里，任意连续交易（彼此不超 ndays 天）内侧的最大复利倍数。"""
        from datetime import date
        ts = sorted(trades, key=lambda t: t[2])
        n = len(ts)
        best = 1.0
        best_seg = None
        for i in range(n):
            start = date(int(ts[i][2][:4]), int(ts[i][2][4:6]), int(ts[i][2][6:8]))
            eq = 1.0
            j = i
            while j < n:
                d = date(int(ts[j][3][:4]), int(ts[j][3][4:6]), int(ts[j][3][6:8]))
                if (d - start).days > ndays:
                    break
                eq *= ts[j][1] / ts[j][0]
                if eq > best:
                    best = eq
                    best_seg = (ts[i][2], ts[j][3], j - i + 1)
                j += 1
        return best, best_seg

    print('=' * 66)
    print('  分层回测（满仓滚 · 2000 起步 · 次日/骑连板卖出）')
    print('=' * 66)
    for name, trades in combos.items():
        eq, avg, win = run_calc(trades)
        tenx = '✅ 达 10 倍' if eq >= 20000 else f'未到（{eq/2000:.2f} 倍）'
        print(f'  {name:<12} n={len(trades):<4} 均收益 {avg*100:+6.2f}% 胜率 {win*100:5.1f}% | 2000→{eq:,.0f}（{eq/2000:.2f} 倍）{tenx}')

    span, hold, tenxd = time_report(combos['骑连板·无差别'])
    span2, hold2, tenxd2 = time_report(combos['骑连板·炸1次'])
    print('\n  ── 耗时（骑连板） ──')
    print(f'  无差别: 日历跨度 {span} 天 | 在仓交易日约 {hold} 天 | 首次达10倍约 {tenxd if tenxd is not None else "未达"} 天')
    print(f'  炸1次: 日历跨度 {span2} 天 | 在仓交易日约 {hold2} 天 | 首次达10倍约 {tenxd2 if tenxd2 is not None else "未达"} 天')

    b30, b30_seg = best_window(combos['骑连板·无差别'], 30)
    b60, b60_seg = best_window(combos['骑连板·无差别'], 60)
    print('\n  ── 最佳单月/双月（骑连板·无差别，vs 你的 1 个月 10 倍纪录） ──')
    print(f'  最佳 30 天窗口: {b30:.2f} 倍  区间 {b30_seg}')
    print(f'  最佳 60 天窗口: {b60:.2f} 倍  区间 {b60_seg}')
    print('=' * 66)

    bs.logout()


if __name__ == '__main__':
    main()