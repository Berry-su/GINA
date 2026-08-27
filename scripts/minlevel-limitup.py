#!/usr/bin/env python3
"""
分钟级「能不能买进」真实成交验证（baostock 5 分钟线，免费无积分）

思路：日线能判断「涨停了」，但判断「这板排不排得上（能不能买进）」，必须看分钟线。
用 5 分钟线重建每个涨停的「炸板次数」：
  - 炸板次数 == 0 且首封早（一字/强封）→ 封死，买不进；
  - 炸板次数 > 0（盘中打开过）→ 有机会在涨停价买进（真实成交）。

只对主板（10% 涨跌停）做个位数、妖股级小样本验证。
输出：可买 vs 不可买 的次日开盘收益/连板率，以及「乐观(全部能买) vs 真实(只买炸板回封)」满仓滚动能否 10 倍。
"""

import sys
import baostock as bs

POOL = [
    ('600776', '东方通信'),
    ('000957', '中通客车'),
    ('002432', '九安医疗'),
    ('002771', '真视通'),
    ('000592', '平潭发展'),
]
START, END = '2020-01-01', '2023-12-31'
LIMIT = 0.10


def prefix(code):
    return 'sh.' + code if code.startswith('6') else 'sz.' + code


def login():
    lg = bs.login()
    if lg.error_code != '0':
        print('baostock 登录失败', lg.error_msg)
        sys.exit(1)


def _f(x, default=0.0):
    try:
        v = float(x)
        return v
    except (TypeError, ValueError):
        return default


def daily_bars(code):
    rs = bs.query_history_k_data_plus(
        prefix(code), 'date,open,high,low,close,preclose,volume,amount,turn,pctChg',
        start_date=START, end_date=END, frequency='d', adjustflag='3')
    rows = []
    while rs.error_code == '0' and rs.next():
        r = rs.get_row_data()
        if not r[4] or not r[5]:
            continue  # 停牌/空值日跳过
        rows.append({
            'date': r[0], 'open': _f(r[1]), 'high': _f(r[2]), 'low': _f(r[3]),
            'close': _f(r[4]), 'preclose': _f(r[5]), 'pctChg': _f(r[9]) / 100,
        })
    return rows


def minute_bars(code, date):
    """某日 5 分钟线（date 已为 'YYYY-MM-DD'；time 字段形如 20230301093500000）。"""
    rs = bs.query_history_k_data_plus(
        prefix(code), 'date,time,open,high,low,close',
        start_date=date, end_date=date, frequency='5', adjustflag='3')
    bars = []
    while rs.error_code == '0' and rs.next():
        r = rs.get_row_data()
        bars.append({
            'time': r[1][8:14],  # HHMMSS
            'open': float(r[2]), 'high': float(r[3]), 'low': float(r[4]), 'close': float(r[5]),
        })
    return bars


def limit_price(preclose):
    return round(preclose * (1 + LIMIT), 2)


def classify_limitup(minutes, lim):
    """返回 (炸板次数, 首封HHMM, 一字)。"""
    if not minutes:
        return 0, '', False
    first_seal = None
    breaks = 0
    sealed = False
    for m in minutes:
        at_limit = m['close'] >= lim - 0.001 or m['high'] >= lim - 0.001
        if at_limit and first_seal is None:
            first_seal = m['time'][:4]
            sealed = True
        elif sealed and m['close'] < lim - 0.001:
            breaks += 1
            sealed = False
        elif not sealed and m['close'] >= lim - 0.001:
            sealed = True
    yi_zi = first_seal is not None and all(m['close'] >= lim - 0.001 and m['open'] >= lim - 0.001 for m in minutes)
    return breaks, first_seal or '', yi_zi


def main():
    login()
    print(f'小样本：{len(POOL)} 只妖股 · {START}~{END} · 主板 10% 涨停\n')

    buyable = []   # 真实可买（炸板回封）
    notbuyable = []  # 买不进（一字/强封）
    all_events = []  # 乐观（全部非一字）
    lim = None

    for code, name in POOL:
        bars = daily_bars(code)
        # 按日期建次日开盘映射
        nxt = {}
        for i in range(len(bars) - 1):
            nxt[bars[i]['date']] = bars[i + 1]['open']
        cnt = 0
        for b in bars:
            lim = limit_price(b['preclose'])
            if b['close'] < lim - 0.001:
                continue  # 非涨停
            cnt += 1
            minutes = minute_bars(code, b['date'])
            breaks, first_seal, yi_zi = classify_limitup(minutes, lim)
            next_open = nxt.get(b['date'])
            rec = {
                'code': code, 'name': name, 'date': b['date'],
                'next_open': next_open, 'close': b['close'],
                'breaks': breaks, 'first_seal': first_seal, 'yi_zi': yi_zi,
            }
            all_events.append(rec)
            if breaks > 0:
                buyable.append(rec)
            else:
                notbuyable.append(rec)
        print(f'  {name}({code}) 涨停 {cnt} 天')

    def stats(evs):
        if not evs:
            return 0, 0, 0
        n = len(evs)
        ok = [e for e in evs if e['next_open'] is not None]
        if not ok:
            return n, 0, 0
        rets = [e['next_open'] / e['close'] - 1 for e in ok]
        avg = sum(rets) / len(rets)
        cont = sum(1 for e in ok if e['next_open'] is not None and e['next_open'] / e['close'] - 1 >= 0.095)
        return n, avg, cont / len(ok)

    def compound(evs):
        eq = 2000.0
        for e in evs:
            if e['next_open'] is None:
                continue
            eq *= e['next_open'] / e['close']
        return eq

    print('\n' + '=' * 70)
    print('  涨停成交性质对比（次日开盘卖）')
    print('=' * 70)
    nb, ab, cb = stats(notbuyable)
    nb_avg = ab  # 不可买平均
    yb, yavg, ycont = stats(buyable)
    print(f'  不可买(一字/强封): {nb} 次 | 次日开盘均 {nb_avg*100:+.2f}% | 连板率 {cb*100:.1f}%')
    print(f'  可买(炸板回封):   {yb} 次 | 次日开盘均 {yavg*100:+.2f}% | 连板率 {ycont*100:.1f}%')

    eq_all = compound(all_events)
    eq_buy = compound(buyable)
    print('\n  满仓滚动（2000 → ?）：')
    print(f'    乐观(全部非一字能买): {eq_all:,.0f}（{eq_all/2000:.1f} 倍）')
    print(f'    真实(只买炸板回封):   {eq_buy:,.0f}（{eq_buy/2000:.1f} 倍）')
    print('=' * 70)

    bs.logout()


if __name__ == '__main__':
    main()