# 报告 · CI 与发布可靠性边界审计（只读）

**仓库**：`D:\主工作区\projects\dsh-session-superagent`
**审计快照**：main @ `01330a7`（版本 `0.9.222`）
**审计时间**：2026-11-05 09:50 – 10:05（+08:00）
**范围**：`.github/workflows/ci.yml`、`.github/workflows/dependabot.yml`、`scripts/preflight.mjs`、`scripts/preflight-modes.mjs`、`scripts/check-maintenance.mjs`、`scripts/release-gh.mjs`、`scripts/gate-lock.mjs`、`package.json`、`UPDATING.md`、`docs/维护标准.md`、`.git/hooks/pre-push`（本机未入库的钩子），外加 GitHub 上只读的 run / PR / release / 分支保护历史
**方式**：读代码 + `gh run list / view`（只读）+ 本地复跑（`node --test`、`TZ=UTC` 复跑、`git archive` 到 `/tmp` 复跑 0.9.209 那份代码）
**边界**：没有改任何文件（本报告是唯一新增文件）、没有 commit / push、没有 `npm publish`、没有 `gh release create`、没有 `gh workflow run`（**没有触发过任何 workflow**）；临时目录 `/tmp/aud209` 已在会话内删除，`git status` 收尾为空。

> ⚠ 审计期间**另一个会话仍在往 main 提交**（HEAD 依次为 `7650473` → `47a1e41` → `01330a7`）。本报告所有行号对齐 `01330a7`，且 `ci.yml` / `preflight.mjs` / `check-maintenance.mjs` / `release-gh.mjs` / `package.json` 的 md5 在引用时与审计全程一致（`ci.yml` = `3c9486d5…`）。若后续改动这几个文件，行号需要重新对齐。

---

## 结论摘要

CI 的**配置**基本是对的：顶层 `contents: read`、没有 `secrets.*`、没有 `pull_request_target`、有 `concurrency:`、required check 精确匹配矩阵 job 名。问题全部在**边界**上，不在语法上：

1. **CI 红了也不知道挂在哪条用例** —— `preflight` 把 `node --test` 的输出整段吞掉，只留一个计数。0.9.209 那次 `361/363` 至今没有一条日志能说出失败的是哪条；我按 commit 复跑那份代码（本地 + `TZ=UTC`）是 363/363 全过，说明它是环境相关、**本地不可复现**的，而 CI 里没有任何留痕可供事后定位。
2. **"跳过"会被记成 PASS** —— 对比度体检在无浏览器环境（＝CI）走 `res.status === 2` 分支，先记一条 `PASS … 跳过`，再被下面无条件的 `record()` 记成 `PASS … 无数据`。CI 日志里能直接看到**两行同名 PASS**。这类"假绿"比红更贵：它让门禁在 CI 上永远绿。
3. **tag 是整条发布链里唯一零校验的产物** —— workflow 只监听 `push: branches: [main]`，推 tag 不触发任何 CI；`check-maintenance` 只在 push main 时跑，且用 `git tag -l` 只看**本地** tag；`release-gh` 把 tag 推送失败吞掉后照样记成"已存在"。三处叠加的结果是：tag 打错、tag 只在本地、tag 指向旧 commit，**全部都能一路绿灯走完**。
4. **`npm publish` 与 CI 之间没有任何连接** —— `package.json` 里没有 `prepublishOnly` / `prepublish`，CI 里也没有 publish job。门禁红着、CI 被 cancel 掉、甚至没跑过 preflight，都能直接发版。这是不可撤回的动作。

按"必须修 / 值得修"分档见下；每档都给了 `文件:行号` + 原文 + 触发条件 + 具体后果。

---

## 〇、CI 到底跑什么（逐条）

`.github/workflows/ci.yml` 全文 45 行，只有 **1 个 job、2 个矩阵、5 个 step**。

| # | 触发条件（原文位置） | 干什么 | 失败会怎样 |
|---|---|---|---|
| 0 | `on: push: branches: [main]` + `pull_request:`（`ci.yml:3-6`） | 只对 **push 到 main** 和**任意 PR** 触发。推 `feat/*` 分支不触发；**推 tag 不触发** | 分支推上去可以先不看 CI，直到开 PR 或合进 main |
| 1 | `test` job，`strategy.matrix.node: [22, 24]`（`ci.yml:18-22`） | 两个 Node 版本各跑一份完全相同的 5 个 step | 任一份红 = job 红 |
| 2 | `actions/checkout@v7` + `fetch-depth: 0`（`ci.yml:25-27`） | 全历史 + 全 tag（`check-maintenance` 要读 tag） | 浅克隆会让维护一致性假红 |
| 3 | `node scripts/preflight.mjs --fast [--no-maintenance]`（`ci.yml:34-35`） | PR 上追加 `--no-maintenance`；main 上跑全量 `--fast` | 整个 job 红。**这是唯一的门禁入口** |
| 4 | `node scripts/ui-audit.mjs`（`ci.yml:37-38`） | UI 静态体检（写死颜色 / 可访问性 / 官方结构） | 红 |
| 5 | `node scripts/check-docs.mjs`（`ci.yml:40-41`） | 文档链接 / 索引总数 / 阅读路径 | 红 |
| 6 | `if: github.event_name == 'push'` → `node scripts/check-maintenance.mjs`（`ci.yml:43-45`） | 版本 / tag / CHANGELOG / 徽章对齐 | main 上红；**PR 上这条 step 不存在**（不是 SKIP，是根本没这个 step） |

