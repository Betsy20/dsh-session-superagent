import { readFileSync, writeFileSync } from 'node:fs'

const path = 'lib/index.js'
const raw = readFileSync(path, 'utf8')
const crlf = raw.includes('\r\n')
let s = raw.split('\r\n').join('\n')

function sub(oldText, newText) {
  if (!s.includes(oldText)) {
    console.error('MISSING: ' + oldText.slice(0, 80))
    process.exit(1)
  }
  s = s.replace(oldText, newText)
}

sub(
  `      return list
        .map((w) => {
          const flags = []
          if (w.observe === true) flags.push('observe')`,
  `      const sessionId = list[0] && list[0].sessionId
      const sessionUsed = sessionWakesLastHour(list, sessionId)
      const cap = Number(list[0] && list[0].sessionMaxWakes) || DEFAULT_SESSION_WAKES
      const capped = countCapped(list)
      const body = list
        .map((w) => {
          const flags = []
          if (w.observe === true) flags.push('observe')`,
)

sub(
  `          if (w.lastDeferred) flags.push('deferred=' + JSON.stringify(String(w.lastDeferred).slice(0, 40)))`,
  `          // 面板上有的诊断字段，工具输出也要有 —— agent 自诊时未必能看到面板
          if (w.deferReason) flags.push('defer=' + w.deferReason)
          if (Number(w.silentWakes) > 0) flags.push('silent=' + w.silentWakes)
          if (w.lastDeferred) flags.push('deferred=' + JSON.stringify(String(w.lastDeferred).slice(0, 40)))`,
)

sub(
  `            '| err=' + (w.lastError || '-'),
          ].filter(Boolean).join(' ')
        })
        .join('\n')`,
  `            '| err=' + (w.lastError || '-'),
          ].filter(Boolean).join(' ')
        })
        .join('\n')
      const summary = 'session: ' + sessionUsed + '/' + cap + ' wakes last hour'
        + (capped > 0 ? '，' + capped + ' 条守正因上限暂停' : '')
        + (suggestSessionCap({ used: sessionUsed, cap, capped }) ? '，建议把会话上限调到 ' + suggestSessionCap({ used: sessionUsed, cap, capped }) : '')
      return body + '\n' + summary`,
)

if (crlf) s = s.split('\n').join('\r\n')
writeFileSync(path, s)
console.log('watch_status 输出补齐诊断字段')
