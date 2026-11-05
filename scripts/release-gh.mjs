#!/usr/bin/env node
/**
 * 把 CHANGELOG 里的版本同步成 git tag + GitHub Release。
 *
 * 为什么需要它：我们每轮 `npm publish` 都发了新版本，但 GitHub 的 Releases 面板
 * 一直停在 v0.8.11 —— 客户点「发布」看到的是三天前的版本，等于假装没在更新。
 *
 * 用法：
 *   node scripts/release-gh.mjs --latest      # 只处理 CHANGELOG 里最新那个版本（发版默认用这个）
 *   node scripts/release-gh.mjs               # 回填所有缺失的 tag + release（按批次慢慢来）
 *   node scripts/release-gh.mjs --tag-only    # 只补 tag
 *   node scripts/release-gh.mjs --dry-run     # 只打印将要做什么
 *
 * 约定（本仓库）：**Release 标题只写版本号**（`v0.9.168`），说明放正文。
 * 早年那批标题写成「v0.8.11 —— 官方 GUI 移植…」，已在 0.9.168 那次统一改成纯版本号。
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const REPO = 'MYCF711/dsh-session-superagent'
const LF = String.fromCharCode(10)
const args = new Set(process.argv.slice(2))
const DRY = args.has('--dry-run')
const TAG_ONLY = args.has('--tag-only')
const LATEST_ONLY = args.has('--latest')
// --limit N：按 CHANGELOG 顺序只回填前 N 个（"之前的慢慢改"用这个，别一次造几百个 Release）
// --max-create N：最多新建 N 个 Release（已存在的不算）——回填时用这个，别让「跳过」吃掉额度
const MAX_CREATE = (() => {
  const i = process.argv.indexOf('--max-create')
  if (i < 0) return 0
  const n = Number(process.argv[i + 1])
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
})()
const LIMIT = (() => {
  const i = process.argv.indexOf('--limit')
  if (i < 0) return 0
  const n = Number(process.argv[i + 1])
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
})()

const run = (cmd, argv) => execFileSync(cmd, argv, { encoding: 'utf8' })
const quiet = (cmd, argv) => {
  try { return run(cmd, argv) } catch (error) { return String(error.stdout || '') }
}

/** CHANGELOG → [{ version, subtitle, body }]，最新在前。 */
function readChangelog() {
  const lines = readFileSync('CHANGELOG.md', 'utf8').split(/\r?\n/)
  const entries = []
  let current = null
  for (const line of lines) {
    const head = line.match(/^## \[(\d+\.\d+\.\d+)\](.*)$/)
    if (head) {
      if (current) entries.push(current)
      current = { version: head[1], subtitle: head[2].replace(/^\s*-\s*/, '').trim(), body: [] }
      continue
    }
    if (current && /^## /.test(line)) { entries.push(current); current = null; continue }
    if (current) current.body.push(line)
  }
  if (current) entries.push(current)
  return entries.map((e) => ({ ...e, body: e.body.join(LF).trim() }))
}

/** 版本 → 引入它的那个 commit（最早出现 `"version": "x"` 的提交）。 */
function commitFor(version) {
  const out = quiet('git', ['log', '--format=%H', '-S', `"version": "${version}"`, '--', 'package.json'])
  const list = out.trim().split(LF).filter(Boolean)
  return list[list.length - 1] || ''
}

// 审核 T22 B2：以前只看**本地** tag（`git tag -l`）—— 换一台机器或 clone 浅一点，
// 就会以为「没有 tag」，于是去重复建已经存在的 Release（或漏掉远端有、本地没有的）。
// 以**远端**为准，本地取并集。
const existingTags = new Set(quiet('git', ['tag', '-l']).trim().split(LF).filter(Boolean))
try {
  const remote = quiet('git', ['ls-remote', '--tags', 'origin'])
  for (const line of remote.trim().split(LF)) {
    const name = String(line.split('refs/tags/')[1] || '').replace(/\^\{\}$/, '')
    if (name) existingTags.add(name)
  }
} catch (error) {
  console.error('读不到远端 tag（离线？）：', String(error.message || error).split(LF)[0])
}
const existingReleases = new Set()
try {
  const json = run('gh', ['release', 'list', '--repo', REPO, '--limit', '400', '--json', 'tagName'])
  for (const r of JSON.parse(json)) existingReleases.add(r.tagName)
} catch (error) {
  console.error('读不到 release 列表（gh 没登录？）：', String(error.message || error).split(LF)[0])
  process.exit(1)
}

const entries = readChangelog()
const todo = LATEST_ONLY ? entries.slice(0, 1) : (LIMIT > 0 ? entries.slice(0, LIMIT) : entries)
  // --max-create 与 --limit 可以叠加：先按 CHANGELOG 顺序取窗口，再在里面建到 N 个为止
const createdTags = []
const createdReleases = []
const skipped = []
const noCommit = []

for (const entry of todo) {
  if (MAX_CREATE > 0 && createdReleases.length >= MAX_CREATE) break
  const tag = 'v' + entry.version

  if (!existingTags.has(tag)) {
    const sha = commitFor(entry.version)
    if (!sha) { noCommit.push(entry.version); continue }
    if (!DRY) {
      run('git', ['tag', tag, sha])
      // 只推新建的这一个：`git push --tags` 会把历史遗留 tag 一起推，
      // 远端已有同名不同 sha 的会整批 reject（v0.2.0 就这样挡过一次）。
      try { run('git', ['push', 'origin', tag]) } catch (error) {
        console.error('tag 推送失败', tag, String(error.stderr || '').slice(0, 120))
      }
    }
    existingTags.add(tag)
    createdTags.push(tag)
  }
  if (TAG_ONLY) continue
  if (existingReleases.has(tag)) { skipped.push(tag); continue }
  if (DRY) { createdReleases.push(tag); continue }

  // 临时目录用完即删：preflight 有一条「只建不删」的体检
  const dir = mkdtempSync(join(tmpdir(), 'rel-'))
  const file = join(dir, 'notes.md')
  const notes = (entry.subtitle ? entry.subtitle + LF + LF : '') + entry.body
  try {
    writeFileSync(file, notes, 'utf8')
    run('gh', ['release', 'create', tag, '--repo', REPO, '--title', tag, '--notes-file', file])
    createdReleases.push(tag)
  } catch (error) {
    console.error('创建失败', tag, String(error.stderr || error.message).slice(0, 160))
  } finally {
    try { rmSync(dir, { recursive: true, force: true }) } catch {}
  }
}

console.log(JSON.stringify({
  dryRun: DRY,
  tagOnly: TAG_ONLY,
  tags: createdTags.length,
  releases: createdReleases.length,
  skipped: skipped.length,
  noCommit: noCommit.length ? noCommit : undefined,
}, null, 2))
if (createdReleases.length) {
  console.log('新建 release:', createdReleases.slice(0, 5).join(' '), createdReleases.length > 5 ? '…' : '')
}
