# L84 · DSH 宿主弹层原语真实 API smoke

> 结论：当前安装版的宿主运行时实际提供 **290 个具名 exports**；任务点名的 8 个原语均存在，并在“真实 React 18.3.1 + 受控 hook dispatcher + 假 DOM”的直接调用 smoke 中 **8/8 返回预期结构**。这不是浏览器交互验收：effects 只记录、未执行，焦点、键鼠、计时、真实布局与视觉层级均未标为通过。
>
> 本文件是 L84 的只读探测记录。没有改生产代码、没有启动或重启 DSH、没有 commit；唯一写入是本文件。

路径缩写：

- `P` = `D:/DeepSeek Harness/Desktop/resources/app.asar::dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/index-BXV-oxvX.js`，SHA-256 `0f3fc6b857e4f8bd4d69619ce1010240cdaaa443abf0826532a24ef8f6e32ef0`。
- `CSS` = 同目录 `index-BNyAYEM7.css`。它是压缩文件，选择器规则在 `:1`。
- `ZL` = `D:/主工作区/projects/dsh-session-superagent/client.js`。
- `SA` = `/tmp/sa-off`，commit `8c32a9dc5d72c033816c6a8110b37f40cf94fba4`（命令 `git -C /tmp/sa-off rev-parse HEAD` 的输出）。
- `ZL` 行号快照：2443 行，SHA-256 `b1482a818c2ff2e44793a591ea6f3578c5709e0888a4c072663361ba779e3583`；实施前必须重新定位。此快照里旧 `ConfirmBtn` 已变为 `ConfirmButton`，下文按新快照说明。

## 一、exports 清单与版本基线

### 1.1 真实 require 路径，不是磁盘包路径

普通 Node 在工作区及 `/tmp/sa-off` 执行：

```text
node --version
v24.20.0
require.resolve('@deepseek-ai/dsh-client-ui-primitives')
ERROR MODULE_NOT_FOUND
require.resolve('@deepseek-ai/dsh-client-ui-primitives/package.json')
ERROR MODULE_NOT_FOUND
```

这不代表宿主没有原语。`P:190` 的 `OZ()` 把 `@deepseek-ai/dsh-client-ui-primitives` 映射到 `TU`，`P:188` 定义 `TU=Object.freeze(...)`；`ZL:9-14` 已是 `window.__ModuleLoader__.load({ factory(require) { ... } })`。因此正确入口是 **factory 注入的 require**，不是文件系统 ESM import。

本次用 `ELECTRON_RUN_AS_NODE=1`（Electron Node `v24.21.0`）真实执行安装版 web bundle，在 `__ModuleLoader__.create({ staticModules: OZ(), ... })` 处捕获真实映射；再只在内存中给 `ZL` 的 factory 加一行 primitives require，并调用原 factory。输出：

```text
CAPTURED react,react/jsx-runtime,react-dom,react-dom/client,...,
  @deepseek-ai/dsh-client-ui-primitives,...
CLIENT_FACTORY {"id":"dsh-session-superagent","inject":["slots"],
  "apply":"function","sameIdentity":true,"exportCount":290}
REACT_VERSION 18.3.1
PHYSICAL_PRIMITIVES_PACKAGE false
```

`sameIdentity:true` 表示经主理鱼 factory require 得到的对象与宿主 `OZ()` 映射是同一对象；没有改磁盘上的 `client.js`。

### 1.2 版本、官方 rev 与 hash

| 项 | 实测/登记值 | 证据与边界 |
|---|---|---|
| 安装版 | `0.2.1-rc.5` | Electron 读取 asar 内 `/package.json` 与 `dsh-web-frontend/package.json` 的输出均为该版本 |
| primitives 对应版本 | `0.2.1-rc.5` | `dsh-web-frontend/package.json` 的 `devDependencies['@deepseek-ai/dsh-client-ui-primitives']` 输出为 `0.2.1-rc.5`；asar 中没有独立 primitives `package.json`，runtime 也没有 `version` export，所以这里记录的是**携带它的 bundle 对应版本**，不是伪造一次子包 package.json require |
| 安装包 build | `d4db512a969fccf0c5cc7ec8fe38e9c1d27af916`，`dshBuildDirty=false` | asar 根 `package.json` 自报 `dshBuildCommit`；与下面的主库 source tag 分开记录 |
| 安装 asar | SHA-256 `e1b6f25fa937da98086c3e77af77aa14791105963c4d337a1c42179d232c6915` | 本次 `sha256sum app.asar` 实测；与 `home/dsh-ui-official/LIBRARY-MANIFEST.json:3-7` 一致 |
| 官方主库 source | tag `dsh-v0.2.2-rc.1`，commit `66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db` | `home/dsh-ui-official/SOURCES.md:5-11`；本次 `git ls-remote ... refs/tags/dsh-v0.2.2-rc.1` 返回同一 hash |
| superagent 参照 | `8c32a9dc5d72c033816c6a8110b37f40cf94fba4` | `/tmp/sa-off` 的真实 `git rev-parse HEAD` |

