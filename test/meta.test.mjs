// 版本/契约守门：踩过的坑都在注释里。
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

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
  const marker = "} from './watch.js'"
  const end = src.indexOf(marker)
  assert.ok(end > 0, '找不到 watch.js 的 import 块')
  const start = src.lastIndexOf('import {', end) + 'import {'.length
  const imported = new Set(src.slice(start, end).split(',').map((v) => v.trim()).filter(Boolean))
  const body = src.slice(end + marker.length)
  const missing = Object.keys(watch).filter((name) => {
    if (imported.has(name)) return false
    return new RegExp('\\b' + name + '\\b').test(body)
  })
  assert.deepEqual(missing, [], '这些名字被用了却没 import：' + missing.join(', '))
})

// 第二轮审核的教训：移植官方 GUI 时用了 3 个官方 CSS 里根本不存在的 class，
// 弹层落到页面底部、状态标签变成裸文字，而测试全是绿的。
test('client.js 用到的 dt-* 类名都必须在移植来的 CSS 里存在', () => {
  const client = read('../client.js')
  // 不用正则读 PORTED_CSS：按引号扫描，避免转义地狱
  const marker = 'const PORTED_CSS = "'
  const head = client.indexOf(marker)
  assert.ok(head >= 0, '找不到 PORTED_CSS')
  let j = head + marker.length
  let closed = -1
  while (j < client.length) {
    if (client[j] === '\\') {
      j += 2
    } else if (client[j] === '"') {
      closed = j
      break
    } else {
      j += 1
    }
  }
  assert.ok(closed > 0, '找不到 PORTED_CSS 的收尾引号')
  const css = JSON.parse('"' + client.slice(head + marker.length, closed) + '"')

  const known = new Set()
  let k = 0
  while ((k = css.indexOf('.dt-', k)) >= 0) {
    let end = k + 1
    while (end < css.length && /[a-z0-9-]/.test(css[end])) end += 1
    known.add(css.slice(k + 1, end))
    k = end
  }
  assert.ok(known.size > 150, 'CSS 里只解析到 ' + known.size + ' 个类名，解析逻辑可能坏了')

  // 扫两遍：className 里的整串，以及任意位置的字面量（catch cx('dt-foo') / 'dt-btn-danger' 这类）
  const used = new Set()
  const reClass = /className:\s*'([^']+)'/g
  let m
  while ((m = reClass.exec(client)) !== null) {
    for (const name of m[1].split(/\s+/)) {
      if (name.startsWith('dt-')) used.add(name)
    }
  }
  const reLiteral = /'([a-z0-9-]+)'/g
  while ((m = reLiteral.exec(client)) !== null) {
    const name = m[1]
    // 只收形如 dt-xxx 的完整类名；以 '-' 结尾的是拼接前缀，跳过
    if (/^dt-[a-z0-9-]+[a-z0-9]$/.test(name)) used.add(name)
  }
  const missing = [...used].filter((name) => !known.has(name))
  assert.deepEqual(missing, [], '这些 class 用了但 CSS 里没有：' + missing.join(', '))
})

// 2026-11-01 事故：新增 lib/body.js 没同步进 profile，宿主 import 失败导致插件整体不挂载。
// 这条守门在仓库层面挡住「相对 import 指向不存在的文件」这一类。
test('lib/ 里每个相对 import 都能解析到真实文件', () => {
  const libDir = fileURLToPath(new URL('../lib/', import.meta.url))
  const missing = []
  for (const name of readdirSync(libDir)) {
    if (!name.endsWith('.js')) continue
    const code = readFileSync(join(libDir, name), 'utf8')
    // 同时覆盖 `import { x } from './y.js'` 与副作用写法 `import './y.js'`
    const specs = []
    for (const line of code.split(String.fromCharCode(10))) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('import ')) continue
      const at = trimmed.lastIndexOf("from '")
      if (at >= 0) {
        specs.push(trimmed.slice(at + 6).split("'")[0])
      } else {
        // 副作用写法：import './y.js' —— 注意切片后第一个字符还是引号，剥掉再取
        const rest = trimmed.slice('import '.length)
        if (!rest.startsWith("'")) continue
        const side = rest.slice(1).split("'")[0]
        if (side.startsWith('.')) specs.push(side)
      }
    }
    for (const spec of specs) {
      if (spec && spec.startsWith('.') && !existsSync(join(libDir, spec))) missing.push(name + ' -> ' + spec)
    }
  }
  assert.deepEqual(missing, [], '相对 import 指向不存在的文件：' + missing.join(', '))
})

