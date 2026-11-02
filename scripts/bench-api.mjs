#!/usr/bin/env node
// 可复现的接口基准：给「要不要动主轮询路径」这类决定提供数字，而不是感觉。
//
// 用法：node scripts/bench-api.mjs [owner/name]
// 会依次测：REST 列表（含头）／GraphQL 列表（含最后评论）／逐条取评论 vs 批量取评论。
import { spawnSync } from 'node:child_process'

const repo = process.argv[2] || 'cli/cli'
const [owner, name] = repo.split('/')
if (!owner || !name) {
  console.error('用法：node scripts/bench-api.mjs owner/name')
  process.exit(2)
}

const gh = (args) => {
  const t0 = Date.now()
  const res = spawnSync('gh', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  return { ms: Date.now() - t0, stdout: res.stdout || '', status: res.status }
}
const kb = (text) => (text.length / 1024).toFixed(1) + ' KB'

console.log('仓库：' + repo)
console.log('---')

// ① REST 列表（我们的主路径形态：--include 才能拿 ETag）
{
  const r = gh(['api', '--include', `repos/${repo}/issues?state=all&sort=updated&direction=desc&per_page=20`])
  const sep = String.fromCharCode(10) + String.fromCharCode(10)
  const idx = r.stdout.indexOf(sep)
  const body = idx > 0 ? r.stdout.slice(idx + sep.length) : r.stdout
  let count = '?'
  try { count = JSON.parse(body).length } catch {}
  console.log(`REST 列表(20, --include): ${r.ms}ms，${count} 条，${kb(r.stdout)}`)
}

// ② GraphQL 列表（含最后评论）
{
  const q = 'query($o:String!,$n:String!){repository(owner:$o,name:$n){issues(first:20,orderBy:{field:UPDATED_AT,direction:DESC})'
    + '{nodes{number title state url author{login} labels(first:5){nodes{name}} assignees(first:5){nodes{login}}'
    + ' comments(last:1){totalCount nodes{author{login} createdAt}}}}}}'
  const r = gh(['api', 'graphql', '-f', 'query=' + q, '-F', 'o=' + owner, '-F', 'n=' + name])
  let count = '?'
  try { count = JSON.parse(r.stdout).data.repository.issues.nodes.length } catch {}
  console.log(`GraphQL 列表(20, 含最后评论): ${r.ms}ms，${count} 条，${kb(r.stdout)}`)
}

// ③ 取最后评论：逐条 vs 批量（用前 3 条 open issue 的号）
{
  const list = gh(['api', `repos/${repo}/issues?state=all&per_page=3`, '--jq', '.[].number'])
  const numbers = String(list.stdout || '').split(String.fromCharCode(10)).map((v) => Number(v.trim())).filter(Boolean).slice(0, 3)
  if (numbers.length === 0) {
    console.log('取评论基准：跳过（仓库没有 issue）')
  } else {
    const t0 = Date.now()
    for (const n of numbers) gh(['api', `repos/${repo}/issues/${n}/comments?per_page=1&sort=created&direction=desc`, '--jq', '.[0].user.login'])
    const perItem = Date.now() - t0

    const aliases = numbers.map((n, i) => `i${i}: issue(number: ${n}) { number comments(last: 1) { nodes { author { login } createdAt } } }`).join(' ')
    const t1 = Date.now()
    gh(['api', 'graphql', '-f', 'query=query($o:String!,$n:String!){repository(owner:$o,name:$n){' + aliases + '}', '-F', 'o=' + owner, '-F', 'n=' + name])
    const batch = Date.now() - t1
    console.log(`取最后评论(${numbers.length} 条): 逐条 ${perItem}ms vs 批量 ${batch}ms`)
  }
}
console.log('---')
console.log('判断标准：主轮询路径已经有 ETag（没变化时 304，零解析），')
console.log('所以只有当 GraphQL 明显更快**且**能省掉后续请求时才值得换主路径。')
