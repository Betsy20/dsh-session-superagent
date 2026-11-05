// 临时目录工厂：自动登记，进程退出时统一删除。
//
// 为什么需要：测试里到处 `mkdtempSync(join(tmpdir(), …))`，有的忘了删，
// 结果本机攒了 **1654** 个残留目录（一次测试跑 8 个）。清理靠自觉不可靠，靠钩子。
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const made = []

process.on('exit', () => {
  for (const dir of made) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch { /* 被占用就留着，下次 clean-tmp 处理 */ }
  }
})

export function tempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  made.push(dir)
  return dir
}

/**
 * 守卫：任何会**写状态**的测试，动手前必须确认 `DSH_SUPERAGENT_STATE` 指向临时目录。
 *
 * 审核 T30 发现的真实事故：`test/routes.test.mjs` 里有一条用例在 env 还没设好时 import 了
 * `lib/index.js`，`watch_start` 于是把 `o/parity#session-parity` 写进了**真实**的
 * `~/.dsh/state/session-superagent/watchers.json`。那条假守从此一直在真机面板上轮询失败。
 *
 * 这条守卫把「靠调用顺序才指对目录」变成「指错就当场炸」。
 */
export function assertTempStateDir(where = '') {
  const dir = String(process.env.DSH_SUPERAGENT_STATE || '')
  if (!dir) {
    throw new Error('DSH_SUPERAGENT_STATE 没设：这会写到真实状态目录' + (where ? '（' + where + '）' : ''))
  }
  const home = String(process.env.USERPROFILE || process.env.HOME || '')
  if (home && dir.startsWith(home) && !dir.includes('Temp') && !dir.includes('tmp')) {
    throw new Error('DSH_SUPERAGENT_STATE 指向了用户目录，不是临时目录：' + dir + (where ? '（' + where + '）' : ''))
  }
  return dir
}
