#!/usr/bin/env python3
"""
深挖真 alpha：在「真实可买（炸板回封）」的涨停里，用分钟级特征分辨「次日涨 vs 跌」。

免费数据：data/baostock-klines.json（49 支随机样本）+ baostock 5 分钟线重建：
  - 首封时间（首次封板 HHMM）
  - 最后封板时间（回封 HHMM）
  - 炸板次数（盘中打开次数）
  - 收盘是否封住
  - 连板数

对每个分钟级特征做单因子 alpha 检验（次日开盘卖收益 / 胜率），找哪个特征能把「买得进」的
涨停里「次日继续涨」的那批挑出来。
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


def fetch_minutes(code, date):
    d = f'{date[:4]}-{date[4:6]}-{date[6:8]}'
    rs = bs.query_history_k_data_plus(
        prefix(code), 'time,open,high,low,close',
        start_date=d, end_date=d, frequency='5', adjustflag='3')
    bars = []
    while rs.error_code == '0' and rs.next():
        r = rs.get_row_data()
        bars.append({'time': r[0][8:14], 'close': float(r[4])})
    return bars


def minute_profile(minutes, lim):
    first_seal = None
    last_seal = None
    breaks = 0
    sealed = False
    for m in minutes:
        at_limit = m['close'] >= lim - 0.001
        if at_limit and not sealed:
            if first_seal is None:
                first_seal = m['time'][:4]
            sealed = True
            last_seal = m['time'][:4]
        elif not at_limit and sealed:
            breaks += 1
            sealed = False
    close_sealed = bool(minutes) and minutes[-1]['close'] >= lim - 0.001
    return first_seal, last_seal, breaks, close_sealed


def main():
    bs.login()
    data = json.load(open(POOL_FILE, encoding='utf-8'))
    klines = data['klines']

    evs = []
    for code, bars in klines.items():
        lim = limit_pct(code)
        bars = sorted(bars, key=lambda b: b['date'])
        for i, b in enumerate(bars):
            if b['pctChg'] < lim - 0.005:
                continue
            if i + 1 >= len(bars) or b['close'] <= 0:
                continue
            minutes = fetch_minutes(code, b['date'])
            first_seal, last_seal, breaks, close_sealed = minute_profile(minutes, limit_price(b['preClose'], lim))
            if breaks == 0:
                continue  # 只研究真实可买（盘中打开过）
            streak = 0
            k = i
            while k >= 0 and bars[k]['pctChg'] >= lim - 0.005:
                streak += 1
                k -= 1
            next_open = bars[i + 1]['open']
            evs.append({
                'ret': next_open / b['close'] - 1,
                'breaks': breaks,
                'first_seal': first_seal or '9999',
                'last_seal': last_seal or '0000',
                'close_sealed': close_sealed,
                'streak': streak,
            })

    print(f'真实可买（炸板回封）样本：{len(evs)} 次\n')

    def bucket(key, fn, labels):
        print(f'  ── 因子「{key}」──')
        for lab, cond in labels:
            sub = [e for e in evs if cond(e)]
            if not sub:
                print(f'    {lab:<14} n=0')
                continue
            avg = sum(e['ret'] for e in sub) / len(sub)
            win = sum(1 for e in sub if e['ret'] > 0) / len(sub)
            print(f'    {lab:<14} n={len(sub):<4} 次日开盘均 {avg*100:+6.2f}%  胜率 {win*100:5.1f}%')

    bucket('炸板次数', None, [
        ('炸1次', lambda e: e['breaks'] == 1),
        ('炸2次及以上', lambda e: e['breaks'] >= 2),
    ])
    bucket('首封时间', None, [
        ('早封(<10:00)', lambda e: e['first_seal'] < '1000'),
        ('中封(10-14)', lambda e: '1000' <= e['first_seal'] < '1400'),
        ('尾盘封(>=14)', lambda e: e['first_seal'] >= '1400'),
    ])
    bucket('收盘是否封住', None, [
        ('收盘封住', lambda e: e['close_sealed']),
        ('尾盘开板', lambda e: not e['close_sealed']),
    ])
    bucket('连板数', None, [
        ('首板', lambda e: e['streak'] == 1),
        ('2板及以上', lambda e: e['streak'] >= 2),
    ])

    # 组合：早封 + 炸1次 + 收盘封住
    combo = [e for e in evs if e['first_seal'] < '1000' and e['breaks'] == 1 and e['close_sealed']]
    if combo:
        avg = sum(e['ret'] for e in combo) / len(combo)
        win = sum(1 for e in combo if e['ret'] > 0) / len(combo)
        print(f'\n  组合(早封+炸1次+收盘封住): n={len(combo)} 次日开盘均 {avg*100:+.2f}% 胜率 {win*100:.1f}%')

    bs.logout()


if __name__ == '__main__':
    main()