**版本边界**：下述 API 来自安装版 `P`，不是从 `0.2.2-rc.1` 类型文件猜出来的。主库 rev 用于追溯官方来源；升级或 build hash 变化后必须重跑，不承诺 290 个名字和参数永远不变。

### 1.3 完整 exports（真实 `Object.keys(ui)`，290 个）

以下 90 个为未列入下一组的组件、常量和函数：

```text
BrandWordmark, Button, CODE_HIGHLIGHT_EXTENSIONS, Checkbox,
CodeBlock, CommandText, ConnectionIndicator, DEFAULT_DIFF_MAX_LINES,
DEFAULT_READ_MAX_LINES, DEFAULT_SEARCH_MAX_LINES, DEFAULT_TERMINAL_MAX_LINES, DiffBlock,
DisclosureRow, FISH_LOGO_PATH, FISH_LOGO_VIEWBOX, FileTypeIcon,
FishLogo, GuideArtworkBrowser, GuideArtworkFiles, HoverCard,
HoverCardGroup, ICON_MEDIUM_STROKE, ICON_REGULAR_STROKE, ImageLightbox,
InlineEditor, Input, JsonBlock, JsonTree,
MarkdownDelegateProvider, MarkdownText, Menu, MenuGroup,
MenuItemButton, MenuSurface, Modal, PathLabel,
Pill, PluginArtworkDefault, PluginArtworkLoop, PluginArtworkSearch,
PluginArtworkSubagent, PluginArtworkTerminal, ReadBlock, ReferenceChip,
ReferenceIconMedium, ReferenceIconRegular, RiskConfirmation, SHIELD_OUTLINE_PATH,
SearchBlock, SegmentedControl, SegmentedTabs, SettingsForm,
SettingsFormModel, SettingsSecretField, SettingsValueField, ShortcutKeys,
StateDot, Switch, Tag, TerminalBlock,
TextShimmer, Toast, Tooltip, UserTextRun,
WebBlock, classifyFileType, classifyLinkPath, closeTopModal,
diffTotals, extractMarkdownPlainText, fileExtension, fileSizeText,
focusWithoutRing, isBehindModal, isDarwinDesktop, languageForPath,
modalSelector, observeComposition, observeStickyMenuGroups, pointerModality,
rankByName, relativeTime, settingsNumberField, settingsTextField,
useAnchoredMaxHeight, useAnchoredPosition, useCodeHighlighter, useDismissOnOutsidePointer,
useModalLayer, writeClipboard
```

其余 200 个为 `Icon* / LinkIcon* / PermissionIcon*`：

