# 报告：更新 POST 禁止自动重放

日期：2026-11-06  
工作树：`D:\主工作区\projects\dsh-session-superagent-no-replay`  
分支：`task/update-no-replay`

## 结论

已修复 `/session-superagent/update` 的 POST 在 fetch rejection 或 HTTP 404 后经 `discoverBase()` 自动重放的问题。更新 POST 现在只发一次；GET 的 discover/retry 保持原行为，其它 mutation 未扩大改动。

更新 POST 的响应丢失或 404 不再被界面解释为确定失败，更不会写成“未安装”或“安装完成”。界面保留原 `update`、当前/最新版本与手动命令，持久显示：

> 请求结果未知，请先重新检查 installed/running，再手动确认

同时把 `installedVersion`、`runningVersion`、`needsReload` 标为未知；Section notice 与 error Toast 保留原始错误详情，确认层保持打开。

## 根因与修复

### 1. 通用重试没有区分请求语义

原 [`call()`](../client.js#L426) 在两类情况下对所有请求统一执行 `discoverBase()` 后递归重试：

- `fetch()` reject；
- 首次响应为 404。

更新 POST 可能已经开始修改安装副本；响应丢失不能证明请求没有执行，因此第二次 POST 可能重复安装，或把仍在进行的安装误报成失败。

修复后仅在 `path === '/update'` 且方法为 POST 时禁止这两条自动重试路径：

- fetch rejection 直接抛出带 `updateResultUnknown` 标记的错误，不执行发现流程；
- 404 不执行发现流程，继续解析真实错误正文，再按结果未知处理；
- GET 与其它 mutation 仍走原有 discover/retry 分支。

### 2. 未知结果不能套用确定成功/失败回执

[`installUpdate()`](../client.js#L2879) 识别上述标记，写入显式的未知结果状态，不修改 `update`。版本与更新 Section 在[状态与回执行](../client.js#L2762)中优先呈现未知提示，避免落入原有“安装完成”或“false · 当前无需重载”等确定结论。

手动“重新检查”仍沿用原逻辑清除旧回执；复制命令与手动确认入口保留。HTTP 500 等本任务外的确定失败仍按原“安装更新失败”路径处理，并有既有用例回归。

## 严格实证

测试直接执行真实 `client.js` UMD 中的 `call()`，仅替换沙箱内的 `fetch`，没有复制或另写一份重试实现。新增用例位于 [`test/update-ui.test.mjs`](../test/update-ui.test.mjs#L411)。

### 修复前复现

新增测试先运行在旧实现上，真实结果为 **10 项中 8 pass / 2 fail**：

1. 首个更新 POST reject：实际 POST 数 **2**，断言要求 **1**，失败。
2. 首个更新 POST 404：旧实现经发现流程发第二次 POST；mock 的第二次响应成功，安装回调实际返回 `true`，断言要求 `false`，失败。
3. 同一轮的 GET rejection 与 404 回归用例已通过，证明后续修复不是为让新测试变绿而删除通用重试。

### 修复后定向验证

命令：

```sh
timeout 60 node --test test/update-ui.test.mjs
```

结果：**tests 10，pass 10，fail 0，skipped 0，todo 0**；耗时 **251.5809 ms**。

覆盖计数：

- POST 首次 reject：POST **1** 次，`/state` 发现请求 **0** 次，成功后的强制刷新 **0** 次；`update` setter **0** 次；版本与命令仍在，未知提示进入 Section 与 Toast。
- POST 首次 404：POST **1** 次，`/state` 发现请求 **0** 次；第二次 POST 的 mock 成功分支不会被执行。
- GET 首次 reject：更新 GET **2** 次，完整 discoverBase `/state` **8** 次（默认前缀 + `r2…r8`），第二次使用 `/session-superagent/r2` 并成功。
- GET 首次 404：同上，更新 GET **2** 次、发现请求 **8** 次、第二次成功。
- 既有 HTTP 500 用例保持确定失败语义；成功、防连点、回执、手动检查与 fallback 用例全部通过。

## 全量门禁

| 检查 | 命令 | 真实结果 |
|---|---|---|
| 全量测试 | `timeout 300 npm test` | **tests 576，pass 576，fail 0，cancelled 0，skipped 0，todo 0**；**22986.0337 ms** |
| UI 审计 | `timeout 60 node scripts/ui-audit.mjs --json` | **11/11 通过，100 分**；写死颜色 0、自造 token 0、死代码 0 |
| 客户端语法 | `timeout 30 node --check client.js` | 通过，退出码 0 |
| 补丁格式 | `timeout 30 git diff --check` | 通过，退出码 0 |

`npm test` 输出一条 Node 自带提示：`node:test run() is being called recursively within a test file. skipping running files.`；最终完整汇总仍为上述 **576/576**，无失败。

## 范围与未做事项

- 仅修改 `client.js`、`test/update-ui.test.mjs`，并新增本报告。
- 未修改 `lib/`、`package.json`、版本号、派单表或其它 mutation。
- 未安装、未重启、未 push、未 commit；未执行真实更新，验证全部使用内存 mock。
- 本任务未做宿主真机安装或截图；UI 结论来自真实客户端组件树断言与 `ui-audit`，不冒称真机安装验证。