失败会不会阻止合并 / 发布：

- **阻止合并**：只对 PR 有效，且只对 `test (22)` / `test (24)` 两个 required check 有效（分支保护实测 `required_status_checks.contexts = ["test (22)","test (24)"]`）。
- **阻止发布**：**不会**。没有任何 workflow 负责 `npm publish` 或 `gh release create`；发布是在本机跑的（`UPDATING.md:10-40`），CI 的结论不参与。
- 实测的旁证：最近 100 条 run = 92 success / 7 failure / 1 in-progress；main 上的提交**全部**是 `push` 事件（没有一条走 PR 合并），也就是说 required check 在实际流程里从未起过拦截作用（管理员可直推，见 `docs/维护标准.md:26` 自己记的 `enforce_admins=false`）。

---

## 一、必须修

### M1 CI 红了无法定位：`node --test` 的输出被整段吞掉，日志里只有一个计数

**位置**：`scripts/preflight.mjs:60-66`

```js
  const res = tryRun('node', ['--test'])
  const out = String(res.stdout || '') + String(res.stderr || '')
  const tests = (out.match(/# tests (\d+)/) || out.match(/ℹ tests (\d+)/) || [])[1]
  const pass = (out.match(/# pass (\d+)/) || out.match(/ℹ pass (\d+)/) || [])[1]
  const fail = (out.match(/# fail (\d+)/) || out.match(/ℹ fail (\d+)/) || [])[1]
  record('单测 node --test', res.status === 0 && fail === '0', `${pass}/${tests} 通过，失败 ${fail}`)
```

`out` 只被 `match` 三次，**从来没有被打印**；`record()` 只输出 `${pass}/${tests} 通过，失败 ${fail}`。

**触发条件**：任何一条用例在 CI 上失败（`res.status !== 0`）。

**会导致什么**：CI 日志里能拿到的全部信息就是一行计数。实测 0.9.209 那次失败（run `41938114934`）的 `--log-failed` 全文里，与本项相关的**唯一**一行是：

```
FAIL 单测 node --test                    361/363 通过，失败 1  (1.3s)
```

整条日志里没有任何用例名、没有断言消息、没有堆栈。后果链条：

1. 修复只能靠猜。下一个提交 `a88b808` 给的归因是「GBK 用例按环境跳过（**CI 无 ICU**）」（`git log -1 a88b808`），改的是 `test/body.test.mjs:34-37`；
2. 但这个归因**与今天的 runner 不符**：我在本地复跑 `b4b0fe9` 那份代码（`git archive` 到 `/tmp`）得到 `tests 363 / pass 363 / fail 0`，`TZ=UTC` 也一样；而当前 main 上 CI 报的是 `368/369 通过，失败 0` —— 只有 1 条被跳过（`test/secrets-acl.test.mjs:12` 的 Windows ACL 那条），**GBK 那条在 CI 上是真跑的**。也就是说 runner 有 GBK，`hasGbk` 守卫在 CI 上不生效，那次红的真实成因至今没有任何记录；
3. 于是"红过一次 → 猜了个原因 → 绿了"闭环了，但**同一类失败还会再来，而且下次依然拿不到用例名**。

这条也是"361/363 里 1 条必挂、直到下一轮才发现"那件事的**根因**：不是没人看，是**看了也看不出是什么**。

**最小修法**：`fail !== '0'` 时把 `out` 的最后 ~40 行打到 stdout（或 `core.setFailed` 里带上），一行改动，不需要改结构。

---

### M2 无浏览器环境下「对比度体检」被记成 PASS，且汇总里出现两条同名项

**位置**：`scripts/preflight.mjs:248-257`

```js
  // 退出码 2 = 环境问题（本机没有浏览器 / 渲染空）。CI 上没有浏览器是正常的，
  // 这种情况必须 SKIP 而不是 FAIL —— 否则「没量」会被当成「不达标」，门禁在 CI 里永远红。
  if (res.status === 2) {
    record('对比度体检', true, '跳过：本机没有可用的浏览器（CI 环境正常现象）')
  } else if (!light || !dark) bad.push('量不到数据（渲染/浏览器失败）')
  else {
    if (light.groups > base.light.groups) bad.push('浅色不达标 ' + light.groups + ' 组 > 基线 ' + base.light.groups)
    if (dark.groups > base.dark.groups) bad.push('深色不达标 ' + dark.groups + ' 组 > 基线 ' + base.dark.groups)
  }
  record('对比度体检', bad.length === 0, bad.length ? bad[0] : (light && dark ? … : '无数据'))
```

注释自己写的是「必须 SKIP 而不是 FAIL」，但代码做的是**记 PASS**（第二个参数 `true`）。而且 `record()` 在 `if/else` 之外**无条件又调用了一次**，所以 `res.status === 2` 时写两行。

