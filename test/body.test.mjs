// 请求体解码与截断：Windows 上 argv 是 GBK，且 64KB 上限会切在汉字中间。
import assert from 'node:assert/strict'
import test from 'node:test'

import { decodeBody, truncateUtf8 } from '../lib/body.js'

test('truncateUtf8 不许切在汉字中间（否则整段会被当成 GBK 重解）', () => {
  const text = '主工作区'.repeat(5000) // 每字 3 字节
  const buf = Buffer.from(text, 'utf8')
  const cut = truncateUtf8(buf, 20000)
  assert.ok(cut.length <= 20000)
  const decoded = decodeBody(cut)
  assert.ok(!decoded.includes('\ufffd'), '截断后不该出现替换字符')
  assert.ok(decoded.startsWith('主工作区'), '前几个字要完好')
  // 切在字符边界上：长度能被 3 整除（这个样例里）
  assert.equal(cut.length % 3, 0, '应该落在 3 字节字符的边界上')
})

test('truncateUtf8：没超限就原样返回（不复制、不破坏）', () => {
  const buf = Buffer.from('短内容', 'utf8')
  assert.equal(truncateUtf8(buf, 1024).toString('utf8'), '短内容')
})

test('truncateUtf8：非法上限（0 / 负数 / NaN）原样返回，别把请求体清空', () => {
  const buf = Buffer.from('abc', 'utf8')
  for (const bad of [0, -1, Number.NaN, 'x']) {
    assert.equal(truncateUtf8(buf, bad).toString('utf8'), 'abc')
  }
})

test('decodeBody：UTF-8 直接过，GBK 回退仍生效', () => {
  assert.equal(decodeBody(Buffer.from('主工作区', 'utf8')), '主工作区')
  // GBK 的「主工作区」字节
  const gbk = Buffer.from([0xd6, 0xf7, 0xb9, 0xa4, 0xd7, 0xf7, 0xc7, 0xf8])
  assert.equal(decodeBody(gbk), '主工作区')
})
