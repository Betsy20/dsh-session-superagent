# L84 · 主理鱼 InfoTip 接入 DSH Tooltip 实施报告

> 版本基线：`dsh-session-superagent` **0.9.267**，未改版本号。实施日期：2026-11-05。
>
> 结果：主面板实际 `InfoTip({text,icon,warn})` 路径在宿主提供 `Tooltip` 时改用 DSH primitives；保留 `button.dt-info / dt-info-warn`、现有 Icon、原文案与 aria-label。scroll-close 通过 capture listener + key remount 落在主面板组件路径，不是只存在于独立适配模块。缺少模块或 Tooltip 时完整保留原本地实现。

## 1. 范围与依据

依据：

- `ui-host-primitives.js` 的 `createHostUi` / Tooltip 薄适配、remount key、capture scroll 与 effect cleanup。
- `docs/ui-decomp/04-host-primitives-smoke.md` 的真实 API 边界：`label/side/portal/openOnClick/gap`、trigger clone、无受控 `open/onOpenChange`、宿主不管 scroll。
- 只读提取当前安装版 Tooltip 实现再次确认：宿主合并 `aria-describedby`、ref 与 mouse/focus/click handlers，但不维护 `aria-expanded`，也没有 scroll listener。

本任务只写入：

1. `client.js`；
2. 新建 `test/ui-l84-tooltip.test.mjs`；
3. 新建本报告。

未写 `ui-host-primitives.js`、`ui-orbit-popover.js`、`lib/`、其他既有测试、版本文件或派单表；未 commit、未 publish、未重启或刷新 DSH。测试期间工作树出现了其他并行任务的 README/package/orbit 等改动，它们不属于本任务，也未由本任务回滚或修改。

## 2. 实现

### 2.1 UMD 可选探测与主面板接入

`client.js:54-120`：

- 在既有 `createHostUi({React,primitives})` 内补 Tooltip 薄适配；UMD 仍只使用 factory 注入的 `require`，没有 import 相对 ESM 模块。
- `hostTooltip` 独立可选探测 `primitives.Tooltip`；缺少它只回退 InfoTip，不把已经接入的 DSH Modal/Toast 一并降级。
- `client.js:527-542` 将原本地实现完整保留为 `FallbackInfoTip`，对外仍是同一个 `InfoTip(props)` 调用面。现有调用点未改，仍传 `{text,icon,warn}`。
- 静态分支只在模块初始化时确定；`InfoTip` 自身不条件调用 hooks，fallback 的 state 顺序保持原样。

### 2.2 DSH 参数、trigger 与 aria 映射

`client.js:56-89`：

- 固定传递 `label:text`、`side:'top'`、`portal:true`、`openOnClick:true`、`gap:8`。
- 没有传 `open`、`onOpenChange` 或自行实现定位；hover/focus/click pinned 仍由 DSH 负责。
- trigger 仍是 `button[type=button].dt-info`，`warn` 时追加 `dt-info-warn`，`aria-label` 仍取原始 `text`。
- 字符串 icon 继续交给现有 `Icon({name:icon,size:14})`；也接受有效 React icon element。DSH 路径没有本地 `dt-tooltip` bubble。
- `TooltipTrigger` 用宿主 `React.forwardRef` 把 DSH 合并的 ref 与事件 handlers 原样落到 button。
- 安装版 DSH 只在提示可见时给 click 模式 trigger 合并 bubble 的 `aria-describedby`。适配器保留该属性，并以 `aria-expanded=Boolean(aria-describedby)` 映射可见状态；没有另建 open state、事件切换或受控 API。

### 2.3 scroll-close 与回退

`client.js:73-80`：

- 每个 HostTooltip mount 时在 `window` 以 capture=true 注册 `scroll`，因此主面板和嵌套滚动容器都走同一 listener。
- listener 只执行 `setRemountKey(current => current + 1)`；React key 从 0 递增，强制 DSH Tooltip remount，清除其内部 pinned/open 状态。
- effect 依赖为 `[]`；cleanup 用同一个 listener 与 capture=true 对称解绑。
- require 失败或仅缺 Tooltip 时，原 `dt-info/dt-info-warn`、`aria-label/aria-expanded`、click 开、blur 关、原 `span.dt-tooltip[role=tooltip]` 文案和 absolute/bottom:130% 样式均保留。

## 3. 自动化覆盖

新测试 `test/ui-l84-tooltip.test.mjs` 执行真实 `client.js` UMD factory，并用显式假 primitives/fake React 记录结构、状态与 effects。仅为了覆盖现有主面板调用点没有用到的 `warn/icon` 参数，测试在**内存源码**中暴露同一个 InfoTip；磁盘生产文件没有测试出口。

