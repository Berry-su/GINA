#!/usr/bin/env python3
"""
免费 A 股历史数据拉取（baostock）→ 输出 JSON，供 Gina(Node) 的短线攻击手回测使用。
无需 token / 积分，baostock 免费登录。

用法：
  python3 scripts/baostock-fetch.py --n 50 --start 2020-01-01 --end 2023-12-31 \
      --out data/baostock-klines.json

输出结构：
  { "codes": ["600519", ...],
    "klines": { "600519": [ {date,open,close,high,low,amount,turnover,preClose,pctChg}, ... ] } }
   其中 pctChg 为小数（如 0.044），turnover 为 %（如 0.21）
"""

import argparse
import json
import random
import sys

import baostock as bs


def prefix(code):
    # 上交所=sh、深交所=sz
    return 'sh.' + code if code.startswith(('6', '9')) else 'sz.' + code


def fetch_universe(day):
    codes = []
    rs = bs.query_all_stock(day=day)
    while rs.error_code == '0' and rs.next():
        row = rs.get_row_data()
        # row: [code, tradeStatus, code_name]
        code = row[0].split('.')[-1]
        trade_status = row[1] if len(row) > 1 else '1'
        if trade_status == '1' and code.isdigit() and len(code) == 6:
            codes.append(code)
    return codes


def fetch_kline(code, start, end):
    rs = bs.query_history_k_data_plus(
        prefix(code),
        'date,open,high,low,close,preclose,volume,amount,turn,pctChg',
        start_date=start, end_date=end, frequency='d', adjustflag='3')
    bars = []
    while rs.error_code == '0' and rs.next():
        row = rs.get_row_data()
        # date,open,high,low,close,preclose,volume,amount,turn,pctChg
        o, h, l, c = row[1], row[2], row[3], row[4]
        pre = row[5]
        amount = row[7]
        turn = row[8]
        pct = row[9]
        bars.append({
            'date': row[0].replace('-', ''),
            'open': float(o) if o else None, 'close': float(c) if c else None,
            'high': float(h) if h else None, 'low': float(l) if l else None,
            'preClose': float(pre) if pre else None,
            'amount': float(amount) if amount else 0,
            'turnover': float(turn) if turn else 0,
            'pctChg': float(pct) / 100 if pct else 0,
        })
    return bars


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--n', type=int, default=50)
    p.add_argument('--start', default='2020-01-01')
    p.add_argument('--end', default='2023-12-31')
    p.add_argument('--out', default='data/baostock-klines.json')
    p.add_argument('--seed', type=int, default=20260822)
    p.add_argument('--day', default='2023-12-29', help='取全市场股票列表的交易日')
    args = p.parse_args()

    lg = bs.login()
    if lg.error_code != '0':
        print('baostock 登录失败:', lg.error_msg)
        sys.exit(1)
    print('baostock 登录成功')

    codes = fetch_universe(args.day)
    print(f'全市场股票数: {len(codes)}')
    random.seed(args.seed)
    sample = random.sample(codes, min(args.n, len(codes)))
    print(f'随机抽样 {len(sample)} 支，拉取历史日 K ...')

    klines = {}
    ok = 0
    for i, code in enumerate(sample):
        try:
            bars = fetch_kline(code, args.start, args.end)
            if bars:
                klines[code] = bars
                ok += 1
        except Exception as e:
            print(f'  {code} 失败: {e}')
        if (i + 1) % 10 == 0:
            print(f'  ...{i + 1}/{len(sample)}  有效 {ok}')

    bs.logout()

    with open(args.out, 'w', encoding='utf-8') as f:
        json.dump({'codes': list(klines.keys()), 'klines': klines}, f, ensure_ascii=False)

    print(f'完成：有效 {ok}/{len(sample)} 支，写入 {args.out}')


if __name__ == '__main__':
    main()