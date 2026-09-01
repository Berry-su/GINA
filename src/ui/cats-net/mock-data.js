/**
 * CATS-Net 3D 概念图 · 模拟数据
 *
 * 形状与 backend `ConceptNode.getConceptSphereData()` 的输出一致:
 *   nodes: [{ id, name, level, type, activation, confidence, granularity }]
 *   edges: [{ source, target, weight, type, levelTransition }]
 *   layers: { episodic: { count, totalActivation, avgActivation }, semantic, abstract }
 *
 * 这一份是 mock:10 个概念 + 15 条边,主题围绕 GINA 真实业务(风险/题材/交易决策),
 * 用来验证 3D 布局、交互、HUD 控件、层过滤、激活阈值的功能面。后续由 gina-coder
 * 把 GET /api/cats-net/graph 接入到 backend 替换掉。
 */

export const MOCK_CONCEPTS = [
  // ── abstract 层:高度抽象的元概念 ────────────────────────────
  { id: 'c-risk',      name: 'risk',      level: 'abstract', type: 'abstract',  activation: 0.92, confidence: 0.95, granularity: 5 },
  { id: 'c-value',     name: 'value',     level: 'abstract', type: 'abstract',  activation: 0.74, confidence: 0.88, granularity: 5 },
  { id: 'c-momentum',  name: 'momentum',  level: 'abstract', type: 'abstract',  activation: 0.81, confidence: 0.79, granularity: 4 },

  // ── semantic 层:通用语义概念 ───────────────────────────────
  { id: 'c-stock',     name: 'stock',     level: 'semantic', type: 'entity',    activation: 0.88, confidence: 0.96, granularity: 3 },
  { id: 'c-volatility',name: 'volatility',level: 'semantic', type: 'attribute', activation: 0.65, confidence: 0.82, granularity: 3 },
  { id: 'c-rotation',  name: 'rotation',  level: 'semantic', type: 'action',    activation: 0.71, confidence: 0.75, granularity: 2 },

  // ── episodic 层:具体时间/事件绑定 ──────────────────────────
  { id: 'c-ztpool',    name: 'ztpool-2026-09-01', level: 'episodic', type: 'entity', activation: 0.94, confidence: 0.99, granularity: 1 },
  { id: 'c-zgcy',      name: 'zgcy-14:32',  level: 'episodic', type: 'entity',   activation: 0.83, confidence: 0.91, granularity: 1 },
  { id: 'c-slys',      name: 'slys-09:30',  level: 'episodic', type: 'entity',   activation: 0.77, confidence: 0.84, granularity: 1 },
  { id: 'c-zsza',      name: 'zsza-15:00',  level: 'episodic', type: 'entity',   activation: 0.69, confidence: 0.78, granularity: 1 },
]

export const MOCK_EDGES = [
  // abstract → semantic (跨层向下,语义支撑)
  { source: 'c-risk',     target: 'c-volatility', weight: 0.92, type: 'causal',       levelTransition: 0.3 },
  { source: 'c-value',    target: 'c-stock',      weight: 0.78, type: 'hierarchical', levelTransition: 0.3 },
  { source: 'c-momentum', target: 'c-rotation',   weight: 0.85, type: 'causal',       levelTransition: 0.3 },

  // semantic ↔ semantic (同层语义关联)
  { source: 'c-stock',     target: 'c-volatility', weight: 0.71, type: 'association', levelTransition: 1.0 },
  { source: 'c-volatility',target: 'c-rotation',   weight: 0.66, type: 'causal',       levelTransition: 1.0 },
  { source: 'c-rotation',  target: 'c-stock',      weight: 0.59, type: 'association', levelTransition: 1.0 },

  // semantic → episodic (抽象到具体实例)
  { source: 'c-stock',     target: 'c-ztpool',    weight: 0.95, type: 'hierarchical', levelTransition: 0.5 },
  { source: 'c-stock',     target: 'c-zgcy',      weight: 0.87, type: 'hierarchical', levelTransition: 0.5 },
  { source: 'c-stock',     target: 'c-slys',      weight: 0.82, type: 'hierarchical', levelTransition: 0.5 },
  { source: 'c-stock',     target: 'c-zsza',      weight: 0.76, type: 'hierarchical', levelTransition: 0.5 },

  // episodic ↔ episodic (同事件层关联,实线因果)
  { source: 'c-ztpool',    target: 'c-zgcy',      weight: 0.93, type: 'causal',       levelTransition: 1.0 },
  { source: 'c-ztpool',    target: 'c-slys',      weight: 0.74, type: 'causal',       levelTransition: 1.0 },
  { source: 'c-ztpool',    target: 'c-zsza',      weight: 0.68, type: 'causal',       levelTransition: 1.0 },

  // abstract → episodic (跨层大跳跃,虚线示意)
  { source: 'c-risk',      target: 'c-ztpool',    weight: 0.81, type: 'association', levelTransition: 0.2 },
  { source: 'c-momentum',  target: 'c-zgcy',      weight: 0.73, type: 'causal',       levelTransition: 0.2 },

  // 局部反向
  { source: 'c-volatility',target: 'c-zsza',      weight: 0.62, type: 'causal',       levelTransition: 0.5 },
]

/** 计算 layer stats(跟 backend getConceptSphereData() 的 layers 字段同构) */
export function computeLayerStats(nodes) {
  const stats = { abstract: { count: 0, totalActivation: 0, avgActivation: 0 },
                  semantic: { count: 0, totalActivation: 0, avgActivation: 0 },
                  episodic: { count: 0, totalActivation: 0, avgActivation: 0 } }
  for (const n of nodes) {
    const s = stats[n.level]
    if (!s) continue
    s.count++
    s.totalActivation += n.activation
  }
  for (const k of Object.keys(stats)) {
    const s = stats[k]
    s.avgActivation = s.count > 0 ? s.totalActivation / s.count : 0
  }
  return stats
}
