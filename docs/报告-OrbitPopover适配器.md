# OrbitPopover 独立适配器报告

## 交付边界

本次只新增以下三个文件：

- `ui-orbit-popover.js`
- `test/orbit-popover-adapter.test.mjs`
- `docs/报告-OrbitPopover适配器.md`

没有修改 `client.js`、`package.json`、`lib/`、其他测试、版本或派单表，没有 commit。工作区里同时存在其他代理对这些文件的改动，不属于本交付；本适配器也没有依赖或改动并行 InfoTip 子任务。

实现依据是 `docs/ui-decomp/04-host-primitives-smoke.md` §2.6、§2.7、§2.8、§4.4，以及 `docs/ui-decomp/06-host-primitives-task.md` 的 StatusOrbit 验收边界。适配器只组合宿主能力，不包含 watcher 轮询、业务 rows/actions/error、252/368 推导、删除请求或确认 Modal，也没有实现第三套定位、外点或材质系统。

## ESM 调用面

模块具名导出：

```js
createOrbitPopover({ React, primitives })
```

工厂返回：

```js
{ OrbitPopover, useOrbitConfirm }
```

### 宿主能力注入

必需的 DSH primitives：

- `useAnchoredPosition`
- `useDismissOnOutsidePointer`
- `MenuSurface`

必需的 React 能力：`createElement`、`useRef`、`useCallback`、`useEffect`，以及由宿主 `react-dom` 注入的 `createPortal`。普通 `react` export 本身没有 `createPortal`；为保持题目指定的双参数工厂签名，集成侧应构造宿主 React facade，而不是虚构 `primitives.createPortal`：

```js
const { createPortal } = require('react-dom')
const orbitUi = createOrbitPopover({
  React: Object.assign({}, React, { createPortal }),
  primitives,
})
```

缺少上述任何能力都会在工厂创建时显式抛出“需要宿主能力”或“`DSH primitives.<name> 不可用`”错误。调用方应据此完整保留现有 StatusOrbit；适配器不会静默退回自绘弹层或非 portal surface。

## OrbitPopover 契约

主要 props：

| prop | 契约 |
|---|---|
| `open` | 只控制宿主 hook 的 open 参数和最终是否渲染，不控制 hooks 是否调用 |
| `anchorRef` | 圆环锚点，原样传给两个宿主 hook；打开时必填 |
| `orbitRef` | 焦点归还目标；省略时使用 `anchorRef` |
| `panelRef` | 可选调用方 panel ref；省略时使用适配器内部稳定 ref |
| `onClose` | 最新回调放入 ref；接收 `{ reason }` |
| `width` | 调用方必填的正数；适配器不推导空态/常规业务宽度 |
| `zIndex` | 可配置，默认 `1100`，对应官方 Menu portal 层级；不是极大常量 |
| `portalTarget` | 可选 portal target，默认 `document.body`；显式 `null` 且打开时明确报错 |
| `className/style/ariaLabel/children` | surface 的领域内容与扩展样式；关键定位样式由适配器最后写入 |

### 定位、surface 与 hooks

`useAnchoredPosition` 收到且只收到以下定位配置：

```js
{
  open,
  anchorRef,
  panelRef,
  side: 'top',
  align: 'end',
  gap: 8,
  margin: 8,
}
```

没有 `align:'center'`，没有 `flip` 参数，也没有备用定位计算。宿主返回 `{left, top}` 后，主 `MenuSurface` 通过宿主 `createPortal` 挂到 target，并写入：

```js
{
  position: 'fixed',
  left: position.left,
  top: position.top,
  width,
  zIndex,
}
```

首帧 `position=null` 时使用 `left:0, top:0, visibility:'hidden'`，只避免未测量 surface 闪现；这不是另一套定位或自动 flip。坐标可见后使用 `visibility:'visible'`。

surface 固定为 `role:'dialog'`、`tabIndex:-1`，不设置 `aria-modal`，不加 Modal 背板，也不使用 Tooltip 承载交互列表。`MenuSurface` 自身的官方材质实现仍归宿主；本适配器没有新增 mask/backdrop 节点。

所有 hooks 都位于 `if (!open) return null` 之前：

1. 内部 panel ref 与最新 onClose ref；
2. `useCallback(..., [])` 创建 stable close；
3. `useAnchoredPosition(...)`；
4. `useDismissOnOutsidePointer(panelRef, open, close, anchorRef)`；
5. 本地 `useEffect` 管理 Escape、初始焦点与清理回焦。

因此 `open=false → true → false` 不改变 hook 顺序。父级轮询只更新 onClose ref，不改变 stable close identity。

### Escape、外点与焦点

- DSH 外点 hook 固定调用 `close(false)`；适配器把它转换为 `onClose({reason:'outside-pointer'})`。
- 打开时，本地 effect 在 `ownerDocument` 以 capture 注册 `keydown`；非 repeat Escape 会 `preventDefault()`、`stopPropagation()`，再调用 `onClose({reason:'escape'})`。
- effect mount 后聚焦 panel；cleanup 用同一 listener/capture 对称解绑，并聚焦仍连接的 `orbitRef.current`（或 `anchorRef.current`）。
- 普通关闭和确认关闭都以圆环为目标，不读取已可能卸载的删除按钮。
- 这是非 Modal dialog：没有新增焦点陷阱，焦点圈/Tab 策略未被假对象测试宣称为浏览器已验。

