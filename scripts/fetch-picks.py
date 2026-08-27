#!/usr/bin/env python3
"""读取 data/picks-candidates.json（题材选出的候选代码），拉 baostock 行情 → data/picks-klines.json。"""

import json
import baostock as bs
from datetime import date


def prefix(c):
    return 'sh.' + c if c.startswith(('6', '9')) else 'sz.' + c


def main():
    with open('data/picks-candidates.json', encoding='utf-8') as f:
        cands = json.load(f)  # [{code, name}]

    bs.login()
    out = {}
    for c in cands:
        code, name = c['code'], c['name']
        rs = bs.query_history_k_data_plus(
            prefix(code), 'date,close,preclose,amount,turn,pctChg,peTTM,pbMRQ',
            start_date='2025-06-01', end_date=date.today().isoformat(), frequency='d', adjustflag='3')
        bars = []
        while rs.error_code == '0' and rs.next():
            r = rs.get_row_data()
            bars.append({
                'date': r[0].replace('-', ''),
                'close': float(r[1]) if r[1] else 0,
                'preclose': float(r[2]) if r[2] else 0,
                'amount': float(r[3]) if r[3] else 0,
                'turnover': float(r[4]) if r[4] else 0,
                'pctChg': float(r[5]) / 100 if r[5] else 0,
                'pe': float(r[6]) if r[6] else None,
                'pb': float(r[7]) if r[7] else None,
            })
        out[code] = {'name': name, 'bars': bars}
    bs.logout()
    with open('data/picks-klines.json', 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False)
    print('fetched:', {k: len(v['bars']) for k, v in out.items()})


if __name__ == '__main__':
    main()