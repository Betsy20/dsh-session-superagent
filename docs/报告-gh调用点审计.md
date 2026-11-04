# 报告：`lib/index.js` 的 `gh` 调用点审计（Gitee 视角）

> **基线**：`c0da515`（0.9.179，`lib/index.js` 2589 行）。
> **审计对象**：`lib/index.js` 里全部 18 处 `run('gh', …)`。
> **分类口径**：`github-only`（设计如此，Gitee 不走这里，无需改）/ `provider-dependent`（Gitee 下必须改道，否则功能坏）/ `unknown`（说不清，需要人判断）。
> **行号**：斜杠前是基线行号；斜杠后是工作区当前快照的行号（`git hash-object lib/index.js` = `1bdf1efc…`，2608 行；Lead 的 L1 改动落地后以后者为准，两者相同时只写一个）。

## 一、逐点分类

行号 | 函数 | 路径 | 分类 | Gitee 后果 | 建议
--- | --- | --- | --- | --- | ---
| 363 | `ghAuthStatusText()` | 轮询（`pollWithItems` 的坏 JSON 诊断） | `github-only` | Gitee 分支交给 `pollWithItems` 的是 `JSON.stringify(items)`，`JSON.parse` 不会失败，这条永远不执行 | 不用改；等 Gitee 也有「坏响应」路径时再接 `giteeWhoami` |
| 373 | `ghHealth()` | 面板（`GET /state`，每次刷新） | `provider-dependent` | 面板「来源」永远显示 gh CLI 的可用性；Gitee-only 且没配 GitHub token 时弹红色横幅「gh CLI 不可用……现在所有轮询都会失败」，实际 Gitee 轮询正常（走 REST + `giteeToken`） | 面板按「有没有 GitHub 守」决定是否探 gh；Gitee 守只展示 `giteeToken` 配没配 |
| 728 | `tokenScopes()` | 面板（`GET /state`，每次刷新） | `provider-dependent` | 「权限范围」显示的是 GitHub 账号的 OAuth scope（或 spawn 失败的红字）；Gitee 私人令牌的权限从没被看过，面板给出了一个与 Gitee 无关的结论 | 只在存在 GitHub 守时探 scope；Gitee 守这一行改成展示 `giteeToken` 状态 |
| 766 | `precheckRepo()` | 面板（`POST /watch` 新建守） | `provider-dependent` | `gh api repos/<gitee-repo>` 打的是 `api.github.com` → 404。**当前被 `isNew` 恒 false 遮蔽**（见 §五）；一旦按注释本意可达，每次新建 Gitee 守都会得到假警告「仓库不存在，或当前 token 没有访问权限」 | Gitee 走 `giteeRepo()`，把 `permissions` 映射成 push/private 再交给 `repoStructureNote` |
| 776 | `precheckRepo()`（404 后的搜索兜底） | 面板（`POST /watch` 新建守） | `provider-dependent` | 上面 404 之后进 GitHub 的 `search/repositories`，拿 Gitee 仓库名去 GitHub 搜，会给客户推荐一个 GitHub 上的同名仓库（纯误导），还只吃 30 次/分钟的 search 额度 | Gitee 下不要用 GitHub 的 search 池：要么不提示，要么另接 Gitee 的搜索 API |
| 874 / 882 | `viewerLogin()` | 轮询（`fetchLastComments` 取「我是谁」） | `provider-dependent` | 这条在 Gitee 下不执行（886–895 行提前 return），但「我是谁」没有 Gitee 版本：`fetchGiteeLastComment` 拿不到 `selfLogin` → `self` 恒 false → **自回声判定永远不成立**（自己留的评论被当成「有人在等」） | 登录名按 provider 分开取（Gitee 用 `giteeWhoami`），并传给 `fetchGiteeLastComment` 的 `selfLogin` |
| 912 / 921 | `fetchLastComments()`（GraphQL 批量） | 轮询 | `github-only` | Gitee 在 886–895 行提前 return，不走 GraphQL 批量；Gitee 的评论由 `fetchGiteeLastComment` 逐条 REST 取 | 不用改 |
| 929 / 938 | `fetchLastComments()`（REST 兜底） | 轮询 | `github-only` | 同上，Gitee 不可达（这条只服务 GitHub 条目） | 不用改 |
| 1004 / 1013 | `pollOnce()`（主轮询） | 轮询 | `github-only` | Gitee 分支在 952–999 行提前 return；ETag / 304 / `x-poll-interval` / 额度自适应全是 GitHub 语义 | 不用改；但 `watch_start` 建的守没有 `provider` 字段，会掉进这条（见 §五） |
| 1365 / 1384 | `probeAccess()` | 面板（`POST /watch` 后台权限探测） | `provider-dependent` | 每次添加/编辑 Gitee 守都打 `gh api repos/<gitee-repo>` → 404，`repoAccess` 永远不更新（新守为 null，面板不显示权限徽章）；若 GitHub 上恰好有同名仓库，会把**那家**的 permissions 写进 Gitee 守（push=false → 唤醒消息里出现「只读仓库」） | Gitee 走 `giteeRepo()`，用 `permissions` 映射 `repoAccess` |
| 2058 / 2077 | `watch_ack` 工具（建标签） | 工具 | `github-only` | `entry.provider !== 'gitee'` 守卫，Gitee 不走（Gitee 没有独立建标签端点） | 不用改 |
| 2068 / 2087 | `watch_ack` 工具（打标签） | 工具 | `github-only` | 三元分支：Gitee 走 `addGiteeLabel`，这条只在 GitHub 侧执行 | 不用改 |
| 2225 / 2244 | `watch_doctor`（gh 登录） | doctor | `provider-dependent` | Gitee-only 机器上 `gh auth status` 必然 FAIL（gh 没装 → spawn-error；装了没登录 → exit 1），doctor 第一行就红，客户被带去查一个跟 Gitee 无关的东西 | 只有在存在 GitHub 守时才检查 gh 登录；Gitee 守检查 `giteeToken` |
| 2259 / 2278 | `watch_doctor`（仓库可访问） | doctor | `github-only` | 2243–2257 行的 Gitee 分支 `continue` 掉了，Gitee 走 `giteeRepo()` | 不用改 |
| 2283 / 2302 | `watch_doctor`（ack 标签存在性） | doctor | `github-only` | 同上，Gitee 提前 `continue`；代价是 Gitee 的 ack 标签存在性没人查（见 §五） | 不用改（Gitee 的标签检查属新增能力，不是改道） |
| 2360 / 2379 | `github` 工具本体 | 工具 | `github-only` | 工具名和语义就是 GitHub REST（path 直通 `api.github.com`），Gitee 没有对应工具 | 不用改 |
| 2374 / 2393 | `repo_here` 工具 | 工具 | `github-only` | 语义就是「当前目录的 GitHub 仓库」；Gitee 工作目录下 `gh repo view` 必然失败（见 §二备注） | 不用改（要支持 Gitee 得另开工具） |
| 2412 / 2431 | `watch_start`（推断仓库） | 工具 | `github-only` | 工具只建 GitHub 守（不写 `provider`），Gitee 守只能从面板加；传 `gitee:owner/name` 反而会造出没有 provider 的坏守，轮询掉进 GitHub 分支 → 404（见 §五） | 不用改；若要支持 Gitee，用 `parseRepoSpec` 解析并写入 `provider` |