```text
IconAgentPresetOutlineMedium, IconAgentPresetOutlineRegular, IconAlarmClockOutlineMedium, IconAlarmClockOutlineRegular,
IconApiOutlineMedium, IconApiOutlineRegular, IconAppsAddOutlineMedium, IconAppsAddOutlineRegular,
IconArchiveCheckOutlineMedium, IconArchiveCheckOutlineRegular, IconArchiveOffOutlineMedium, IconArchiveOffOutlineRegular,
IconArchiveOutlineMedium, IconArchiveOutlineRegular, IconBranchOutlineMedium, IconBranchOutlineRegular,
IconBrowseOutlineMedium, IconBrowseOutlineRegular, IconCheckCircleFillMedium, IconCheckCircleFillRegular,
IconCheckCircleOutlineMedium, IconCheckCircleOutlineRegular, IconCheckOutlineMedium, IconCheckOutlineRegular,
IconChecklistOutlineMedium, IconChecklistOutlineRegular, IconChevronDownOutlineMedium, IconChevronDownOutlineRegular,
IconChevronLeftOutlineMedium, IconChevronLeftOutlineRegular, IconChevronRightOutlineMedium, IconChevronRightOutlineRegular,
IconChevronUpOutlineMedium, IconChevronUpOutlineRegular, IconChevronsUpDownOutlineMedium, IconChevronsUpDownOutlineRegular,
IconClockOutlineMedium, IconClockOutlineRegular, IconCloseCircleFillMedium, IconCloseCircleFillRegular,
IconCloseFillMedium, IconCloseFillRegular, IconCloseOutlineMedium, IconCloseOutlineRegular,
IconCodeOutlineMedium, IconCodeOutlineRegular, IconCompactOutlineMedium, IconCompactOutlineRegular,
IconCompareSplitOutlineMedium, IconCompareSplitOutlineRegular, IconContextInjectionOutlineMedium, IconContextInjectionOutlineRegular,
IconCopyOutlineMedium, IconCopyOutlineRegular, IconCordisPluginOutlineMedium, IconCordisPluginOutlineRegular,
IconDarkOutlineMedium, IconDarkOutlineRegular, IconDataOutlineMedium, IconDataOutlineRegular,
IconDatabaseOutlineMedium, IconDatabaseOutlineRegular, IconDeliverDocMedium, IconDeliverDocRegular,
IconDislikeFillMedium, IconDislikeFillRegular, IconDislikeOutlineMedium, IconDislikeOutlineRegular,
IconDownloadOutlineMedium, IconDownloadOutlineRegular, IconEditOutlineMedium, IconEditOutlineRegular,
IconEllipsisOutlineMedium, IconEllipsisOutlineRegular, IconEnhanceOutlineMedium, IconEnhanceOutlineRegular,
IconFlatListOutlineMedium, IconFlatListOutlineRegular, IconFolderCloseMedium, IconFolderCloseRegular,
IconFolderOpenMedium, IconFolderOpenOutlineMedium, IconFolderOpenOutlineRegular, IconFolderOpenRegular,
IconFollowsystemOutlineMedium, IconFollowsystemOutlineRegular, IconFullscreenOutlineMedium, IconFullscreenOutlineRegular,
IconGaugeOutlineMedium, IconGaugeOutlineRegular, IconGlobeOutlineMedium, IconGlobeOutlineRegular,
IconGoalOutlineMedium, IconGoalOutlineRegular, IconInfoOutlineMedium, IconInfoOutlineRegular,
IconInspectOutlineMedium, IconInspectOutlineRegular, IconLightOutlineMedium, IconLightOutlineRegular,
IconLikeFillMedium, IconLikeFillRegular, IconLikeOutlineMedium, IconLikeOutlineRegular,
IconLinkOutlineMedium, IconLinkOutlineRegular, IconListPenOutlineMedium, IconListPenOutlineRegular,
IconLoadingOutlineMedium, IconLoadingOutlineRegular, IconMicrophoneOutlineMedium, IconMicrophoneOutlineRegular,
IconNewChatOutlineMedium, IconNewChatOutlineRegular, IconNowrapFillMedium, IconNowrapFillRegular,
IconPanelLeftOutlineMedium, IconPanelLeftOutlineRegular, IconPaperPlaneOutlineMedium, IconPaperPlaneOutlineRegular,
IconPaperclipOutlineMedium, IconPaperclipOutlineRegular, IconPauseOutlineMedium, IconPauseOutlineRegular,
IconPersonalizationOutlineMedium, IconPersonalizationOutlineRegular, IconPinFillMedium, IconPinFillRegular,
IconPinOutlineMedium, IconPinOutlineRegular, IconPlanOutlineMedium, IconPlanOutlineRegular,
IconPlayOutlineMedium, IconPlayOutlineRegular, IconPluginPinwheelOutlineMedium, IconPluginPinwheelOutlineRegular,
IconPlusOutlineMedium, IconPlusOutlineRegular, IconProjectAddOutlineMedium, IconProjectAddOutlineRegular,
IconQuestionOutlineMedium, IconQuestionOutlineRegular, IconQueueOutlineMedium, IconQueueOutlineRegular,
IconRefreshOutlineMedium, IconRefreshOutlineRegular, IconRightUpOutlineMedium, IconRightUpOutlineRegular,
IconSearchOutlineMedium, IconSearchOutlineRegular, IconSendOutlineMedium, IconSendOutlineRegular,
IconSettingsOutlineMedium, IconSettingsOutlineRegular, IconShareOutlineMedium, IconShareOutlineRegular,
IconShieldOutlineMedium, IconShieldOutlineRegular, IconSkillOutlineMedium, IconSkillOutlineRegular,
IconSlidersTwoOutlineMedium, IconSlidersTwoOutlineRegular, IconSparkleMedium, IconSparkleRegular,
IconStopFillMedium, IconStopFillRegular, IconThinkOutlineMedium, IconThinkOutlineRegular,
IconTrashOutlineMedium, IconTrashOutlineRegular, IconTreeCornerMedium, IconTreeCornerRegular,
IconTriangleRightFillMedium, IconTriangleRightFillRegular, IconUnarchiveOutlineMedium, IconUnarchiveOutlineRegular,
IconUserOutlineMedium, IconUserOutlineRegular, IconUsersOutlineMedium, IconUsersOutlineRegular,
IconWarningOutlineMedium, IconWarningOutlineRegular, IconWarningTriangleOutlineMedium, IconWarningTriangleOutlineRegular,
IconWorkspaceTreeOutlineMedium, IconWorkspaceTreeOutlineRegular, IconWrapFillMedium, IconWrapFillRegular,
IconWrapLinesOutlineMedium, IconWrapLinesOutlineRegular, LinkIconMedium, LinkIconRegular,
PermissionIconAutoReviewMedium, PermissionIconAutoReviewRegular, PermissionIconFullAccessMedium, PermissionIconFullAccessRegular,
PermissionIconReadOnlyMedium, PermissionIconReadOnlyRegular, PermissionIconWorkspaceWriteMedium, PermissionIconWorkspaceWriteRegular
```