**触发条件**：CI 恒成立（runner 上没有浏览器，`audit-contrast` 返回 2）。本地没装无头浏览器时同样成立。

**会导致什么**：实测 CI 日志（run `41951783101`，main 上 0.9.222）：

```
PASS 对比度体检                             跳过：本机没有可用的浏览器（CI 环境正常现象）  (10.0s)
PASS 对比度体检                             无数据  (0.0s)
```

具体后果：

- **对比度回归在 CI 上永远不会红**。写死颜色 / 用错 token / 深浅色对比度掉到基线以下 —— 这一类回归的唯一量化门禁就是它，而它在 CI 里的结论恒为 PASS。
- 汇总里多一行同名项，`通过 N 项` 的 N 是虚的；看表的人会以为"体检过了"，实际是"没量"。
- 这与仓库自己的标准直接冲突：`preflight.mjs:44-45` 已经写明「'skip' 是第三种状态 —— 这项**没跑**…以前调用方传 exit 0 就被记成 PASS，汇总里含一项没跑的检查，是假绿」，本项恰好是同一个 bug 的另一处。

**最小修法**：`res.status === 2` 时 `record('对比度体检', 'skip', …)` 并 `return`/`else` 掉第二次 `record()`。

---

### M3 tag 是发布链上唯一零校验的产物：不触发 CI、只查本地、推失败被吞

三处独立证据，合起来是同一个失败模式。

**(a) 推 tag 不触发任何 CI** —— `.github/workflows/ci.yml:3-6`

```yaml
on:
  push:
    branches: [main]
  pull_request:
```

`push` 只有 `branches: [main]`，没有 `tags:`。推 `v0.9.222` 这个 ref 时 workflow **不会启动**（GitHub 对 tag ref 做 branch 过滤后丢弃）。当前 252 个 tag 全部只经过了「本地 `git tag` + 一次 `git push`」。

**(b) 维护一致性只看本地 tag** —— `scripts/check-maintenance.mjs:45-46`

```js
const tags = new Set(run('git', ['tag', '-l']).split('\n').filter(Boolean))
check('当前版本有 git tag', tags.has(tag), tags.has(tag) ? tag : '缺 ' + tag + '（跑 node scripts/release-gh.mjs --latest）')
```

只读**本地** `git tag -l`。CI 里能过是因为 `actions/checkout@v7` 配了 `fetch-depth: 0`（`ci.yml:24-27`）会顺带取到 tag —— 换句话说，这条检查成立的前提是"远端恰好有 tag"，而它自己并不去问远端。`scripts/release-gh.mjs:74-86` 早就为同一个问题改成了"远端为准、本地取并集"（注释：`审核 T22 B2：以前只看本地 tag —— 换一台机器或 clone 浅一点，就会以为「没有 tag」`），这条没跟着改。

**(c) tag 推送失败被吞掉，并且照样记成"已存在"** —— `scripts/release-gh.mjs:111-120`

```js
      run('git', ['tag', tag, sha])
      // 只推新建的这一个：`git push --tags` 会把历史遗留 tag 一起推，
      // 远端已有同名不同 sha 的会整批 reject（v0.2.0 就这样挡过一次）。
      try { run('git', ['push', 'origin', tag]) } catch (error) {
        console.error('tag 推送失败', tag, String(error.stderr || '').slice(0, 120))
      }
    }
    existingTags.add(tag)
    createdTags.push(tag)
```

`catch` 只打一行 stderr，然后**无论如何** `existingTags.add(tag)` —— 于是本进程后续的 `if (!existingTags.has(tag))` 判断和**下一次运行**都不再尝试推这个 tag。紧接着 `:132` 的 `gh release create` 在没有远端 tag 时会由 GitHub 在**默认分支 HEAD** 上自动补建一个同名 tag。

**触发条件**：

- (a)(b)：任何一次「tag 打在了错的 commit 上 / tag 只在本地 / tag 推了但推的是旧 ref」；
- (c)：`git push origin <tag>` 失败即可 —— 本仓库**真实发生过** push 被 GitHub Push Protection 拦下（提交里有像密钥的字面量），也经历过"远端已有同名不同 sha 整批 reject"（代码注释自己记着 v0.2.0）。

**会导致什么**（按发生顺序，任何一步都会留下静默半成品）：

1. tag 只在本地 → `npm publish` 照常成功、`release-gh` 照常建出 Release（GitHub 自动在 main HEAD 补 tag）→ **用户 `git checkout v0.9.x` 拿到的不是发版那一版**，而且之后本地 tag 再推会被 `already exists` 拒掉，全程没有一条报错；
2. tag 打在旧 commit 上（`commitFor()` 用 `git log -S '"version": "x"'` 找"最早引入这个版本串的提交"，`release-gh.mjs:68-72`，是个启发式）→ CI 全绿、npm 绿、Release 绿，只有 tag 指向错的代码；
3. 因为 (a) 推 tag 不跑 CI、(b) 只查本地，上面两种状态**不会被任何自动化发现**。`UPDATING.md:24-27` 已经把相邻的坑写进了流程（"先推 commit 再补 tag，CI 会在「维护一致性」那一步红 —— 实测过一次"），但那只是"tag 还没建"的方向；"tag 建错了/推失败了"这个方向没有任何挡板。

