# Orbit 写操作并发、轮询乱序与删除错误修复报告

## 结论

本 worktree 已修复三类问题：

1. `立刻 / 暂停 / 恢复 / 删除` 按 `watcher id + action` 同步加锁，pending 时禁用原动作并显示明确文案，成功与失败均在 `finally` 解锁。
2. Orbit 的定时 `/state` 与写后 `/state` 共用单调序号，旧成功、旧失败都不能覆盖较新的请求结果；最新成功会清除读取/写后刷新错误。
3. 删除失败以 `role=alert` 显示在当前确认 Modal，pending 时阻止 Escape/遮罩/取消关闭；失败后保留确认层供重试，只有动作成功才自动关闭并回焦圆环。失败后的主动 Escape/取消仍可使用。

未改 `lib/`、`package.json`、版本号、preflight、派单表，未 commit、未 push。

## 实现

### 1. watcher/action busy 锁

- `client.js:1580` 的 `actionLocks` 保存同步锁；键由 `client.js:1374` 的 `[watcherId, action]` JSON 元组构成。
- `client.js:1702-1730` 在 `await` 前先查/写 ref，因此 React 尚未重渲染时的第二次点击也只会得到一个 POST；`finally` 同时覆盖写失败、回读失败和成功。
- 为保持旧 fallback 的位置化 hook 契约，没有新增根 `useState`。pending 渲染直接读取同步锁集合并用 watcher 数组快照触发重渲染，watcher 数据本身不变。
- `client.js:1785-1796` 为原动作提供 `disabled`、`aria-busy`、`dt-btn-busy` 与「轮询中… / 暂停中… / 恢复中…」可见状态；删除使用「删除中…」。

### 2. `/state` 代际保护

- `client.js:1581` 保存 `stateSequence`，`client.js:1593-1607` 的统一 `loadState()` 在发起请求时递增序号。
- 只有 `sequence === stateSequence.current` 且组件仍存活时才写 watchers 或读取错误；写后回读与定时轮询不再各走一套无保护逻辑。
- 最新成功仅清读取类错误，不抹掉另一写操作已经显示的操作错误。
- `client.js:1613-1620` 的 interval 与 `client.js:1721-1723` 的写后刷新均调用同一 `loadState()`。

### 3. 当前 Modal 中的删除错误

- `client.js:1309-1355` 的共享 `ConfirmDialog` 新增可选 `error / busyLabel / busyHint`，错误使用现有 `dt-error` 和 `role=alert`，无错误时保持原来的无空 body 结构。
- DSH Orbit 与 fallback 都把 `deleteError` 传入当前确认层：`client.js:1806-1807`、`client.js:1897-1901`。
- 删除 pending 时 `preventDismissOnBusy=true`，避免 Modal 先关闭、错误随后只能写进不可见 Orbit；`ConfirmDialog.confirm()` 仍只在 `onConfirm()` 返回真时自动关闭。
- 删除失败写 `删除失败：<服务端错误>`，重试开始清旧错误；成功才关闭并沿用 `orbitConfirm.onConfirmClose()` 回焦圆环。

## 回归测试

新增测试集中在 `test/orbit-popover-integration.test.mjs:613-797`，并只在 harness 中登记手动 interval，不等待真实 5 秒计时：

- 立刻、暂停、恢复同步双击只发一个 POST，pending 可见，成功后能再次显式执行。
- 写失败显示 `role=alert`、解除 busy，显式重试成功。
- 两个并发 `/state` 中，旧成功不能回盖新 watcher，旧失败也不能回盖新成功或重新写读取错误。
- 删除确认连点只发一个 POST；pending 不能 dismiss；失败留在当前 Modal；重试成功才关闭并回焦。
- 删除失败后的主动 Escape 仍可取消、解绑并回焦，且不会重发 delete。
- 既有 Orbit 打开/关闭 hook 顺序、position 只聚焦一次、外点不抢焦、Escape、取消回焦与删除成功用例全部保留。

## 先红后绿与门禁证据

| 阶段 | 命令/范围 | 结果 |
|---|---|---|
| 修改前基线 | `timeout 180 node scripts/test.mjs test/client.test.mjs test/update-ui.test.mjs test/orbit-popover-integration.test.mjs` | 153/153 PASS |
| 新增用例首轮 | `timeout 90 node scripts/test.mjs test/orbit-popover-integration.test.mjs` | 9 PASS / 4 FAIL；直接复现同一 pending 双击 `2 POST !== 1`、删除 pending 可关闭等问题。随后修正两处测试桩选择器/关闭入口，不改产品断言方向。 |
| 最终实现定向 | 上述 integration + client/update-ui + 两组共享 Modal 测试 | 176/176 PASS；追加两条边界后 integration 15/15 PASS |
| 全量 | `timeout 300 npm test` | **643/643 PASS**，0 fail |
| UI 审计 | `timeout 90 node scripts/ui-audit.mjs --json` | **11/11，100 分**；写死颜色、自造 token、键盘弹层问题均为 0 |
| 差异检查 | `git diff --check` | PASS |

## 真实 Chromium

环境：Chromium `156.0.8078.74`，DSH frontend/primitives `0.2.1-rc.5`，React `18.3.1`，安装版 asar SHA-256 `e1b6f25fa937da98086c3e77af77aa14791105963c4d337a1c42179d232c6915`。

1. 原主线 `scripts/verify-panel-chromium.mjs` 使用本 worktree 的真实 `client.js`：**47/47 PASS**，包括 Orbit 焦点、Tab、Escape、删除取消与回焦。
2. 通过 stdin 对同一主线 harness 做内存扩展，未修改脚本文件；独立 loopback fixture 提供 5 秒延迟、首次删除 500、重试成功及轮询 POST。最终总结果 **52/52 PASS**，其中新增 5 项：
   - 同坐标两次真实鼠标点击删除确认，pending 为「删除中…」，仅 1 POST。
   - pending Escape 不关闭；失败错误在当前 `.dt-modal-body [role=alert]`；双击仍仅 1 POST。
   - 重试成功后才关闭并回焦圆环，总计 2 次 delete（首次失败 + 显式重试）。
   - 「立刻」同坐标双击显示「轮询中…」且仅 1 POST。
   - 轮询完成后解除 busy，专项无未预期页面错误。

高层 `dblclick()` 会在两次点击间重新检查 actionability，无法稳定把第二次点击落在 disabled/pending 内；最终采用同坐标两次真实 `mouse.click`，不是 DOM 合成事件。

## 边界与未验项

- Chromium 使用真实安装版 React/primitives + 真实 `client.js`，但 API 是独立 loopback fixture；没有进入真实 DSH Web GUI，没有写真实 watcher，也没有访问 GitHub/Gitee。
- 未验物理读屏、触摸、IME 与真实服务端 watcher 状态迁移。
- 主线既有 Ego/CDP 截图通道会终止进程，因此按 harness 既有开关跳过截图；DOM、ARIA、焦点、请求次数和真实键盘/鼠标路径均已验收，不把跳过截图记成产品失败。
- Ego Lite 提示有更新；未升级，升级需用户明确批准。
