#!/usr/bin/env node
// 重启宿主之后跑这一条，确认"新代码真的在跑"。
//
// 为什么需要：服务端改动只有重启才生效。仓库版本和线上版本可能差几十个版本，
// 而界面上看不出来 —— 这个脚本把"线上到底跑的哪一版、有没有新特性"变成一条命令。
//
// 用法：node scripts/verify-live.mjs [http://127.0.0.1:64349]
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const base = (process.argv[2] || 'http://127.0.0.1:64349').replace(/\/+$/, '')
const expected = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version

const rows = []
const add = (name, ok, detail) => rows.push({ name, ok, detail })

const get = async (path, headers) => {
  const started = Date.now()
  const res = await fetch(base + path, { headers: headers || {} })
  const text = await res.text()
  return { res, text, ms: Date.now() - started }
}

try {
  const first = await get('/session-superagent/state')
  let body = null
  try { body = JSON.parse(first.text) } catch {}

  add('/state 可达', first.res.ok && body !== null, `HTTP ${first.res.status}，${first.ms}ms`)

  const live = body && body.serverVersion
  add(
    '版本对齐',
    live === expected,
    live === expected ? `线下=${expected} / 线上=${live}` : `线上 ${live} ≠ 仓库 ${expected} —— 需要重启宿主（不是重装）`,
  )

  const etag = first.res.headers.get('etag')
  add('响应带 ETag', Boolean(etag), etag ? etag : '没有 etag 头：这个版本早于 0.8.85')

  if (etag) {
    const second = await get('/session-superagent/state', { 'if-none-match': etag })
    add('条件请求可用（304）', second.res.status === 304, `HTTP ${second.res.status}，${second.res.status === 200 ? second.text.length + ' 字节（应回 304）' : '无正文'}`)
  } else {
    add('条件请求可用（304）', false, '跳过：没有 ETag')
  }

  const diag = await get('/session-superagent/diagnose')
  let diagBody = null
  try { diagBody = JSON.parse(diag.text) } catch {}
  add('/diagnose 可用', diag.res.ok && diagBody && typeof diagBody.text === 'string', diag.res.ok ? (diagBody && diagBody.text ? diagBody.text.split(String.fromCharCode(10))[0] : '空') : `HTTP ${diag.res.status}`)

  const update = await get('/session-superagent/update')
  let updateBody = null
  try { updateBody = JSON.parse(update.text) } catch {}
  add('/update 可用', update.res.ok && updateBody && typeof updateBody.current === 'string', updateBody ? `current=${updateBody.current} latest=${updateBody.latest || '-'}` : `HTTP ${update.res.status}`)

  if (body && Array.isArray(body.watchers)) {
    const total = body.watchers.length
    const isolated = body.watchers.filter((w) => w.isolated === true).length
    add('守的投影完整', total === 0 || body.watchers.every((w) => w.id && w.repo), `${total} 条，其中隔离执行 ${isolated} 条`)
  }
} catch (error) {
  add('连接', false, String((error && error.message) || error) + `（宿主没起？base=${base}）`)
}

const failed = rows.filter((r) => !r.ok)
for (const row of rows) console.log(`${row.ok ? 'PASS' : 'FAIL'} ${row.name.padEnd(18)} ${row.detail}`)
console.log('---')
console.log(failed.length === 0 ? '线上与仓库一致，新代码已在跑' : `${failed.length} 项不通过`)
if (failed.length > 0) process.exitCode = 1
