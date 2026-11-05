# 报告 · Orbit 触发按钮原生化

日期：2026-11-05  
仓库版本：`0.9.268`（未改版本号，未 commit）

## 1. 结论与范围

StatusOrbit 触发按钮已不再携带 `style` prop。原按钮对象中的 **13 项 inline 视觉声明**（含 `display/alignItems/justifyContent/height/minWidth/padding/margin/border/borderRadius/background/cursor/color/opacity`）已迁入 `DOCK_CSS`，打开态不再写死 `rgba(128,128,128,.16)`。

本任务按 hunk 只做了两处 `client.js` 改动，并新增一个测试文件：

- [client.js 的 DOCK_CSS 触发器规则](../client.js#L461)：4 个规则块，覆盖基础几何、hover、active/open、初始读取弱化。
- [client.js 的 StatusOrbit button](../client.js#L1445)：以 `className` 替代整个 `style` 对象。
- [test/orbit-trigger-native.test.mjs](../test/orbit-trigger-native.test.mjs)：DSH 与 fallback 双路径回归，共 7 条测试。

宿主导出中有 `Button`，但没有已登记的 `IconButton`。宿主 `Button` 的 md/sm 分别为 36/28px，且 `icon` 会引入额外图标槽；为保留 20px dock 几何和同一个 `OrbitMark` 直接子节点，本任务采用任务书允许的第二条路线：**官方 `dt-btn dt-btn-ghost` + 可复用 derived `sa-orbit-trigger`**。没有另建 DSH/fallback 两套按钮实现。

`OrbitMark` 仍是已登记 derived 图形；`OrbitPopover`、`ConfirmDialog`、`InfoTip` 均不在本任务 hunk 内。共享工作树验收期间另有 Tooltip 焦点子任务产生的 InfoTip/测试改动，本任务没有修改或回退那些 hunk；最终全量测试是在共享工作树上共同跑过的。

## 2. 样式与行为对照

| 项目 | 原实现 | 现实现 |
|---|---|---|
| 基础类 | 无 | `dt-btn dt-btn-ghost sa-orbit-trigger` |
| 几何 | button inline style | `.dt-btn.sa-orbit-trigger`：20px 高、20px 最小宽、原 padding/margin/radius |
| 默认背景 | inline `transparent` | class `transparent` |
| hover | 无独立规则 | `var(--dsw-alias-interactive-bg-hover)`，与官方 ghost 一致 |
| open / active | inline `rgba(128,128,128,.16)` | `[aria-expanded='true']` / `:active` 使用 `var(--dsw-alias-interactive-bg-active)` |
| 焦点 | 无本组件专用 inline | 复用官方 `.dt-btn:focus-visible` 与 `--dsw-alias-brand-primary` |
| 初始读取 | inline `opacity: 0.45` | `is-loading` class，`opacity: 0.4`，与官方 `.dt-btn:disabled` 同档 |
| 字体 | 继承 | class `font: inherit`，抵消通用按钮 md 字号，不新增 md/sm 类 |

透明度没有虚构新的 `--dsw-*` token：`0.4` 的依据是现有官方 `.dt-btn:disabled` 规则。初始读取只是视觉弱化，**没有新增 `disabled` 属性**，仍然可以点击并打开弹层。

行为保持项：

- 注册槽仍为 `conversation.composer.dock`，`order=-10`，位于 activity/usage 左侧。
- `ref`、`type=button`、`title`、`aria-label`、`onClick` 保留。
- `aria-expanded` 仍由原 `open` 状态生成字符串 `'true' / 'false'`，CSS 直接消费同一 ARIA 状态，没有第二份 open 状态。
- 加载、打开、关闭在 DSH 与 fallback 都走同一个 button 和同一个 `toggle`。
- `OrbitMark` 仍是 button 的直接子组件，16×16 viewBox、`aria-hidden` 与原 watchers 输入保留。

## 3. 新增测试覆盖

[新测试](../test/orbit-trigger-native.test.mjs)直接执行真实 `client.js` UMD，分别注入无宿主原语与完整 Orbit 原语，调用真实 `onClick` 后重渲染：

1. fallback：无 inline style、最左槽位、官方/derived class、aria/title、OrbitMark。
2. fallback：点击切换 open，`aria-expanded` 同步，再次点击关闭。
3. fallback：初始读取 `is-loading`、不禁止点击、加载后移除弱化 class。
4. DSH：同第 1 项。
5. DSH：同第 2 项。
6. DSH：同第 3 项。
7. CSS 合同：原几何逐项相等、hover/open token 已登记、无 rgba/hex、加载透明度与官方 disabled 档位一致、官方焦点规则存在。

触发按钮的 inline `style` 属性计数为 **0**；断言使用 `Object.hasOwn(trigger.props, 'style') === false`，不是只检查值 falsy。

## 4. 实际验收结果

| 命令 | 真实结果 |
|---|---|
| `node --test test/orbit-trigger-native.test.mjs` | **7/7 通过，fail 0，exit 0** |
| `node scripts/test.mjs test/client.test.mjs test/orbit-popover-integration.test.mjs` | **101/101 通过，fail 0，exit 0** |
| `node --test test/ui-l84-tooltip.test.mjs test/orbit-trigger-native.test.mjs` | **12/12 通过，fail 0，exit 0** |
| `npm test`（最终复跑） | **535/535 通过，fail 0，exit 0** |
| `node scripts/ui-audit.mjs --json` | **11/11，100 分，exit 0** |
| `node scripts/audit-contrast.mjs --json` | 完成双主题测量；浅 **16 ≤16**、深 **13 ≤13**；脚本按既有违规返回 **exit 1** |
| `git diff --check -- client.js` | **exit 0** |

全量测试首轮曾为 530/531：唯一失败来自并发 Tooltip 测试的 `hostRefCalls` 重复声明。该并发文件稳定后，定向 12/12 与最终全量 535/535 均已复跑；本任务没有修改那份 Tooltip 测试。

### 4.1 ui-audit 原始值

- 写死颜色（自造 CSS）：**0**。
- 写死颜色（含 inline/JS 常量）：**0**。
- 自造 token：**0**；15 个引用均有官方出处。
- 自造类死代码：**0**。
- 缺名图标按钮：**0**。
- 焦点可见规则：**17**。
- 官方结构采用：**8/8**。

### 4.2 对比度原始计数

| 主题 | groups | 测量 nodes | failGroups | failNodes | 本任务上限 |
|---|---:|---:|---:|---:|---:|
| light | 122 | 1486 | **16** | 310 | **16** |
| dark | 135 | 1486 | **13** | 231 | **13** |

退出码 1 表示预览仍有已登记的 WCAG 违规，**不能写成“对比度零违规”**；本任务判据是 failGroups 不超过浅 16 / 深 13，实测未增加。输出中没有独立的 `sa-orbit-trigger` pass/fail group，因此这里只报告全预览基线计数，不虚构触发图标的单独对比度结论。

## 5. 未验项

- 未在真实 DSH Web GUI 重载插件并做鼠标、Tab、Enter、Space、焦点环与点击走查；Node 测试使用假 React/DOM/宿主原语。
- 未生成或交付深浅主题截图。可写路径只允许本报告、测试与 `client.js`，没有写其他截图文件。
- 对比度来自 `render-preview.mjs` 静态预览与近似 token 的无头 Chromium 测量，不等于真实宿主 token/computed style；脚本也不测量 `:hover/:focus` 状态。
- 未验证宿主热重载后真实 WebView 中 `DOCK_CSS` 的注入时序；既有 `ensurePortedCss()` 路径未改。
- 未改 `ui-host-primitives.js`、`lib/`、`package.json`、其他既有测试、版本号或派单表；未 commit。
