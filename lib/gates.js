/**
 * 兼容层：门禁实现已经抽到独立包 `@mycf711/dsh-gate`（G1/G2）。
 *
 * 这里**只做 re-export**，不保留任何规则实现 —— 四层配置、确定性规则、
 * 语义复审、提示词润色全部由包提供，避免「两份实现各自漂移」。
 *
 * - 旧调用点（历史测试 / 外部脚本）继续 `import ... from './gates.js'` 就能工作；
 * - 主插件自己已经直接 `import ... from '@mycf711/dsh-gate'`，并在检查路径上
 *   优先用宿主注入的 `ctx.get('gate')`，缺失时才回退 `createGate()`。
 *
 * 新增能力请直接改包（`packages/dsh-gate/`），不要在这里补实现。
 */

export {
  // 现有调用面（与抽取前 lib/gates.js 的导出逐一对齐）
  loadGateConfig,
  lintText,
  semanticReview,
  optimizePrompt,
  listModels,
  readGateScope,
  writeGateConfig,
  validateConfig,
  normalizeConfig,
  mergeConfig,
  // GateProvider：宿主没有注入 ctx.get('gate') 时的回退实现
  createGate,
  // 路径常量（包内保留了旧导出名，符号级兼容）
  DEFAULT_GATE_PATH,
  USER_GATE_PATH,
  PROJECT_GATE_PATH,
  LOCAL_GATE_PATH,
} from '@mycf711/dsh-gate'