## 二、逐项 API 证据

下列代码块是对 `Function.prototype.toString` 所得参数解构的格式化转写，**不是冒充官方 `.d.ts`**。运行时对象还确认：`DisclosureRow` 是 `React.memo`（读取 `.type` 取证），`MenuSurface` 是 `forwardRef`（读取 `.render` 取证）；生产代码仍应正常 `h(UI.DisclosureRow, ...)` / `h(UI.MenuSurface, ...)`，不要直接调用 `.type/.render`。

### 2.1 Modal

```js
Modal({
  open, onClose, title, closeLabel, description, children, footer,
  className, contentClassName, onKeyDownCapture,
  headless = false, backdropBlur = true, shortcutModal
})
```

证据：`P:129` 的 `function j_(...)` 与同文件共享 `function k_(...)`；本次 `String(ui.Modal)`、`String(ui.useModalLayer)` 全文输出。行为由源码可确认：

- `open=false` 返回 `null`；打开时 `createPortal(..., document.body)`。根为 `role=presentation`，mask 为 `aria-hidden=true` 且 `onClick=onClose`，dialog 为 `tabIndex=-1`、`role=dialog`、`aria-modal=true`、`aria-label=title`。
- 非 headless 结构是 header（`h2` + close button）→ 可选 description → 可选 body，footer 在 content 外；`className` 合到 dialog，`contentClassName` 合到 content。`headless=true` 仍保留 portal/mask/dialog/layer hook，只跳过官方内部排版。
- `useModalLayer` 把最新 `onClose` 放 ref，layout effect 只依赖 `[dialogRef, open]`；父轮询重渲染不应因此重建焦点圈。它维护 per-document modal stack，只让栈顶层处理键盘。
- 初始焦点优先 `[data-modal-autofocus]`，再查可聚焦元素，最后 dialog。Escape（无 Shift、非 repeat、无 Ctrl/Alt/Meta、未被 composition guard 拦截）会 `preventDefault()` 并调用最新 close；Tab 圈排除 `[inert]`/`[hidden]` 内元素，焦点位于 `role=menu` 时让菜单自行处理。
- 清理时仅当被清层是栈顶层才归还焦点：优先打开前且仍 `isConnected` 的 `HTMLElement`，否则回到前一层 modal。以上都是**源码路径确认**，真实键鼠尚未执行。
- `CSS:1`：root `position:fixed; inset:0; z-index:1000`，dialog 自身 `z-index:1`；mask 有 `backdrop-filter`，`backdropBlur=false` 会内联关闭它。

### 2.2 RiskConfirmation

```js
RiskConfirmation({
  open, title, description,
  acknowledgeLabel, cancelLabel, closeLabel, confirmLabel,
  acknowledged, disabled = false,
  onAcknowledgedChange, onCancel, onConfirm
})
```

证据：`P:129` 的 `function hA(...)` 及 `String(ui.RiskConfirmation)`。

- 它是受控 acknowledgment 的 Modal 复合件，不是 `ConfirmButton` 的同形替换。mask/Escape/右上关闭和取消按钮都走 `onCancel`；确认按钮走 `onConfirm`。
- 确认按钮 `disabled = disabled || !acknowledged`；checkbox 的 `checked=acknowledged`，变化时 `onAcknowledgedChange(event.currentTarget.checked)`，并带 `data-modal-autofocus=true`。
- 没有自带 Promise、busy ref、成功后关闭或错误驻留逻辑；这些必须由业务适配器提供。普通 watcher 删除无需此重型确认。

### 2.3 Toast

```js
Toast({ text, icon, tone, anchor, holdMs = 3000, actions, onDone })
// actions: [{ prefix, label, onClick }]
```

证据：`P:134` 的 `aR=3000`、`lR=1000`、`function cR(...)`；`String(ui.Toast)`。官方调用另见 asar 内 `dsh-client-ui-plugin-manager/lib/client.js:4267-4280`，以 `notice.seq` 为 key；跨视图挂 `shell.overlay` 见同文件 `:4402-4410`。

- 总是 portal 到 body，根为 `role=alert`，不是当前主理鱼的 `role=status/aria-live=polite`。没有 `className/role/style/...rest` 输入，不能按当前 `dt-toast` 方式覆盖这些属性。
- effect 在 `holdMs + 1000ms` 后调用最新 `onDone`，换 `holdMs` 会重置计时；源码直接 `onDone()`，所以应把它当必填。CSS 用 `--dsh-toast-hold` 控制 fade，新通知要由父层用不同 key 强制重挂载。
- `tone === 'success'` 只负责内建成功勾图标；其他 tone 不会自动获得 error 样式。错误图标应显式传 `icon`。`actions` 在同一文本行附加 button。
- `anchor` 是直接带 `getBoundingClientRect()` 的元素，不是 ref；只据其水平中心设置 left，且仅监听 `window.resize`，没有 scroll listener。
- `CSS:1`：`position:fixed; top:40px; left:50%; z-index:1100; pointer-events:none`；默认 hold 为 3s，fade 为 1s。

