import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { auditAdapterParity, formatAdapterDifferences } from '../scripts/audit-adapter-parity.mjs'

const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8')
const hostSource = read('ui-host-primitives.js')
const orbitSource = read('ui-orbit-popover.js')
const clientSource = read('client.js')
const sources = { hostSource, orbitSource, clientSource }

test('独立适配器与内联 UMD 适配器的 84 项结构化语义断言通过', () => {
  const result = auditAdapterParity(sources)
  assert.equal(result.checks, 84)
  assert.deepEqual(result.differences, [], formatAdapterDifferences(result))
  assert.equal(result.ok, true)
})

test('审计比较语义字段，允许 UMD 注释、空白与引号风格差异', () => {
  const reformatted = clientSource
    .replace('holdMs: 3000,', 'holdMs /* UMD formatting only */ : 3000,')
    .replace("side: 'top',", 'side: "top",')
  assert.notEqual(reformatted, clientSource)
  const result = auditAdapterParity({ ...sources, clientSource: reformatted })
  assert.deepEqual(result.differences, [], formatAdapterDifferences(result))
  assert.equal(result.ok, true)
})

test('临时假源把 Toast holdMs 改成 4500 时，审计抓住真实漂移并给出双侧值', () => {
  const drifted = clientSource.replace('holdMs: 3000,', 'holdMs: 4500,')
  assert.notEqual(drifted, clientSource, '只变异测试内存中的假源')
  const result = auditAdapterParity({ ...sources, clientSource: drifted })
  assert.equal(result.ok, false)
  const difference = result.differences.find((item) => item.path === 'host.Toast.holdMs')
  assert.ok(difference, formatAdapterDifferences(result))
  assert.equal(difference.standalone, '3000')
  assert.equal(difference.inline, '4500')
  assert.equal(difference.expected, '3000')
  const report = formatAdapterDifferences(result)
  assert.match(report, /host\.Toast\.holdMs/)
  assert.match(report, /独立\/实际：3000/)
  assert.match(report, /UMD\/对照：4500/)
})

test('临时假源删除 Tooltip openOnClick 时，差异明确标记缺失字段', () => {
  const drifted = clientSource.replace('openOnClick: true,', '')
  assert.notEqual(drifted, clientSource, '只变异测试内存中的假源')
  const result = auditAdapterParity({ ...sources, clientSource: drifted })
  assert.equal(result.ok, false)
  const difference = result.differences.find((item) => item.path === 'host.Tooltip.openOnClick')
  assert.ok(difference, formatAdapterDifferences(result))
  assert.equal(difference.standalone, 'true')
  assert.equal(difference.inline, undefined)
  assert.match(formatAdapterDifferences(result), /host\.Tooltip\.openOnClick[\s\S]*<缺失>/)
})
