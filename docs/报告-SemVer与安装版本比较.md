# SemVer 与安装版本比较修复报告

日期：2026-11-06  
工作树：`D:\主工作区\projects\dsh-session-superagent-semver`  
分支：`task/update-semver`

## 1. 实证问题

原实现有两套数字加权：服务端 `acc * 1000 + n`，客户端 `major * 1e6 + minor * 1e3 + patch`。它们都不是 SemVer precedence：

- 固定进制会碰撞，例如 `0.1000.0` 与 `1.0.0`；`Number` 还会丢失大整数精度。
- `0.9.273-rc.1`、`0.9.273+build.5` 不能按 prerelease/build 规则处理。
- 服务端用 `runningVersion/current` 判断磁盘是否有更新，安装副本已经较新时仍可能提示更新。

真实只读探针同时证实了 installed/running 错用：宿主 `/state` 报告安装副本 `0.9.273`、运行模块 `0.9.266`，旧 `/update` 拿到 npm latest `0.9.272` 后返回 `hasUpdate:true`；按安装副本比较，正确答案为 `false`。

## 2. 修复内容

### 2.1 单一 SemVer comparator

新增 `lib/semver.js`：

- major/minor/patch 使用十进制字符串“先长度、后字典序”比较，不经过 `Number` 或 `BigInt`，没有安全整数或固定字长限制。
- 完整实现 prerelease：正式版高于 prerelease；数字标识符按数值比较且低于非数字；非数字按 ASCII；同前缀时标识符更多者更高。
- build metadata 不参与 precedence。
- 严格 grammar 拒绝前导零、空标识符、范围、首尾空白、Unicode 标识符和非字符串；无效比较返回 `null`，调用方只在结果严格等于 `1` 时判定有更新。
- `lib/update.js` 改为复用并转出口径相同的 `isStrictSemver`，不再保留第二份 regex。

### 2.2 服务端 installed/running 口径

`lib/index.js` 的 `checkUpdate` 现在返回：

- `current`：保留原兼容字段，等于运行模块版本；
- `runningVersion`：当前进程已加载模块版本；
- `installedVersion`：磁盘安装副本版本；
- `hasUpdate`：`compareSemver(latest, installedVersion) === 1`。

只有 installed 缺失或不是严格 SemVer 时才回退 running 作为基线；installed 可取时，running 不参与磁盘更新判断。npm `version` 必须先以原始字符串类型通过严格校验，数组等值不再被 `String(...)` coercion 成合法版本；非法 latest 会给出错误且不生成可执行命令。

省略 `version` 的 POST 在 latest 低于当前安装基线时返回 HTTP 409 / `downgrade_requires_explicit_version`，runner 不执行。显式传入 `version` 仍代表用户明确选择，允许主动降级。

### 2.3 缓存失效

成功 POST 现在会清空 `updateCache` 并递增 generation：

- 即使之前 `refresh=1` 已消费 60 秒强制刷新额度，紧接着的 GET 仍会重新读取 installed 和 registry latest。
- POST 前已经在飞的旧 GET 即使晚到，也不能把安装前快照重新写进缓存。

### 2.4 客户端 discoverBase

`client.js` 的 UMD 不能 import ESM/npm 包，因此在标记块内放置与 `lib/semver.js` 完全相同的 comparator 源码。测试会做去公共缩进后的逐字结构审计，并在 VM 中运行客户端副本。

`discoverBase` 先排除非法 `serverVersion`，再以同一 comparator 选择最高 precedence 的真实 `routeBase`；仅 build 不同的同 precedence 实例不会造成无谓切换。

### 2.5 包装与同步

- `package.json` 的 `files` 只新增 `lib/semver.js`。
- `scripts/sync-profile.mjs` 的 `TARGETS` 只新增同一文件。
- 未改版本号，未改派单表。

## 3. 必过反例

以下“是否有更新”均指 `compareSemver(latest, installed) === 1`：

| latest | installed | 结果 |
|---|---|---:|
| `0.9.273-rc.1` | `0.9.273` | 不更新 |
| `0.9.273+build.5` | `0.9.273` | 不更新 |
| `0.9.273` | `0.9.273+build.5` | 不更新 |
| `0.9.272-rc.1` | `0.9.273` | 不更新 |
| `0.1000.0` | `1.0.0` | 不更新 |
| `1.0.0` | `0.1000.0` | 更新 |
| `9007199254740993.0.0` | `9007199254740992.0.0` | 更新 |

**口径说明**：任务原文的 `0.1000.0 > 1.0.0` 与 SemVer 规范冲突。SemVer 先比较 major，所以正确关系是 `0.1000.0 < 1.0.0`；本修复针对该反例消除了旧固定 base-1000 的“相等碰撞”，没有把大小关系改成违反规范的方向。

官方 prerelease 链已逐对及反向验证：

```text
1.0.0-alpha
< 1.0.0-alpha.1
< 1.0.0-alpha.beta
< 1.0.0-beta
< 1.0.0-beta.2
< 1.0.0-beta.11
< 1.0.0-rc.1
< 1.0.0
```

另覆盖 `2 < 10`、数字 `<` 非数字、`- < A < a`、任意长度数字标识符、build 忽略及非法输入。

## 4. 验证计数

| 验证 | 命令 / 探针 | 结果 |
|---|---|---:|
| 修改前定向基线 | `node --test test/update-route.test.mjs test/update-ui.test.mjs` | 27/27 |
| 最终定向 | `node --test test/update-semver.test.mjs test/update-route.test.mjs test/update-ui.test.mjs` | **47/47** |
| 全量 | `npm test` | **593/593，exit 0** |
| 真实只读探针 | npm registry GET + 宿主 `/update` GET + `/state` GET | **3/3 请求成功** |

全量测试输出另有一条 `node:test run() is being called recursively within a test file` 警告；本次退出码为 0，失败、取消、跳过均为 0。

真实 registry 探针结果：

```text
本地 installed = 0.9.273
npm latest     = 0.9.272
新 comparator  = hasUpdate:false
```

真实宿主只读结果：

```text
/update：HTTP 200，current=0.9.266，latest=0.9.272，hasUpdate=true（旧运行代码）
/state： HTTP 200，installedVersion=0.9.273，runningVersion=0.9.266
```

这证明旧运行代码仍按 running 误报，而新源码按 installed 得到正确结果。未向宿主发送更新 POST，未安装，未重启；宿主尚未加载本工作树修复。

## 5. 审核与边界

独立只读子代理 `e393cebd-de5c-4dea-99c1-3cdfe16510f3` 审核了 comparator、installed/running 交叉场景、UMD 同源性和缓存反例；其指出的 registry 原始类型 coercion、强制刷新额度假绿、在飞 GET 晚写缓存均已补修复与测试。最终定向和全量结果见上节。

本轮按任务范围只保证**成功 POST**后的缓存失效。CLI 非零退出或超时若发生部分改盘，失败路径仍可能沿用既有缓存；该边界未在本轮扩大修改。

本子代理未执行 `git commit`、`git push`、安装或宿主重启。执行期间 Lead 侧外部集成了 `2f354d7`、`9ed91e5`、`c1db895` 并纳入本任务代码与测试；子代理未改写其历史。最终复核时仅本报告是未跟踪文件。