### 2.4 Tooltip

```js
Tooltip({
  label, shortcutKeys,
  side = 'right', align = 'center', delayMs = 0, focusDelayMs = 0,
  gap = 8, disabled = false, portal = false, maxWidth,
  openOnClick = false, children
})
```

证据：`P:134` 的 `function $r(...)`、定位函数 `iR(...)`，以及 `String(ui.Tooltip)`。

- `children` 必须是可 `cloneElement` 的单个 React element；宿主合并 ref、mouse/focus/click handlers 和 `aria-describedby`。`label` 可为值或函数。
- 默认 hover/focus 打开，点击 Trigger 会关闭。`openOnClick=true` 时才启用 pinned click 模式、`useDismissOnOutsidePointer`、以及 capture 阶段的 **Escape/Tab 关闭**；不能给默认 hover 模式凭空宣称同一套 Escape 行为。
- click 模式的 Escape 会 `preventDefault + stopPropagation`；外点排除 trigger 和 bubble。没有显式“关闭后 focus opener”代码，焦点归还必须真机核对。
- 定位以 12px 为视口边距，按“请求 side → 对侧 → 其余侧”尝试，再夹取；bubble 的 `ResizeObserver` 与 window resize 会重算，**没有 scroll listener**。这与 `SA/src/client/controls.tsx:232-248` 的 scroll/resize 关闭策略不同。
- 无受控 `open/onOpenChange` props；业务层若必须 scroll-close，只能在适配器里以 remount 或 `disabled` 状态间接实现，不能写 `open=false` 假 API。
- `portal=true` 才 portal 到 body。`CSS:1` 普通 bubble `z-index:100`，`[data-portal]` 为 `1100`；`[data-pinned]` 才 `pointer-events:auto`，普通提示为 `none`。

### 2.5 DisclosureRow

```js
DisclosureRow({
  icon, title, open, expandable, onToggle, running = false,
  expandOnRowClick = false, previewChevron = expandable,
  keepContentWhenOpen = false, collapsedContent, headerAccessory, children,
  className, rowClassName, contentClassName, contentLayoutClassName,
  leadingClassName, chevronClassName, titleClassName
})
```

证据：`P:129` 的 `BD=C.memo(function(...))`，运行时对象为 `{ $$typeof, type, compare }`，本次读取 `.type` 的完整源码。

- `expandOnRowClick=true` 且 `expandable=true` 时，整行才是 `role=button/tabIndex=0/aria-expanded`，Enter/Space 调 `onToggle`；否则由 leading 原生 button 承担展开。主理鱼现有整行交互（`ZL:403-418`）适配时须显式传这两个值，不能沿用默认值。
- `collapsedContent` 在关闭时显示；`keepContentWhenOpen=true` 时打开也保留。`children` 只在 open 时挂载。`running` 驱动 TextShimmer，`headerAccessory` 与 row 点击区分离。
- `onToggle` 在 leading button 路径无参数，在整行 onClick 路径会收到 React event；主理鱼回调不应依赖参数。

### 2.6 useAnchoredPosition

```js
useAnchoredPosition({
  open, anchorRef, panelRef,
  side = 'bottom', align = 'start', gap, margin
}) // => null | { left, top }
```

证据：`P:129` 的 `function uA(...)` 与 `String(ui.useAnchoredPosition)`；顶部 frame clearance 辅助 `Ws` 也在 `P:129`。

- **参数是一个 object**；`gap` 和 `margin` 没有默认值，调用方必须给数值。`side` 支持源码分支中的 top/bottom，`align` 只有 start/end 计算；没有 center，也没有自动 side flip。
- open 时读取 anchor rect 与 panel `offsetWidth/offsetHeight`，计算 fixed 风格 left/top，并做水平、垂直夹取；垂直上边还考虑 `--dsh-frame-top-clearance`。关闭时返回 `null`。
- layout effect 注册 `window.scroll`（capture）、`window.resize` 和 **panel** `ResizeObserver`，清理时全部解除；没有 anchor ResizeObserver。它只给坐标，不给 position、portal、width、z-index、dismiss 或焦点行为。

### 2.7 useDismissOnOutsidePointer

```js
useDismissOnOutsidePointer(panelRef, open, close, anchorRef?)
```

证据：`P:129` 的 `function C_(e,t,r,i)` 与 `String(ui.useDismissOnOutsidePointer)`。

- **四个位置参数，不是 object**。open 时在 document 的冒泡阶段监听 `pointerdown`。
- target 必须是 `instanceof Node`；不在 panel 内、也不在可选 anchor 内时调用 `close(false)`。effect 依赖四项，所以 close 应稳定。
- 不处理 Escape、mousedown、focus 归还、scroll 或 resize。迁移时要删除旧的重复 mousedown listener，但不能顺手删掉 Escape/焦点逻辑。

