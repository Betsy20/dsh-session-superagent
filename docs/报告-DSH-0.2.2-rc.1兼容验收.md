# DSH 0.2.2-rc.1 兼容与只读 watcher 验收（issue #9）

日期：2026-11-06  
分支：`compat/dsh-0.2.2-rc.1`  
兼容提交：`3ab92b8a90c48d8804c13f25a2e15c42d0f04a73`（`fix: 显式兼容 DSH 0.2.2-rc.1（0.9.276）`）

## 1. 结论与边界

- `engines.dsh = ">=0.2.1-rc.5 <0.2.2-0 || >=0.2.2-rc.1 <0.3.0-0"` 在 semver 默认模式与 `includePrerelease: true` 下均满足本任务边界：保留 rc5、显式接纳 rc1 和后续 0.2.x，排除 `0.2.2-rc.0` 与 0.3 预发布/正式版。
- 旧范围 `>=0.2.1-rc.5` 的 rc1 默认模式探针按预期红（真实 exit 1）；新范围定向测试绿（真实 exit 0）。
- `DSH_SUPERAGENT_OFFLINE=1 node --test test/routes.test.mjs`：68/68，真实 exit 0。
- `DSH_SUPERAGENT_OFFLINE=1 npm test`：601/601，真实 exit 0。
- 从上述兼容提交打出的 tarball 已安装到独立 app 的全新 home。rc1 真实 `loadProfileDirectory()` 返回 `skippedBundles: []`，且 `dsh-session-superagent` 位于已加载 layers。
- watcher 验收只使用独立 home 内的 fixture。`watch_status` / `watch_trace` 前后状态文件逐字节不变，profile 配置逐字节不变，followup=0，issue/PR API 调用=0，`cleanShutdown=true`。
- 未访问或写回 live issue/PR，未推进 live 水位，未改 live home/profile/state，未启动、停止或重启当前 DSH，未 push、未开 PR。

### 工作树异常记录（不属于产品失败）

本任务接手时已有未提交兼容改动；12:19:57 由外部执行者提交为 `3ab92b8`。该提交同时包含已有的 `0.9.276` 版本元数据以及 README/client/lib/index 的同步 hunk；这些不是本验收代理新增或改写的文件。

12:25:55–12:27:21，其他执行者又把本 worktree 的 HEAD 移到 `8cda019`、`9d597b7`、`e605ce7`、`c3e5c67`（隔离 fixture 的 `init` / `fix: #42`）。本代理立即通知 Lead；确认这些提交分别由 `zhuli/one`、`zhuli/a`、`zhuli/b`、`zhuli/ghost` 保留后，仅用 `git reset --mixed 3ab92b8` 恢复 compat 分支与索引，没有 clean 或覆盖任何工作树文件，异常前回滚点为 `c3e5c67`。tarball 与安装均已在该异常发生前从 `3ab92b8` 完成，因此独立验收证据不受后续分支指针异常影响。

## 2. 文件清单

| 文件 | 验收时状态 | 本任务处理 |
|---|---|---|
| `package.json` | `engines.dsh` 更新；`semver@7.8.6` 位于 devDependencies | 先读并验收，未覆盖；未新增版本号改动 |
| `package-lock.json` | lockfileVersion 3；只有 semver 测试依赖 | 先读并验收 |
| `test/dsh-engines.test.mjs` | 覆盖 default + includePrerelease、旧范围对照与 `skippedBundles=[]` | 先读并验收，真实执行 |
| `CHANGELOG.md` | 已有兼容条目 | 保留已有工作，未扩大修改 |
| `scripts/verify-dsh-022.mjs` | 新增只读验收脚本 | 本代理新增并真实执行 |
| `docs/报告-DSH-0.2.2-rc.1兼容验收.md` | 本报告 | 本代理新增 |

本代理未改 watcher 生产逻辑、`client.js`、宿主配置或版本号。

## 3. SemVer 先红后绿证据

### 3.1 旧范围先红（预期失败，真实 exit 1）

```bash
node --input-type=module -e "import assert from 'node:assert/strict'; import semver from 'semver'; const oldRange='>=0.2.1-rc.5'; const actual=semver.satisfies('0.2.2-rc.1',oldRange); console.log(JSON.stringify({phase:'red-old-range',version:'0.2.2-rc.1',oldRange,defaultSatisfies:actual,expectedByIssue:true})); assert.equal(actual,true,'旧范围默认模式未接纳 rc1');"
# REAL_EXIT_CODE=1
```

关键输出：

```text
{"phase":"red-old-range","version":"0.2.2-rc.1","oldRange":">=0.2.1-rc.5","defaultSatisfies":false,"expectedByIssue:true}
AssertionError [ERR_ASSERTION]: 旧范围默认模式未接纳 rc1
false !== true
```

