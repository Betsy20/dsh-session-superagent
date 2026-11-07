// 测试用临时目录：统一登记，进程退出时清理。
// 门禁包自己的测试也要守「临时目录收口」——不把残留留给下一个人。
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const made = []

process.on('exit', () => {
  for (const dir of made) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // 被占用就留着，下次 clean 处理
    }
  }
})

export function tempDir(prefix = 'dsh-gate-') {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  made.push(dir)
  return dir
}

export function writeTextFile(path, text) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text, 'utf8')
}

export function writeJsonFile(path, value) {
  writeTextFile(path, JSON.stringify(value, null, 2) + '\n')
}