---

### M4 `npm publish` 与 CI 完全解耦：没有任何发布前门禁

**位置**：`package.json:31-42`（`scripts` 全量）与 `.github/workflows/ci.yml`（无 publish job）

```json
  "scripts": {
    "test": "node --test",
    "check": "node --test",
    "preview:orbit": "node scripts/preview-orbit.mjs",
    "sync:profile": "node scripts/sync-profile.mjs",
    "smoke:observe": "node scripts/smoke-observe.mjs",
    "sync:profile:check": "node scripts/sync-profile.mjs --check",
    "sync:profile:repair": "node scripts/sync-profile.mjs --repair",
    "preview": "node scripts/render-preview.mjs",
    "preflight": "node scripts/preflight.mjs",
    "preview:themes": "node scripts/render-preview.mjs preview-themes.html"
  },
```

没有 `prepublishOnly` / `prepublish` / `prepack`；`ci.yml` 里也没有任何 `npm publish` 步骤（全文只有 5 个 step，见「〇」）。

**触发条件**：任何一次手工 `npm publish`。

**会导致什么**：发布动作**不读取任何门禁结论**：

- CI 红着可以发（当前 main 的 7 条 failure 里就有 main 上的真实红）；
- CI 被 `cancel-in-progress` 取消掉可以发（`ci.yml:13-15`，见 W2）；
- 上一次提交是红的、这次只改了个错别字也一样发 —— `npm publish` 不跑 `node --test`、不跑 `preflight`、不查 `check-maintenance`；
- 而 npm 上的版本是**不可撤回**的（`unpublish` 有 72 小时/依赖限制，实际上等于撤回不了），DSH 用户 `dsh plugin update` 拿到的就是这一版。

对照 `UPDATING.md:21-22`（"3) 全量门禁（不是 --fast）`node scripts/preflight.mjs`"）与 `UPDATING.md:5`（"默认分支只接受通过门禁的 PR"）：这两条都是**流程纪律**，没有任何机器执行它。而 `MAINTENANCE.md:69` 自己立的标准是"**标准写在文档里不算数**：新加的检查必须接进 `preflight` 或 CI，否则就是「标准悬空」"（`docs/维护标准.md:76` 同义："标准写在文档里不算数，接进 CI 才算。"）。

**最小修法**：`"prepublishOnly": "node scripts/check-maintenance.mjs && node scripts/preflight.mjs --fast"`，两分钟的事，把"发布前必跑"从纪律变成机制。

---

## 二、值得修

> 以下每一条都不满足"必须修"的两条门槛（确定的触发路径 + 确定的后果），但都在同一条链上，且都有实证。

### W1 `check-maintenance` 里标着「只提示」的那条，其实会让门禁红

**位置**：`scripts/check-maintenance.mjs:60-62`

```js
const since = tags.has(tag) ? run('git', ['diff', '--name-only', tag + '..HEAD', '--', 'lib/', 'client.js']) : ''
const dirty = since.split('\n').filter(Boolean).length
check('自上个 tag 起未改动运行时代码（未 bump 不算错，只提示）', dirty === 0, dirty === 0 ? '干净' : dirty + ' 个文件已改，尚未 bump 版本')
```

`check()` 的第二个参数是 `dirty === 0`，而 `:64` 把所有 `!ok` 收进 `failed`、`:71` 再 `process.exitCode = 1`。名字和注释都说"只提示"，行为是**硬失败**。

**后果**：`v0.9.222` 这种"先 bump + tag，再继续改 lib"的正常节奏里，只要 tag 已存在而 lib 又动过，下一次 push main 就红。而红一次就会被当成"又来了"，正是"CI 红了没人看"的土壤。要么改成真提示（`.push({ok:true})` + 只打印），要么把名字和注释改成"会红"。两者选一个，别让文案撒谎。

### W2 `concurrency` 用 `cancel-in-progress` + 没有 `timeout-minutes`

**位置**：`.github/workflows/ci.yml:12-15` / `:18-22`

```yaml
# 同一分支的旧运行直接取消：省 runner，也避免"旧结果盖新结果"
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
```

- 同一 ref（main）连推两次，前一次运行被 **cancel**。被 cancel 的那次如果本来要红，结论就是 `cancelled` 而不是 `failure` —— 结果页上看不到红。历史 100 条 run 里目前是 0 条 cancelled（推送间隔约 2–5 分钟、单次 30 秒，还没撞上），但机制在，且 trait 只在"撞上"时才生效。
- job 没有 `timeout-minutes`，GitHub 默认 360 分钟/ job。实测 PR run 的**耗时**到过 `7h0m27s`（#7）和 `12h36m23s`（#3）—— 那些 run 是 0 job 的异常态（见 W3），但"挂住"在这条链上不是假设。

### W3 PR 阶段的三处缺口：fork PR 从不跑、PR 能改自己的门禁、required check 名字是硬耦合

