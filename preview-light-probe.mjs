// 临时探针：确认 getComputedStyle 对 color-mix() 返回什么语法，以及 canvas 能否还原任意 CSS 颜色。用完删。
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'

function probe() {
  const out = []
  const sels = ['.dt-tag[data-tone="success"]', '.dt-tag[data-tone="warning"]', '.dt-tag[data-tone="danger"]',
    '.dt-tag[data-tone="outline"]', '.dt-tag[data-tone="quiet"]', '.dt-banner.dt-danger', '.dt-stat-btn[aria-pressed="true"]',
    '.dt-stats', '.dt-input', '.dt-settings-body', '.dt-mark', '.dt-pre ins']
  for (const s of sels) {
    const el = document.querySelector(s)
    if (!el) { out.push(s + ' => NOT FOUND'); continue }
    const cs = getComputedStyle(el)
    out.push(s + ' => bg=' + cs.backgroundColor + ' | color=' + cs.color)
  }
  const cv = document.createElement('canvas')
  cv.width = 1
  cv.height = 1
  const ctx = cv.getContext('2d', { willReadFrequently: true })
  for (const s of ['color(srgb 0.1 0.5 0.2 / 0.12)', 'oklab(0.5 0.1 0.1 / 0.2)', 'color-mix(in srgb, #9a6700 12%, transparent)', 'rgba(154,103,0,0.12)']) {
    ctx.clearRect(0, 0, 1, 1)
    ctx.fillStyle = s
    ctx.fillRect(0, 0, 1, 1)
    const d = ctx.getImageData(0, 0, 1, 1).data
    out.push('canvas[' + s + '] = ' + [d[0], d[1], d[2], d[3]].join(','))
  }
  document.getElementById('__probe__').textContent = out.join('\n')
}

const f = process.argv[2]
const src = readFileSync(f, 'utf8')
const injected = src + '\n<pre id="__probe__">' + '<scr' + 'ipt>window.addEventListener("load",' + probe.toString() + ')</scr' + 'ipt></pre>'
const tmp = f.replace(/\.html$/, '.probe.html')
writeFileSync(tmp, injected)
const url = 'file:///' + tmp.split('\\').join('/')
const dom = execFileSync(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--virtual-time-budget=3000', '--dump-dom', url], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
const m = dom.match(/<pre id="__probe__">([\s\S]*?)<\/pre>/)
console.log(m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&'))
