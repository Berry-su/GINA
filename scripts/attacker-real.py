#!/usr/bin/env python3
"""
最终版：分钟级真实成交 + 短线攻击手选股 + 满仓滚动（baostock 免费，无 token/积分）

数据：data/baostock-klines.json（49 支随机样本，含日线 open/close/high/low/amount/换手率/pctChg）
分钟级：对每个涨停日拉 baostock 5 分钟线，重建「炸板次数」→ 判定真实可买（炸板>0，盘中打开过）。
选股：复用短线攻击手打分（低价+小盘+避天量换手+连板），对比「无差别 vs 带选股」的满仓滚终值。

结论三问：
  1) 真实成交（只买炸板回封）下，满仓滚能不能 10 倍？
  2) 加上攻击手选股，能不能把收益往上提？
"""

import json
import baostock as bs

POOL_FILE = 'data/baostock-klines.json'
THRESHOLD = 4


def prefix(code):
    return 'sh.' + code if code.startswith('6') else 'sz.' + code


def limit_pct(code):
    return 0.20 if code.startswith(('30', '688')) else 0.10


def limit_price(preclose, limit):
    return round(preclose * (1 + limit), 2)


def fetch_minutes(code, date_yyyymmdd):
    d = f'{date_yyyymmdd[:4]}-{date_yyyymmdd[4:6]}-{date_yyyymmdd[6:8]}'
    rs = bs.query_history_k_data_plus(
        prefix(code), 'time,open,high,low,close',
        start_date=d, end_date=d, frequency='5', adjustflag='3')
    bars = []
    while rs.error_code == '0' and rs.next():
        r = rs.get_row_data()
        bars.append({'time': r[0][8:14], 'open': float(r[1]), 'high': float(r[2]),
                     'low': float(r[3]), 'close': float(r[4])})
    return bars


def classify(minutes, lim):
    """返回炸板次数、是否一字。"""
    if not minutes:
        return 0, False
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
    yi_zi = first_seal is not None and all(m['open'] >= lim - 0.001 and m['close'] >= lim - 0.001 for m in minutes)
    return breaks, yi_zi


def attack_score(price, float_mv, turnover, streak):
    s = 0
    if price < 5: s += 3
    elif price < 10: s += 2
    elif price < 20: s += 1
    if 30 <= float_mv < 100: s += 2
    elif float_mv < 30: s += 1
    if turnover > 20: s -= 2
    elif 5 <= turnover <= 10: s += 1
    if streak >= 2: s += 1
    s += 1  # 涨停加成
    return s


def main():
    lg = bs.login()
    if lg.error_code != '0':
        print('登录失败', lg.error_msg)
        return

    data = json.load(open(POOL_FILE, encoding='utf-8'))
    klines = data['klines']
    print(f'池：{len(klines)} 支随机样本')

    events = []
    for code, bars in klines.items():
        lim = limit_pct(code)
        bars = sorted(bars, key=lambda b: b['date'])
        for i, b in enumerate(bars):
            if b['pctChg'] < lim - 0.005:
                continue  # 非涨停
            # 连板数
            streak = 0
            k = i
            while k >= 0 and bars[k]['pctChg'] >= lim - 0.005:
                streak += 1
                k -= 1
            minutes = fetch_minutes(code, b['date'])
            breaks, yi_zi = classify(minutes, limit_price(b['preClose'], lim))
            if breaks == 0:
                continue  # 只保留盘中打开过（真实可买）
            next_open = bars[i + 1]['open'] if i + 1 < len(bars) else None
            if next_open is None or b['close'] <= 0:
                continue
            float_mv = (b.get('amount') or 0) / ((b.get('turnover') or 0) / 100) / 1e8 if b.get('turnover') else 999
            price = b['close']
            turnover = b.get('turnover') or 0
            events.append({
                'code': code, 'date': b['date'], 'price': price,
                'floatMv': float_mv, 'turnover': turnover, 'streak': streak,
                'nextOpen': next_open, 'close': b['close'],
                'score': attack_score(price, float_mv, turnover, streak),
            })

    events.sort(key=lambda e: e['date'])
    print(f'真实可买（炸板回封）涨停：{len(events)} 次\n')

    def compound(evs):
        eq = 2000.0
        for e in evs:
            eq *= e['nextOpen'] / e['close']
        return eq

    def avg_ret(evs):
        if not evs:
            return 0
        r = [e['nextOpen'] / e['close'] - 1 for e in evs]
        return sum(r) / len(r)

    plain = events
    smart = [e for e in events if e['score'] >= THRESHOLD]

    print('=' * 66)
    print('  真实成交 · 满仓滚动（次日开盘必卖）')
    print('=' * 66)
    print(f'  无差别: {len(plain)} 次 | 均收益 {avg_ret(plain)*100:+.2f}% | 2000→{compound(plain):,.0f}（{compound(plain)/2000:.2f} 倍）')
    print(f'  带选股: {len(smart)} 次 | 均收益 {avg_ret(smart)*100:+.2f}% | 2000→{compound(smart):,.0f}（{compound(smart)/2000:.2f} 倍）')
    print('=' * 66)

    bs.logout()


if __name__ == '__main__':
    main()