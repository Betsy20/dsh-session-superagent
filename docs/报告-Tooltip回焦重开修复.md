# Tooltip scroll-close 回焦重开修复报告

## 结论

`ui-host-primitives.js` 的独立 Tooltip 适配器已修复：scroll 引起 keyed remount 后，程序化回焦只在同步 `focus({preventScroll:true})` 期间使用官方 `disabled` 抑制打开；`focus` 返回后立即恢复 `disabled=false`，不改变 remount key，也不再次 detach/attach trigger。

同一真实 Chromium 失败路径复验结果为 **27/27**。scroll 稳定后实测：

```text
tooltipOpen=false
bubble=null
aria-describedby=null
aria-expanded="false"
document.activeElement=#tooltip-trigger
trigger.isConnected=true
scrollTop=70
refEvents=[detach, attach(#tooltip-trigger)]
```

hover、键盘 focus、click pinned、Escape、Tab、外点、ref detach/attach、普通回焦，以及同 harness 的 Orbit/Modal 组合验收均通过。

## 根因与真实复现

### 环境

- Chromium：`156.0.8078.74`；DSH frontend：`0.2.1-rc.5`；React：`18.3.1`；primitives：290 exports。
- 安装 asar SHA-256：`e1b6f25fa937da98086c3e77af77aa14791105963c4d337a1c42179d232c6915`。
- 修复前 `ui-host-primitives.js` SHA-256：`934f9178a4413c30bb430a044d61f9ed38bc63a33994ed4e903503551940a0d1`。
- 修复后 `ui-host-primitives.js` SHA-256：`30742e1dd8ff856e72c2b88151f9b7c2a36341cbc72234b2ada1e8b8a6f382fd`。

### 必现路径

1. 用真实 hover 与 `Shift+Tab` 键盘焦点分别确认 Tooltip 正常打开；fixture 与主面板一样把官方 `aria-describedby` 映射为 `aria-expanded`。
2. 先移开指针，再以键盘 focus 打开**非 pinned** Tooltip，保持键盘模态。
3. 将嵌套滚动容器 `scrollTop` 改为 `70`，触发真实 scroll 事件；不再插入 `mouse.move()` 改变输入模态。
4. 修复前，旧 keyed Tooltip 卸载后，恢复焦点触发新实例的官方 `onFocus`：最终新 bubble 的 id 为 `:r1:`，`visibility=visible`，trigger 为 `aria-expanded=true`、`aria-describedby=:r1:`，且焦点仍在已连接的新 trigger。等待关闭的 `waitForFunction(false)` 超时，脚本 exit 1。

旧验收的 click-pinned/wheel 路径会把 Chromium 切回指针模态，官方 focus-visible 判定 `R_()` 因而不响应程序化 focus，所以旧报告 27/27 没覆盖到这个分支。此次没有放宽原断言，而是把缺陷路径和 ARIA/焦点断言纳入复验。

### 官方行为依据

安装版 Tooltip `function $r(...)` 已提供 `disabled=false`：可见条件为 `$!==null && !disabled`；`disabled` effect 会清掉 anchor/open 状态，打开函数 `we()` 在 disabled 时直接返回。适配层使用这个官方能力，没有虚构受控 `open/onOpenChange`，也没有新增第二套 Tooltip、计时器或焦点系统。

## 实现

