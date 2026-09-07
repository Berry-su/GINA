// arch-evolution framework barrel export.
//
// Public surface:
//   - arch-graph:    buildGraph, detectCycles, walkJsFiles, extractImports,
//                    resolveImport, classifyImport,
//                    getFanIn, getFanOut, getIncoming, getOutgoing
//   - arch-metrics:  computeAll, fileMetrics, nodeMetrics,
//                    deadCodeCandidates, hotPathCandidates, globalStats
//   - arch-analyzer: analyze
//   - arch-rewriter: applyProposal, applyProposals
//   - arch-controller: runArchAudit, buildReport, getArchOverview,
//                      defaultControllerState, loadControllerState,
//                      saveControllerState, resetForTest

export {
  buildGraph,
  detectCycles,
  walkJsFiles,
  extractImports,
  resolveImport,
  classifyImport,
  getFanIn,
  getFanOut,
  getIncoming,
  getOutgoing,
  ESM_EXTENSIONS,
  MAX_FILE_SIZE,
  MAX_FILES,
  IGNORE_DIRS,
} from './arch-graph.js'

export {
  computeAll,
  fileMetrics,
  nodeMetrics,
  deadCodeCandidates,
  hotPathCandidates,
  globalStats,
  DEFAULT_LIMITS,
} from './arch-metrics.js'

export {
  analyze,
} from './arch-analyzer.js'

export {
  applyProposal,
  applyProposals,
  AUTO_APPLY_TYPES,
  DRY_RUN_DEFAULT,
  MAX_RENAME_FILES,
} from './arch-rewriter.js'

export {
  runArchAudit,
  buildReport,
  getArchOverview,
  defaultControllerState,
  loadControllerState,
  saveControllerState,
  resetForTest,
} from './arch-controller.js'
