# 共享 Pill 原生化报告

## 结论

主理鱼共享 `Pill()` 已在独立 worktree `D:\主工作区\projects\dsh-session-superagent-native-pill`（分支 `task/native-pill`）迁移到 DSH 官方 `Pill`。宿主存在导出时直接委托；整个 primitives 不存在、exports 为空或仅缺 `Pill` 时，交互场景完整回退原 `button.dt-pill`，静态场景按官方语义渲染 `span.dt-pill`。

9 个 `h(Pill, …)` 业务调用点均未修改。`active / className / children / onClick / rest` 按官方合同转发；官方未提供的 `aria-pressed` 只在有 `onClick` 时由共享调用方按 `!!active` 最小补齐，静态只读 badge 不补该属性，也不伪造按钮。

未修改 `lib/`、`package.json`、版本号、preflight、派单表或浏览器验收脚本；未 commit、未 push。

## 1. 官方证据

核对上游固定 commit `66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`：

- [packages/client/ui-primitives/src/Pill.tsx](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db/packages/client/ui-primitives/src/Pill.tsx)：解构 `active = false / className / children / onClick / ...rest`；有 `onClick` 时返回 `button[type=button]` 并展开 rest，无 `onClick` 时返回静态 `span`。官方未设置 `aria-pressed`。
- [packages/client/ui-primitives/src/Pill.module.css](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db/packages/client/ui-primitives/src/Pill.module.css)：官方拥有 `pill / interactive / active` 三类及 hover/active token；适配层不回填旧 `dt-pill` 去覆盖官方主题。
- 本仓既有结构证据 `docs/ui-decomp/01-dsh-ui-tree.md` 也明确：Pill 有 `onClick` 时是 button，否则为 span；普通只读徽章不得因迁移被强行交互化。

## 2. 实现

### 2.1 独立探测与直接委托

`client.js` 在原语探测区新增 `hostPill`：

- `primitives.Pill` 存在：共享 `Pill()` 返回 `h(hostPill, props, children)`，不先创建本地 button/span，也不复制官方样式类或交互逻辑。
- 仅缺 `Pill`：只降级共享胶囊，Button、Input、Switch、SegmentedTabs、Modal/Toast 等不受影响。
- 整个 primitives `require` 失败：`hostPill = null`，走本地回退。

### 2.2 两种形态与 aria

| 场景 | 官方可用 | 官方不可用 |
|---|---|---|
| 有 `onClick` | 官方交互 Pill；透传 active/className/children/onClick/rest，并补 `aria-pressed=!!active` | 原 `button.dt-pill[type=button]`；保留 active class、onClick、children 与 `aria-pressed` |
| 无 `onClick` | 直接交给官方静态 span 分支；不加 `aria-pressed` | `span.dt-pill`；不加 `type/onClick/aria-pressed` |

`className` 在官方路径按官方合同透传；回退路径与原 `dt-pill / dt-pill-active` 合并。rest 在交互回退中同样落到原生 button；静态回退不额外发明 rest 行为。

### 2.3 业务行为保持不变

以下 9 个调用表达式原样保留：

1. 仓库能力徽章过滤；
2. 过滤汇总单项清除；
3. 过滤汇总全部清除；
4. 暂停原因过滤；
5. 暂停原因清除；
6. 跳过原因过滤；
7. 跳过原因清除；
8. 「只看有问题的」切换；
9. 「全部」恢复。

过滤状态槽、再点取消、搜索清除、五类筛选同时清除以及列表收敛逻辑均未改动。

## 3. 测试覆盖

`test/update-ui.test.mjs` 新增 4 条真实 UMD 测试；`test/client.test.mjs` 无需修改：

1. **官方委托**：覆盖 active=false/true、className、children、onClick、id/title/data rest、key、aria-pressed；另覆盖无 onClick 的官方静态委托，确认适配层不加 button type 或 pressed 状态。
2. **完整回退**：分别覆盖整个 primitives 缺失、空 exports、仅缺 Pill；交互断言原 button/dt-pill/active/aria/onClick/rest，静态断言 span/dt-pill 且无按钮语义。
3. **真实 9 调用点**：实际渲染总览与判定页，覆盖仓库徽章、问题过滤、暂停原因、跳过原因及各自再点取消/清除；验证 active 与 aria-pressed 同步、过滤列表正确收敛，官方路径不再出现本地 `button.dt-pill`。
4. **过滤汇总**：真实调用单项清除和全部清除，逐项断言徽章、状态、搜索、问题、暂停原因五个原状态槽的写回值；无 active 的清除胶囊保持 `aria-pressed=false`。