**分类统计**：`provider-dependent` 7 处（373、728、766、776、874、1365、2225），`github-only` 11 处，`unknown` 0 处。

## 二、Gitee 下会 404 的点

1. **1365 `probeAccess()` —— 每次添加/编辑 Gitee 守都 404。**
   `gh api repos/<gitee-repo>` 打的是 `api.github.com`，Gitee 仓库在 GitHub 上不存在 → 404。
   后果：`repoAccess` 永远不更新（新守是 `null`，面板不显示权限徽章）；如果 GitHub 上恰好有同名仓库，
   还会把**别家**的权限写进 Gitee 守 —— 唤醒消息里的「只读仓库」提示就是这么来的。
2. **766 `precheckRepo()` —— 新建守的即时体检 404。**
   同一个 `repos/<owner>/<name>` 端点。**当前不可达**（`isNew` 恒 false，见 §五），
   但按注释本意（只有新建才体检）修好之后，每次新建 Gitee 守都会 404，并弹假警告「仓库不存在，或当前 token 没有访问权限」。
3. **776 `precheckRepo()` 的搜索兜底 —— 404 之后接着打 GitHub 的 search 池。**
   它只在 766 收到 404 后触发，用 Gitee 仓库名去 `search/repositories` 里找「是不是想填」，
   会把一个 GitHub 上的同名仓库推荐给 Gitee 用户（search 池只有 30 次/分钟，也会被白白消耗）。

> **不是 404、但同样「Gitee 下打错家/必然失败」的点，改道时一并处理：**
> - **373 `ghHealth()`**：`gh --version` 探的是本机 GitHub CLI；Gitee-only 时面板因此报「所有轮询都会失败」。
> - **728 `tokenScopes()`**：`gh api -i user` 问的是 GitHub 账号；Gitee 的令牌权限从未被读取。
> - **2225 `watch_doctor`**：`gh auth status` 在 Gitee-only 机器上必然 FAIL。
> - **2412 `watch_start`**：在 Gitee 工作目录下 `gh repo view` 必然失败（没有 GitHub remote）。