- **fork PR 的 CI 实际没跑过**：4 条来自 fork 的 PR（#5 #6 #7 等）对应 run 全部 `jobs: []`（0 个 job）、`conclusion: failure`，页面提示 "This run likely failed because of a workflow file issue"；其中一条先出现 `action_required`（0 秒）—— 那是"首次贡献者需要维护者批准后才会起跑"。也就是说：**外部 PR 在批准前，`test (22)/(24)` 永远不报告，PR 页面上看起来只是"等检查"**。实测这几条 PR 最后是 `CLOSED`，等于人工接管。
- **PR 可以改掉自己的门禁**：`pull_request` 事件用的是 **merge ref**（PR head 合进 base）里的 workflow 文件。一个把 `ci.yml` 里 `preflight` 那一步删掉的 PR，在它自己的 run 里就是绿的 —— 而 required check 只要求"名字为 `test (22)`/`test (24)` 的 check 成功"。要堵住这条，需要 `pull_request` 之外再挂一个用 base 分支代码跑的 job（或把关键检查做成独立 workflow，由 `pull_request` 触发但在 base 上执行）。
- **required check 名字硬耦合**：保护规则里的 contexts 是字符串 `test (22)` / `test (24)`（矩阵展开出的名字），`ci.yml:18-22`。以后矩阵改成 `[22]`、或 job 改名，`test (24)` 会**永远 pending** —— 所有 PR 都合不进去，而且没有任何报警。改矩阵时请同步改保护规则（或改用 job 别名）。

### W4 `profile 一致性` 在 CI 里连 SKIP 都不算，直接从汇总里消失

**位置**：`scripts/preflight.mjs:117-129`

```js
  if (!existsSync(profileDir)) {
    console.log('SKIP profile 一致性 --check        没有 profile 安装目录（CI 环境正常）')
  } else {
```

只 `console.log`，**没有 `record()`** → 该项不进 `rows` → 汇总的"通过 N 项"里既不算过也不算跳。`record()` 的三态设计（`:44-45`）就是为这种情况准备的，这里没用上。

**后果**：`sync-profile --check`（缺失 / 断链 / 陈旧三个判据）在所有自动化里都不存在。安装副本与仓库不一致这件事，只有人手动跑才会发现（`UPDATING.md:36` 第 7 步）。

### W5 真正在拦发布的那道门禁不在版本控制里

**位置**：`.git/hooks/pre-push`（本机文件，`git` 从不跟踪 hooks）

该钩子做了真正的发布前门禁：快档 `check-docs` + `ui-audit` 永远跑；推 main / 首次推分支时跑 `preflight --fast`，推 main 时额外跑 `check-maintenance`；`SUPERAGENT_SKIP_HOOK=1` 是逃生门（`:14-18`）。

**后果**：新机器 / 新 clone / 换会话之后**这道门禁根本不存在**，而 `UPDATING.md` 把"推 commit + tag"当成发布链的最后一关。换句话说：本仓库"发布前一定会跑门禁"这件事，依赖的是一份不入库的本机文件。建议把同样的分级逻辑做成 `scripts/pre-push.mjs`，再由 README/UPDATING 提示 `git config core.hooksPath`。

### W6 CI 全程 `DSH_SUPERAGENT_OFFLINE=1`，真实 `gh` 调用路径零覆盖

**位置**：`scripts/preflight.mjs:55-56` + `lib/index.js:586-615`

```js
// 单测/门禁不该依赖真实 GitHub：没有有效凭证时每次 gh 调用要等到超时（实测单文件 100 秒）
CHILD_ENV.DSH_SUPERAGENT_OFFLINE = '1'
```

```js
// 离线判定抽成纯函数（有单测），见 isOfflineMode。
if (file === 'gh' && isOfflineMode()) {
  resolve({ code: 0, stdout: offlineGhReply(args), stderr: '' })
  return
}
```

`offlineGhReply()`（`lib/index.js:592-600`）对任何 list 类调用都返回 `items: []`。

**后果**：CI 里**从来没有一次真实 `gh` 调用**。`gh api --include` 的头体分隔（Windows CRLF）这类格式问题，按构造就不可能在 CI 上红 —— 事实也是这样：`fix(gh): --include 的头体分隔要认 CRLF` 这条在 PR #2 / #4 / #5 之间反复了三轮才在真机上定下来。这条不是说"要联网跑测试"，而是：**离线替身与真 CLI 的输出契约，需要有一处对拍**（比如把真实 `gh api --include` 的原始字节存成 fixture，再让 `parseGhInclude` 在 CI 上跑）。

### W7 维护一致性在 push main 时跑两遍

`preflight.mjs:438-444`（默认跑）与 `ci.yml:43-45`（单独 step）在 push 上都会跑 `check-maintenance.mjs`。纯浪费（0.1s，可忽略），但两处口径以后容易漂：一处改了参数另一处没改。

### W8 文档与保护规则漂移两处

- `docs/维护标准.md:74`：`CI（.github/workflows/ci.yml）在每次 push 与 PR 上跑前三条中的前两条 + UI 体检 + 文档契约` —— 实际只对 **push 到 main** 生效（`ci.yml:4-5`），推 `feat/*` 不跑。
- `UPDATING.md:5`：`默认分支只接受通过门禁的 PR` —— 分支保护里**没有** `required_pull_request_reviews`（实测保护规则 JSON 里没有这个键），且 `enforce_admins=false`；实际全部提交都是直推 main（100/100 条 main run 都是 `push` 事件）。`docs/维护标准.md:26` 已经把"保留紧急直推"记成**已知取舍**，但 `UPDATING.md:5` 仍写成硬规则，两句互相矛盾。