### 2.8 MenuSurface

```js
MenuSurface({ compact = false, className, style, children, ...rest }, forwardedRef)
```

证据：`P:129` 的 `const j1=C.forwardRef(function(...))` 与运行时 `.render` 全文；`CSS:1` 的 `_surface_ri079_1/_backing_ri079_2/_material_ri079_21`。

- 主 surface 是普通 `div`，透传 rest/ref，附带 `data-menu-material=translucent` 与一个 `aria-hidden` material 子层；另一个 `aria-hidden data-menu-backing` 才 portal 到 body，并在 layout effect 中 append 到 body。
- **主 surface 自己不 portal、不定位、不锚定、不 dismiss、不管 Escape/焦点，也没有统一 z-index。** CSS 仅给 surface `position:relative; isolation:isolate`；backing 默认 `display:none`，仅 Darwin 下显示固定 anchor backing 且 `z-index:-1`。
- 官方 `Menu` 是在外部自行组合 positioning、键盘、portal 后再渲染 MenuSurface；其实现位于 `P:129` 的 `function b_(...)`，portal 时才加 `Ne.portal`。`CSS:1` 的 `_portal_4ub78_41` 为 `position:fixed; z-index:1100`。不能把 MenuSurface 单独当成完整 Menu 或 Modal。

## 三、最小 smoke 结果与未验项

### 3.1 方法与判据

1. 用 Electron Node 动态 import 安装版 `P`，以最小假 DOM 让 bundle 定义真正运行；在 `OZ()` 被交给 `__ModuleLoader__.create` 时捕获 staticModules。探针随后故意抛出 `capture-stop` 阻止启动应用，所以 stderr 中该行是**探针控制流**，不是原语加载失败；假 DOM 也会触发 KaTeX quirks-mode warning，不能当产品 GUI 结果。
2. 经真实 `client.js` factory require 取得 UI，验证 `sameIdentity:true` 和 290 exports。
3. 使用 bundle 的真实 React 18.3.1，临时给 `ReactCurrentDispatcher` 装受控 hooks；`useEffect/useLayoutEffect` 只记录，不执行。用真实 `react-dom.createPortal` 配合假 `document.body` 直接调用组件。memo/forwardRef 仅为探针读取 `.type/.render`。
4. 判据只覆盖“能否调用及返回的 React/portal 结构”，不覆盖真实 mount、浏览器事件、CSS 或时序。

最终重跑原始输出摘要：

```text
SMOKE_SUMMARY {"passed":8,"failed":0,
  "note":"direct calls only; effects recorded, not executed; no real layout or input events"}
```

| 原语 | 直接调用实测 | smoke 明确没有证明的事 |
|---|---|---|
| Modal | PASS；portal 到 `BODY`，root=presentation，mask 有 onClick，dialog=`aria-modal=true`，h2 为 Smoke；记录 1 个 layout effect | 初始焦点、Tab 圈、Escape、嵌套 stack、焦点归还、真实遮罩 |
| RiskConfirmation | PASS；返回类型为 Modal，checkbox 带 autofocus，2 个按钮，未勾选时 confirmDisabled=true | 勾选事件、onCancel/onConfirm 请求、busy、异步关闭 |
| Toast | PASS；portal、`role=alert`、`--dsh-toast-hold=3000ms`，记录 layout/effect/layout 3 个 effect | 3+1 秒 onDone、fade、连续通知 key 重挂载、读屏播报 |
| Tooltip | PASS；clone button，click/focus handlers 存在，初始 bubble=false，记录 5 个 effect | hover/focus/touch、delay、Escape/Tab、外点、边缘定位、scroll 后位置 |
| DisclosureRow | PASS；整行 role=button、tabIndex=0、expanded=true、onKeyDown 存在 | 真 Enter/Space、onToggle 次数、running shimmer、accessory 事件 |
| useAnchoredPosition | PASS；open=false 返回 null，记录 1 个 layout effect | open=true 的测量、夹取、scroll/resize/RO、frame clearance |
| useDismissOnOutsidePointer | PASS；返回 undefined，记录 1 个 effect，deps 长度为 4 | pointerdown target/contains、anchor 排除、卸载清理 |
| MenuSurface | PASS；role/rest 透传，material=translucent，backing portal 且 hidden，visibility 同步，记录 1 个 layout effect | body append 次序、Darwin anchor backing、视觉层级和真实材料效果 |

### 3.2 必须留给真实浏览器/宿主的验收

