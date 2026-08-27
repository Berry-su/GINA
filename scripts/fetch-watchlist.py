#!/usr/bin/env python3
"""拉取「信息题材 → 个股候选」的龙头行情（baostock 免费），供打分选股。"""

import json
import baostock as bs

WATCH = {
    '600988': '赤峰黄金', '601899': '紫金矿业', '601398': '工商银行',
    '300418': '昆仑万维', '002230': '科大讯飞', '688256': '寒武纪',
    '600030': '中信证券', '601066': '中信建投', '600036': '招商银行',
}


def prefix(c):
    return 'sh.' + c if c.startswith(('6', '9')) else 'sz.' + c


def main():
    bs.login()
    out = {}
    for code, name in WATCH.items():
        rs = bs.query_history_k_data_plus(
            prefix(code), 'date,close,preclose,amount,turn,pctChg',
            start_date='2025-06-01', end_date='2026-08-20', frequency='d', adjustflag='3')
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
            })
        out[code] = {'name': name, 'bars': bars}
    bs.logout()
    with open('data/watchlist-klines.json', 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False)
    print('done:', {k: len(v['bars']) for k, v in out.items()})


if __name__ == '__main__':
    main()