// 事故 1 的复发形态：新增 lib/xxx.js 但没加进 sync-profile 的 TARGETS，
// 结果 profile 里没有这个文件 -> 宿主 import 失败 -> 插件整体不挂载。
test('sync-profile 的 TARGETS 必须覆盖 lib/ 下所有 js 文件', () => {
  const script = read('../scripts/sync-profile.mjs')
  const start = script.indexOf('const TARGETS = [')
  const end = script.indexOf(']', start)
  assert.ok(start > 0 && end > start, '解析不到 TARGETS')
  const listed = [...script.slice(start, end).matchAll(/'([^']+)'/g)].map((m) => m[1])
  const libs = readdirSync(fileURLToPath(new URL('../lib/', import.meta.url)))
    .filter((f) => f.endsWith('.js'))
    .map((f) => 'lib/' + f)
  const missing = libs.filter((f) => !listed.includes(f))
  assert.deepEqual(missing, [], '这些 lib 文件没进 TARGETS（新增文件后必须加）：' + missing.join(', '))
})

test('SERVER_VERSION = package.json 版本', () => {
  const v = read('../lib/index.js').match(/export const SERVER_VERSION = '([\d.]+)'/)
  assert.ok(v, 'lib/index.js 里没有 SERVER_VERSION')
  assert.equal(v[1], pkg.version)
})

test('官方原语齐全（controls.tsx 那一套都要在）', () => {
  const src = read('../client.js')
  for (const name of ['Icon', 'Btn', 'Tag', 'Pill', 'SegTabs', 'SegmentedControl', 'Input', 'Toggle', 'Modal', 'DisclosureRow', 'InfoTip', 'Section']) {
    assert.ok(src.includes('function ' + name + '('), '缺少原语 ' + name)
  }
})

test('编辑态初始化必须列全可编辑字段（漏一个就会在保存时把配置写错）', () => {
  const src = read('../client.js')
  const start = src.indexOf('setDraft({', src.indexOf('dt-open'))
  assert.ok(start > 0, '找不到点标题时的 setDraft 初始化')
  const block = src.slice(start, src.indexOf('})', start))
  for (const field of ['intervalSec', 'labels', 'activeHours', 'onlyAssigned', 'observe', 'isolated', 'workdir', 'batchLimit', 'maxWakesPerHour', 'isolateKeepDays', 'priorityReopened', 'priorityComments', 'priorityLabels', 'priorityUnassigned', 'priorityStale', 'maxIsolated', 'sessionMaxWakes']) {
    assert.ok(block.includes(field + ':'), '编辑态初始化缺字段 ' + field + ' —— 打开再直接保存会把这项写回默认值')
  }
})

test('doctor 的版本一致性检查：磁盘版本必须等于加载版本（否则就是"改了没重启"）', () => {
  const src = read('../lib/index.js')
  assert.ok(src.includes('installedVersion'), '缺 installedVersion 实现')
  assert.ok(src.includes('代码已更新但未生效'), '缺"改了没重启"的提示文案')
  // 当前仓库状态下两者应当一致（不一致说明有人改了版本号却没同步）
  const disk = JSON.parse(read('../package.json')).version
  const m = src.match(/export const SERVER_VERSION = '([^']+)'/)
  assert.ok(m, '找不到 SERVER_VERSION')
  assert.equal(m[1], disk, 'package.json 与 SERVER_VERSION 必须一致')
})
