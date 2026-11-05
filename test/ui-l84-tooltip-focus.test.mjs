import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const start = source.indexOf('const HostTooltip =')
const end = source.indexOf('const createToastState', start)
const tooltip = source.slice(start, end)

test('主面板 Tooltip scroll-close 与适配层一样保留 trigger 焦点', () => {
  assert.ok(start > 0 && end > start, '找不到 HostTooltip')
  for (const expected of [
    'triggerNodeRef', 'restoreFocusRef', 'document.activeElement',
    'triggerNode.contains(activeElement)', 'focus({ preventScroll: true })',
    'triggerRef: triggerNodeRef',
  ]) {
    assert.ok(tooltip.includes(expected), '主面板缺少焦点保留逻辑：' + expected)
  }
  assert.ok(tooltip.includes('[remountKey]'), '焦点恢复 effect 必须跟随 remountKey')
})

test('TooltipTrigger 合并 DSH ref 与适配 ref，不吞掉任一引用', () => {
  assert.ok(source.includes('const setTriggerRefs = (node) =>'))
  assert.ok(source.includes('if (triggerRef) triggerRef.current = node'))
  assert.ok(source.includes("typeof ref === 'function'"), '必须兼容 callback ref')
  assert.ok(source.includes("typeof ref === 'object'"), '必须兼容对象 ref')
})