- 在实际 DSH Web GUI 的 `window.__ModuleLoader__` 中加载主理鱼 factory；本次是**真实 Node 执行同一安装 bundle + 真实 client factory**，没有声称已点过当前 GUI。
- Modal/RiskConfirmation：嵌套弹层、IME、Escape repeat/modifier、Tab/Shift+Tab、轮询重渲染、opener 被卸载后的焦点策略、背板点击与请求次数。
- Tooltip：hover/focus-visible/touch/click pinned、Escape/Tab、外点、resize/flip/clamp、scroll 后是否可接受；portal 与 Modal 的叠放。
- Toast：连续两条各自完整出现/消退、旧 onDone 不清新通知、action 可点性（根 `pointer-events:none` 的真实 CSS 结果）、`role=alert` 读屏变化。
- StatusOrbit 组合：portal 主 surface、窗口 resize/真实滚动、panel resize、窄/矮视口、外点、Escape、焦点回圆环、与确认 Modal 的同屏层级。
- CSS computed style、双主题、reduced-motion、Darwin 专用 backing，以及 100/1000/1100 在真实宿主 stacking context 中的结果。

## 四、主理鱼迁移边界与建议

### 4.1 能直接换、必须包一层、暂时保留

| 目标 | 能直接换什么 | 必须包一层什么 | 暂时保留什么 |
|---|---|---|---|
| **ConfirmBtn / 当前 ConfirmButton + Modal**（`ZL:458-548`） | 用 `UI.Modal` 替换适配器内部的本地 Modal shell；`open/title/description/footer/onClose` 是一一对应的真实 props，并补 `closeLabel:'关闭'` | 保留现有 `ConfirmButton` 调用面、`busyRef + busy`、`onConfirm()=>boolean`、成功才关闭和错误反馈。它是业务复合件，不能直接换成 `RiskConfirmation` | 普通删除继续用 Modal；只有确实需要“勾选知悉后果”的高风险动作才另包 RiskConfirmation。确认中的取消/背板/Escape 是否禁用也由业务层决定，宿主不会自动做 busy lock |
| **InfoTip**（`ZL:422-431`） | Tooltip 的 trigger clone、hover/focus/click pinned、portal、边缘定位和 click 模式 Escape/外点可复用 | 保留 `{text,icon,warn}` 与 `dt-info/dt-info-warn` trigger 适配；建议 `side:'top', portal:true, openOnClick:true, gap:8`。必须另处理 scroll-close，因为 Tooltip 没有 scroll listener，也没有受控 open | 若暂时不能安全实现 scroll-close/remount，就先保留现有 InfoTip，不要把“同名 Tooltip”当完全等价替换。焦点归还与 touch 必须真机验 |
| **Toast / useToast**（`ZL:997-1017`） | 用 `UI.Toast` 替换 view 的 portal、hold/fade 和 onDone 计时；保留“同时只有最新一条” | 保留 `[view,notify]` 调用面和 item.id；`key:item.id` 必传。用 id guard 防止旧 onDone 清掉新 item；错误 tone 映射为显式 warning icon。跨视图通知另包 `shell.overlay`，官方证据见 plugin-manager `:4402-4410` | 重要错误仍留在对应 Section/orbit 内，不只 Toast。宿主根固定 `role=alert` 且不收 style/className，旧红左边与 polite status 不能平移；若该语义未验收，暂保留旧视图 |
| **StatusOrbit 浮层**（`ZL:748-959`） | `useAnchoredPosition` 可承担 open 时测量、scroll/resize/panel RO；`useDismissOnOutsidePointer` 可替代当前 capture mousedown 的外点部分；MenuSurface 可替换表面材质 | 必须有一个 OrbitPopover 适配器统一 portal、fixed left/top、Escape、初始/归还焦点、role=dialog、宽度、z-index 和 stable close。主 surface 要自己 portal；hook 要在 `if (!open) return` 之前无条件调用，避免 hook 顺序变化 | OrbitMark、watcher 轮询、rows/actions/error、368/252 derived 宽度与空态都保留。不要用 Tooltip 承载交互列表，也不要为了非 Modal panel 加背板 |
| **DisclosureRow** | 可复用宿主 memo 组件与 Enter/Space 行为 | 保留主理鱼现有名称作薄适配，并显式 `expandable:true, expandOnRowClick:true`，迁移 className/body 结构 | `dt-disclosure-body` 领域内容保留；不要假设 DSH 会自动生成 `dt-*` DOM |

当前快照已经没有旧二段 `ConfirmBtn`：`ConfirmButton` 在 `ZL:504-548`，orbit 删除入口在 `ZL:926-930`。若其他分支仍是旧 ConfirmBtn，目标也应是先形成上述同一适配器，而不是把每个调用点直接改成宿主 RiskConfirmation。

### 4.2 Modal 与 superagent 同源行为的取舍

`SA/src/client/widgets.tsx:75-89` 已给出正确的确认复合边界：Button 开 Modal、description 说明后果、footer 取消/确认、busy 防重入、成功关闭；`SA/src/client/provider.tsx:42-55` 给出 busy ref 与错误反馈。当前 `ZL` 已接近这一形状，**不需要再发明新的确认组件**。

替换本地 Modal 后应删除的只有重复的 shell/focus 实现，而且要在浏览器回归之后删：

