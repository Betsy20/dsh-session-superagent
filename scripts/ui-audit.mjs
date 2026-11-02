#!/usr/bin/env node
// UI 体检：把「像不像 DSH 原生界面」拆成能数的指标，每轮跑一次，只认数字。
//
// 为什么要这个脚本：靠在真机里肉眼点一遍，既慢又漏；而且大部分指标不需要宿主就能量。
// 输出 7 项指标 + 总评；`--json` 给机器读（CI 或下一轮对比）。
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const clientSource = readFileSync(join(ROOT, 'client.js'), 'utf8')

// PORTED_CSS 是官方搬来的那一大块；其余样式块才是我们自己写的（sa-* / orbit / toast 等）
const portedMatch = clientSource.match(/const PORTED_CSS = "([\s\S]*?)";/)
const PORTED = portedMatch ? JSON.parse('"' + portedMatch[1] + '"') : ''
const ownStyleBlocks = [...clientSource.matchAll(/(?:const|let)\s+\w*(?:CSS|STYLE)\w*\s*=\s*`([\s\S]*?)`/g)]
  .map((m) => m[1])
  .join('\n')

const count = (re, text) => (text.match(re) || []).length
const results = []
const add = (name, value, target, note) => {
  const ok = typeof target === 'function' ? target(value) : value <= target
  results.push({ name, value, target: typeof target === 'function' ? '按规则' : target, ok, note })
}

// ① 可点但不可键盘操作的裸 div（原生界面里这种元素不存在）
const clickableDivs = [...clientSource.matchAll(/h\('div',\s*\{[^}]*onClick[^}]*\}/g)].map((m) => m[0])
const bareClickable = clickableDivs.filter((s) => !/role:|tabIndex:/.test(s)).length
add('可点但不可键盘操作的裸 div', bareClickable, 0, clickableDivs.length + ' 个可点 div 里有一半缺 role/tabIndex 的话就是这种')

// ② 焦点样式：没有 :focus-visible，键盘用户看不出自己在哪
const focusRules = count(/:focus-visible/g, PORTED + ownStyleBlocks)
add('焦点可见规则 (:focus-visible)', focusRules, (v) => v >= 1, '原生界面用键盘走一遍能看见焦点环')

// ③ 自造样式里写死的颜色（原生只用 --dsw-alias-* token，写死会在深色主题里烂）
const hardcoded = count(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g, ownStyleBlocks)
add('自造样式里写死的颜色', hardcoded, 0, 'SVG 轨道环的语义色除外，那段单独算')

// ④ 图标按钮必须有可读名字：aria-label / label 属性 / 可见文字，三者有其一即可
//    （只按字面量判断，所以按「调用片段里有没有名字、有没有紧跟可见文字」来数）
const iconOnlyUnnamed = (() => {
  let bad = 0
  const names = []
  for (const m of clientSource.matchAll(/h\(Btn, \{/g)) {
    const seg = clientSource.slice(m.index, m.index + 420)
    const hasName = new RegExp('aria-label|(^|[^a-zA-Z])label:').test(seg)
    const close = seg.indexOf('},')
    const visibleText = close > 0 && /'/.test(seg.slice(close + 2))
    if (!hasName && !visibleText) {
      bad += 1
      names.push(clientSource.slice(0, m.index).split(String.fromCharCode(10)).length)
    }
  }
  return { bad, names }
})()
add('图标按钮缺可读名字', iconOnlyUnnamed.bad, 0,
  iconOnlyUnnamed.names.length ? '缺名字的按钮在第 ' + iconOnlyUnnamed.names.join(', ') + ' 行' : '')

// ⑤ 空态：没数据时必须有一句人话，而不是白屏。
//    用「length === 0 分支的数量」当代理指标 —— 每个列表/日志区都该有一条。
const emptyBranches = count(/length === 0/g, clientSource)
add('空态分支数', emptyBranches, (v) => v >= 4, '列表 / 日志 / 搜索 / 悬浮面板 各至少要有一条')

// ⑥ 原生组件复用：按钮/输入/标签这些应该用宿主组件，不是裸标签
const rawButtons = count(/h\('button'/g, clientSource)
const nativeBtns = count(/h\(Btn,/g, clientSource)
add('裸 button / 原生 Btn', rawButtons + '/' + nativeBtns, () => true, '裸 button 越少越像原生；这一项只看趋势')
results[results.length - 1].raw = rawButtons
results[results.length - 1].native = nativeBtns

// ⑦ CSS 类是否都被用到（官方搬来的那批允许闲置，但自己写的类闲置就是死代码）
const ownClasses = [...new Set([...ownStyleBlocks.matchAll(/\.(sa-[a-z0-9-]+)/g)].map((m) => m[1]))]
const deadOwnClasses = ownClasses.filter((c) => count(new RegExp('\\.' + c + '\\b'), clientSource) <= 1)
add('自造类里的死代码', deadOwnClasses.length, 0, deadOwnClasses.length ? '没用到的自造类：' + deadOwnClasses.join(' ') : '全部有用到')

const passed = results.filter((r) => r.ok).length
const score = Math.round((passed / results.length) * 100)

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ score, passed, total: results.length, results }, null, 2))
} else {
  for (const r of results) {
    const mark = r.ok ? 'PASS' : 'FAIL'
    console.log(`${mark} ${String(r.name).padEnd(26)} ${String(r.value).padEnd(10)} 目标 ${r.target}`)
    if (!r.ok) console.log(`     ↳ ${r.note}`)
  }
  console.log(`\nUI 体检：${passed}/${results.length} 通过（${score} 分）`)
}
process.exit(passed === results.length ? 0 : 1)
