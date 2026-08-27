#!/usr/bin/env python3
"""读取 data/eval-codes.json（题材池全部候选代码），拉 baostock 全历史日线（后复权）→ data/eval-klines.json。

用于回看器 eval-lead-lag.mjs 计算「标记日 → 后续 N 日涨幅」。
"""
import json
import baostock as bs


def prefix(c):
    return 'sh.' + c if c.startswith(('6', '9')) else 'sz.' + c


def main():
    with open('data/eval-codes.json', encoding='utf-8') as f:
        codes = json.load(f)  # [{code, name}]

    bs.login()
    out = {}
    for c in codes:
        code, name = c['code'], c['name']
        rs = bs.query_history_k_data_plus(
            prefix(code), 'date,open,close,pctChg',
            start_date='2024-01-01', end_date='2026-12-31',
            frequency='d', adjustflag='3')
        bars = []
        while rs.error_code == '0' and rs.next():
            r = rs.get_row_data()
            close = float(r[2]) if r[2] else 0
            if close <= 0:
                continue
            bars.append({
                'date': r[0].replace('-', ''),
                'open': float(r[1]) if r[1] else 0,
                'close': close,
                'pctChg': float(r[3]) / 100 if r[3] else 0,
            })
        out[code] = {'name': name, 'bars': bars}
    bs.logout()
    with open('data/eval-klines.json', 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False)
    print('fetched codes:', len(out), 'bars:', {k: len(v['bars']) for k, v in out.items()})


if __name__ == '__main__':
    main()