- [ui-host-primitives.js:78](../ui-host-primitives.js#L78)：新增 `scrollFocusSuppressed`，普通渲染始终为 `false`。
- [ui-host-primitives.js:84](../ui-host-primitives.js#L84)：scroll 时仍先记录焦点是否位于 trigger/其内部；需要回焦时，keyed remount 同帧设置 suppress。
- [ui-host-primitives.js:116](../ui-host-primitives.js#L116)：新 ref 附着后，在 `disabled=true` 帧内同步执行 `focus({preventScroll:true})`；`finally` 恢复 `false`，即使 ref 缺失或 focus 抛错也不会永久禁用。
- [ui-host-primitives.js:135](../ui-host-primitives.js#L135)：把 suppress 映射到官方 `disabled`；恢复时不改变 key，因此没有第二次 ref 抖动。

## 回归测试

[host-primitives-adapter.test.mjs:62](../test/host-primitives-adapter.test.mjs#L62) 的假 React harness 改为按 hook 位置保存多个 state，避免新增状态后互相覆盖。[同文件:218](../test/host-primitives-adapter.test.mjs#L218) 明确断言：

- 初始 `disabled=false`；scroll 回焦 remount 帧为 `true`；
- 新 trigger 收到且仅收到 `focus({preventScroll:true})`；
- focus 后状态恢复 `false`，下一渲染 key 不变、焦点不丢；
- 原 props/ref、capture listener cleanup、焦点在 trigger 内部及焦点在别处的既有行为不回归。

新增断言在旧实现上先得到 **11/12、fail 1**（`disabled` 实际为 `undefined`），修复后全绿，证明测试能抓住旧行为。

## 最终实测计数

| 检查 | 命令/方式 | 结果 |
|---|---|---|
| 适配器定向 | `timeout 120s node scripts/test.mjs test/host-primitives-adapter.test.mjs` | **12/12，fail 0** |
| 主面板既有 Tooltip 回归 | `timeout 120s node scripts/test.mjs test/ui-l84-tooltip.test.mjs test/ui-l84-tooltip-focus.test.mjs` | **7/7，fail 0** |
| 全量 | `timeout 300s npm test` | **612/612，fail 0，skipped 0** |
| UI 审计 | `timeout 60s node scripts/ui-audit.mjs --json` | **11/11，100 分** |
| 语法/差异 | `node --check ui-host-primitives.js && git diff --check` | exit 0 |
| 真实 Chromium 深层复验 | 安装版 bundle + 当前 worktree 适配器，上述键盘 focus/scroll 路径 | **27/27，fail 0** |

UI 审计原始关键值：不可键盘裸 div `0`、写死颜色（自造样式）`0`、写死颜色（含 inline/JS）`0`、自造 token `0`、自造类死代码 `0`、缺名图标按钮 `0`、官方结构采用 `8/8`、focus-visible 规则 `17`。

Chromium 的 27 项仍由基础环境 3、Tooltip 13、Orbit/Modal 10、页面错误 1 组成；这次把 scroll 项加强为同时检查 `tooltipOpen=false`、ARIA 清除、trigger 已连接，并保留后续 Escape/Tab/外点检查，没有用减少检查项换取通过。未生成截图，也未修改既有验收脚本；脚本只在执行管道内切换到本 worktree、加入上述路径/断言并禁用截图。

## 集成边界与未验项

- **本任务按写权限没有修改 `client.js`。** 其中 UMD `HostTooltip` 是独立内联镜像，仍是旧实现；本报告的模块 27/27 不能冒充实际主面板内联路径已经修复。主线必须由有该文件权限的一方同步同一短暂 `disabled` 逻辑，并在主线再次运行真实 Chromium 深层验收。
- 浏览器验收使用真实 Chromium 和安装版 React/primitives 的独立 loopback harness，没有进入需要认证的 DSH Web GUI 会话 slot。
- 未验 touch、读屏播报、双主题、reduced-motion、resize/窄视口；这些不是本次改动路径。
- `test/ui-primitives-browser.test.mjs` 原本不存在，本次没有必要新建；真实浏览器证据来自现有 `scripts/verify-ui-primitives.mjs` 的内存增强复验。
- 本子代理改动仅限 `ui-host-primitives.js`、`test/host-primitives-adapter.test.mjs` 和本报告；未改 client/lib/package/版本/preflight/派单表，未执行 commit/push。收尾核对时，父代理已把前两项集成提交为本分支 `388cee6`，本报告尚未提交。
