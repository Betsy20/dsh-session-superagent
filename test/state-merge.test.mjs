// 真机丢过 watcher（一条是用户的 Betsy20/magpie-Jet-Hub）：宿主重载或两个实例交替运行时，
// 一个**持有旧快照**的写入会把别人刚建的条目整份覆盖掉。
//
// 修法：写状态时与盘上内容合并 —— 盘上有、内存里没有的条目保留；
// 只有「墓碑里记过的 id」才允许消失（删除时立墓碑，避免被迟到写入复活）。
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const STATE_DIR = mkdtempSync(join(tmpdir(), 'superagent-merge-'))
process.env.DSH_SUPERAGENT_STATE = STATE_DIR
process.env.DSH_SUPERAGENT_NO_POLL = '1'

const { __test } = await import('../lib/index.js')
const { readState, writeState } = __test

const entry = (repo) => ({ id: repo + '#s', repo, sessionId: 's', intervalSec: 60, enabled: true })

test('迟到的旧快照不会抹掉别人刚建的 watcher', () => {
  writeState({ watchers: { 'a/one#s': entry('a/one') } })
  const stale = readState()                        // 某个实例手里的旧快照
  stale.watchers['a/one#s'].lastError = 'old'

  writeState({ watchers: { 'b/two#s': entry('b/two') } })   // 另一个实例新建了一条
  const merged = writeState(stale)                          // 旧快照覆盖回来

  assert.ok(merged.watchers['a/one#s'], '自己那条还在')
  assert.ok(merged.watchers['b/two#s'], '别人新建的那条也必须还在')
})

test('删除留下的墓碑能挡住迟到写入的复活', () => {
  writeState({ watchers: { 'c/three#s': entry('c/three'), 'd/four#s': entry('d/four') } })
  const stale = readState()

  // 正常删除 c/three：从 watchers 里去掉，并立墓碑
  const deleting = readState()
  delete deleting.watchers['c/three#s']
  deleting.deleted = { 'c/three#s': new Date().toISOString() }
  writeState(deleting)
  assert.equal(readState().watchers['c/three#s'], undefined, '删掉了')

  // 一个持有旧快照（里面还有 c/three）的写入不能把它复活
  const merged = writeState(stale)
  assert.equal(merged.watchers['c/three#s'], undefined, '墓碑必须挡住复活')
  assert.ok(merged.watchers['d/four#s'], '没被删的那条照旧')

  const onDisk = JSON.parse(readFileSync(join(STATE_DIR, 'watchers.json'), 'utf8'))
  assert.equal(onDisk.watchers['c/three#s'], undefined)
  rmSync(STATE_DIR, { recursive: true, force: true })
})