这是旧行为不符合 issue 目标的直接证据，不是 rc1 宿主失败。

### 3.2 新范围后绿（真实 exit 0）

```bash
DSH_SUPERAGENT_OFFLINE=1 node --test test/dsh-engines.test.mjs
# REAL_EXIT_CODE=0；tests 1 / pass 1 / fail 0
```

测试矩阵：

| 版本 | default | includePrerelease |
|---|---:|---:|
| `0.2.1-rc.5` | true | true |
| `0.2.1` | true | true |
| `0.2.2-rc.0` | false | false |
| `0.2.2-rc.1` | true | true |
| `0.2.2` | true | true |
| `0.2.99` | true | true |
| `0.2.99-rc.1` | 不作默认预发布承诺 | true |
| `0.2.1-rc.4` | false | false |
| `0.3.0-alpha.0` | false | false |
| `0.3.0` | false | false |

测试还直接计算 rc1 的默认门禁结果，并断言 `skippedBundles` 严格等于 `[]`。`semver` 只位于 devDependencies，tarball 的 `bundled` 为 `[]`，不会作为运行时依赖打入插件。

## 4. 定向与全量离线测试

```bash
timeout 300s env DSH_SUPERAGENT_OFFLINE=1 node --test test/routes.test.mjs
# REAL_EXIT_CODE=0
# tests 68 / pass 68 / fail 0 / skipped 0

timeout 300s env DSH_SUPERAGENT_OFFLINE=1 npm test
# REAL_EXIT_CODE=0
# tests 601 / pass 601 / fail 0 / skipped 0
```

本轮两次真实运行都没有出现 `notfound` 失败。因此没有把任何 `notfound` 编成 rc1 根因，也没有为掩盖失败修改 watcher 生产逻辑。

## 5. 提交、tarball 与独立安装记录

| 项 | 值 |
|---|---|
| 兼容 commit | `3ab92b8a90c48d8804c13f25a2e15c42d0f04a73` |
| 独立 app | `D:\DeepSeek Harness\Desktop-0.2.2-rc.1` |
| app `--version` | `0.2.2-rc.1`，exit 0 |
| 全新 home | `D:\DeepSeek Harness\home-0.2.2-rc.1-issue9-20261106-122532` |
| 独立 profile | `issue9` |
| tarball | `D:\DeepSeek Harness\home-0.2.2-rc.1-issue9-20261106-122532\dsh-session-superagent-0.9.276.tgz` |
| 安装包版本 | `dsh-session-superagent@0.9.276` |
| tarball SHA-256 | `eeb92d08c036275cc384775604b2c10aa41aa2c75c41db1e1a2fc2f5f1d8413b` |
| npm shasum | `591102ea4ab4cca442912dc844b52af8a7d96823` |
| 包内容 | 26 entries，`bundled=[]` |

打包时工作树相对 `3ab92b8` 为 clean：

```bash
timeout 120s npm pack --pack-destination "D:/DeepSeek Harness/home-0.2.2-rc.1-issue9-20261106-122532" --json
# PACK_REAL_EXIT_CODE=0
```

安装使用独立 Electron CLI；`DSH_HOME`、`HOME`、`USERPROFILE`、APPDATA、LOCALAPPDATA、pnpm store/cache 全部指向上述全新 home：

```bash
timeout 300s env \
  ELECTRON_RUN_AS_NODE=1 \
  DSH_HOME="D:\\DeepSeek Harness\\home-0.2.2-rc.1-issue9-20261106-122532" \
  HOME="D:/DeepSeek Harness/home-0.2.2-rc.1-issue9-20261106-122532" \
  USERPROFILE="D:\\DeepSeek Harness\\home-0.2.2-rc.1-issue9-20261106-122532" \
  "D:/DeepSeek Harness/Desktop-0.2.2-rc.1/DeepSeek Harness.exe" \
  --expose-internals \
  "D:\\DeepSeek Harness\\Desktop-0.2.2-rc.1\\resources\\app.asar\\dsh\\node_modules\\@deepseek-ai\\dsh-desktop-host\\lib\\cli.js" \
  plugin --profile issue9 add \
  "D:\\DeepSeek Harness\\home-0.2.2-rc.1-issue9-20261106-122532\\dsh-session-superagent-0.9.276.tgz"
# INSTALL_REAL_EXIT_CODE=0
# dependencies: + dsh-session-superagent 0.9.276
```

独立 profile 的 `package.json` 含 `dsh-session-superagent`，安装副本版本为 `0.9.276`。以下只读导出也成功：

