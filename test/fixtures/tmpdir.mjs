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
