import styles from './TradingView.module.css'

/**
 * 股票交易看盘页面（由 Design Spec 确定性生成）
 * 风格：单色精密仪器
 */
export default function TradingView() {
  return (
    <div className={styles.root}>
    <section className={styles.node-panel-default}>
      <span className={styles.node-text-title}>{'MARKET WATCH'}</span>
      <span className={styles.node-text-label}>{'MONO PRECISION TERMINAL'}</span>
    </section>
    <section className={styles.node-panel-default}>
      <span className={styles.node-text-label}>{'WATCHLIST'}</span>
      <div className={styles.node-list-default}>
        <div className={styles.listItem} key={0}>{'AAPL'}</div>
        <div className={styles.listItem} key={1}>{'TSLA'}</div>
        <div className={styles.listItem} key={2}>{'NVDA'}</div>
        <div className={styles.listItem} key={3}>{'MSFT'}</div>
        <div className={styles.listItem} key={4}>{'AMZN'}</div>
        <div className={styles.listItem} key={5}>{'META'}</div>
        <div className={styles.listItem} key={6}>{'GOOGL'}</div>
      </div>
    </section>
    <section className={styles.node-panel-default}>
      <span className={styles.node-text-label}>{'PRICE CHART'}</span>
      <section className={styles.node-panel-metric}>
        <div className={styles.node-metric-up} data-tone="neutral">
          <span className={styles.metricLabel}>{''}</span>
          <span className={styles.metricValue}>{'184.36'}</span>
        </div>
        <div className={styles.node-metric-up} data-tone="neutral">
          <span className={styles.metricLabel}>{''}</span>
          <span className={styles.metricValue}>{'+3.42'}</span>
        </div>
      </section>
    </section>
    <section className={styles.node-panel-default}>
      <span className={styles.node-status-default} data-tone="neutral">● {'CONNECTED'}</span>
      <span className={styles.node-text-label}>{'UPDATED 09:41:23'}</span>
    </section>
    </div>
  )
}
