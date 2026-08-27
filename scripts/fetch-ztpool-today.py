#!/usr/bin/env python3
"""拉取当日涨停池里的「低价 + 连板」短炒标的 → data/ztpool-today.json。

用途：候选池补充通道。题材→龙头映射会漏掉当天真正在连板的低价小票，
这里用 AKShare 涨停池补一份「低价(<10元) + 连板(>=2)」的票，供 start-trading 合并进候选打分。

失败/非交易日静默返回空，不影响主流程。
"""
import json
import sys
from datetime import date

import akshare as ak


def main():
    day = date.today().isoformat().replace('-', '')
    try:
        df = ak.stock_zt_pool_em(date=day)
    except Exception as e:
        print(f'ztpool fetch err: {repr(e)[:120]}', file=sys.stderr)
        with open('data/ztpool-today.json', 'w', encoding='utf-8') as f:
            json.dump([], f)
        return

    out = []
    if df is not None and len(df):
        for _, r in df.iterrows():
            price = float(r.get('最新价') or 0)
            streak = int(r.get('连板数') or 0)
            if price <= 0 or streak < 2 or price >= 10:
                continue
            code = str(r.get('代码', '')).zfill(6)
            float_mv = float(r.get('流通市值') or 0) / 1e8  # 元 → 亿元
            out.append({
                'code': code,
                'name': str(r.get('名称', '')).strip(),
                'price': price,
                'streak': streak,
                'breakTimes': int(r.get('炸板次数') or 0),
                'turnover': float(r.get('换手率') or 0),
                'floatMcap': round(float_mv, 2),
                'industry': str(r.get('所属行业', '')),
            })

    with open('data/ztpool-today.json', 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False)
    print('ztpool-today:', len(out), '只低价连板')


if __name__ == '__main__':
    main()
