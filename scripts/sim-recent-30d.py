#!/usr/bin/env python3
"""
Gina 近期 30 交易日短线模拟实战 v2 —— 全市场 + 多策略（baostock 免费近期行情）

把 v1 只做「打板弱封」的问题修掉：
  - 宇宙扩到全市场（不再 245 支抽样，抓全所有连板 run）；
  - 加入低吸 / 追涨，三策略并行，每日多个候选，不再只等弱封涨停；
  - 打板加「连板惯性」：只买 ≥2 板的炸板回封，避开孤立 1 板弱封。

策略（全部短线，T+1）：
  打板·骑连板 ：买入可成交涨停（炸板回封）收盘，持有到连板结束、首个非涨停日开盘卖；
  低吸·深跌反弹：买入当日大跌（pctChg ≤ -5%）的收盘，次日开盘卖（赌反弹）；
  追涨·突破    ：买入当日放量突破 5 日新高（4% ≤ pctChg < 涨停）的收盘，次日开盘卖（赌延续）。

真实成交：打板只买「非一字且盘中打开过(low<close)」；低吸/追涨按收盘价成交。
本金 10000，满仓单店（同时只持一支），往返成本 0.15%。
"""
import argparse
import json
import os
import re
import random

import baostock as bs

COST = 0.0015


def prefix(code):
    return 'sh.' + code if code.startswith('6') else 'sz.' + code


def limit_pct(code):
    return 0.20 if code.startswith(('30', '688')) else 0.10


def is_limit(b, lim):
    return b['pctChg'] >= lim - 0.005


def attacker_score(b, streak):
    s = 0
    p = b['close']
    if p < 5:
        s += 3
    elif p < 10:
        s += 2
    elif p < 20:
        s += 1
    mcap = (b['amount'] / (b['turnover'] / 100)) / 1e8 if b['turnover'] > 0 else 999
    if 30 <= mcap < 100:
        s += 2
    elif mcap < 30:
        s += 1
    to = b['turnover']
    if to > 20:
        s -= 2
    elif 5 <= to <= 10:
        s += 1
    if streak >= 2:
        s += 1
    s += 1  # 涨停
    return s


def fetch_universe(day):
    codes = []
    rs = bs.query_all_stock(day=day)
    while rs.error_code == '0' and rs.next():
        row = rs.get_row_data()
        code = row[0].split('.')[-1]
        trade_status = row[1] if len(row) > 1 else '1'
        if trade_status == '1' and re.match(r'^(60|00|30|68)', code):
            codes.append(code)
    return codes


def fetch_kline(code, start, end):
    rs = bs.query_history_k_data_plus(
        prefix(code), 'date,open,high,low,close,amount,turn,pctChg',
        start_date=start, end_date=end, frequency='d', adjustflag='3')
    bars = []
    while rs.error_code == '0' and rs.next():
        r = rs.get_row_data()

        def f(x):
            return float(x) if x else None
        bars.append({
            'date': r[0].replace('-', ''),
            'open': f(r[1]), 'high': f(r[2]), 'low': f(r[3]), 'close': f(r[4]),
            'amount': f(r[5]), 'turnover': f(r[6]),
            'pctChg': f(r[7]) / 100 if r[7] else 0,
        })
    return bars


