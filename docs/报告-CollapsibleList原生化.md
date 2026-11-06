# CollapsibleList 原生化报告

## 结论

`CollapsibleList` 已在独立 worktree `D:\主工作区\projects\dsh-session-superagent-collapsible-native`（分支 `task/collapsible-native`）迁移到 DSH 官方 `DisclosureRow`：

- 宿主存在 `DisclosureRow` 导出时，直接传 `expandable=true`、`expandOnRowClick=true`，整行点击、Enter、Space、焦点与展开内容挂载均交给官方组件。
- 整个 primitives 不存在、exports 为空或仅缺 `DisclosureRow` 时，回退原本地 `DisclosureRow`，保留原有点击、键盘和焦点入口。
- 标题计数、首条 40 字折叠摘要、`ul.dt-plain-list > li` 与开合状态不变。
- `WatcherForm` 高级区没有迁移：它仍是唯一显式 `h(DisclosureRow, …)` 调用，`bodyId`、`aria-controls` 和真实 body 的关联保持原实现。

未修改 `test/client.test.mjs`、`lib/`、`package.json`、版本号、preflight、派单表或 Chromium 验收脚本；未 commit、未 push。

## 1. 官方依据与边界

核对上游固定 commit `66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db` 的 [DisclosureRow.tsx](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db/packages/client/ui-primitives/src/DisclosureRow.tsx)：

- props 包含 `icon/title/open/expandable/onToggle/expandOnRowClick/collapsedContent/children`。
- `rowExpands = expandable && expandOnRowClick`；整行因此获得 `role=button`、`tabIndex=0`、`aria-expanded`。
- 官方整行 `onClick=onToggle`，`onKeyDown` 处理 Enter/Space；展开时挂载 `children`，收起时默认展示 `collapsedContent`。
- 官方 props 没有 `bodyId` 或 `aria-controls`。因此高级区不能为了“原生化”丢掉刚修复的关联，继续走本地实现。

本仓既有 `docs/ui-decomp/01-dsh-ui-tree.md` 也登记了同一官方导出及 `expandable/onToggle/expandOnRowClick/collapsedContent` 适配边界。

## 2. 实现

### 2.1 独立探测

`client.js` 新增仅供 `CollapsibleList` 使用的 `hostCollapsibleRow`：

- `primitives.DisclosureRow` 存在时保存官方组件；整个模块加载失败时清空并回退。
- 探测独立于 Orbit 的 `hostOrbitRow`，不会因为 Orbit 需要额外 portal/hook 能力而阻止普通过滤清单使用官方行。
- 变量名和注释明确限定用途，避免误把不支持 `aria-controls` 的官方组件接进高级区。

### 2.2 两种路径

| 路径 | 组件与 props | 保留行为 |
|---|---|---|
| 官方可用 | `h(hostCollapsibleRow, { …rowProps, expandable: true, expandOnRowClick: true }, ul)` | 官方整行点击、Enter、Space、焦点、aria-expanded、摘要和 children 挂载 |
| 官方不可用 | `h(DisclosureRow, rowProps, ul)` | 原本地 `.dt-disclosure-row[role=button][tabIndex=0]`、click/Enter/Space 与焦点入口 |

两种路径共享 `rowProps`：`title + '（' + items.length + '）'`、受控 `open`、函数式 `onToggle`、原 question icon，以及 `items[0]` 的 40 字摘要。两种路径的 children 都是原 `ul.dt-plain-list`，逐项生成 `li`。

普通 `CollapsibleList` 不传 `bodyId`，也不伪造 `aria-controls`。高级区仍传 `bodyId=idPrefix+'-advanced-body'`，由本地实现把同一个 id 落到展开 body。

### 2.3 唯一调用点

静态与真实 UMD 双重防线确认：

- `h(CollapsibleList, …)` 业务调用点恰好 **1** 个，即总览「最近被过滤」。
- `h(DisclosureRow, …)` 显式本地调用恰好 **1** 个，即 `WatcherForm` 高级区。
- Orbit 已有 `hostOrbitRow` 路径不在本任务范围内，未修改。

## 3. 测试覆盖

`test/update-ui.test.mjs` 新增 **4** 条真实 UMD 测试；生产文件没有增加测试导出，捕获点只在测试执行时通过源码替换注入。

1. **官方委托**：断言官方组件身份、`expandable/expandOnRowClick`、标题计数、40 字摘要、两条 `li`、无伪造 body/aria 参数，以及 `onToggle` 对原状态槽的开合写回。
2. **完整回退**：分别覆盖模块缺失、空 exports、仅缺 DisclosureRow；断言收起摘要、展开卸载摘要、语义 `ul/li`、aria-expanded 与 `tabIndex=0`。
3. **回退交互**：三种缺失场景分别执行 click、Enter、Space，断言 `preventDefault` 和真实状态写回，焦点入口不丢。
4. **唯一调用点与高级区边界**：真实渲染总览的唯一官方过滤行；真实渲染新增表单，确认没有官方 DisclosureRow 混入，高级区仍为本地行且 `aria-controls=watcher-new-advanced-body`。

