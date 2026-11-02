// 顺序也算契约：会话忙时必须**先**判定、再决定要不要开隔离区。
//
// 依据本轮实测：本机 `git worktree add` 0.19s，加上回收过期副本的若干次 git 调用，
// 一次白跑就是 1 秒级；而 decideWake 之后一定会拒绝。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const src = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')

test('pollOnce 里先判会话是否空闲，再准备隔离区', () => {
  const pollStart = src.indexOf('async function pollOnce')
  assert.ok(pollStart > 0, '找不到 pollOnce')
  const body = src.slice(pollStart, src.indexOf('\n}\n', pollStart))

  const precheckAt = body.indexOf('const pre = decideWake(')
  const isolationAt = body.indexOf('await prepareIsolation(')
  assert.ok(precheckAt > 0, '缺"忙则不开隔离区"的前置判断')
  assert.ok(isolationAt > 0, '找不到 prepareIsolation 调用')
  assert.ok(precheckAt < isolationAt, '前置判断必须出现在 prepareIsolation 之前')
  // 前置判断里要写清"下一轮再试"，否则面板只会显示旧原因
  assert.match(body.slice(precheckAt, isolationAt), /下一轮再试/)
})
