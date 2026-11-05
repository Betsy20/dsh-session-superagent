// 面板上写死的数字，必须与代码里的真实阈值对得上。
//
// 为什么需要：默认值/阈值一旦调整，面板上的"最小 30 秒""最近 5 次"就开始说谎，
// 而没有任何门禁会红（0.9.123 / 0.9.127 已各踩过一次）。这里把每一处绑到真实来源。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const client = readFileSync(join(root, 'client.js'), 'utf8')
const index = readFileSync(join(root, 'lib', 'index.js'), 'utf8')
const watchLib = readFileSync(join(root, 'lib', 'watch.js'), 'utf8')

const num = (pattern, source, label) => {
  const found = String(source).match(pattern)
  assert.ok(found, '找不到 ' + label + '（守卫失效，先修这里）')
  return Number(found[1])
}

test('面板「最小 30 秒」= 服务端的间隔下限', () => {
  const shown = num(/最小 (\d+) 秒/, client, '面板文案里的最小值')
  const code = num(/Math\.max\((\d+), Math\.min\(3600, Math\.round\(args\.intervalSec\)\)\)/, index, 'intervalSec 下限（watch_start 的夹紧）')
  assert.equal(shown, code, '面板写 ' + shown + '，代码是 ' + code)
})

test('面板「最近 5 次唤醒」= /state 里 filteredLog 的切片', () => {
  const shown = num(/判定日志（最近 (\d+) 次唤醒）/, client, '判定日志条数')
  // 正则放宽：切片前面多了 Array.isArray 守卫（T37 M2），别再死死匹配实现细节
  const code = num(/filteredLog:.*?slice\(-(\d+)\)/, index, 'filteredLog 切片')
  assert.equal(shown, code, '面板写 ' + shown + '，服务端切片 ' + code)
})

test('面板「最近 20 条」= history 的推送上限', () => {
  const shown = num(/运行时事件（最近 (\d+) 条）/, client, '运行时事件条数')
  const code = num(/export function pushHistory\(history, record, max = (\d+)\)/, watchLib, 'pushHistory 上限')
  assert.equal(shown, code, '面板写 ' + shown + '，pushHistory 上限 ' + code)
})

test('面板「连续 2 次」= 静默唤醒的告警阈值', () => {
  const shown = num(/连续 (\d+) 次就会在「需要关注」里提示/, client, '面板阈值')
  const code = num(/Number\(watcher\.silentWakes\) >= (\d+)\) \{/, client, '面板判断阈值')
  assert.equal(shown, code, '文案写 ' + shown + '，判断用 ' + code)
})
