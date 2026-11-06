# 完整面板 Chromium 验收报告

## 结论

**PASS 34 / FAIL 0 / TOTAL 34；最终验收命令真实 exit code = 0；截图 SKIP 10，不计产品 FAIL。**

本轮在真实 Chromium `156.x` 中加载当前 worktree 的真实 `client.js` UMD，以安装版 React/primitives 同时挂载：

- `conversation.view / session-superagent-desk`；
- `conversation.composer.dock / session-superagent-orbit`；
- Orbit 删除动线中的真实确认 `Modal`。

原有 desk 的导航、搜索、编辑、设置、fake API 与禁止外部请求检查全部保留；新增 Orbit 打开/关闭、初始焦点、Escape 回焦、确认 Modal 打开/取消、Tab 焦点圈和取消后回焦。desk 的“设置”页签与仓库标题按钮也分别补了“真实点击进入 + 焦点不丢”断言。

交付脚本：[scripts/verify-panel-chromium.mjs](../scripts/verify-panel-chromium.mjs)。

## 1. 可复现命令与真实退出

```bash
node --check scripts/verify-panel-chromium.mjs
timeout 240 ego-browser nodejs < scripts/verify-panel-chromium.mjs
```

最终结果：

```text
PASS 34
FAIL 0
TOTAL 34
ACTUAL_EXIT=0
SYNTAX_EXIT=0
SCREENSHOT_SKIP=10
```

`ACTUAL_EXIT` 由 shell 在命令结束后读取并再次 `exit`，不是根据页面文本推测。最终脚本只有走完全部步骤、没有 FAIL 时才以 `0` 结束；34 是本轮实际路径上的全部功能断言数，两个截图分支均走 SKIP，没有计入 PASS。

### 截图故障的两次未完成尝试

| 尝试 | 真实退出 | 同一 TaskSpace 现场 | 处理 |
|---|---:|---|---|
| raw CDP desk 截图 | 1 | 已走完设置「版本与更新」，停在 `Page.captureScreenshot`；页面 `captureErrors=[]` | 不把环境故障记成产品 FAIL，移除 desk raw CDP 等待 |
| Orbit `page.screenshot` | 1 | Orbit 已打开且焦点已在 surface，随后死在截图 API 内部 | 按任务允许项关闭本轮截图，继续 DOM/键盘/焦点验收 |
| 最终完整功能走查 | **0** | 全部 desk + Orbit + Modal 步骤完成，TaskSpace 正常关闭 | **34 PASS / 0 FAIL** |

前两次是没有完成的 harness 尝试，不混入最终 PASS/FAIL 数。当前截图异常发生在 Ego/CDP 调用内部，页面侧 `try/catch` 接不到，因此最终脚本以 `CAPTURE_SCREENSHOTS=false` 明确降级，而不是让截图阻断功能验收。

## 2. 真实组件签名与挂载方式

