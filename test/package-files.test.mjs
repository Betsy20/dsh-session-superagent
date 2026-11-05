import assert from 'node:assert/strict'
import test from 'node:test'
import { readdirSync, readFileSync } from 'node:fs'

test('lib/ 下每个运行时模块都必须进入 npm files（否则发布后 import 才炸）', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const files = new Set(pkg.files || [])
  const lib = readdirSync(new URL('../lib', import.meta.url)).filter((name) => name.endsWith('.js'))
  assert.ok(lib.length > 0)
  for (const name of lib) {
    assert.ok(files.has('lib/' + name), 'package.json.files 漏了 lib/' + name + '：本机测试能过，npm 包会缺模块')
  }
})

test('面向使用者的根文档必须随包发布（SETUP 不是仓库私有笔记）', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const files = new Set(pkg.files || [])
  for (const name of ['README.md', 'SETUP.md', 'UPDATING.md', 'CHECKLIST.md', 'MAINTENANCE.md']) {
    assert.ok(files.has(name), 'package.json.files 漏了 ' + name)
  }
})