既有「WatcherForm 高级区：新增/编辑 bodyId 唯一，aria-controls 关联且 Enter/Space 开合不改草稿」继续在官方导出存在的环境中通过。

## 4. 实际执行结果

所有长命令均套了 `timeout`。

| 检查 | 真实结果 |
|---|---|
| `node --check client.js`、`node --check test/update-ui.test.mjs` | 通过 |
| 迁移前定向 `node scripts/test.mjs test/client.test.mjs test/update-ui.test.mjs` | **129/129**，0 失败，0 skipped |
| 迁移后同一定向命令 | **133/133**，0 失败，0 skipped；正好新增 4 条 |
| `npm test` | **626/626**，0 失败，0 skipped |
| `node scripts/ui-audit.mjs --json` | **11/11，100 分** |
| 真实 Chromium：主线 47 项 + 本任务 4 项 | **51/51**，0 失败，exit 0 |
| `git diff --check` | 通过，无 whitespace error |

`ui-audit` 原始关键计数：可点但不可键盘操作的裸 div **0**；焦点可见规则 **17**；自造样式写死颜色 **0**；图标按钮缺可读名字 **0**；空态分支 **17**；弹层键盘行为 **3/3**；裸 button / 原生 Btn **15/25**；自造类死代码 **0**；官方结构采用 **8/8**；含 inline/JS 常量写死颜色 **0**；自造 token **0**。

## 5. 真实 Chromium 证据

最终复跑读取本 worktree 的真实 `client.js`，在独立 loopback 页面中加载安装版 React/primitives，并执行主线完整走查；另在内存中的验收副本追加了 4 项 CollapsibleList 检查，未改写 `scripts/verify-panel-chromium.mjs`。

- Chromium：**156.0.8078.74**；React：**18.3.1**；安装版 frontend/primitives：**0.2.1-rc.5**。
- primitives identity=true，导出数 **290**。
- 本 worktree `client.js` SHA-256：`b7be93f43d8802a362c64c8c19fd55401cd1685245c0d9139a3e181ffa791571`。
- 官方 asar SHA-256：`e1b6f25fa937da98086c3e77af77aa14791105963c4d337a1c42179d232c6915`。
- 主线原脚本 SHA-256：`e23d96f4c9231873604b584e6c3481bf0a0bf04a9b5d7b4e984280d873d4ba83`。

本任务新增的 4 项真实结果：

1. 收起时恰好一个官方 `[data-disclosure-row][data-expandable=true]`，标题为「看被过滤的条目（1）」，摘要完整，`role=button`、`tabIndex=0`、`aria-expanded=false`，没有本地 `dt-disclosure-row`，列表未挂载。
2. click 后 `ul.dt-plain-list` 与唯一 `li` 真实挂载，行为焦点仍留在官方行且元素 connected。
3. Enter 后列表卸载、摘要恢复，`aria-expanded=false`，焦点不丢。
4. Space 后列表重新挂载，`aria-expanded=true`，焦点不丢。

同一轮主线高级区检查再次实测：`aria-controls=watcher-new-advanced-body`、展开 body 的同值 id、5 个高级 Switch、Enter 展开与 Space 收起、焦点保持全部通过。完整走查无未预期页面错误或外部请求，防写探针真实返回 403。

首次运行曾得到 **22 PASS / 3 FAIL**：既有 Tooltip scroll 与 Switch settled 两项未等到预期状态，随后发生 `EGO_TASK_SPACE_NOT_FOUND`。没有把这些结果写成通过，也没有修改相关生产代码。最终自包含复跑的 **51/51** 已覆盖并通过相同主线检查及本任务新增检查。

主线脚本既有 `CAPTURE_SCREENSHOTS=false`，因此 **12** 个截图动作明确记为 SKIP，未计入 51 个功能检查，也未改写任何 PNG。

## 6. 边界与未验项

- 真实 Chromium 验收使用独立 loopback fixture 和安装版原语；未进入需要真实会话与凭证的 DSH Web GUI，不冒称完成宿主安装或重载验证。
- 未执行真实保存、安装更新、删除、暂停、恢复或 watcher 轮询；唯一 POST 是 loopback 防写探针。
- 未验物理读屏、触摸、IME、真实 GitHub/Gitee 响应与真实 watcher 状态变化。
- Ego Lite 提示有可用升级（当前 **0.6.2.7**）；本任务未升级工具。

最终改动仅限：`client.js`、`test/update-ui.test.mjs`、本报告。