## 三、结论

基线 18 个调用点里有 **7 处**必须按 provider 改道（373、728、766、776、874、1365、2225），其中 874/1365 两处 Lead 的工作区改动已经改掉 —— **Gitee 支持还差 5 处**（373 面板 gh 健康、728 面板 scope、766/776 添加前体检、2225 doctor 的 gh 登录）才完整。

## 四、复现命令与原始输出

（1）18 处调用点（基线 `c0da515`）：

```text
$ git show c0da515:lib/index.js | grep -n "run('gh'"
363:  const res = await run('gh', ['auth', 'status'], { timeoutMs: 8000 })
373:    const res = await run('gh', ['--version'], { timeoutMs: 10000 })
728:  const res = await run('gh', ['api', '-i', 'user'], { timeoutMs: 20000, env: ghEnv() })
766:  const res = await run('gh', ['api', 'repos/' + repo, '--jq',
776:        const search = await run('gh', ['api', 'search/repositories?q=' + encodeURIComponent(name + ' in:name') + '&per_page=5', '--jq', '.items[].full_name'],
874:    const res = await run('gh', ['api', 'user', '--jq', '.login'], { timeoutMs: 12000, env: ghEnv() })
912:    const res = await run('gh', args, { timeoutMs: 15000, env: ghEnv() })
929:      const res = await run('gh', ['api', `repos/${repo}/issues/${item.number}/comments?per_page=1&sort=created&direction=desc`,
1004:  const res = await run('gh', args, { timeoutMs: 45000, env: ghEnv() })
1365:      const res = await run('gh', ['api', 'repos/' + entry.repo, '--jq',
2058:        await run('gh', ['api', '-X', 'POST', `repos/${entry.repo}/labels`, '-f', `name=${label}`, '-f', 'color=ededed'], { env: ghEnv() })
2068:          : await run('gh', ['api', '-X', 'POST', `repos/${entry.repo}/issues/${number}/labels`, '-f', `labels[]=${label}`], { env: ghEnv() })
2225:      const auth = await run('gh', ['auth', 'status'], { env: ghEnv() })
2259:        const repoRes = await run('gh', ['api', `repos/${entry.repo}`, '--jq', '.full_name'], { env: ghEnv() })
2283:        const labRes = await run('gh', ['api', `repos/${entry.repo}/labels/${encodeURIComponent(label)}`, '--jq', '.name'], { env: ghEnv() })
2360:      const res = await run('gh', ['api', '-X', method, args.path, '--header', 'Accept: application/vnd.github+json'], {
2374:      const res = await run('gh', ['repo', 'view', '--json', 'nameWithOwner,defaultBranchRef,visibility,url'], { cwd: process.cwd(), env: ghEnv() })
2412:        const res = await run('gh', ['repo', 'view', '--json', 'nameWithOwner'], { cwd: process.cwd(), env: ghEnv() })
```

（2）验收命令（当前工作区，行号有 Lead 未提交改动造成的偏移，条数一致）：

```text
$ grep -n "run('gh'" lib/index.js | wc -l
18
```

（3）报告本身的条目数：

```text
$ grep -c '^| ' "docs/报告-gh调用点审计.md"
18
```

## 五、顺带发现（只读审计，未改任何代码）

- **`isNew` 恒 false，`precheckRepo` 是死代码**：`const created = !(state.watchers && state.watchers[id])` 与
  `const isNew = !created && !state.watchers[id]` 互为否定，两条路径都得到 false（blame：`d1041a13`，2026-11-02）。
  所以 766/776 现在跑不到；修 `isNew` 之前，Gitee 的「添加前体检」其实一直空转。
- **`watch_start` 不写 `provider`**：它只认 `owner/name`，不调 `parseRepoSpec`。传 `gitee:owner/name` 能过正则，
  但建出来的守没有 `provider` 字段 → `pollOnce` 走 GitHub 分支 → `gh api repos/gitee:owner/name/...` → 404。
- **Gitee 的 ack 标签存在性没人查**：doctor 在 2257 行 `continue` 掉了 2283 的检查；Gitee 标签不存在时
  `watch_ack` 会 404（`lib/gitee.js` 的 `addGiteeLabel` 注释已说明），但 doctor 不会提前告诉客户。
- **`ghEnv()` 只注入 GitHub 凭据**（`GH_TOKEN` / `GH_CONFIG_DIR`）：Gitee 守上的 gh 调用（373/728/1365/2225 等）
  用的是 GitHub 账号，不是 Gitee 账号 —— 这是它们「打错家」的共同原因。
