// 契约快照：形状一变就红，而不是等客户调用失败。
//
// 与 routes.test.mjs 的分工：那边验「行为」（请求→响应），这边只验「形状」
// （有哪些工具、各有哪些参数、有哪些路由、inject 依赖）。
// 形状变更必须显式更新快照（node scripts/contract.mjs --update），并在 CHANGELOG 写清为什么改。
import assert from 'node:assert/strict'
import test from 'node:test'

import { buildContract, readFixture } from '../scripts/contract.mjs'

test('接口形状与 test/fixtures/contract.json 一致', async () => {
  const current = await buildContract()
  const expected = readFixture()

  // 版本号不比：它每次发版都变（由 meta 测试守着）
  assert.equal(current.version, undefined, '快照里不该有 version，避免每次发版强制 --update')

  assert.deepEqual(
    current.tools,
    expected.tools,
    '工具形状变了（名字/参数/必填项）。若是有意改动，跑 node scripts/contract.mjs --update 并在 CHANGELOG 说明',
  )
  assert.deepEqual(current.routes, expected.routes, '路由集合变了，同上')
  assert.deepEqual(current.inject, expected.inject, 'inject 依赖变了（宿主注入的服务名），同上')
})