def generate_events(klines, combat):
    """产出三类策略的事件：打板 / 低吸 / 追涨。每个事件含 entry/exit/buy/sell/prio。"""
    daban = {'all': [], 'inertia': []}
    dixi = []   # 低吸
    zhang = []  # 追涨

    for code, bars in klines.items():
        lim = limit_pct(code)
        N = len(bars)
        is_lim = [is_limit(b, lim) for b in bars]

        for i in range(N):
            b = bars[i]
            if b['date'] not in combat:
                continue

            # ── 打板（真实成交：炸板回封） ──
            if is_lim[i]:
                yi_zi = (b['open'] == b['high'] == b['low'] == b['close'])
                opened = (b['low'] is not None and b['close'] is not None and b['low'] < b['close'])
                if (not yi_zi) and opened:
                    streak = 0
                    k = i
                    while k >= 0 and is_lim[k]:
                        streak += 1
                        k -= 1
                    # 骑连板：run 结束后的首个非涨停日开盘
                    j = i
                    while j < N and is_lim[j]:
                        j += 1
                    if j < N:
                        ev = {
                            'entry': b['date'], 'buy': b['close'],
                            'exit': bars[j]['date'], 'sell': bars[j]['open'],
                            'code': code, 'streak': streak, 'prio': streak, 'score': attacker_score(b, streak),
                        }
                        daban['all'].append(ev)
                        if streak >= 2:
                            daban['inertia'].append(ev)

            # ── 低吸：当日深跌（≤ -5%），收盘买、次日开盘卖 ──
            if b['pctChg'] is not None and b['pctChg'] <= -0.05 and i + 1 < N:
                dixi.append({
                    'entry': b['date'], 'buy': b['close'],
                    'exit': bars[i + 1]['date'], 'sell': bars[i + 1]['open'],
                    'code': code, 'pct': b['pctChg'], 'prio': -b['pctChg'],  # 越深越优先
                })

            # ── 追涨：放量突破 5 日新高（4% ≤ pctChg < 涨停），收盘买、次日开盘卖 ──
            if i >= 5 and i + 1 < N and b['pctChg'] is not None:
                prev_high = max((bars[k]['close'] for k in range(i - 5, i) if bars[k]['close'] is not None), default=0)
                if 0.04 <= b['pctChg'] < lim - 0.005 and b['close'] is not None and b['close'] >= prev_high \
                        and (b['turnover'] or 0) >= 5:
                    zhang.append({
                        'entry': b['date'], 'buy': b['close'],
                        'exit': bars[i + 1]['date'], 'sell': bars[i + 1]['open'],
                        'code': code, 'pct': b['pctChg'], 'prio': b['pctChg'],  # 越强越优先
                    })

    return daban, dixi, zhang


def simulate(evs, use_prio=True):
    """满仓单店：按入场日排序，每日挑一个最优候选，重叠跳过，10000 起步复利。"""
    by_date = {}
    for e in evs:
        by_date.setdefault(e['entry'], []).append(e)
    days = sorted(by_date.keys())
    eq = 10000.0
    peak = eq
    dd = 0.0
    wins = 0
    used = 0
    last_exit = None
    for d in days:
        if last_exit is not None and d < last_exit:
            continue
        cands = by_date[d]
        e = max(cands, key=lambda x: (x['prio'] if use_prio else 0))
        ret = e['sell'] / e['buy'] - 1 - COST
        eq *= (1 + ret)
        peak = max(peak, eq)
        dd = max(dd, (peak - eq) / peak)
        if ret > 0:
            wins += 1
        used += 1
        last_exit = e['exit']
    winrate = wins / used if used else 0
    return {'n': used, 'eq': eq, 'winrate': winrate, 'dd': dd, 'candidates': len(evs)}


