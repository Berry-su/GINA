#!/usr/bin/env python3
"""
A股历史涨停池拉取（AKShare → 东财），输出 JSON，用于「真实成交」打板回测。

涨停池含分钟级关键字段，是判定「能不能买进」的依据：
  - 炸板次数：>0 表示盘中打开过 → 有机会买入；==0 且首封时间早（一字/秒封）→ 买不进；
  - 首次封板时间 / 最后封板时间；
  - 封板资金、连板数、换手率、流通市值 → 直接喂给「短线攻击手」打分。

用法：
  python3 scripts/akshare-ztpool-fetch.py --start 2023-01-01 --end 2023-12-31 --out data/ztpool.json

注意：本接口底层是东方财富，若被限流会返回空，需换出口 IP（Clash 切换节点）或等限流恢复。
"""

import argparse
import json
import sys

import akshare as ak
import baostock as bs


def trading_days(start, end):
    """用 baostock 交易日历拿交易日列表（YYYYMMDD）。"""
    lg = bs.login()
    if lg.error_code != '0':
        return []
    rs = bs.query_trade_dates(start_date=start, end_date=end)
    days = []
    while rs.error_code == '0' and rs.next():
        # [calendar_date, is_trading_day]
        row = rs.get_row_data()
        if row[1] == '1':
            days.append(row[0].replace('-', ''))
    bs.logout()
    return days


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--start', default='2023-01-01')
    p.add_argument('--end', default='2023-12-31')
    p.add_argument('--out', default='data/ztpool.json')
    args = p.parse_args()

    days = trading_days(args.start, args.end)
    print(f'交易日 {len(days)} 个')

    # 东财涨停池标准列名（待首次成功运行后按实际列名校对）
    COLS = {
        'code': '代码', 'name': '名称', 'pct': '涨跌幅', 'price': '最新价',
        'amount': '成交额', 'float_mv': '流通市值', 'total_mv': '总市值',
        'turnover': '换手率', 'seal_money': '封板资金',
        'first_seal': '首次封板时间', 'last_seal': '最后封板时间',
        'break_times': '炸板次数', 'streak': '连板数', 'industry': '所属行业',
    }

    out = {}
    empty = 0
    for i, d in enumerate(days):
        try:
            df = ak.stock_zt_pool_em(date=d)
        except Exception as e:
            print(f'  {d} 报错: {repr(e)[:80]}')
            empty += 1
            continue
        if df is None or len(df) == 0:
            empty += 1
            continue
        rows = []
        for _, r in df.iterrows():
            rows.append({
                'code': str(r.get(COLS['code'], '')).zfill(6),
                'name': r.get(COLS['name'], ''),
                'pct': r.get(COLS['pct'], None),
                'turnover': r.get(COLS['turnover'], None),
                'floatMv': r.get(COLS['float_mv'], None),
                'sealMoney': r.get(COLS['seal_money'], None),
                'firstSeal': r.get(COLS['first_seal'], None),
                'lastSeal': r.get(COLS['last_seal'], None),
                'breakTimes': r.get(COLS['break_times'], None),
                'streak': r.get(COLS['streak'], None),
            })
        out[d] = rows
        if (i + 1) % 20 == 0:
            print(f'  ...{i + 1}/{len(days)}  空 {empty}')

    with open(args.out, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False)
    print(f'完成：空 {empty}/{len(days)}，写入 {args.out}')


if __name__ == '__main__':
    main()