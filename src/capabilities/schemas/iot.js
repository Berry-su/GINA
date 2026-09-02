// src/capabilities/schemas/iot.js — IoT 工具 schema（ADR-012 · Phase 4）
//
// 2 个 tool 暴露给 LLM：
//   - query_iot   : 列 / 查 IoT 设备和场景
//   - control_iot : 控制 IoT 设备 / 跑 / 启 / 禁 场景
//
// 统一参数约定：
//   - action: 'list_devices' | 'get_device' | 'list_scenarios' | 'get_scenario' | 'status' | 'control' | 'run_scenario' | 'enable_scenario' | 'disable_scenario' | 'enable_all' | 'disable_all'
//   - provider: 'homekit' | 'mijia' | 'mqtt' | 'mock'
//
// emotion-isolation 严守（沿用 Phase 2/3）：
//   - tool 输出只走事实通道（"X 设备当前 Y 状态"），不触发 joy
//   - 控制操作必写 L2 memory + iot-audit
//   - LLM 拿到的 string 描述里不带 emotion 词

function buildParameters({ actions, extraProps = [] }) {
  const props = {
    action: {
      type: 'string',
      enum: actions,
      description: `Operation to perform. One of: ${actions.join(', ')}.`,
    },
    provider: {
      type: 'string',
      enum: ['mock', 'homekit', 'mijia', 'mqtt'],
      description: 'IoT provider. Defaults to env GINA_IOT_PROVIDER_* or "mock".',
    },
  }
  for (const p of extraProps) props[p.key] = p.schema
  return {
    type: 'object',
    properties: props,
    required: ['action'],
  }
}

export const iotSchemas = {
  query_iot: {
    type: 'function',
    function: {
      name: 'query_iot',
      description:
        'Inspect smart home devices (HomeKit / Mijia / MQTT) and automation scenarios. List devices, get device state, list scenarios, query status. Results are written to L2 episodic memory (auto-decay) for future CATS-Net concept recall. This tool returns pure fact data only and never influences the agent\'s internal state or decision path.',
      parameters: buildParameters({
        actions: ['list_devices', 'get_device', 'list_rooms', 'list_scenarios', 'get_scenario', 'status'],
        extraProps: [
          { key: 'deviceId', schema: { type: 'string', description: 'Device ID (get_device).' } },
          { key: 'scenarioId', schema: { type: 'string', description: 'Scenario ID (get_scenario).' } },
          { key: 'room', schema: { type: 'string', description: 'Filter by room (list_devices).' } },
          { key: 'type', schema: { type: 'string', description: 'Filter by type (list_devices): light, switch, ac, lock, sensor, curtain, fan, outlet, vacuum, thermostat, speaker, other.' } },
        ],
      }),
    },
  },

  control_iot: {
    type: 'function',
    function: {
      name: 'control_iot',
      description:
        'Control a smart home device (on/off, brightness, temperature, color, lock) or run / enable / disable an automation scenario. All control operations are written to L2 episodic memory AND to a persistent audit log. Use dryRun=true to preview without executing, and confirmed=true to mark user-approved actions. This tool returns pure fact data only and never influences the agent\'s internal state or decision path.',
      parameters: buildParameters({
        actions: ['control', 'run_scenario', 'enable_scenario', 'disable_scenario', 'enable_all', 'disable_all'],
        extraProps: [
          { key: 'deviceId', schema: { type: 'string', description: 'Target device ID (control).' } },
          { key: 'controlAction', schema: { type: 'string', description: 'Control action (control): on_off, set_brightness, set_color_temp, set_color, set_temperature, set_fan_speed, set_volume, lock, pause, resume.' } },
          { key: 'params', schema: { type: 'object', description: 'Action parameters (control). E.g. {on: true} or {brightness: 80} or {temperature: 24}.' } },
          { key: 'scenarioId', schema: { type: 'string', description: 'Scenario ID (run/enable/disable).' } },
          { key: 'dryRun', schema: { type: 'boolean', description: 'Dry-run mode (control/run_scenario). If true, only send preview notification; do not actually control devices. Default false.' } },
          { key: 'confirmed', schema: { type: 'boolean', description: 'User confirmed action (required for sensitive controls). Default false.' } },
        ],
      }),
    },
  },
}
