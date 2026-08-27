#!/usr/bin/env python3
"""
回测「高弹性小票池 + 骑连板」（2020-2023，baostock 免费）
对照之前的「随机 49 股 → 骑连板 12.64 倍」：题材弹性池是信息选股的静态代理，看它能不能更高、更快。

入场：连板 run 的首个「可买涨停」（炸板回封，盘中打开过）。
出场：骑连板（持有到开板）vs 隔日卖；满仓滚；报告 倍数/耗时/最佳单月。
"""

import baostock as bs

POOL = [
    '600988', '002155', '000975', '600111', '300748',  # 美联储/利率 → 黄金/稀土
    '300229', '300364', '300624', '300418', '300781',  # AI 创业板小票
    '300661', '603986', '688536', '300567', '688120',  # 半导体弹性
    '300014', '300568', '002709', '300390', '300274',  # 新能源
    '300347', '300759', '300363', '300601', '688266',  # 医药
    '300059', '300033', '300803', '688318', '601136',  # 券商互金/次新
    '300699', '000733', '300777', '300775', '688122',  # 军工
    '600266', '002244', '600322', '000736', '600791',  # 地产小票
    '600256', '600938', '600470', '600295', '601699',  # 能源
]
START, END = '2020-01-01', '2023-12-31'


def prefix(c):
    return 'sh.' + c if c.startswith(('6', '9')) else 'sz.' + c


def limit_pct(c):
    return 0.20 if c.startswith(('30', '688')) else 0.10


def limit_price(pre, lim):
    return round(pre * (1 + lim), 2)


def daily(code):
    rs = bs.query_history_k_data_plus(prefix(code), 'date,open,close,preclose,amount,turn,pctChg',
        start_date=START, end_date=END, frequency='d', adjustflag='3')
    rows = []
    while rs.error_code == '0' and rs.next():
        r = rs.get_row_data()
        if not r[1] or not r[2]:
            continue
        rows.append({'date': r[0].replace('-', ''), 'open': float(r[1]), 'close': float(r[2]), 'preclose': float(r[3]),
                     'amount': float(r[4]) if r[4] else 0, 'turnover': float(r[5]) if r[5] else 0,
                     'pctChg': float(r[6]) / 100 if r[6] else 0})
    return rows


def breaks(code, date, lim):
    d = f'{date[:4]}-{date[4:6]}-{date[6:8]}'
    rs = bs.query_history_k_data_plus(prefix(code), 'time,close',
        start_date=d, end_date=d, frequency='5', adjustflag='3')
    sealed, brk = False, 0
    n = 0
    while rs.error_code == '0' and rs.next():
        r = rs.get_row_data()
        n += 1
        at = float(r[1]) >= lim - 0.001
        if at and not sealed:
            sealed = True
        elif not at and sealed:
            brk += 1
            sealed = False
    return brk, n


def main():
    bs.login()
    trades_ride, trades_sell = [], []
    for code in POOL:
        bars = daily(code)
        if len(bars) < 40:
            continue
        lim = limit_pct(code)
        for i, b in enumerate(bars):
            if b['pctChg'] < lim - 0.005:
                continue  # 非涨停
            if i + 1 >= len(bars):
                continue
            brk = breaks(code, b['date'].replace('-', ''), limit_price(b['preclose'], lim))[0]
            if brk == 0:
                continue  # 只买盘中打开过（真实可买）
            # 连板 run：首个可买涨停作为入场；骑到 run 结束后的开板日
            j = i + 1
            while j < len(bars) and bars[j]['pctChg'] >= lim - 0.005:
                j += 1
            exit_open = bars[j]['open'] if j < len(bars) else None
            day_open = bars[i + 1]['open']
            if exit_open is not None:
                trades_ride.append((b['close'], exit_open, b['date'], bars[j]['date'] if j < len(bars) else b['date']))
                trades_sell.append((b['close'], day_open, b['date'], bars[i + 1]['date']))

    def calc(ts):
        ts = sorted(ts, key=lambda t: t[2])
        eq = 2000.0
        for buy, sell, *_ in ts:
            eq *= sell / buy
        return eq

    def best_window(ts, ndays=30):
        from datetime import date
        ts = sorted(ts, key=lambda t: t[2])
        best = 1.0
        for i in range(len(ts)):
            start = date(int(ts[i][2][:4]), int(ts[i][2][4:6]), int(ts[i][2][6:8]))
            eq = 1.0
            for j in range(i, len(ts)):
                d = date(int(ts[j][3][:4]), int(ts[j][3][4:6]), int(ts[j][3][6:8]))
                if (d - start).days > ndays:
                    break
                eq *= ts[j][1] / ts[j][0]
                best = max(best, eq)
        return best

    def first_10x(ts):
        from datetime import date
        ts = sorted(ts, key=lambda t: t[2])
        if not ts:
            return None
        f = date(int(ts[0][2][:4]), int(ts[0][2][4:6]), int(ts[0][2][6:8]))
        eq = 2000.0
        for buy, sell, ed, xd in ts:
            eq *= sell / buy
            if eq >= 20000:
                d = date(int(xd[:4]), int(xd[4:6]), int(xd[6:8]))
                return (d - f).days
        return None

    print('=' * 64)
    print('  高弹性小票池 + 骑连板（2020-2023）')
    print('=' * 64)
    eq_ride = calc(trades_ride)
    eq_sell = calc(trades_sell)
    best30 = best_window(trades_ride, 30)
    t10 = first_10x(trades_ride)
    lines = [
        f'  真实可买入场：{len(trades_ride)} 次',
        f'  骑连板:  2000 → {eq_ride:,.0f}（{eq_ride/2000:.2f} 倍）',
        f'  隔日卖:  2000 → {eq_sell:,.0f}（{eq_sell/2000:.2f} 倍）',
        f'  最佳 30 天窗口（骑连板）: {best30:.2f} 倍',
        f'  首达 10 倍：{t10 if t10 is not None else "未达"} 天',
        f'  对照：随机 49 股骑连板 = 12.64 倍',
    ]
    for l in lines:
        print(l)
    with open('data/theme-attack-result.txt', 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')
    print('=' * 64)
    bs.logout()


if __name__ == '__main__':
    main()