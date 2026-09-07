// emotion framework barrel.
//
// Public surface:
//   - JoyState (1 维, 向后兼容)
//   - EmotionState (5 维, 新)
//   - 单例 helpers: getJoyState, getEmotionState
//   - 重置 (test only): resetJoyStateForTest, resetEmotionStateForTest
//   - 渲染: JoyState.injectFor, EmotionState.injectFor
//   - 常量: JOY_CONSTANTS, EMOTION_CONSTANTS, DIMENSIONS, DIMENSION_IDS
//
// 隔离保证 (老板 9-07 拍板):
//   - emotion 不进任何 tool schema / system prompt 决策指令 / analyst 评分
//   - 唯一出口 = EmotionState.injectFor() / JoyState.injectFor() 注入 context 字符串
//   - 编译时 / 测试时验证 tool 链路拿不到 emotion 值

export {
  JoyState,
  getJoyState,
  resetJoyStateForTest,
  JOY_CONSTANTS,
} from './joy-state.js'

export {
  EmotionState,
  getEmotionState,
  resetEmotionStateForTest,
  EMOTION_CONSTANTS,
  EMOTION_SCHEMA_VERSION,
  DEFAULT_VALUE,
  DECAY_PER_24H,
  MAX_JUMP,
  DIMENSIONS,
  DIMENSION_IDS,
} from './emotion-state.js'
