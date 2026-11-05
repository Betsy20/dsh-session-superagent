# DSH 宿主官方 UI 结构树与可复用素材（主理鱼复用版）

> 盘点对象：本机安装的 DSH `0.2.1-rc.5`，不是更高版本，也不是主理鱼此前移植的 `dsh-superagent dt-*` 样式包。
>
> 官方 asar：`D:\DeepSeek Harness\Desktop\resources\app.asar`，SHA-256 `e1b6f25fa937da98086c3e77af77aa14791105963c4d337a1c42179d232c6915`。版本、哈希和主库基线见 `D:\DeepSeek Harness\home\DSH-UI-official.md:32-38`；本次已对实际 asar 重算同一哈希。
>
> 路径缩写：`ASAR/` 表示上述归档内的虚拟路径（`app.asar::…`），不是磁盘上已经解压的目录；`OFFICIAL/` 表示 `D:\DeepSeek Harness\home\dsh-ui-official\`；`CSS/` 表示主库既有证据目录 `D:\DeepSeek Harness\default-workspace\dsh-ui\tmp\asar-css\`。
>
> **源码边界：本机包内没有宿主 UI 的完整 TS/TSX 源码，只有编译产物。** 多数包保留 `lib/types/...`、`src/client/...` region 注释，部分文件末尾仍有 `sourceMappingURL`，但归档没有对应 `.map` 和完整 `src/`。下文给的是实际可读编译文件及行号，不把 region 注释伪称为本机源码文件。官方主库也明确采用 `app.asar::…` 定位，见 `OFFICIAL/structure/official-shell-tree.md:7-14`。
>
> 本文是静态结构/素材盘点，不宣称完成浏览器交互验收。未另起服务、未修改 GUI；只读探测确认现有 GUI 的 `/favicon.svg` 与 `/favicon-dark.svg` 均返回 HTTP 200。

---

## 一、组件清单：真实来源、行号与导出方式

### 1.1 宿主 primitives 的正确引用方式

宿主 Web 入口把 primitives 编译进 `ASAR/dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/index-BXV-oxvX.js`：

- 第 188 行是 `TU=Object.freeze(...)` 的完整具名导出表；第 190 行把 `@deepseek-ai/dsh-client-ui-primitives` 映射到 `TU`，同时提供 `react`、`react/jsx-runtime`、`@deepseek-ai/dsh-client-ui-slots` 等运行时模块。
- 官方包自身也通过同一方式引用，例如 `ASAR/dsh/node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js:7-10`、`ASAR/dsh/node_modules/@deepseek-ai/dsh-client-ui-settings-shell/lib/client.js:7-9`。
- **本机 asar 没有独立的 `dsh-client-ui-primitives/` 包目录，也没有其 TS/TSX 源码；只有上述编译产物和浏览器运行时导出。** 因而可用的是 `factory(require)` 里的运行时 `require`，不是从磁盘路径做 ESM `import`。

主理鱼 `client.js` 当前已经是 `window.__ModuleLoader__.load({ factory(require) { … } })`，可在 `require('react')` 后直接使用：

```js
const {
  Button, Input, Modal, RiskConfirmation,
  SegmentedTabs, SegmentedControl,
  Tag, Pill, DisclosureRow,
  Toast, Tooltip, StateDot, Switch, Checkbox,
  SettingsForm, SettingsValueField, SettingsSecretField,
  IconRefreshOutlineRegular, IconPlusOutlineMedium,
} = require('@deepseek-ai/dsh-client-ui-primitives')
```

不要写成 `import … from 'D:/…/app.asar/…'`，也不要依赖带 hash 的 `index-BXV-oxvX.js` URL；构建 hash 会随版本改变。

### 1.2 任务点名的组件/原语

下表的“定义”均指实际编译定义；“导出”指浏览器模块运行时具名导出。`P` 为上一节的 `dsh-web-frontend/dist/assets/index-BXV-oxvX.js`。

| 组件/结构 | 真实文件与行号 | 导出方式与可复用边界 |
|---|---|---|
| **Button** | `ASAR/dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/index-BXV-oxvX.js:129`：`n2=C.forwardRef(...)`；同文件 `:188`：`Button:n2` | 具名 `Button`。支持 `variant`（默认 `ghost`）、`size`（默认 `md`）、`icon`、`className`、原生 button props 和 ref。**可直接复用。** |
| **Input** | 同文件 `:129`：`eA=C.forwardRef(...)`；`:188`：`Input:eA` | 具名 `Input`。结构为外层 `span` + 可选 icon + 原生 `input`，支持 ref 和原生 input props。**可直接复用。** |
| **Modal / 风险确认** | 同文件 `:129`：`function j_(…)`、`function hA(…)`；`:188`：`Modal:j_`、`RiskConfirmation:hA` | 具名 `Modal`、`RiskConfirmation`。Modal 自带 portal、遮罩、`role=dialog`、`aria-modal`、页头/正文/footer，并调用共享 `useModalLayer`；不要再用本地 div 重造焦点圈。 |
| **Tabs / Segmented** | 同文件 `:129`：`function JD(…)`、`function XD(…)`；`:188`：`SegmentedTabs:JD`、`SegmentedControl:XD` | 两个不同具名导出。`SegmentedTabs` 用 `items/value/onChange/label`；`SegmentedControl` 用 `id/options/value/onChange/label/disabled`，支持方向键、Home/End、跳过 disabled。不要再把后者写成 `radiogroup`。 |
| **Section** | 宿主没有 primitives `Section` 导出。真实设置分区是内部函数：`ASAR/dsh/node_modules/@deepseek-ai/dsh-client-ui-settings-general/lib/client.js:631-640` `GeneralSection`；模型分区在同包 `dsh-client-ui-settings-models/lib/client.js:2320-2338`；插件详情 section 在 `dsh-client-ui-plugin-manager/lib/client.js:2742-2752` | **无通用导出。** 这些组件由各自包的 `apply/inject` 和 slot 注册，不能 `require('…settings-general').GeneralSection`。主理鱼现有本地 `Section` 可保留；扩展宿主设置时应注册 `settings.section`，不是复制内部组件。 |
| **Tag / Pill / Badge** | `P:129`：`function o4(…)` Tag、`function i4(…)` Pill；`P:188`：`Tag:o4`、`Pill:i4`。官方 Tag 用例见 `ASAR/dsh/node_modules/@deepseek-ai/dsh-client-ui-plugin-manager/lib/client.js:2633-2652` | `Tag`、`Pill` 可直接引用。Pill 有 `onClick` 时渲染 button，否则为 span。**没有名为 `Badge` 的 primitives 导出**；普通徽章用 Tag，可切换过滤用 Pill，`plugins.detail.badge` 是槽名而不是 Badge 组件。 |
| **KeyValues** | 全包检索没有宿主 `KeyValues`/`dt-kv` 组件。相邻但语义不同的真实导出是 `P:188` 的 `JsonBlock`、`JsonTree`、`SettingsValueField` | **无通用 KeyValues 导出。** 字符串键值列表继续用语义化 `<dl><dt/><dd/></dl>` 的本地薄封装；结构化 JSON 才考虑 `JsonTree`。主理鱼已有实现，不应再另造一个“官方 KV”。 |
| **Disclosure / Timeline** | `P:129`：`BD=C.memo(function …)`；`P:188`：`DisclosureRow:BD`。真实轨迹时间线是 `ASAR/dsh/node_modules/@deepseek-ai/dsh-client-ui-trajectory/lib/client.js:6288-6339` `TrajectoryTimeline`，其模块边界从 `:6314` 开始 | `DisclosureRow` 可直接复用，但要适配 `expandable/onToggle/expandOnRowClick/collapsedContent` 等 props。**`TrajectoryTimeline` 没有公共导出**，是带 TTFT/decode、缩放和选区的专用轨迹部件；不能当通用 Timeline import。 |
| **Toast** | `P:134`：`function cR(…)`；`P:188`：`Toast:cR`。官方使用例：`ASAR/dsh/node_modules/@deepseek-ai/dsh-client-ui-plugin-manager/lib/client.js:4267-4280`；挂到 `shell.overlay` 的注册见同文件 `:4402-4410` | 具名 `Toast`，支持 `text/icon/tone/anchor/holdMs/actions/onDone`。局部保存反馈可直接用；需要离开当前视图仍存在的通知，应照官方包一层 `shell.overlay`。 |
| **Tooltip** | `P:134`：`function $r(…)`；`P:188`：`Tooltip:$r`。官方包实例：`ASAR/dsh/node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js:18052-18073` | 具名 `Tooltip`，支持 `label/shortcutKeys/side/align/delayMs/gap/portal/openOnClick` 等。适合说明，不适合承载主理鱼 dock 的交互列表。 |
| **Empty / Error / Loading** | 没有同名的通用 primitives 导出。真实空会话是 `ASAR/dsh/node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js:17641-17780` 的 `EmptyHero`；共享设置表状态在 `P:134` 的 `SettingsForm`；加载状态原语在 `P:129` 的 `StateDot`、`TextShimmer`；插件列表状态样式见 `CSS/065__PluginManagerPage.module.css.mjs.css:1` 的 `.V7pFBG_status/.failure/.empty` | `EmptyHero` 无公共导出且包含 workspace/composer，不应复制成通用空态。普通面板用本地语义文案 + token；`StateDot(state:'ongoing')` 与 `TextShimmer` 可直接用；`SettingsForm` 可表达 unavailable/readOnly/failed。 |
| **Settings 左右栏** | `ASAR/dsh/node_modules/@deepseek-ai/dsh-client-ui-settings-general/lib/client.js:230-337` `SettingsPanel`，完整根结构见同文件 `:648-734`；CSS 为 `CSS/085__SettingsRoot.module.css.mjs.css:1` | `SettingsPanel`/`SettingsRoot` **不是公共组件导出**。官方结构是 Modal → 左 `nav` + 右 `content/options`，通过 `settings.section` 动态填页。扩展宿主设置走 slot；主理鱼自己的页内设置可保留轻量本地左右栏。 |

### 1.3 其它已经确认存在、值得直接用的导出

完整导出表以 `P:188` 为准；下面只列与主理鱼最相关的真实名字：

| 类别 | 导出名 |
|---|---|
| 表单/状态 | `Switch`、`Checkbox`、`InlineEditor`、`StateDot`、`TextShimmer`、`ConnectionIndicator` |
| 设置表单 | `SettingsForm`、`SettingsFormModel`、`SettingsValueField`、`SettingsSecretField`、`settingsNumberField`、`settingsTextField` |
| 菜单/浮层 | `Menu`、`MenuGroup`、`MenuItemButton`、`MenuSurface`、`HoverCard`、`HoverCardGroup`、`useAnchoredPosition`、`useAnchoredMaxHeight`、`useDismissOnOutsidePointer` |
| 数据/内容 | `JsonBlock`、`JsonTree`、`MarkdownText`、`CodeBlock`、`DiffBlock`、`ReadBlock`、`SearchBlock`、`TerminalBlock`、`PathLabel` |
| 品牌/插画组件 | `FishLogo`、`BrandWordmark`、`FISH_LOGO_PATH`、`FISH_LOGO_VIEWBOX`、`PluginArtworkDefault`、`PluginArtworkLoop`、`PluginArtworkSearch`、`PluginArtworkSubagent`、`PluginArtworkTerminal`、`GuideArtworkBrowser`、`GuideArtworkFiles` |

`SettingsFormModel` 不是任意后端都能直接使用的“表单状态库”：官方 shell 卡通过 `ctx.configForms.get(namespace)` 构造它，见 `ASAR/dsh/node_modules/@deepseek-ai/dsh-client-ui-settings-shell/lib/client.js:112-148`。主理鱼自有 `/state` 后端需要适配器，不能直接拿它替代现有状态管理。

### 1.4 官方可照抄的调用模板

以下是当前 `client.js` 的 `h = React.createElement` 风格；它使用真实导出，不依赖 JSX 编译：

```js
const UI = require('@deepseek-ai/dsh-client-ui-primitives')

