/**
 * 兼容层：门禁实现已抽到 @mycf711/dsh-gate。
 *
 * 主插件内部仍按 `./gates.js` 导入，旧测试与第三方调用不需要改；
 * 新代码应直接依赖 `@mycf711/dsh-gate`。
 */
export {
  createGate,
  loadGateConfig,
  mergeConfig,
  normalizeConfig,
  lintText,
  validateConfig,
  readGateScope,
  writeGateConfig,
  DEFAULT_GATE_PATH,
  USER_GATE_PATH,
  PROJECT_GATE_PATH,
  LOCAL_GATE_PATH,
  semanticReview,
  optimizePrompt,
  listModels,
} from '@mycf711/dsh-gate'