## 删除确认策略

`useOrbitConfirm({ orbitRef, onCloseOrbit, onRequestConfirm })` 返回：

```js
{ onRequestConfirm: requestConfirm, onConfirmClose, restoreFocus }
```

`requestConfirm(detail)` 的顺序固定为：

1. 在 ref 中记录 `restoreFocus='orbit'`；
2. 默认且始终先调用 `onCloseOrbit({reason:'confirm'})`；
3. 若提供自定义 `onRequestConfirm`，再把原 detail 与 `reason:'confirm'`、`restoreFocus:'orbit'` 一并交给它，由调用方打开自己的确认 Modal。

因此自定义打开确认策略也不能遗漏“先关 orbit”，避免 orbit 的默认 1100 层压住 Modal root 的 1000 层。适配器本身不创建确认 Modal、不执行删除，也不接管 busy/成功才关闭等业务规则。

确认取消或成功关闭时，调用方必须调用 `onConfirmClose()`。它只在标记仍为 `orbit` 时清除标记并显式聚焦最新 `orbitRef.current`；即使 request detail 带有删除按钮/opener，也不会把焦点还给该按钮。确认失败且 Modal 保持打开时不应调用它。两个回调都用空依赖 `useCallback` 保持 identity，同时经 ref 读取最新调用方函数。

## 假对象测试证据

定向命令与首轮真实输出：

```text
node --test test/orbit-popover-adapter.test.mjs
tests 10 / pass 10 / fail 0 / exit code 0
```

测试使用按位置保存槽位的假 React hooks、假 `createPortal`、假 `MenuSurface`/position/dismiss primitives 和假 DOM，覆盖：

1. 缺 portal、React hooks 或三个 DSH 原语时显式报错；
2. `top/end/8/8` 参数、portal target、`role=dialog`、fixed left/top、调用方 width、可配置 zIndex；
3. `open=false/true/false` 完整 hook 顺序一致；
4. stable close identity、最新 onClose、外点 `false → outside-pointer`；
5. 初始焦点、Escape prevent/stop/repeat、capture 注册和对称解绑、cleanup 回焦圆环；
6. 首帧 null position 不自行 flip/center/另算坐标；
7. 默认 `document.body`、无 Tooltip、无适配器背板、无第二个 portal；
8. 252/368 等 width 只能由调用方给出，非法 width 和无 target 明确失败；
9. 默认确认策略的关闭顺序、`restoreFocus='orbit'`、确认关闭只回圆环；
10. 自定义 `onRequestConfirm` 仍先关闭 orbit，轮询重渲染读取最新回调且身份稳定。

首轮全量：

```text
npm test
tests 515 / pass 514 / fail 1 / exit code 1
```

OrbitPopover 的 10 项在全量中全部通过。唯一失败是并行 InfoTip 子任务的 `test/ui-l84-tooltip.test.mjs:286`（“主面板 scroll-close…”）：断言两侧都打印 `[]`，但跨 VM realm 的数组未通过 `deepStrictEqual`。本任务按可写边界没有修改该测试或 `client.js`，已把真实失败通知父代理；此首轮结果不写成全绿。

并行子任务随后把该处改为显式 `Array.isArray` 与长度断言。最终复跑的真实结果为：

```text
npm test
tests 515 / pass 515 / fail 0 / exit code 0
```

最终全量中的 OrbitPopover 10 项也全部通过。测试脚本仍打印既有的 `node:test run() is being called recursively` warning，但没有失败；本任务没有修改那段 runner 或并行 InfoTip 修复。

## 明确未验项

这些测试证明的是适配参数、元素/portal 结构、hook 调用顺序、回调 identity、手动 effect 注册/清理和焦点目标选择。effects 是手动执行的，position 是假返回值，外点是直接调用假 hook 收到的 `close(false)`，焦点对象也是假对象。

以下均未宣称已验：

- 真实 React mount/reconciliation、layout/passive effect 时序与卸载清理；
- 真实 `getBoundingClientRect`、offset 测量、clamp、frame clearance、真实 left/top 或窄/矮视口布局；
- 宿主 scroll/resize/panel ResizeObserver 的真实触发和清理，以及“没有自动 flip”在边界视口中的视觉结果；
- 真实 pointerdown、Node.contains、anchor 排除、Escape 传播/IME/组合键和浏览器焦点；
- 删除按钮实际卸载后，取消/成功/失败确认路径与圆环焦点的端到端时序；
- orbit 与 Modal 的真实 stacking context、1100/1000 层级和确认同屏结果；
- MenuSurface 真实材质、Darwin backing、computed style、双主题、reduced-motion 和读屏。

所以本交付只是下一步 StatusOrbit 迁移的独立准备，不代表可以立即删除现有 superagent 同源定位、Escape、外点或焦点实现。接入后仍须按任务书做真实 Chromium/宿主回归，尤其验证“orbit 关闭 → Modal → 确认关闭回圆环”整条动线。
