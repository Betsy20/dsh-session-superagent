// 双主题预览能渲染：离线验收界面靠 render-preview.mjs，它坏掉就等于没有验收手段。
// 抽成独立脚本：preflight 与注入验证共用（注入验证跑整套 preflight 太慢）。
import { execFileSync } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(tmpdir(), 'zhuli-preview-check-' + process.pid + '-' + Date.now() + '.html')

let status = 0
try {
  execFileSync('node', ['scripts/render-preview.mjs', out], { cwd: ROOT, stdio: 'ignore' })
} catch (error) {
  status = error.status ?? 1
}

let ok = false
let detail = 'render-preview 执行失败'
try {
  const html = readFileSync(out, 'utf8')
  const hasLight = html.includes('浅色主题')
  const hasDark = html.includes('深色主题')
  const scenarios = (html.match(/class="preview-title"/g) || []).length
  // 弹层也要能被渲染出来：它是「界面够不够官方」的唯一离线验收面
  const hasPopover = html.includes('sa-dock-panel') && html.includes('卫星环弹层')
  ok = status === 0 && hasLight && hasDark && scenarios >= 18 && hasPopover
  detail = scenarios + ' 块（含弹层）'
} catch (error) {
  detail = String((error && error.message) || error).slice(0, 120)
} finally {
  try { rmSync(out, { force: true }) } catch {}
}

if (ok) {
  console.log('PASS 双主题预览可渲染  ' + detail)
} else {
  console.log('FAIL 双主题预览可渲染  ' + detail)
  process.exitCode = 1
}
