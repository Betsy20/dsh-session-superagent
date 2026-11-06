# trace 请求竞态与 /state 旧错误清理报告

日期：2026-11-06  
工作区：`D:\主工作区\projects\dsh-session-superagent-trace-state`  
分支：`task/trace-state`（基线 `8d3fe27`）

## 结论

两类问题均已处理：

1. `/trace` 原先没有请求代际，慢旧响应可以覆盖较新编号的结果；较慢的旧失败也可以覆盖重试成功。现在每次点击追溯都会递增序号，新请求同步写入自己的 loading，只有序号仍为当前值的请求才能写结果或错误。
2. `/state` 的并发序号守卫原本已经存在，实测旧失败不会覆盖新成功；但 `200→500→304` 中，已有快照的 304 会直接早退，导致 500 留下的 `snap.error` 永不清。现在这种 304 会保留原快照并清除旧错误；无快照 304 仍按既有逻辑清 ETag 并重取全量，没有重复修改 T96 的返回语义。

本次只改请求状态，不改 DOM、样式、UI 结构、接口字段或服务端代码。

## 先红后绿证据

基线 `test/client.test.mjs` 为 97/97；既有“无快照 304 重取”用例在修改前已经通过。

新增 4 条竞态用例后，修复前定向结果为 **1 通过 / 3 失败**：

| 用例 | 修复前实测 | 修复后 |
|---|---|---|
| trace A 慢 / B 快 | A 最后返回后，界面从 `#2 新结果` 回盖成 `#1 旧结果` | 通过 |
| 错误后重试，旧错误慢到 | 重试已成功，慢旧错误仍覆盖成功结果 | 通过 |
| `/state` 200→500→304 | 500 的 `temporary failure` 在 304 后仍保留 | 通过 |
| `/state` 旧失败 / 新 200 并发 | 修改前已经通过，证明原序号守卫有效 | 通过 |

测试使用完整真实 `client.js`，并让一个测试内的 state/ref 跨 render 持久，避免通用静态桩每次 render 重建 ref 而漏掉竞态。辅助 `/client-note` 请求按 pathname 分流，不会消耗 trace/state 的 deferred 响应。

新增测试位于 `test/client.test.mjs`：

- `loadStatefulPanel`：持久 state/ref 的真实 UMD 测试入口；
- `trace A 慢 B 快：新编号立即 loading，慢旧结果不得回盖新编号`；
- `trace 错误后可重试；较慢的旧错误不得覆盖重试成功`；
- `/state 200→500→304：已有快照的最新 304 是成功，必须清掉旧读取错误`；
- `/state 并发：旧失败不得覆盖较新的 200 成功与清错结果`。

既有 `首帧 304 不该把面板卡在「正在读取」：本地没有 body 时必须重取一次全量` 继续通过。

## 实现

### trace 请求代际

`client.js` 在 `traceResult` 旁增加 `traceSeqRef`。点击时先执行 `++traceSeqRef.current`，再同步设置 `{loading:true, number:asNumber}`；`call()` 返回后以及 catch 写错误前都检查序号。慢旧请求因此不能再写结果或错误，新编号也不会继续显示旧结果。

### /state 304 清错

`load()` 收到 `{notModified:true}` 且本地有 body 时：

- 若 `prev.error` 或 `prev.loading` 存在，写入 `{loading:false, error:null, body:prev.body}`；
- 若状态本来正常，返回原 `prev`，避免条件轮询每次产生新 state；
- 继续返回原 `{notModified:true}`，不改变既有调用方契约；
- 无 body 时保持原有 `stateEtag = null; return load()` 重取路径。

原有 `loadSeqRef` 守卫保持不变，旧 `/state` 失败仍不能覆盖新成功。

## 验证结果

| 门禁 | 命令 / 范围 | 结果 |
|---|---|---|
| 语法 | `node --check client.js && node --check test/client.test.mjs` | 通过 |
| 定向 | 4 条新增竞态 + 既有无快照 304 | **5/5** |
| 全量 | `timeout 360 npm test` | **652/652** |
| UI 体检 | `node scripts/ui-audit.mjs --json` | **11/11，100 分** |
| 真实 Chromium | `scripts/verify-panel-chromium.mjs` | **47/47** |
| 差异检查 | `git diff --check` | 通过 |

真实 Chromium 环境：

- Chromium `156.0.8078.74`；React `18.3.1`；DSH frontend `0.2.1-rc.5`；
- 执行的是本工作区真实 `client.js`，SHA-256 `2bdc1f283707a79fdb7cbfe2882040d939f74d347098ec397d925adfaeaee3ed`；
- 完整 desk/orbit、单次 trace、表单、设置、Modal、键盘与焦点路径通过；
- 无未预期页面错误、无外部请求、无真实 mutation；末尾防写探针按预期得到 403；
- 验收使用独立 loopback fake API，不冒充真实 DSH Web GUI 或真实 GitHub/Gitee 联调；
- 截图通道按脚本既有 `CAPTURE_SCREENSHOTS = false` 跳过，未生成或覆盖工作区图片。

Ego Lite 提示有可用升级；本任务未升级工具。

## 改动边界

仅修改/新增：

- `client.js`
- `test/client.test.mjs`
- `docs/报告-trace与状态竞态.md`

未修改 `test/update-ui.test.mjs`，也未修改 `lib/`、`package.json`、版本、preflight、派单表或其他文件。未 commit、未 push。
