// 版本一致性守门：踩过「CHANGELOG 顶部还停在 0.3.6，package.json 已经 0.7.2」，
// 因为插入新条目的 python replace 找不到锚点时会静默无操作。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')
const pkg = JSON.parse(read('../package.json'))

test('CHANGELOG 顶部版本 = package.json 版本', () => {
  const first = read('../CHANGELOG.md').match(/## \[(\d+\.\d+\.\d+)\]/)
  assert.ok(first, 'CHANGELOG 里找不到版本标题')
  assert.equal(first[1], pkg.version)
})

test('README 徽章版本 = package.json 版本', () => {
  const badge = read('../README.md').match(/badge\/version-(\d+\.\d+\.\d+)-green/)
  assert.ok(badge, 'README 里找不到版本徽章')
  assert.equal(badge[1], pkg.version)
})

test('CLIENT_VERSION = package.json 版本', () => {
  const v = read('../client.js').match(/const CLIENT_VERSION = '([\d.]+)'/)
  assert.ok(v, 'client.js 里没有 CLIENT_VERSION')
  assert.equal(v[1], pkg.version)
})

test('package.json 该有的元数据都在', () => {
  for (const key of ['name', 'version', 'description', 'license', 'repository', 'author', 'homepage', 'bugs', 'files', 'engines']) {
    assert.ok(pkg[key], '缺 ' + key)
  }
  assert.ok(pkg.files.includes('client.js'), 'client.js 必须发出去，否则面板加载不到')
  assert.ok(pkg.files.includes('cordis.patch.yml'), 'patch 必须发出去，否则装不上')
})

// 审核找出来的真实事故：recordReported 在 index.js 里被调用却从未 import，
// 每次成功唤醒都抛 ReferenceError，却没有任何用例跑到那条路径。这条守门专门堵它。
test('lib/index.js 里用到的 watch.js 导出，必须真的被 import 进来', async () => {
  const src = read('../lib/index.js')
  const watch = await import('../lib/watch.js')
  const end = src.indexOf("} from './watch.js'")
  assert.ok(end > 0, '找不到 watch.js 的 import 块')
  const start = src.lastIndexOf('import {', end) + 'import {'.length
  const imported = new Set(src.slice(start, end).split(',').map((v) => v.trim()).filter(Boolean))
  const body = src.slice(end + "} from './watch.js'".length)
  const missing = Object.keys(watch).filter((name) => !imported.has(name) && new RegExp('\b' + name + '\b').test(body))
  assert.deepEqual(missing, [], '这些名字被用了却没 import：' + missing.join(', '))
})
