// 真机丢过 watcher（一条是用户的 Betsy20/magpie-Jet-Hub）：宿主重载或两个实例交替运行时，
// 一个**持有旧快照**的写入会把别人刚建的条目整份覆盖掉。
//
// 修法：写状态时与盘上内容合并 —— 盘上有、内存里没有的条目保留；
// 只有「墓碑里记过的 id」才允许消失（删除时立墓碑，避免被迟到写入复活）。
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

test('主文件坏了会退回备份，而不是把客户所有守当空状态', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zhuli-bak-'))
  process.env.DSH_SUPERAGENT_STATE = dir
  const mod = await import('../lib/index.js?bak=' + Date.now())
  const { readState, writeState } = mod.__test

  // 先写一份好的：这会让 writeState 下次有机会产出 .bak
  writeState({ watchers: { 'a#1': { repo: 'a/b', sessionId: '1', intervalSec: 60 } } })
  // 再写一次，让刚写好的那份变成 .bak
  writeState({ watchers: { 'a#1': { repo: 'a/b', sessionId: '1', intervalSec: 90 } } })
  assert.ok(existsSync(join(dir, 'watchers.json.bak')), '应该留下备份')

  // 把主文件写坏
  writeFileSync(join(dir, 'watchers.json'), '{ 这不是 json')
  const recovered = readState()
  assert.ok(recovered.watchers && recovered.watchers['a#1'], '要从备份恢复出条目：' + JSON.stringify(recovered).slice(0, 120))
  // 恢复后主文件应该能被正常解析了
  const again = JSON.parse(readFileSync(join(dir, 'watchers.json'), 'utf8'))
  assert.ok(again.watchers['a#1'], '恢复时要把好内容写回主文件')
  rmSync(dir, { recursive: true, force: true })
})