- `ZL:443-500` 的 `FOCUSABLE/trapTab/useEffect/root/mask` 与宿主 `P:129` 的 `useModalLayer` 重复；宿主版本另有 modal stack、IME guard 和 opener 连通性处理。
- `onClose` ref 的动机与 `SA/src/client/controls.tsx:182-214` 相同：轮询重渲染不能重置焦点。宿主已内建，不应在外层再叠一套 document keydown。
- DSH Modal 的 DOM/class 是 CSS-module 类，不会产生 `.dt-modal*`。`className` 只能用于 dialog 扩展，`contentClassName` 用于 content；术语表宽度等另写适配选择器。正文里的 `dt-glossary/dt-pre/dt-values` 可保留，但 shell 不能一半 DSH、一半假设 `.dt-modal` 仍命中。

### 4.3 Toast 的具体适配约束

当前 `ZL` 是 3600ms CSS hold + 4000ms JS 清除；宿主与 `SA/src/client/provider.tsx:65-70,82-107` 都是 hold + 1000ms 后 onDone。若保持约 4 秒总周期，适配器可用 `holdMs:3000` 并完全移除自己的 timer。

必须同时满足：

1. `h(UI.Toast, { key:item.id, ... })`，不是只把 id 留在数据里。
2. `onDone` 按 id 清除：只有当前 item 仍是完成的那条才置空。
3. success 用宿主内建勾；error 显式传官方 warning icon。`tone:'error'` 本身不会生成旧 `dt-danger` 外观。
4. 保存/复制等局部轻反馈可留在 panel；离开页面仍要见的错误参照官方 `shell.overlay`，不要把局部 useToast 说成全局通知。

### 4.4 StatusOrbit 的具体适配约束与层级陷阱

建议优先尝试 `side:'top', align:'end', gap:8, margin:8`，返回坐标写 `position:fixed; left; top`，不再用当前 `left/bottom` 手算（`ZL:818-854`）。但有两个不能隐藏的差距：

- 当前是 anchor 中心对齐，hook 只有 start/end。**若必须保持居中，暂保留这段 left 偏移，只先迁 dismiss；不得传未实现的 `align:'center'`。**
- hook 不会自动从上翻到下。矮视口需要实测，必要时另用 `useAnchoredMaxHeight` 或保留业务放置策略；不能写“自动翻转已验证”。

层级需要单独设计，不能把 `zIndex:2147483000`（`ZL:940-943`）简单改成另一个常量就算完成：

| 层 | 官方实测 CSS | 对主理鱼的含义 |
|---|---|---|
| Modal / RiskConfirmation | root `1000`，`CSS:1` | 确认框应成为键盘顶层；焦点由 modal stack 管 |
| 普通 Tooltip | `100`，`CSS:1` | 非 portal 不适合越容器/跨壳提示 |
| portal Tooltip / Toast | `1100`，`CSS:1` | 与官方 overlay 同层，需实测与 Modal 同屏 |
| MenuSurface | surface 无统一 z-index；官方 Menu portal class 才是 `1100`，`CSS:1` | OrbitPopover 必须自己决定 portal 与层级，MenuSurface 不会代做 |

**orbit 内的删除确认是组合风险**：若 orbit 采用官方 Menu portal 的 `1100`，它会高于 Modal root 的 `1000`。因此打开确认时，适配器必须关闭或隐藏 orbit，并定义确认关闭后是回原删除按钮还是回圆环；若原删除按钮随 orbit 卸载，宿主 Modal 的“opener 仍 isConnected 才归还”不会 magically 找回它。这一策略未定并经真机验证前，StatusOrbit 应最后迁移，不能先删 `ZL:781-805` 的现有 Escape/焦点归还。

建议顺序：

1. 先在主面板把现有 ConfirmButton 内部切到 DSH Modal，验焦点/背板/busy。
2. 再接单条 keyed Toast 与 InfoTip 适配器，分别处理 id guard 和 scroll-close。
3. 最后迁移 StatusOrbit：先引 OrbitPopover，不碰领域 rows；明确“确认打开时 orbit 关闭/隐藏 + 关闭后焦点回圆环”的策略，再删除旧定位、mousedown 和极大 z-index。
4. 任何一步真机回归不通过，就回退到现有 superagent 同源实现，不新增第三套弹层。

### 4.5 本轮未验项汇总

- 未在真实 GUI 做键鼠、读屏、截图、computed style、双主题或 resize/scroll 验证。
- 未执行组件 effects，未让计时器自然到期，未触发真实 pointer/keyboard/focus 事件。
- 未验证 `0.2.2-rc.1` 的 primitives 是否与安装版逐字相同；本 smoke 只固定到上述 asar/P hash。
- 未给出官方 TypeScript 声明；参数证据全部标明来自运行时源码/toString 或结构调用实验。
- 未修改生产代码，未 commit。L84 实施时仍需独立的浏览器验收与回归证据。