### W9 回填没做完：1 个 tag 没有对应 Release

实测：本地/远端 tag 共 **252** 个，GitHub Release **251** 个，差的是 **`v0.8.73`**（`comm -23 <(git tag -l) <(gh release list --tagName)`）。正是"npm publish 成功但 Release 没建"那件事的残留。`release-gh.mjs` 的默认（不带 `--latest`）模式就是为回填准备的，跑一次即可；这条不影响新版本，但会一直让"tag 数 ≠ Release 数"。

### W10 本地没有凭据扫描，Push Protection 是唯一防线

实测仓库安全设置：`secret_scanning: enabled`、`secret_scanning_push_protection: enabled`，但 `secret_scanning_non_provider_patterns: disabled`、`secret_scanning_validity_checks: disabled`。仓库里没有任何 secret-scan 脚本/钩子（`scripts/` 下无 `audit-secret*`），`preflight` 也没有这一项。

**后果**：一处像密钥的字面量（哪怕只是示例）会被**远端**拦下，然后必须 `reset --soft` 压提交 —— 这正是历史上真实发生过的场景。本地没有任何前置检查，"提交里有没有像密钥的串"要在 push 那一刻才知道，而那时提交已经是既成事实。加一条 `preflight` 项（正则扫 `lib/ client.js scripts/ test/ docs/`，命中就红）成本很低。

---

## 三、确认没问题

以下都是**实测**过的，不是"看着像对"：

| 项 | 结论 | 证据 |
|---|---|---|
| 顶层权限 | ✅ `contents: read`，无 job 级提权 | `ci.yml:8-10`；`grep -c "secrets\." ci.yml` = **0**，全文没有 `permissions:` 的第二次出现 |
| 凭证暴露面 | ✅ CI 不接触任何 secret | `ci.yml` 里 `secrets.` 出现 **0** 次；没有任何 workflow 做 publish / release，发布凭证不进 Actions |
| 危险触发器 | ✅ 没有 `pull_request_target` | `grep -c pull_request_target ci.yml` = **0**；只有 `push` 与 `pull_request` |
| 并发组 | ✅ 有 `concurrency:`（按 ref 分组） | `ci.yml:13-15`；虽然按 ref 分组 + cancel 有 W2 的副作用，但"两个 tag 同时推"这个具体场景**不会互相干扰**——因为推 tag 根本不触发 workflow（见 M3a），连组都不会进 |
| 分支保护底线 | ✅ 禁强推、禁删 main | 保护规则 `allow_force_pushes=false` / `allow_deletions=false` |
| required check 已接线 | ✅ 名字与矩阵精确匹配 | `contexts = ["test (22)","test (24)"]` 对 `ci.yml:18-22` 的 `test` + `node: [22, 24]` |
| 远端凭据扫描 | ✅ 开着 | `security_and_analysis.secret_scanning = enabled`、`secret_scanning_push_protection = enabled` |
| Release 幂等 | ✅ 重复跑不会重建 | `release-gh.mjs:123` `if (existingReleases.has(tag)) { skipped.push(tag); continue }`；实测 251 个 Release 无重名 |
| tag 与版本一致（近期） | ✅ 最近 25 个 tag 全部对 | 逐个 `git show <tag>:package.json` 比对：**0 个不一致** |
| npm 与 tag 对齐 | ✅ 当前一致 | `npm view … version` = `0.9.221`（当时 `latest` 也是 0.9.221），Release `v0.9.221` = Latest |
| 单测本地全绿 | ✅ 369/369 | 见「五、复跑输出」；`TZ=UTC` 复跑同为 369/369（没有时区相关脆弱用例） |
| 门禁互斥锁 | ✅ 实现正确 | `gate-lock.mjs`：`mkdirSync` 原子性 + 陈旧锁清理 + 只删自己的锁 + token 重入（`:49-104`）。CI 上是干净 VM，不会撞锁；并发风险只在本地两会话（见 `docs/报告-发布工具链审计.md` 的实测） |
| 门禁临时产物 | ✅ 已忽略 | `.gitignore:17-18` 覆盖 `.gate-lock/` / `.gate-recover/`；审计收尾 `git status --porcelain` 为空 |

**关于"两个 tag 同时推会怎样"**（题目第 4 点）的完整回答：

1. **不会触发任何 workflow**（`ci.yml:4-5` 只监听 `branches: [main]`），所以没有并发问题，也没有任何校验；
2. 两个 tag 都会成功落到远端（GitHub 对 tag 的推送是逐个 ref 的）；
3. 唯一会"并发"的是**两个会话在本机同时跑 `release-gh`** —— 那时 `git tag` 相同、`gh release create` 会撞 `already exists`，其中一方报 "创建失败" 后被 catch 掉（`release-gh.mjs:134-136`），结果仍是"建了一个、另一个跳过"，不会出现两个 Release；
4. 真正需要 `concurrency` 的是本地门禁，它已经有锁（`gate-lock.mjs`），且锁的实现是对的。

