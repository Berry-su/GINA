// tool-self-create framework barrel export.
//
// Public surface:
//   - ToolSpec:      validateSpec, validateSchema, validateTestCase, createSpec,
//                    specHash, isCompatibleVersion, assessRisk
//   - ToolGenerator: generate, buildPrompt, stripCodeFences
//   - ToolValidator: validateAll, gateSchema, gateSourceSafety, gateResourceLimits,
//                    suggestCanaryPercent
//   - ToolRegistry:  register, get, getVersion, listTools,
//                    advanceCanary, rollback, deprecate, disable,
//                    recordCall,
//                    defaultRegistry, loadRegistry, saveRegistry
//   - ToolEvolution: detectGap, shouldUpgrade, shouldDeprecate, evaluate,
//                    recordFailure, failureCount,
//                    defaultState, loadState, saveState
//   - Constants:     DANGEROUS_PATTERNS, FORBIDDEN_NET_HOSTS,
//                    DEFAULT_CANARY_PERCENTS, DEFAULT_FAILURE_THRESHOLD

export {
  validateSpec,
  validateSchema,
  validateTestCase,
  createSpec,
  specHash,
  isCompatibleVersion,
  assessRisk,
  NAME_REGEX,
  VERSION_REGEX,
  VALID_TYPES,
  VALID_SIDE_EFFECTS,
} from './tool-spec.js'

export {
  generate,
  buildPrompt,
  stripCodeFences,
  MAX_PROMPT_LEN,
  MAX_SOURCE_LEN,
} from './tool-generator.js'

export {
  validateAll,
  gateSchema,
  gateSourceSafety,
  gateResourceLimits,
  suggestCanaryPercent,
  DANGEROUS_PATTERNS,
  FORBIDDEN_NET_HOSTS,
} from './tool-validator.js'

export {
  register,
  get,
  getVersion,
  listTools,
  advanceCanary,
  rollback,
  deprecate,
  disable,
  recordCall,
  defaultRegistry,
  loadRegistry,
  saveRegistry,
  DEFAULT_CANARY_PERCENTS,
  DEFAULT_CANARY_MIN_CALLS,
  DEFAULT_CANARY_MAX_ERROR_RATE,
} from './tool-registry.js'

export {
  detectGap,
  shouldUpgrade,
  shouldDeprecate,
  evaluate,
  recordFailure,
  failureCount,
  defaultState as defaultEvolutionState,
  loadState as loadEvolutionState,
  saveState as saveEvolutionState,
  assessRisk as assessRiskFromEvolution,
  DEFAULT_FAILURE_THRESHOLD,
  DEFAULT_RECENT_WINDOW_MS,
  DEFAULT_USAGE_FLOOR,
} from './tool-evolution.js'
