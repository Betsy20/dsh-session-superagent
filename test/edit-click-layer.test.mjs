import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

test('行内编辑表单必须在 .dt-open::after 透明点击层之上', () => {
  assert.ok(source.includes('.dt-ticket-body .dt-form { position: relative; z-index: 1; }'),
    '缺少表单 z-index 保护时，input 点击会命中标题按钮并收起')
  // Chromium 实测：修复前 elementFromPoint=input 位置命中 button.dt-open；修复后命中 input。
})

test('WatcherForm 使用官方 DraftEditor 的 form.dt-card 外壳', () => {
  assert.ok(source.includes("className: 'dt-form dt-card'"), '表单外壳不能退回裸 dt-form')
})
