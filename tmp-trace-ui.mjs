import { readFileSync, writeFileSync } from 'node:fs'

const path = 'client.js'
const raw = readFileSync(path, 'utf8')
const crlf = raw.includes('\r\n')
let s = raw.split('\r\n').join('\n')

function sub(oldText, newText) {
  if (!s.includes(oldText)) {
    console.error('MISSING: ' + oldText.slice(0, 80))
    process.exit(1)
  }
  s = s.replace(oldText, newText)
  s = s.split('\n').join('\r\n') === s ? s : s
}

// ① 客户端版的单条追溯（与服务端 watch.js:itemTrace 同语义；面板不跨包 import）
sub(
  '      /** 暂停原因码 → 人话（服务端 deferReason 是唯一来源）。 */',
  `      /** 单条追溯（与服务端 watch.js:itemTrace 同语义；面板要独立一份）。 */
      function itemTraceFor(watcher, number) {
        if (!watcher || number === null || number === undefined || number === '') return null
        const target = String(number).trim()
        if (!target) return null
        const seen = (watcher.seen && watcher.seen[target]) || null
        const reported = (watcher.lastReported && watcher.lastReported[target]) || null
        const filtered = (watcher.filteredLog || []).filter((entry) => String(entry.number) === target)
        const wakes = (watcher.history || []).filter((entry) => Array.isArray(entry.numbers) && entry.numbers.map(String).includes(target))
        let verdict
        if (filtered.length > 0 && !seen && !reported) verdict = '被过滤掉了：' + (filtered[filtered.length - 1].reason || '未知原因')
        else if (wakes.some((w) => w.ok)) verdict = '已经唤醒过 ' + wakes.filter((w) => w.ok).length + ' 次'
        else if (seen) verdict = '已记入水位但没唤醒（被吸收 / 仅观察 / 或上报前就已存在）'
        else if (wakes.length > 0) verdict = '尝试唤醒过 ' + wakes.length + ' 次但都没成功'
        else verdict = '还没轮到它（可能还没被轮询到，或在批外）'
        return { number: target, repo: watcher.repo || null, seen, reported, filtered, wakes, verdict }
      }

      /** 暂停原因码 → 人话（服务端 deferReason 是唯一来源）。 */`,
)

// ② 判定页新增「追溯」小节：复用搜索框（零新增 state）
sub(
  "        (() => {\n          const counts = new Map()",
  `        (() => {
          const needle = search.trim()
          if (!needle) {
            return h(Section, { key: 'trace', title: '追溯一条', hint: '先在右上角搜索框输入编号（如 42），这里会出现可追溯的条目' },
              h(Hint, null, '追溯会告诉你：它被过滤了、已经唤醒过、还是根本没轮到。'))
          }
          const candidates = watchers.flatMap((watcher) => {
            const numbers = new Set()
            for (const entry of watcher.filteredLog || []) if (String(entry.number).includes(needle)) numbers.add(String(entry.number))
            for (const n of watcher.lastBatch || []) if (String(n).includes(needle)) numbers.add(String(n))
            return [...numbers].map((n) => ({ repo: watcher.repo, number: n, verdict: (itemTraceFor(watcher, n) || {}).verdict || '' }))
          })
          if (candidates.length === 0) {
            return h(Section, { key: 'trace', title: '追溯一条' },
              h(Hint, null, '「' + needle + '」没有可追溯的条目 —— 可能还没被轮询到，或者编号写错了。'))
          }
          return h(Section, { key: 'trace', title: '追溯一条', count: candidates.length },
            h('ul', { className: 'dt-plain-list' }, candidates.slice(0, 12).map((item) => h('li', { key: item.repo + '#' + item.number },
              h('button', {
                className: 'dt-textlink',
                type: 'button',
                onClick: () => setGlossary('trace:' + item.repo + '#' + item.number),
              }, '#' + item.number + ' @ ' + item.repo),
              h('span', { className: 'dt-row-meta' }, item.verdict)))))
        })(),
        (() => {
          const counts = new Map()`,
)

// ③ 弹层：glossary 为 'trace:repo#number' 时展示追溯
sub(
  "        rulesHelp ? h(Modal, {",
  `        (typeof glossary === 'string' && glossary.startsWith('trace:')) ? (() => {
          const raw = glossary.slice(6)
          const hash = raw.lastIndexOf('#')
          const repo = hash > 0 ? raw.slice(0, hash) : raw
          const number = hash > 0 ? raw.slice(hash + 1) : ''
          const owner = watchers.find((w) => w.repo === repo)
          const trace = owner ? itemTraceFor(owner, number) : null
          return h(Modal, { open: true, title: '追溯 #' + number + ' @ ' + repo, onClose: () => setGlossary(false) },
            h(KeyValues, { rows: trace ? [
              ['结论', trace.verdict],
              ['水位（seen）', trace.seen || '（没有记过）'],
              ['上次上报', trace.reported || '（没有上报过）'],
              ['被过滤', trace.filtered.length > 0 ? trace.filtered.map((e) => (e.reason || '未知')).join('、') : '（没有）'],
              ['唤醒尝试', trace.wakes.length > 0 ? trace.wakes.map((w) => (w.ok ? '成功' : '失败（' + (w.reason || '未知') + '）')).join('、') : '（没有）'],
            ] : [['结论', '找不到这条守的状态']] }),
            h('div', { className: 'dt-actions' },
              h(Btn, { size: 'sm', variant: 'ghost', onClick: () => setGlossary(false) }, '关闭')))
        })() : null,
        (glossary === true || typeof glossary === 'string' && !glossary.startsWith('trace:')) ? h(Modal, { open: true, title: '主理鱼术语表', onClose: () => setGlossary(false) },`,
)

if (crlf) s = s.split('\n').join('\r\n')
writeFileSync(path, s)
console.log('面板追溯入口已加')