最终 **5 条**用例：

1. 主面板「判定」实际路径的 DSH 参数、原 trigger、现有 Icon、无本地 bubble、无虚构受控 API。
2. `{text,icon,warn}`、原 trigger 文案与 warn class；模拟 DSH clone 合同后，describedby→expanded、ref 与宿主事件 handlers 均正确透传。
3. 主面板 capture scroll 后 key 0→1，effect 依赖为空，cleanup 以同一 listener/capture 解绑。
4. require 缺失与仅缺 Tooltip 两种 fallback；原 click/blur、expanded、bubble 文案和定位样式保持。
5. 主面板仅缺 Tooltip 时使用本地 InfoTip，同时 DSH Modal 仍可用，验证独立回退边界。

这些断言证明元素、props、状态与 listener 注册/清理，不冒充真实浏览器键鼠或读屏验收。

## 4. 实测命令与真实计数

| 命令 | 最终结果 |
|---|---|
| `node --check client.js` | PASS，语法错误 0 |
| `node --check test/ui-l84-tooltip.test.mjs` | PASS，语法错误 0 |
| `git diff --check -- client.js test/ui-l84-tooltip.test.mjs` | PASS，目标文件空白错误 0 |
| `node scripts/test.mjs test/ui-l84-tooltip.test.mjs` | **5/5 通过，0 失败，0 skipped/todo** |
| `node scripts/test.mjs test/ui-l84-host-modal-toast.test.mjs test/host-primitives-adapter.test.mjs` | **19/19 通过，0 失败** |
| `npm test` | 当前完整工作树 **515/515 通过，0 失败，0 cancelled/skipped/todo**；总数包含并行任务测试，不全部归属于本任务 |
| `node scripts/ui-audit.mjs --json` | **11/11 通过，100 分** |
| `node scripts/audit-contrast.mjs --json` | 完成双主题无头 Chromium 静态 preview 测量；脚本 exit 1，实际 failGroups 浅色 **16**、深色 **13**，均不超本任务上限 |

`npm test` 仍输出既有的 `node:test run() is being called recursively ... skipping running files` runner warning；最终 515 条均通过。本任务未修改 runner。

ui-audit 关键原始值：写死颜色（CSS）0、写死颜色（含 inline/JS）0、自造 token 0、自造类死代码 0、缺名图标按钮 0、官方结构采用 8/8。

### 4.1 对比度计数与退出码

| 主题 | 测量节点 | 总组数 | blocking failGroups | failNodes | 本任务上限 | 结论 |
|---|---:|---:|---:|---:|---:|---|
| light | 1486 | 122 | **16** | 310 | 16 | **16≤16** |
| dark | 1486 | 135 | **13** | 231 | 13 | **13≤13** |

- 独立 `audit-contrast` 在仍有 blocking WCAG 违规时按设计返回 1；本轮共 29 组（16+13），不能写成“WCAG 全部达标”。
- 上限比较的是 `summary[theme].failGroups`，不是总组数或 failNodes。
- 本任务没有改颜色、token 或 `PORTED_CSS`。测量来自静态 preview 的 computed style，不覆盖运行中 DSH 的 Tooltip portal/bubble。

## 5. 真实 DSH GUI / 浏览器交互未验项

本轮**没有**在实际 DSH Web GUI 中重载主理鱼并操作 Tooltip，也没有 GUI 截图。无头 Chromium 对比度测量不等于下述宿主验收；这些项目保持未验：

1. 修改后的 factory 在运行中宿主是否命中 DSH 分支，以及实际取得的 primitives 对象版本。
2. 真实 hover、focus-visible、touch、click pinned、再次点击、外点、Escape/Tab 与焦点位置/归还。
3. 真实主面板及嵌套容器 scroll 后 pinned bubble 是否可见地关闭，key remount 是否与 DSH 内部 effect 时序组合正确。
4. body portal、上侧定位、边缘 flip/clamp、resize、窄/矮视口及 Tooltip 与 Modal/Toast 的同屏层级。
5. 真实 DOM/读屏中 `aria-describedby` 与 `aria-expanded` 的同步、提示播报，以及 forwardRef 后的实际焦点行为。
6. 宿主双主题下 DSH bubble 的 computed style、对比度与动效；静态 preview 没有渲染该宿主 portal bubble。

## 6. 回滚边界

- 宿主无模块或 Tooltip 时自动走原实现，无需数据迁移。
- 撤销本任务只需还原 `client.js` 并删除新测试、新报告；不涉及 watcher 数据、服务端状态或版本。
- `ui-host-primitives.js` 与 orbit 子任务文件未由本任务修改。
