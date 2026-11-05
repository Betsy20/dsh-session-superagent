/**
 * watchers.json 的显式 schema 迁移入口。
 *
 * 吸收官方 migration 的最小纪律：先迁移、再 normalize；未知未来版本拒绝；
 * 失败交给 readState 的 .bak 恢复，不把半新半旧的状态当成正常状态。
 * 这里只做我们实际需要的 v0 → v1，不搬 SQLite 迁移框架。
 */
export const CURRENT_STATE_SCHEMA = 1

export function migrateState(input) {
  const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
  const version = raw.schemaVersion === undefined ? 0 : Number(raw.schemaVersion)
  if (!Number.isInteger(version) || version < 0) throw new Error('invalid state schemaVersion: ' + String(raw.schemaVersion))
  if (version > CURRENT_STATE_SCHEMA) {
    throw new Error('state schemaVersion ' + version + ' is newer than supported ' + CURRENT_STATE_SCHEMA)
  }
  if (version === CURRENT_STATE_SCHEMA) return { state: raw, changed: false, from: version }
  // v0：没有 schemaVersion 的历史文件。保留所有已有字段，只补版本与必需容器。
  const state = {
    ...raw,
    schemaVersion: CURRENT_STATE_SCHEMA,
    watchers: raw.watchers && typeof raw.watchers === 'object' && !Array.isArray(raw.watchers) ? raw.watchers : {},
  }
  return { state, changed: true, from: version }
}