def simulate_smart(evs, threshold):
    """Gina 智能选股：只买攻击手打分达阈值的可买涨停，其余空仓等待（管住手）。"""
    q = [e for e in evs if e.get('score', 0) >= threshold]
    all_days = set(e['entry'] for e in evs)
    q_days = set(e['entry'] for e in q)
    by_date = {}
    for e in q:
        by_date.setdefault(e['entry'], []).append(e)
    days = sorted(by_date.keys())
    eq = 10000.0
    peak = eq
    dd = 0.0
    wins = 0
    used = 0
    last_exit = None
    for d in days:
        if last_exit is not None and d < last_exit:
            continue
        e = max(by_date[d], key=lambda x: (x.get('score', 0), x.get('streak', 0)))
        ret = e['sell'] / e['buy'] - 1 - COST
        eq *= (1 + ret)
        peak = max(peak, eq)
        dd = max(dd, (peak - eq) / peak)
        if ret > 0:
            wins += 1
        used += 1
        last_exit = e['exit']
    winrate = wins / used if used else 0
    wait_days = len(all_days) - len(q_days)  # 有涨停可打但选择空仓的天数
    return {'n': used, 'eq': eq, 'winrate': winrate, 'dd': dd, 'candidates': len(q), 'wait_days': wait_days}


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--sample', type=int, default=0, help='>0 时全市场随机抽样 N 支（0=全市场）')
    p.add_argument('--window', type=int, default=30)
    p.add_argument('--end', default='2026-08-21')
    p.add_argument('--start', default='2026-05-20')
    p.add_argument('--seed', type=int, default=20260822)
    args = p.parse_args()

    lg = bs.login()
    if lg.error_code != '0':
        print('登录失败', lg.error_msg)
        return
    print('baostock 登录成功')

    full = fetch_universe('2026-08-20')
    print(f'全市场（沪深主板/创业板/科创板）共 {len(full)} 支')
    if args.sample > 0:
        random.seed(args.seed)
        full = random.sample(full, min(args.sample, len(full)))
        print(f'→ 随机抽样 {len(full)} 支')

    cache = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'sim-recent-klines.json')
    klines = {}
    if os.path.exists(cache):
        klines = json.load(open(cache, encoding='utf-8'))
        print(f'从缓存加载 {len(klines)} 支（跳过拉取）')
    else:
        ok = 0
        for i, code in enumerate(full):
            try:
                bars = fetch_kline(code, args.start, args.end)
                if len(bars) >= 3:
                    klines[code] = sorted(bars, key=lambda b: b['date'])
                    ok += 1
            except Exception:
                pass
            if (i + 1) % 500 == 0:
                print(f'  ...{i + 1}/{len(full)} 有效 {ok}')
        bs.logout()
        print(f'拉取完成：有效 {len(klines)}/{len(full)} 支')
        with open(cache, 'w', encoding='utf-8') as f:
            json.dump(klines, f, ensure_ascii=False)
        print('已缓存 klines，下次直接加载')

    all_dates = set()
    for bars in klines.values():
        all_dates.update(b['date'] for b in bars)
    trade_days = sorted(all_dates)
    combat = set(trade_days[-args.window:]) if len(trade_days) > args.window else set(trade_days)
    print(f'行情覆盖 {len(trade_days)} 个交易日；实战窗口 = 最近 {len(combat)} 个交易日：{min(trade_days[-args.window:])}~{max(trade_days)}')

    daban, dixi, zhang = generate_events(klines, combat)

    def fmt(name, r):
        extra = f' 空仓{r["wait_days"]}天' if 'wait_days' in r else ''
        print(f'  {name:<26} 候选 {r["candidates"]:>5} | 实做 {r["n"]:>3} | 胜率 {r["winrate"]*100:>5.1f}% | 回撤 {r["dd"]*100:>5.1f}% | 10000→{r["eq"]:>12,.0f}（{r["eq"]/10000:.3f} 倍）{extra}')

    print('=' * 100)
    print(f'  近期 {len(combat)} 交易日短线模拟实战 · A/B 对比（本金 10000 · 满仓单店 · T+1 · 真实成交）')
    print('=' * 100)
    print('  【B组 · 机械无脑】')
    fmt('打板·骑连板(全部可买)', simulate(daban['all']))
    fmt('打板·骑连板(连板≥2)', simulate(daban['inertia']))
    print('  【A组 · Gina 智能选股】')
    fmt('打板·骑连板(打分≥4·管住手)', simulate_smart(daban['all'], 4))
    print('  【参照 · 非打板机械信号（已证负期望）】')
    fmt('低吸·深跌反弹', simulate(dixi))
    fmt('追涨·突破', simulate(zhang))

    print('\n  ── 打板·连板惯性 前 10 笔明细 ──')
    for e in sorted(daban['inertia'], key=lambda x: x['entry'])[:10]:
        ret = e['sell'] / e['buy'] - 1 - COST
        print(f'    {e["entry"]} {e["code"]} {e["streak"]}板 买{e["buy"]:.2f}→卖{e["sell"]:.2f} ({ret*100:+.1f}%)')
    print('=' * 96)


if __name__ == '__main__':
    main()