function OfficialControls({ tab, onTab, onRefresh, modalOpen, onClose, toast, onToastDone }) {
  return h(React.Fragment, null,
    h(UI.SegmentedTabs, {
      label: '主理鱼分区',
      value: tab,
      onChange: onTab,
      items: [
        { value: 'overview', label: '总览' },
        { value: 'judge', label: '判定' },
        { value: 'settings', label: '设置' },
      ],
    }),
    h(UI.Tooltip, { label: '重新读取', portal: true },
      h(UI.Button, {
        size: 'sm',
        icon: h(UI.IconRefreshOutlineRegular, { size: 14 }),
        onClick: onRefresh,
      }, '刷新')),
    h(UI.StateDot, { state: 'ongoing' }),
    h(UI.Tag, { tone: 'info' }, '会话级'),
    modalOpen ? h(UI.Modal, {
      open: true,
      title: '主理鱼',
      closeLabel: '关闭',
      onClose,
    }, '正文') : null,
    toast ? h(UI.Toast, { text: toast, tone: 'success', onDone: onToastDone }) : null)
}
```

---

## 二、设计 token 与主题机制

### 2.1 token 分层：组件只消费 alias，不写死调色板

真实来源：`ASAR/dsh/node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js` 的全局样式注入表 `:1406-1457`。其中 `base.css` 在 `:1406-1407`，静态调色板和 alias 在 `:1412-1413`，scrollbar 在 `:1421-1422`，elevation 在 `:1424-1425`，暗色代码高亮覆盖在 `:1427-1428`。

| 层 | 可直接复用的变量 | 用法 |
|---|---|---|
| 文字 | `--dsw-alias-label-primary/secondary/tertiary/caption/dimmed` | 标题、正文、辅助、说明、禁用；不要用 opacity 代替全部语义层级 |
| 背景 | `--dsw-alias-bg-base`、`--dsw-alias-bg-layer-1/2/3`、`--dsw-alias-bg-mask-1`、`--dsw-alias-bg-module-platform` | 页面、卡片/浮层、遮罩、选中/模块底 |
| 边框 | `--dsw-alias-border-l1/l2/l3/l4` | 分隔、卡片、输入框；官方常用 `.5px` |
| 状态 | `--dsw-alias-state-success-*`、`state-warn-*`、`state-error-*`、`state-business-*`、`state-idle-*` | 状态点、Tag、错误和业务选中；按语义选 exact token，不猜后缀 |
| 交互 | `--dsw-alias-interactive-bg-hover`、`--dsw-alias-interactive-bg-active`、button/link 相关 alias | hover/active、主按钮、链接 |
| 特定表面 | `--dsw-specific-sidebar-fill`、`--dsw-specific-input-major`、`--dsw-specific-bubble`、`--dsw-specific-menu`、`--dsw-specific-selector` | 只在相同表面语义下使用；不要把 input-major 当通用卡片底 |
| 设置卡 | `--dsw-alias-settings-card-fill`、`--dsw-alias-settings-card-stroke` | 设置/插件配置卡，见 `CSS/093__ModelsSection.module.css.mjs.css:1` |
| 圆角/阴影 | `--dsw-radius-xs/sm/md/lg/xl/panel`、`--dsw-elevation-soft`、`--dsw-elevation-prominent` | `4/8/12/16/20/28px`；卡片与弹层不要自造阴影 |
| 字体 | `--dsw-font-family`、`--dsw-font-family-brand`、`--dsh-font-family-text/code/terminal` | 普通 UI 用系统栈；Montserrat 只用于品牌；代码用 code 栈 |
| 字号/密度相关 | `--dsh-content-font-size`、`--dsh-content-font-size-secondary`、`--dsh-content-font-delta`、`--dsh-code-font-size`、`--dsh-terminal-font-size` | 跟随官方字体设置，不在插件里写死 `13px system-ui` 覆盖整棵子树 |
| 几何 | `--dsh-chat-content-width`、`--dsh-composer-card-max-width`、`--dsh-composer-side-clearance`、`--dsh-composer-height`、`--dsh-frame-top-clearance`、`--dsh-frame-overlay-top`、`--dsh-windows-titlebar-height` | 只读宿主几何；除插件自有布局变量外不要覆写宿主变量 |
| 动效/滚动条 | `--ds-ease-in-out`、`--ds-transition-duration{,-fast,-slow}`、`--dsh-scrollbar-*` | 统一动效和滚动条；尊重 `prefers-reduced-motion` |

暗色默认解析值和静态色与 alias 的对应，可直接查 `OFFICIAL/structure/official-shell-tree.md:16-37`。这些 hex 用于理解/校验主题，**不应复制进主理鱼组件**；第三方主题可以覆盖 alias。

### 2.2 dark / light / system 的真实机制

1. **首屏预防闪烁**：`ASAR/dsh/node_modules/@deepseek-ai/dsh-client-ui-theme/lib/index.js:126-181` 生成 boot CSS 和 body script；`:138-160` 按 preference 与 `prefers-color-scheme` 写入 `data-ds-theme-source`、`data-ds-dark-theme` 和字体变量。
2. **运行时解析**：`ASAR/dsh/node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js:1632-1680` 管理 light/dark/system 和 `matchMedia('(prefers-color-scheme: dark)')`；`:1849-1858` 把 system 解析成实际 light/dark。
3. **DOM 落地**：`ASAR/dsh/node_modules/@deepseek-ai/dsh-client-ui-layout/lib/client.js:503-583` 的 ThemePresenter 设置 root `color-scheme`、`data-ds-theme-source`、body `data-ds-dark-theme` 和字体变量。
4. **第三方主题**：theme runtime 支持注册主题与 token override，见同文件 `:1800-1849`；override 必须同时给 `{light,dark}`，校验见 `:1934-1939`。主理鱼只消费变量，不应自行切换 body 属性或覆盖全局调色板。

可复用的暗色选择器是 `body[data-ds-dark-theme]`，例如主题包自身在 `:1419`、`:1428` 的写法；但主理鱼通常不需要为颜色另写 dark 分支，alias 已处理。

### 2.3 density：本机没有全局 density 开关

对本批宿主 UI/CSS 检索不到 `data-density`、`--dsw-density` 或 `--dsh-density` 主题机制。不要把主理鱼自己的 compact 样式冒充官方 density。

官方提供的是三类不同能力：

- 字体大小设置：theme client `:984-1089`，设置 UI 见 `:1218-1388`；
- Chat 的 `transcriptView=compact/standard/detailed/verbose`，只影响工作步骤展示，证据汇总见 `OFFICIAL/structure/official-settings-tree.md:121-130`；
- 各组件自己的紧凑变体和容器查询。

主理鱼应保持 token + 容器响应，不新增全局 `data-density`，也不要覆写宿主的 `--dsh-content-font-*`。

### 2.4 平台差异与容器查询

- **macOS**：插件管理页头用 `[data-platform=darwin]` 加 `var(--dsh-frame-top-clearance,0px)`，见 `CSS/065__PluginManagerPage.module.css.mjs.css:1`；主理鱼 `PORTED_CSS` 已有同构规则，可继续用。
- **Windows 桌面**：`data-windows-titlebar`、40px caption 和内容圆角由宿主拥有，证据见 `ASAR/dsh/node_modules/@deepseek-ai/dsh-client-ui-layout/lib/client.js:72-93` 与 `OFFICIAL/structure/official-shell-tree.md:79-92`。插件不要再次补 40px。
- **容器而不是视口**：Composer 行有 `container-type:inline-size` 和 `@container (width<=560px)`，见 `CSS/039__InputBar.module.css.mjs.css:1`；插件 inventory 用命名 container 并在窄容器把双列卡改单列，见 `CSS/097__PluginInventorySettingsTab.module.css.mjs.css:1`；Trajectory split 也使用 inline-size container，见 `ASAR/dsh/node_modules/@deepseek-ai/dsh-client-ui-trajectory/lib/client.js:3265-3266`。

### 2.5 可直接复用的 CSS 结构与官方模板

这些是**结构参考**，不是可导入的公共 class API。hash 前缀由 CSS Modules 生成，插件应使用自己的语义类名 + 宿主 token，或直接使用 primitives。

| 官方模板 | 文件与定位 | 主理鱼可复用结构 |
|---|---|---|
| 插件页 | `CSS/065__PluginManagerPage.module.css.mjs.css:1` | `page → pageHead/toolbar → status/failure/empty → group/card/detailSections`；内容 max 960、页面自滚动、darwin top clearance |
| 设置根 | `CSS/085__SettingsRoot.module.css.mjs.css:1` | `overlay/mask → panel → nav(188) + content → header + options(overflow-y:auto)`；只用于理解宿主，不复制整个设置窗 |
| Conversation | `CSS/036__ConversationRoot.module.css.mjs.css:1` | `root → header/viewArea/body/composerSeat`；理解 `conversation.view` 的滚动和 composer 边界 |
| Composer | `CSS/039__InputBar.module.css.mjs.css:1` | `card → controls row → dock`；dock `gap12/padding-top4`，控件行容器查询 |
| AppFrame | `CSS/056__AppFrame.module.css.mjs.css:1` | 三列 track、Windows chrome、overlay/bottom；不可在插件内复制 |
| 状态/空态/错误 | `CSS/065__PluginManagerPage.module.css.mjs.css:1`、`CSS/097__PluginInventorySettingsTab.module.css.mjs.css:1` | tertiary status/empty、error + retry、loading skeleton/status dot，避免另造“成功/失败”颜色 |
| 专用时间线 | `CSS/146__TrajectoryTimeline.module.css.mjs.css:1` | 仅用于 TTFT/decode 轨迹图，不拿来替代主理鱼普通事件列表 |

主理鱼新局部样式可采用下面的**结构等价适配模板**。它有意使用 `sa-`，不是官方导出类名：

```css
.sa-page {
  box-sizing: border-box;
  height: 100%;
  overflow: auto;
  container-type: inline-size;
  padding: 28px clamp(24px, 4vw, 48px) 48px;
  color: var(--dsw-alias-label-primary);
  font-family: var(--dsw-font-family);
}
.sa-page > * { width: 100%; max-width: 960px; }
.sa-head { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 16px; }
.sa-section { display: flex; flex-direction: column; gap: 12px; }
.sa-status, .sa-empty { margin: 0; color: var(--dsw-alias-label-tertiary); font-size: 13px; line-height: 20px; }
.sa-error { color: var(--dsw-alias-state-error-primary); }
[data-platform='darwin'] .sa-head { padding-top: var(--dsh-frame-top-clearance, 0px); }
@container (width <= 640px) {
  .sa-head { flex-direction: column; }
  .sa-two-columns { grid-template-columns: minmax(0, 1fr); }
}
@media (prefers-reduced-motion: reduce) {
  .sa-page *, .sa-page *::before, .sa-page *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
```

---

## 三、官方素材清单与引用边界

### 3.1 权威素材主库

`OFFICIAL/assets/manifest.json:1-7` 固定了本机 asar、哈希、版本和素材条目数；`OFFICIAL/LIBRARY-MANIFEST.json:1-6` 记录全库完整性。主库说明共 45 个官方 JSX 片段、10 个 asar 原文件、1 个 CSS data-URI APNG，以及 Montserrat 字体和许可证，见 `D:\DeepSeek Harness\home\DSH-UI-official.md:32-38`。

**主库路径是素材归档/构建来源，不代表浏览器插件可以跨宿主静态根直接 import。** 在 DSH 插件运行时应优先 `require` primitives；若独立预览或另一产品要复制文件，应在构建阶段从主库复制并保留许可证、hash 和来源，不在 `client.js` 写 `D:/...` URL。

### 3.2 icons：优先组件导出，不再手画 path

所有已登记 JSX 的来源 symbol、viewBox、字节数和 SHA-256 都在 `OFFICIAL/assets/manifest.json`。例如：

| 素材 | 主库/官方来源 | 插件内推荐引用 |
|---|---|---|
| 侧栏折叠 | `OFFICIAL/assets/icons/sidebar/panel-left.jsx`；manifest `:163-174`，源 symbol `IconPanelLeftOutlineRegular` | `h(IconPanelLeftOutlineRegular,{size:16})` |
| 新建会话 | `OFFICIAL/assets/icons/sidebar/new-chat.jsx`；manifest `:177-188` | `IconNewChatOutlineRegular` |
| 插件 | `OFFICIAL/assets/icons/sidebar/plugin-pinwheel.jsx`；manifest `:205-216` | `IconPluginPinwheelOutlineRegular` |
| 搜索/文件夹 | manifest `:261-300` | `IconSearchOutlineRegular`、`IconFolderCloseRegular`、`IconFolderOpenRegular` |
| 附件/发送 | manifest `:345-356`、`:765-790` | `IconPaperclipOutlineRegular`、`IconSendOutlineRegular`；Composer 专用 send/stop 原始片段也保留在主库 |
| 设置/关闭 | manifest `:429-454` | `IconSettingsOutlineRegular`、`IconCloseOutlineRegular` |
| 复制/分支/反馈 | manifest `:485-566` | `IconCopyOutlineRegular`、`IconBranchOutlineRegular`、`IconLike…`、`IconDislike…` |
| 权限 | manifest `:709-762` | `PermissionIconReadOnlyRegular`、`PermissionIconWorkspaceWriteRegular`、`PermissionIconFullAccessRegular`、`PermissionIconAutoReviewRegular` |

主理鱼现有 `ICON_PATHS` 在 `client.js:183-213`，本地 `Icon` 在 `:215-221`。下列已有官方对应，后续改动应直接换用，不要再补一份 path：

| 当前 name | 官方导出 |
|---|---|
| `chevron-left/right/down` 及代码中使用的 `chevron-up` | `IconChevronLeftOutlineRegular`、`IconChevronRightOutlineRegular`、`IconChevronDownOutlineRegular`、`IconChevronUpOutlineRegular` |
| `search`、`question`、`plus` | `IconSearchOutlineRegular`、`IconQuestionOutlineRegular`、`IconPlusOutlineMedium` |
| `trash`、`refresh`、`clock` | `IconTrashOutlineRegular`、`IconRefreshOutlineRegular`、`IconClockOutlineRegular` |
| `close`、`settings`、`copy` | `IconCloseOutlineRegular`、`IconSettingsOutlineRegular`、`IconCopyOutlineRegular` |
| `pause`、`play`、`stop` | `IconPauseOutlineRegular`、`IconPlayOutlineRegular`、`IconStopFillRegular` |
| `alert` | `IconWarningOutlineRegular` 或 `IconWarningTriangleOutlineRegular` |
| `user`、`queue` | `IconUserOutlineRegular`、`IconQueueOutlineRegular` |
| `external` | `IconRightUpOutlineRegular` |

`history/inbox/hash/filter/decision/session/running/blocked` 不应猜一个官方名字；完整导出表没有这些同名 icon。历史可评估 `IconClockOutlineRegular`，运行/阻塞状态优先 `StateDot`，其余若保留现有 path 必须标为主理鱼 derived，而不是“官方素材”。

另有一个现状差异只记录、不在本次修改：`ICON_PATHS` 没有定义 `chevron-up`，但 `DisclosureRow` 在 `client.js:398` 使用了它，当前会落到 `Icon` 的 question 回退；迁移到上述官方 chevron 导出时可消除这个回退。

### 3.3 logo、SVG、插画和 empty-state

| 类别 | 真实素材与位置 | 如何引用 / 限制 |
|---|---|---|
| 运行时鱼标 | `P:129` `FishLogo`，`P:188` 导出 `FishLogo/FISH_LOGO_PATH/FISH_LOGO_VIEWBOX`；官方品牌包在 `ASAR/dsh/node_modules/@deepseek-ai/dsh-client-ui-brand-official/lib/client.js:15-39` 注入 `sidebar.brand.mark/name` | 直接 `h(FishLogo,{size:…})`；需要 path 时用 `FISH_LOGO_PATH`，不要另画鲸鱼 |
| Wordmark | `P:129` `BrandWordmark`，`P:188` 导出 | 直接组件；官方 wordmark 不能用 Montserrat 文本近似 |
| Web favicon | `ASAR/dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/favicon.svg`、`favicon-dark.svg`；`dist/index.html:7-8` 按系统明暗选择 | 同源 `/favicon.svg`、`/favicon-dark.svg` 已实测 200。适合 favicon/引用，不建议当通用空态插画 |
| 主库 whale SVG | `OFFICIAL/assets/brand/whale-light.svg`、`whale-dark.svg`；来源/哈希/viewBox 见 `OFFICIAL/assets/manifest.json:22-49` | 50×50 viewBox；构建期复制并保留许可证。运行时已能 require 时优先 FishLogo |
| welcome 品牌 SVG | asar `/renderer/assets/welcome-brand.svg`；主库镜像 `OFFICIAL/assets/brand/deepseek-harness.svg`，manifest `:8-20` | 472×40，属于 welcome/桌面资源，不是 Web dist 公共插件 import 路径 |
| 更新关闭 SVG | asar `/renderer/update-close.svg`；manifest `:50-62` | 仅更新对话框语义，固定色，不能拿它充当所有设置关闭按钮；设置关闭用 primitives icon |
| 插件插画 | `P:188` 导出 `PluginArtworkDefault/Loop/Search/Subagent/Terminal`、`GuideArtworkBrowser/Files`；定义在同文件 `:188` | 可按语义直接渲染。它们是 artwork 组件，不是可任意 import 的独立 SVG 文件 |
| bundle preview SVG | `ASAR/dsh/node_modules/@deepseek-ai/dsh-client-ui-plugin-manager/lib/client.js:2078-2087`：badge-skill/voice-input 及 zh preview | 已内嵌进编译 JS，专属于对应 bundle 预览；不作为主理鱼通用 empty-state |
| 通用 empty-state 插画 | **本机包内没有独立的通用 empty-state PNG/SVG 素材；只有编译产物中的专用 EmptyHero/artwork。** | 普通空态采用官方 `status/empty/hint` 文案结构；不要自行画插画后标“官方”。`EmptyHero` 见 conversation client `:17671-17780`，是会话首屏而不是通用组件 |
| 运行动画 | `OFFICIAL/assets/brand/running-whale.png`，源为 chat client CSS data-URI APNG，manifest `:64-76` | 28×28 APNG，CSS 默认 14×14；主理鱼 OrbitMark 是另一套 derived 状态标识，不应把它改称官方 RunningWhaleTail |

### 3.4 字体

- 官方字体文件：`ASAR/dsh/node_modules/@deepseek-ai/dsh-client-ui-theme/lib/styles/montserrat-light.woff2`、`ASAR/dsh/node_modules/@deepseek-ai/dsh-client-ui-theme/lib/styles/montserrat-regular.woff2`、`ASAR/dsh/node_modules/@deepseek-ai/dsh-client-ui-theme/lib/styles/montserrat-medium.woff2`，权重 300/400/500；主库镜像及 SHA-256 见 `OFFICIAL/assets/manifest.json:78-119`。
- `@font-face` 官方模板：`OFFICIAL/assets/fonts/brand-font.css:1-24`，许可证为同目录 `Montserrat-OFL.txt`，manifest `:121-146`。
- Web dist 另有 hash 文件名的 Montserrat 和 KaTeX 字体；hash URL 不是稳定插件 API。普通 UI 用 `var(--dsw-font-family)`，品牌才用 `var(--dsw-font-family-brand)`。
- 若主理鱼独立预览需要自托管字体，应在预览构建中复制主库字体 + OFL，不应从插件直接 import asar 内部 WOFF2，也不应依赖其它包的临时 URL。

---

## 四、DSH UI 结构树与三个挂载边界

### 4.1 主窗口、会话、侧栏、右栏

主库完整树见 `OFFICIAL/structure/official-shell-tree.md:51-77`；三列计算的真实代码在 `ASAR/dsh/node_modules/@deepseek-ai/dsh-client-ui-layout/lib/client.js:38-46`，slot 组合在同文件 `:623-650`。下面是主理鱼需要的边界版：

```text
Electron BrowserWindow / Web document
├─ Windows caption（仅桌面 Windows；40px，宿主所有）
└─ AppFrame.root
   ├─ sidebarCol
   │  └─ SidebarRoot
   │     ├─ logoRow → sidebar.brand.mark / sidebar.brand.name
   │     ├─ New Session
   │     ├─ panelList → Plugins / Schedules / More（按注册出现）
   │     ├─ regionArea → sidebar.workspaces（Workspace / Session tree / search）
   │     └─ footArea → footer actions + sidebar.settings + connection
   ├─ centerCol
   │  └─ main[key]（root keyed slot）
   │     ├─ main[key=conversation]
   │     │  └─ ConversationRoot
   │     │     ├─ conversation.header
   │     │     │  └─ conversation.session.header
   │     │     │     ├─ breadcrumbs / actions / utilities / corner
   │     │     │     └─ view tabs（Chat / Trajectory / 扩展 view）
   │     │     ├─ viewArea
   │     │     │  └─ 【conversation.view：仅当前 selected view】
   │     │     │     ├─ Chat（消息流、ToolCallTree）
   │     │     │     ├─ Trajectory（主区轨迹，不是右栏）
   │     │     │     └─ session-superagent-desk（主理鱼现有）
   │     │     └─ composerSeat
   │     │        └─ InputBar / conversation.composer.bar
   │     │           ├─ attachments / input.left / input.right / model / activity …
   │     │           └─ div[data-composer-dock]
   │     │              ├─ 【conversation.composer.dock：list，session scope】
   │     │              │  └─ session-superagent-orbit（主理鱼现有）
   │     │              └─ ContextMeter（宿主自有，在 slot 之外）
   │     └─ main[key=plugins]（独立全局面板，见 4.3）
   ├─ rightbarCol（宽度 track）
   │  └─ rightbar.session → DockKit tabs / split / float / pane
   │     （每 Session 独立；不是 conversation.view，也不是 ToolCallTree）
   ├─ shell.bottom（root list；空时不占固定高度）
   └─ shell.overlay（全局 toast/modal/overlay；不放进右栏）
```

关键证据：

- `conversation.view` 在 viewArea 按 `viewId` 渲染：`ASAR/dsh/node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js:18033-18041`；注册声明为 session-scope list：同文件 `:19999-20005`。
- view tab ledger 从 `slots.entries('conversation.view')` 生成，失效回退与订阅见同文件 `:19753-19807`。所以主理鱼是**中栏页签**，不是额外覆盖 Chat 的面板。
- 主理鱼现有注册：`client.js:2331-2348`，`id=session-superagent-desk/order=30/label=主理鱼`。
- Composer dock 的真实 DOM 和渲染条件：conversation client `:19359-19366`；slot 声明在 `:20128-20131`，为 session-scope list。主理鱼现有注册：`client.js:2350-2369`，`order=-10`。
- **dock 不是 `shell.bottom`**；官方结构树也特别把 Activity/Usage/ContextMeter 归到 Composer dock，见 `OFFICIAL/structure/official-shell-tree.md:132-133`。
- 右栏是每会话 DockKit，Trajectory 属于主区 `conversation.view[id=trajectory]`；注册见 `ASAR/dsh/node_modules/@deepseek-ai/dsh-client-ui-trajectory/lib/client.js:8205-8208`。不要复制“右栏工具时间线”作为主理鱼面板。

### 4.2 SettingsRoot：设置弹层不是插件管理页

```text
sidebar.settings
└─ SettingsRoot / Modal
   └─ overlay + mask + section.panel[role=dialog]
      ├─ nav（188px）
      │  ├─ settings.header → “设置”
      │  └─ settings.section list
      │     ├─ account?（按 credential-stored）
      │     ├─ general → settings.general.item*
      │     ├─ models → provider cards/editors
      │     ├─ plugins → settings.plugins.tab*（只读 inventory）
      │     └─ agent-presets
      └─ content
         ├─ header → settings.action* + settings.close
         └─ options（仅 active section，独立滚动）
```

证据：`ASAR/dsh/node_modules/@deepseek-ai/dsh-client-ui-settings-general/lib/client.js:275-337` 的 `SettingsPanel`、`:1239-1274` 的 slot 声明；主库逐项树见 `OFFICIAL/structure/official-settings-tree.md:15-43`。

**设置弹层的“内置插件”与 `main[key=plugins]` 不同。** 前者只读 `settings.plugins.tab`；安装、启停、配置卡属于后者，见 `OFFICIAL/structure/official-settings-tree.md:9-14`、`:181-215`。主理鱼若要“全局设置”不能误塞进只读 inventory。

### 4.3 插件管理页与 `plugins.row.config`

```text
main[key=plugins] → PluginManagerPage
├─ list
│  ├─ PackageCard → packages / enable / tags
│  └─ ItemCard → plugins.item[view=summary]
├─ ItemDetail（官方 item 配置）
│  ├─ plugins.detail.actions / badge
│  ├─ plugins.item[view=summary]
│  └─ section[data-plugin-config]
│     ├─ plugins.item[view=page, form]
│     └─ plugins.detail.section
└─ RowDetail（某个 Cordis row 配置）
   ├─ plugins.detail.actions / badge
   ├─ description 或【plugins.row.config[view=summary]，entryKey=key】
   └─ div[data-plugin-config]
      ├─【plugins.row.config[view=page, form]，entryKey=key】
      └─ plugins.detail.section
```

真实挂载代码：`ASAR/dsh/node_modules/@deepseek-ai/dsh-client-ui-plugin-manager/lib/client.js:2672-2683`（ItemCard）、`:2710-2752`（ItemDetail）、`:2760-2822`（RowDetail）；`plugins.row.config` 声明为 root keyed slot，见同文件 `:4411-4461`。

边界要点：

1. `key` 由宿主 `rowConfigKey(pkg.name,row.rowId)` 计算，summary 和 page 都用同一个 `entryKey`；不能只在组件里注册一个无 key 的 `plugins.row.config` 后期待它出现在任意 row。
2. 组件会收到 `view='summary'|'page'` 和 page 时的 `form`。应照官方配置卡按 view 返回摘要或表单，不在 summary 里渲染整页。
3. **主理鱼当前 `client.js` 没有注册 `plugins.row.config`，只有两个 conversation 槽。** 所以目前不存在它的插件管理配置卡，这不是“挂载失败”，而是尚未实现。
4. 若主理鱼只是要一张官方 item 配置卡，可参照 shell 的 `plugins.item` 完整模板：`ASAR/dsh/node_modules/@deepseek-ai/dsh-client-ui-settings-shell/lib/client.js:150-189`。它同时实现 summary/page、locale、SettingsFormModel 和生命周期清理；包的公开导出只是 `NS/apply/inject`（同文件 `:192-194`），`ShellCard` 本身仍不是公共 import。
5. 只有确实拥有对应 Cordis row 和稳定 `entryKey` 时才选 `plugins.row.config`；否则用 `plugins.item`，不要伪造 row key。

---

## 五、主理鱼复用清单：可直接复用 / 需包一层 / 不应复制

### 5.1 当前 `client.js` 已经有的原语——先停止重复造

当前实现只 `require('react')`，没有使用宿主 primitives（`client.js:9-14`）。它已经有一套从官方 **dsh-superagent 插件**移植的本地 `dt-*` 组件和样式，来源注释见 `client.js:116-120`、`:181-182`。这套 `dt-*` 不等同于本机 DSH 宿主 primitives，但也不应在本轮另起第三套组件。

| 已有实现 | 当前位置 | 复用决定 |
|---|---|---|
| `PORTED_CSS` + 幂等注入 | `client.js:116-179` | 保留作为当前基线；新增页面先复用，不再造平行 CSS。若迁移到宿主 primitives，按组件逐步收缩，不做一次性全量重写 |
| `Icon` / `ICON_PATHS` | `:183-221` | 已有官方同名导出的图标按 3.2 替换；没有官方对应的标 derived，不再复制第二份 Icon 组件 |
| `Btn` | `:225-230` | 可平移到宿主 `Button`；保留 `Btn` 作为薄适配层即可避免调用点全改，内部改为 `h(UI.Button,…)` |
| `Tag`、`Pill` | `:232-234`、`:367-373` | 直接映射宿主 `Tag/Pill`；不要新增 Badge 组件 |
| `SegTabs` | `:236-265` | 映射宿主 `SegmentedTabs`，保留当前 `items/value/onChange/label` 调用形状 |
| `Input` | `:267-271` | 映射宿主 `Input`；外层 class 若影响现有布局，用适配层处理 |
| `Toggle` | `:273-278` | 映射宿主 `Switch`，名称仍可为 Toggle |
| `StateDot` / `Dot` | `:280-294` | 映射宿主 `StateDot`；ongoing 使用官方 spinner，不复制 SVG |
| `Stat` | `:296-312` | **宿主没有通用 Stat 导出，保留现有实现**；不要再造 `StatCard` |
| `Section` + `Hint` | `:296-326`、`:416` | **宿主无通用 Section，保留**；它已经是主理鱼自己的薄语义组件 |
| `Onboarding` | `:328-352` | 保留为主理鱼业务空态；不要换用会话 `EmptyHero` |
| `SegmentedControl` | `:375-384` | 改内部为宿主 `SegmentedControl`；官方键盘/disabled 行为更完整 |
| `DisclosureRow` / `CollapsibleList` | `:354-365`、`:386-402` | 包一层映射官方 props；不要保留两套折叠键盘逻辑 |
| `InfoTip` | `:404-414` | 改为宿主 `Tooltip` 的薄封装；交互型内容不要塞 Tooltip |
| `KeyValues` | `:418-424` | **保留**，语义 `<dl>` 已足够；宿主没有同名原语 |
| `Modal` + 焦点工具 | `:426-479` | 内部替换为宿主 `Modal`；删除重复的手写 focus trap 时先做键盘回归，不新增第三套 modal |
| `ConfirmBtn` | `:481-497` | 轻操作可保留；真正高风险确认改用 `RiskConfirmation`，不要把所有删除都变成重型确认 |
| `useToast` | `:947-969` | 薄封装宿主 `Toast`；跨视图仍要显示的错误另挂 `shell.overlay` |
| `TraceTimeline` / 判定 `dt-timeline` | `:971-989`、`:1681-1807` | **保留普通事件列表**。它不是 Trajectory 的 TTFT/decode 图，不应复制专用 `TrajectoryTimeline` |
| 页内设置左右栏 | `:2023-2044` | 保留主理鱼自己的轻量 `dt-settings`；它不是宿主 SettingsRoot，也无需复制宿主 800px 模态 |
| `OrbitMark` | `:526-603` | 保留为主理鱼 derived 状态素材；官方没有同义轨道环。复用 token 和 reduced-motion，不伪称官方图标 |
| dock 弹层 | `:680-910` | 可复用 `MenuSurface/useAnchoredPosition/useDismissOnOutsidePointer` 做行为适配；不要拿 Tooltip 当交互弹层 |

### 5.2 可直接复用

1. **运行时 primitives**：Button、Input、Modal、SegmentedTabs、SegmentedControl、Tag、Pill、Switch、Checkbox、StateDot、TextShimmer、Toast、Tooltip、官方 icons。引用方式见 1.1。
2. **宿主 token 与主题**：直接使用 `--dsw-alias-*`、`--dsw-radius-*`、`--dsw-elevation-*`、只读 `--dsh-*` 几何/字体变量；dark/light 交给宿主。
3. **现有 `dt-*` 业务薄组件**：Section、KeyValues、Stat、Hint、Onboarding、普通 TraceTimeline、OrbitMark 已有，不要再造第二套。
4. **官方配置卡模式**：`SettingsForm/SettingsValueField/SettingsSecretField` 的展示结构，以及 shell 的 summary/page 双视图模式（settings-shell client `:60-110`）。
5. **同源 favicon**：确需鱼标文件时 `/favicon.svg`、`/favicon-dark.svg` 可 GET；一般仍优先 FishLogo 组件。
6. **主库证据**：`OFFICIAL/structure/` 和 `OFFICIAL/assets/` 可直接作为实现对照与构建素材来源，哈希不要丢。

### 5.3 需包一层

1. **本地名称 → 宿主原语**：保留 `Btn/Toggle/SegTabs/InfoTip` 这些调用面，内部转发到 UI primitives，避免几百个调用点与 UI 迁移耦合。
2. **DisclosureRow**：适配 `expandable`、`expandOnRowClick`、`onToggle` 等官方 props，不照搬当前简化参数。
3. **dock 弹层**：用 `MenuSurface` + anchoring/dismiss hook 或 `HoverCard` 组行为；固定定位、焦点归还、Escape 与触发器关系仍需主理鱼业务层组合。
4. **全局 Toast**：参照 PluginRefreshToast 挂 `shell.overlay`，否则只在面板自己的组件树里显示。
5. **SettingsFormModel**：只有接到 `ctx.configForms` 或写好主理鱼后端 adapter 才使用；revision、dirty、invalid、save/discard 不能只靠视觉壳假造。
6. **插件配置入口**：优先 `plugins.item`；若选 `plugins.row.config`，必须由真实 package/row 计算 key，并同时处理 summary/page/form。
7. **宿主设置扩展**：注册 `settings.section` / `settings.general.item`，不要 import 内部 `SettingsPanel`。主理鱼会话内设置和全局宿主设置要分开决定。

### 5.4 不应复制

1. **不复制或 import CSS Modules hash 类名**：`.V7pFBG_*`、`.AnXs9G_*`、`.GRgSLq_*` 等不是公共 API；只复用其结构/token，类名用主理鱼自己的命名空间。
2. **不复制宿主内部壳**：AppFrame、ConversationRoot、InputBar、SettingsPanel、EmptyHero、TrajectoryTimeline、DockKit 都不能作为公共组件 import；应通过对应 slot 扩展。
3. **不复制稳定组件的行为**：已有宿主 Modal 后不再手写焦点圈；已有 SegmentedControl 后不再写一套方向键；已有官方 icon 后不再手画同义 path。
4. **不复制专用时间线/KV/Badge**：宿主没有通用 KeyValues/Badge/Timeline 导出；主理鱼已有语义组件就保留，别为了“看起来官方”复制 Trajectory 或 JsonTree。
5. **不直接 import asar、hash 构建文件或主库绝对路径**：`app.asar::…`、`index-BXV-oxvX.js`、`index-BNyAYEM7.css`、hash 字体、home 主库文件都不是浏览器稳定模块地址。
6. **不复制颜色/主题开关**：不写死 hex，不另设 dark/light body 属性，不发明全局 density，不覆盖 `--dsh-content-font-*` 和宿主 frame/composer 变量。
7. **不把资源“所在位置”误当“引用权限”**：`renderer/welcome-brand.svg`、update SVG、bundle preview 内嵌 SVG、主库 APNG/JSX 都有特定语义；可见不等于适合主理鱼任意复用。
8. **不混挂槽位**：`conversation.view` 是中栏 view，`conversation.composer.dock` 是 composer 下方 dock，`plugins.row.config` 是插件管理 RowDetail 的 keyed 配置；三者都不是 `shell.bottom` 或右栏。

### 5.5 最小落地顺序（只给后续实现建议，本次未改代码）

1. 先加一行 primitives `require`，把 `Btn/Input/Tag/Pill/SegTabs/Toggle/StateDot` 做薄转发；调用面不变。
2. 再替换 Modal、Tooltip、SegmentedControl、DisclosureRow 和官方 icons，跑键盘、明暗主题、窄容器回归。
3. Section/KeyValues/Stat/Onboarding/TraceTimeline/OrbitMark 保持现有，不追求“全部换成官方同名”。
4. 最后单独决定是否增加 `plugins.item` 全局配置卡；只有真实 row/key 明确后才实现 `plugins.row.config`。

---

**证据缺口（明示）**：本机包内没有 primitives 的独立源码/类型包，只有编译导出与实现，因此本文没有把 props 推写成完整 TypeScript 合同；实际迁移应以 `P:129/134/188` 的参数解构和官方调用例为准。普通 Web GUI 的完整登录态 DOM/键盘交互未在本次静态盘点中重验，结构树来自安装包代码与已冻结主库，而非截图猜测。
