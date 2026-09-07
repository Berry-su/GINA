// keywords.js — 关键词提取工具（占位）
//
// 实际工程中应由调用方注入更强力的关键词提取逻辑（TF-IDF / 主题模型等）。
// 这里提供最基础版本，避免外部依赖。

export function extractKeywords(text, options = {}) {
  if (typeof text !== 'string') return []
  const budget = options.budget || 10
  const minLen = options.minLen || 2
  const maxLen = options.maxLen || 30
  return text
    .toLowerCase()
    .split(/[\s,。.!?！？；;：:、\n\r\t【】\[\]()（）"'`]+/)
    .filter(w => w.length >= minLen && w.length <= maxLen)
    .slice(0, budget)
}

// 占位导出（兼容老接口）
export const keywords = { extract: extractKeywords }