---

## 四、第 6 点：`--fast` 与「CI 里实际被跳过的每一项」（完整表）

`scripts/preflight-modes.mjs:5-16` 的 `FAST_SKIPS` **只登记了 2 项**（这是"单一事实来源"，`docs/preflight-modes.md` 由它生成，preflight 第 ⑥.2 项还会校验两者一致）。但 CI 实际跑的是 `--fast --no-maintenance`（PR）/ `--fast`（main），**加上环境本身造成的跳过，一共是 7 项**。下表是完整的 7 项，前 2 项是 `FAST_SKIPS` 登记的，后 5 项是**没登记但实际发生了**的。

| # | 被跳过的检查 | 在 CI 里为什么会被跳过（位置 + 原文） | 为什么它可以被跳过 | 风险（跳过会漏掉什么） | 实测证据 |
|---|---|---|---|---|---|
| 1 | **门禁自检**（`verify-gates`，21 次注入验证） | `scripts/preflight.mjs:102` `if (!FAST) {` —— CI 用 `--fast`。登记在 `preflight-modes.mjs:6-10`：`why: '要 21 次注入（每次改文件再跑检查），约 4 秒'` | 慢，且注入式验证要改文件再还原，CI 上没必要每次都做 | **不会发现"某条检查已经装死"**。这是唯一能证明另外几十条门禁"真的会红"的东西，而它只在本地跑 | 0.9.219 `fix(gates): 修 3 条假阴性（空输出=通过 / skip 换行写 / ✅ 与版本同行）`、0.9.222 `3 条假阴性（只看第一处 / 清单写死 6 个 / 只认一种拼写）` —— **两次都是"CI 一直绿、门禁其实是哑的"** |
| 2 | **冒烟 `smoke:observe`** | `scripts/preflight.mjs:416-417` `if (FAST) { console.log('SKIP 冒烟 smoke:observe --fast 跳过')`；登记在 `preflight-modes.mjs:11-15`：`why: '需要真机宿主（DSH_SMOKE_HOST=1）'` | 需要真机宿主 + 已登录 `gh`，CI 上都不具备 | 真机上的"观察模式"失效不会被发现（这是产品主路径：真轮询 → 真唤醒） | CI 日志 `SKIP 冒烟 smoke:observe              --fast 跳过` |
| 3 | **维护一致性**（版本 / tag / CHANGELOG / 徽章） | PR 上：`ci.yml:35` 传 `--no-maintenance` → `scripts/preflight.mjs:438-439` `console.log('SKIP 维护一致性 … --no-maintenance 跳过（PR 分支还没打 tag）')`。main 上：`ci.yml:44-45` 只在该 step 里跑一次 | PR 分支上版本号已 bump、tag 要合并后才打，这条必然红（人为规避，有注释说明） | **PR 阶段完全不检查版本一致性**：只 bump 了 `package.json` 没改 CHANGELOG、徽章没改、`lib/index.js` 的 `SERVER_VERSION` 忘了改 —— 这些 PR 可以绿着合进来，只有合进 main 之后才红（而 main 上红已经晚了，见 M4） | PR 上 `SKIP 维护一致性`；main 上 `PASS 维护一致性                             版本/tag/CHANGELOG/徽章 对齐  (0.1s)` |
| 4 | **profile 一致性 `--check`** | `scripts/preflight.mjs:121-122` `if (!existsSync(profileDir)) { console.log('SKIP profile 一致性 --check        没有 profile 安装目录（CI 环境正常）')` | CI 上没有 `%DSH_HOME%\profiles\desktop\node_modules\…` 安装副本 | 比"跳过"更糟：它**没有调用 `record()`**，所以连 `SKIP` 都不算，直接从汇总里消失（W4）。安装副本缺失 / 断链 / 陈旧三件事在自动化里不存在 | CI 日志同一行；汇总行数里没有这一项 |
| 5 | **对比度体检**（`audit-contrast`） | `scripts/preflight.mjs:250-251` `if (res.status === 2) { record('对比度体检', true, '跳过：本机没有可用的浏览器（CI 环境正常现象）')` | runner 上没有无头浏览器，量不到（退出码 2 = 环境问题，不是不达标） | **被记成 PASS，不是 SKIP**（M2）。写死颜色 / token 用错 / 对比度掉到基线以下，在 CI 上永远不会红；且汇总里多一行同名项 | CI 日志**两行**：`PASS 对比度体检 … 跳过：本机没有可用的浏览器` + `PASS 对比度体检 … 无数据` |
| 6 | **真实 `gh` 调用**（整条 CLI 契约） | `scripts/preflight.mjs:55-56` `CHILD_ENV.DSH_SUPERAGENT_OFFLINE = '1'`；消费方 `lib/index.js:614` `if (file === 'gh' && isOfflineMode()) { resolve({ code: 0, stdout: offlineGhReply(args), stderr: '' }) }` | 没凭证时每次 `gh` 调用要等到超时（注释实测"单文件 100 秒"），断言与网络无关 | CI 里 `gh` 的输出**全部是固定假串**（`items: []`）。真实 CLI 的字段、编码、`--include` 的头体分隔、错误文案 —— 全在 CI 覆盖之外（W6）。真机上才发现的问题会一直要真机才能发现 | `--include` CRLF 的修复在 PR #2 → #4 → #5 之间反复三轮；PR #5 的 run（`41785303657`）**0 个 job** |
| 7 | **平台相关用例 `secrets-acl`（Windows ACL）** | `test/secrets-acl.test.mjs:12` `{ skip: process.platform !== 'win32' ? '只在 Windows 上验证 ACL 收紧' : false }` | ACL 是 Windows 专有行为，Linux runner 上无意义 | CI 的用例总数比本地少 1（`368/369` vs `369/369`），"凭证文件只有当前用户可读"这条安全性质在 CI 上**没有任何断言** | main 上 CI 日志 `PASS 单测 node --test                    368/369 通过，失败 0`；本地 `pass 369 / skipped 0` |