```bash
# 同一独立 app/home/CLI：
--profile issue9 --dump-config
# DUMP_CONFIG_REAL_EXIT_CODE=0
# 输出末尾含：# == dsh-session-superagent / id: session-superagent
```

## 6. 宿主真实 skippedBundles 与 watcher 只读验收

### 6.1 直接调用 rc1 profile loader

通过 rc1 asar 内的 `@deepseek-ai/dsh-app-boot` 调用：

```js
loadProfileDirectory('dsh', profileDir, installAnchor, { userLayer: false })
```

真实结果（exit 0）：

```json
{
  "runtimeVersion": "0.2.2-rc.1",
  "skippedBundles": [],
  "layers": ["@deepseek-ai/dsh-base", "dsh-session-superagent"]
}
```

宿主实现使用 `semver.satisfies(runtimeVersion, range, { includePrerelease: true })`；本报告没有仅凭单测推断宿主结果，而是读取了宿主 loader 的真实返回值。

### 6.2 一次性只读脚本

```bash
timeout 90s env \
  ELECTRON_RUN_AS_NODE=1 \
  DSH_HOME="D:\\DeepSeek Harness\\home-0.2.2-rc.1-issue9-20261106-122532" \
  HOME="D:/DeepSeek Harness/home-0.2.2-rc.1-issue9-20261106-122532" \
  USERPROFILE="D:\\DeepSeek Harness\\home-0.2.2-rc.1-issue9-20261106-122532" \
  "D:/DeepSeek Harness/Desktop-0.2.2-rc.1/DeepSeek Harness.exe" \
  "D:\\DeepSeek Harness\\default-workspace\\tmp\\dsh-latest-upgrade\\worktrees\\session-superagent\\scripts\\verify-dsh-022.mjs" \
  --app "D:\\DeepSeek Harness\\Desktop-0.2.2-rc.1" \
  --home "D:\\DeepSeek Harness\\home-0.2.2-rc.1-issue9-20261106-122532" \
  --profile issue9
# VERIFY_REAL_EXIT_CODE=0
```

脚本设置了 `DSH_SUPERAGENT_NO_POLL=1`、`DSH_SUPERAGENT_OFFLINE=1`、`DSH_SUPERAGENT_UPDATE_OFFLINE=1`，状态目录为：

```text
D:\DeepSeek Harness\home-0.2.2-rc.1-issue9-20261106-122532\readonly-fixture-34336-1793939874057
```

最终 JSON 证据（独立 home 的 `verify-dsh-022.json`）：

```json
{
  "runtimeVersion": "0.2.2-rc.1",
  "packageVersion": "0.9.276",
  "layers": ["@deepseek-ai/dsh-base", "dsh-session-superagent"],
  "skippedBundles": [],
  "watcherReadOnly": true,
  "fixtureOnly": true,
  "issuePrApiCalls": 0,
  "followupCalls": 0,
  "stateUnchanged": true,
  "profileUnchanged": true,
  "cleanShutdown": true,
  "routeCount": 9
}
```

具体判据：

1. fixture watcher 为 `observe:true`，已有仅供本 fixture 的 #9 水位；只执行 `watch_status` 与 `watch_trace`。
2. 两次只读调用后 `watchers.json` 与调用前逐字节相等，未推进 fixture 水位，更没有接触 live 水位。
3. 独立 profile 的 `package.json` 与 `cordis.patch.yml` 在验收前后逐字节相等。
4. followup 计数严格为 0；未调用 GitHub/Gitee issue 或 PR API。
5. 同时触发 `ctx.effect` cleanup 与 `ctx.on('dispose')` 两条清理路径，9 条路由各且仅各摘除一次，得到 `cleanShutdown=true`。
6. 脚本首跑曾因误断言 `watch_status` 输出含有契约外的 `id` 而 exit 1；已将脚本修正为断言实际契约字段 `repo` / `sessionId`，未改生产代码，复跑 exit 0。

## 7. 未验项与明确不做的事

- 未启动完整独立 GUI/headless 长驻实例；宿主验收为一次性 CLI、真实 profile loader 与进程内 fixture，不冒充完整真机长跑。
- 未做真实浏览器 UI、客户端注入、键盘/主题走查；本任务没有修改 client。
- 未对 live issue/PR 做任何读取、评论、标签或 ack；未验证网络轮询与真实远端水位，这是本任务的明确隔离边界。
- 未复现 `notfound` 失败；本轮 routes 与全量测试均无此红，故没有根因结论。
- 未启动、停止、重启当前 DSH；未写当前 home/profile/state。
- 未 push、未开 PR、未修改 watcher 生产逻辑或版本号。