1. 从安装版 frontend `dist/index.html` 读取真实 assets，以 `window.__ModuleLoader__.create` 捕获 `staticModules`，故意停止 DSH 应用自身的启动。
2. 通过 `window.__ModuleLoader__.load` 捕获当前 worktree 真实 `client.js` 的 `factory(require)`，执行 `plugin.apply(ctx)`；`ctx.effect` 和 `ctx.slots.inject` 真实调用，`slots.register` 捕获两个生产 Component。
3. desk 的真实挂载 prop 为 `{ sessionId: 'session-panel-chromium-fixture' }`。
4. [`StatusOrbit()`](../client.js#L1473) 的真实签名没有 props，注册处也直接以 `StatusOrbit` 注册（[`client.js:3248`](../client.js#L3248)）。因此 Orbit 使用 `React.createElement(orbit.Component)` 挂载，**没有虚构 sessionId/watchers/ctx/slot 参数**。两条 watcher 由同一个 fixture `GET /session-superagent/state` 提供，Orbit 的真实 `useEffect` 自己拉取并渲染。
5. desk 与 Orbit 分别由安装版 `ReactDOM.createRoot` 挂载到 `#app` 和 `#orbit-app`；第二个 root 只是 harness 的宿主容器，不是生产适配器或替代 Orbit。
6. 安装版 `react@18.3.1`、`react-dom/client`、`react-dom` 与 `@deepseek-ai/dsh-client-ui-primitives` 都来自捕获的同一模块表；Orbit portal 走真实 `react-dom.createPortal`，surface 使用真实 `MenuSurface`、锚定和外点 hooks。

## 3. 功能验收矩阵

### 3.1 既有 desk 检查全部保留

| 区域 | 真实操作与严格断言 | 结果 |
|---|---|---|
| Chromium / 安装模块 | Chromium major=156、React 18.3.1、同一 primitives 对象、真实 UMD | PASS |
| desk slot | id/name/order/label/Component 类型严格相等 | PASS |
| overview | 四个页签、两条 watcher、完整统计与仓库 DOM | PASS |
| overview 搜索 | 输入 `acme/widgets` 后严格只剩该仓库，清空恢复 | PASS |
| overview 行内编辑 | 间隔改为 90，出现“未保存”；放弃恢复 60；无提交 | PASS |
| judge / records | `#42/#41`、运行时事件、fake trace 的 seen/filter/reported/wake 全事件 | PASS |
| trigger | 新建 form、必填仓库、数字间隔；repo/goal 可编辑但未添加 | PASS |
| settings nav | 恰好五个既定分区，真实点击切换 `aria-current` 与标题 | PASS |
| source | 仓库、gh、凭证、scope、隔离事实表及 fixture 值 | PASS |
| creds | 两个 password input 与 ghDir input 可编辑，未保存 | PASS |
| update | 当前/最新均 `0.9.276`，严格等于“已是最新”；无安装按钮 | PASS |
| diagnose | 三个信号与 `+100/+10/+3` 权重严格相等 | PASS |
| goal | 固定 goal 回读、textarea 可编辑、保存按钮可用；未保存 | PASS |
| 页面与 fake API | 未预期 JS error=0、外部请求=0；state/update/trace 均实际命中 loopback | PASS |

### 3.2 本轮新增完整 Orbit/Modal 与入口焦点检查

| 区域 | 真实操作与严格断言 | 结果 |
|---|---|---|
| Orbit slot / fixture | `conversation.composer.dock`、id、order=-10、真实函数签名 arity=0；两条 fixture watcher 渲染 | PASS |
| desk 编辑入口 | 点击仓库标题后出现且仅出现一个 edit form，`aria-expanded=true`，焦点仍在已连接的 opener | PASS |
| desk 设置入口 | 真实点击“设置”页签，选中项为“设置”，焦点仍在已连接的选中页签 | PASS |
| Orbit 打开 | `aria-expanded=true`，portal 到 BODY，非 Modal dialog，两个仓库行与 fixed/visible/视口边界正确 | PASS |
| Orbit 初始焦点 | `document.activeElement` 严格等于可见 surface，且节点仍连接 | PASS |
| Orbit trigger 关闭 | 再次点击圆环关闭，surface 卸载，焦点仍在圆环而不是 body | PASS |
| Orbit Escape | 真实键盘 Escape 关闭，最终焦点显式回到圆环 | PASS |
| 删除确认打开 | 点击第一行“删除”后 Orbit surface 先卸载，再出现标题“确认删除”的 `aria-modal=true` Modal | PASS |
| Modal 初始焦点 | 焦点进入 dialog 的“关闭”按钮，不被 Orbit cleanup 抢回圆环 | PASS |
| Modal Tab 圈 | 真实 Tab 依次到“取消 → 确认删除 → 关闭”，全程不逃逸、不丢焦 | PASS |
| Modal 取消 | 只取消、不确认；Modal 卸载，Orbit 不自动重开，焦点回圆环 | PASS |
| mutation guard | 功能走查期间 mutation=0；随后唯一显式 loopback `POST /watch` 防写探针真实返回 403 | PASS |

## 4. 写操作边界

- 没有点击真实保存、确认删除、安装更新、暂停、恢复或立刻轮询。
- desk 与 Orbit 的全部功能点击完成后，先断言 `apiLog` 中 mutation 数量为 **0**。
- 之后由 harness 显式发起一次 `POST /session-superagent/watch`，body 只含专用 id `fixture-read-only-guard-probe`；独立 `127.0.0.1` server 返回 **403 `fixture-read-only`**。它验证防写 guard 本身有效，不是产品删除请求，也没有离开 loopback 或改变 fixture。
- 浏览器对非同源请求直接拒绝并记录；本轮未访问 GitHub、Gitee 或 npm。

## 5. 基线与哈希

| 项 | 值 |
|---|---|
| Git HEAD | `c9ff2e0945502c1583da97c378edd6c6e00e9a0c` |
| 插件版本 | `0.9.276` |
| 最终交付脚本 SHA-256 | `9925c9bbadf0f8d1a317f9e43cf3544d34ed27c4536aaa0ee821123df68ea700` |
| 真实 `client.js` SHA-256 | `632a47e39083a51bec24157db4a778709add5819d579cd7baf29c40928db6d7c` |
| DSH frontend / primitives range | `0.2.1-rc.5` / `0.2.1-rc.5` |
| 安装 asar SHA-256 | `e1b6f25fa937da98086c3e77af77aa14791105963c4d337a1c42179d232c6915` |
| Electron / 安装 Node | `44.7.0` / `v24.21.0` |
| React | `18.3.1` |
| Chromium | `156.x`（最终脚本严格断言 major=156） |

最终脚本哈希在成功运行后复算，`node --check` 再次真实返回 `0`；成功运行后没有改写脚本。

## 6. 截图与 SKIP

- desk 既有八张基线 PNG 没有覆盖；本任务写权限只允许新增 `panel-chromium-orbit*.png`。
- Orbit 与 Modal 的两张候选截图也因当前 Ego/CDP 通道会在 API 内部终止进程而 SKIP。
- 本轮共 **10 张截图 SKIP**，没有新增 `docs/assets/panel-chromium-orbit*.png`，没有截图 PASS 被计入 34 项。
- 截图降级不影响上述真实 DOM、键盘、焦点、fake API 和防写断言，最终退出仍由功能结果决定。

## 7. 未验项

- 未进入需要真实会话与凭证的 DSH Web GUI；本报告证明独立 loopback 页面中的真实 UMD、真实 slot 注册、真实 desk/orbit Component 与真实 Chromium 交互，不冒充真实宿主端到端。
- 未执行真实保存、删除、更新或 watcher 状态变化；未验这些动作成功后的服务端行为。
- 未验物理读屏、触摸、IME、真实 GitHub/Gitee 响应、真实 watcher 轮询与跨主题/窄屏组合动线。
- 本轮只严格断言 Chromium major=156，未把精确 build 作为独立验收项。
- 截图通道不可用，因此不对本轮 Orbit/Modal 的视觉截图或像素对比作通过声明。

本任务只修改验收脚本和本报告，没有修改生产 `client.js`、适配器、`package/`、`lib/` 或版本文件，没有 commit / push。