**这张表暴露的两个结构性问题**（比单条更要紧）：

- `FAST_SKIPS` 号称"单一事实来源"，但它记的是**参数造成的跳过**（2 项），不包含**环境造成的跳过**（第 3–7 项）。`docs/preflight-modes.md` 因此告诉读者"`--fast` 只跳过 2 项"，而 CI 里实际有 7 项没在跑 —— 文档与真值不冲突，但**读者会得出错的结论**。建议把第 3–7 项也登记进同一张清单（哪怕标注"环境相关"），或者在 `preflight` 结尾把 `SKIP` 逐条列出来。
- 第 4、5 两项的共同点是**"没跑"被表示成了"跑了且通过"**。仓库已经在 `record()` 里做了三态（`preflight.mjs:44-45` 的注释写得很清楚），但这两处没用上。修这两处（W4 / M2）比新增任何检查都值。

---

## 五、复跑输出（原样）

审计收尾时在本机跑的第 4 项验收命令，原样贴出（`duration_ms` 每次会变，其余是判据）：

```
$ cd "/d/主工作区/projects/dsh-session-superagent" && DSH_SUPERAGENT_OFFLINE=1 node --test 2>&1 | tail -5
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2500.8076
```

（`tail -5` 看不到计数行，补一条 `tail -7` 记录用例总数；两次跑之间仓库 HEAD 还在被另一个会话推进。）

```
$ DSH_SUPERAGENT_OFFLINE=1 node --test 2>&1 | tail -7 ; echo "[HEAD=$(git rev-parse --short HEAD)]"
ℹ suites 0
ℹ pass 369
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2911.7169
[HEAD=01330a7]
```

另外两次辅助实验（同样原样）：

1. **`TZ=UTC` 复跑**（模拟 CI 的 UTC 时区，确认没有时区相关的脆弱用例）：

```
$ TZ=UTC DSH_SUPERAGENT_OFFLINE=1 node --test 2>&1 | tail -12
✔ 孤儿目录删掉后，git worktree prune 能把管理记录清干净 (786.2682ms)
ℹ tests 369
ℹ suites 0
ℹ pass 369
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2011.7
```

2. **复跑 0.9.209（`b4b0fe9`，即 CI 红成 `361/363` 的那个提交）** —— 用 `git archive` 导出到 `/tmp/aud209`，不碰仓库：

```
$ git archive b4b0fe9 | tar -x -C /tmp/aud209 && cd /tmp/aud209 && DSH_SUPERAGENT_OFFLINE=1 node --test 2>&1 | tail -12
✔ 孤儿目录删掉后，git worktree prune 能把管理记录清干净 (760.382ms)
ℹ tests 363
ℹ suites 0
ℹ pass 363
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1763.119
```

**结论**：同一个提交在本地 363/363 全过，CI 上是 361/363 —— 那次失败是**环境相关、本地不可复现**的，而 CI 日志（M1）没有留下任何可以定位的信息。这是本报告 M1 的直接证据。

---

## 附：本次审计做过 / 没做过的事

**做过**（全部只读）：读 6 个脚本 + 2 个 workflow + 4 份文档；`git log / show / archive / ls-remote / tag`；`gh run list / view --log --log-failed`、`gh release list`、`gh pr list`、`gh api`（分支保护、ruleset、仓库安全设置）；`npm view`（版本与 dist-tags）；本地 `node --test`（含 `TZ=UTC` 与 /tmp 复跑）。

**没做过**：改任何文件（含 yml）、`git add/commit/push`、`npm publish`、`gh release create`、`gh workflow run`（未触发任何 workflow）、任何写操作 API。审计用的临时目录 `/tmp/aud209` 已删除；仓库 `git status --porcelain` 收尾为空，除本报告外无新增文件。

**已知未覆盖**（留白，不写成"通过"）：npm 侧的 2FA / token 权限没有审计（未读取 `~/.npmrc`）；GitHub Actions 的 runner 镜像行为没有实测（无法在不触发 workflow 的前提下验证）；`dependabot/github_actions` 的分组升级 PR 是否会引入 breaking 的 action 版本（#8 已合入、CI 绿，但只覆盖了"能跑"）。
