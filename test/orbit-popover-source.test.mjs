import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

test('DSH StatusOrbit 使用 OrbitPopover + createPortal，不沿用极大 z-index', () => {
  assert.ok(source.includes('hostOrbit.OrbitPopover'), 'DSH 路径必须使用 OrbitPopover')
  assert.ok(source.includes("require('react-dom')"), 'portal 必须来自宿主 react-dom')
  const panelStart = source.indexOf('const panel = hostOrbit')
  const fallbackStart = source.indexOf(": h('div', {", panelStart)
  const dshPanel = source.slice(panelStart, fallbackStart)
  assert.ok(!dshPanel.includes('2147483000'), 'DSH 路径不能保留任意极大 z-index')
  assert.ok(dshPanel.includes('className: \'dt-card sa-dock-panel\''), '保留现有 surface 样式')
})

test('orbit 删除确认由独立 ConfirmDialog 持有，并显式回焦圆环', () => {
  assert.ok(source.includes('function ConfirmDialog'), '确认层必须与触发按钮分离')
  assert.ok(source.includes('onCloseOrbit: () => setOpen(false)'), '请求确认时必须先关闭 orbit')
  assert.ok(source.includes('orbitConfirm.onConfirmClose()'), '确认关闭必须调用圆环回焦策略')
  assert.ok(source.includes("modalContext: 'orbit'"), 'orbit 继续使用 superagent 同源确认 Modal')
})