共享 `Pill` 的捕获点只在测试执行时通过源码替换注入，不向生产 `client.js` 增加测试导出。

## 4. 实际执行结果

所有长命令均套了 `timeout`。

| 命令 | 真实结果 |
|---|---|
| `timeout 60 node --check client.js` | 通过 |
| `timeout 60 node --check test/update-ui.test.mjs` | 通过 |
| `timeout 240 node --test test/update-ui.test.mjs test/client.test.mjs`（迁移前基线） | **120/120 通过，0 失败，0 skipped** |
| `timeout 240 node --test test/update-ui.test.mjs test/client.test.mjs`（迁移后） | **124/124 通过，0 失败，0 skipped** |
| `timeout 600 npm test` | **617/617 通过，0 失败，0 skipped** |
| `timeout 120 node scripts/ui-audit.mjs --json` | **11/11，100 分** |
| 主线 `scripts/verify-panel-chromium.mjs` + 真实 Chromium | **47/47 功能项通过，0 失败，exit 0** |
| `timeout 30 git diff --check` | 通过，无 whitespace error |

定向计数从实测 120 增至 124，正好对应新增 4 条测试。

`ui-audit` 原始关键计数：可点但不可键盘操作的裸 div **0**；焦点可见规则 **17**；自造样式写死颜色 **0**；图标按钮缺可读名字 **0**；弹层键盘行为 **3/3**；自造类死代码 **0**；官方结构采用 **8/8**；含 inline/JS 常量写死颜色 **0**；自造 token **0**；裸 button / 原生 Btn 趋势计数 **15/25**。

### 4.1 真实 Chromium 证据

主线脚本通过文件 URL 导入，确保读取的是本 worktree，而不是默认主线目录：

```bash
timeout 600 ego-browser nodejs -e 'await import("file:///D:/%E4%B8%BB%E5%B7%A5%E4%BD%9C%E5%8C%BA/projects/dsh-session-superagent-native-pill/scripts/verify-panel-chromium.mjs")'
```

验收输出：

- Chromium：**156.0.8078.74**；React：**18.3.1**；安装版 frontend/primitives：**0.2.1-rc.5**；primitives identity=true，导出数 290。
- 本 worktree `client.js` SHA-256：`bfd74a67d1c367159923c0ccdd66c01243aa4024e288bfa65a938c0231381cb6`。
- 官方 asar SHA-256：`e1b6f25fa937da98086c3e77af77aa14791105963c4d337a1c42179d232c6915`。
- **47/47**：完整 desk/orbit 挂载、搜索与清除、判定/追溯、表单与 Switch、Tooltip、设置、Orbit/Modal 焦点、防写 guard 全过；无未预期页面错误或外部请求。
- 主线脚本既有 `CAPTURE_SCREENSHOTS=false`，因此 12 个截图动作均明确记为 SKIP，未计入 47 个功能检查，也未改写任何既有 PNG。

## 5. 边界与未验项

- 真实 Chromium 验收使用主线既定的独立 loopback 页面、真实 `client.js` 与安装版 React/primitives；未进入需要真实会话和凭证的 DSH Web GUI，不冒称已做宿主安装/重载验证。
- 未执行真实保存、安装更新、删除、暂停、恢复或 watcher 轮询；唯一 POST 是脚本末尾的 loopback 防写探针，真实返回 403。
- 未验物理读屏、触摸、IME、真实 GitHub/Gitee 响应；本轮没有新截图，视觉结论不超出主线 DOM/交互检查范围。
- Ego Lite 输出提示有可用升级（当前 0.6.2.7）；本任务未升级工具。

最终改动仅限：`client.js`、`test/update-ui.test.mjs`、本报告。
