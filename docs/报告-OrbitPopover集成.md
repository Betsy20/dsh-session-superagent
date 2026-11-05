# StatusOrbit 接入 OrbitPopover 报告

日期：2026-11-05

## 结论

`StatusOrbit` 已在 `client.js` 内真正接入宿主 `MenuSurface`、`useAnchoredPosition`、`useDismissOnOutsidePointer` 与 `react-dom.createPortal`。缺少任一宿主能力时仍走旧弹层，不创建第三套 Popover。

本任务只改了：

- `client.js`
- `test/orbit-popover-integration.test.mjs`（新建）
- 本文档（新建）

没有修改 `ui-orbit-popover.js`、InfoTip、`lib/`、`package.json`、其他既有测试、版本或派单表；没有 commit / publish。执行期间工作树被其他并发改动从 0.9.267 推进到 0.9.268，并新增 `test/orbit-popover-source.test.mjs` 两条源码测试；这些不是本任务的改动。

## 实现

### UMD 内的同源薄适配

- 在 factory 内镜像 `ui-orbit-popover.js` 的 `createOrbitPopover({ React, primitives })`，保留 `OrbitPopover` / `useOrbitConfirm` 调用面，并注释来源。
- 分别可选探测 `@deepseek-ai/dsh-client-ui-primitives` 和 `require('react-dom').createPortal`。
- `MenuSurface`、两个宿主 hook、portal 任一缺失都保留旧 StatusOrbit 的手算定位、capture mousedown、原确认结构和旧 z-index。
- 没有给 `primitives` 伪造 `createPortal`，也没有 import 相对 ESM。

### DSH 弹层

- 固定传参：`side: 'top'`、`align: 'end'`、`gap: 8`、`margin: 8`。
- 主 surface portal 到 `document.body`，使用 `role: 'dialog'` 和 `tabIndex: -1`。
- 空态宽 252，常规宽 368；保留 OrbitMark、watcher rows、轮询、错误展示、立刻/暂停/恢复/删除动作及入口顺序。
- 未传 `center` 或 `flip`，未给 orbit 增加背板；DSH surface 使用适配器默认 z-index 1100，旧 `2147483000` 只留在 fallback。
- open / close 都执行同一组 hooks；旧 capture mousedown 只在 fallback 注册。

### 删除确认与焦点

- 把 `ConfirmDialog` 从 `ConfirmButton` 拆出，主面板原调用面和 busy/取消/确认行为不变。
- DSH orbit 的待删 watcher 由 `StatusOrbit` 持有，避免 orbit 关闭时把确认层一起卸载。
- 状态顺序为：先 `setOpen(false)` 关闭 orbit，再记录待删 watcher 打开本地 `modalContext: 'orbit'` Modal。
- 确认期间没有 portal orbit surface，因此不会让 orbit 的 1100 层盖住 Modal。
- 取消和删除完成都显式调用 `orbitConfirm.onConfirmClose()`，焦点回圆环按钮，不回已卸载的删除按钮。
- 普通主面板删除仍走原 `PanelModal`，没有改成 `RiskConfirmation`。

## 验证结果

| 命令 | 真实结果 |
| --- | --- |
| `node scripts/test.mjs test/orbit-popover-integration.test.mjs` | **7/7 通过** |
| 相关旧测试（client / host Modal+Toast / orbit adapter） | **114/114 通过**；其中独立适配器仍为 10/10 |
| `npm test` | **524/524 通过，0 失败** |
| `node scripts/ui-audit.mjs` | **11/11，100 分** |
| `node scripts/audit-contrast.mjs --json` | 浅色 **16 组 / 310 节点**，深色 **13 组 / 231 节点**；满足浅 ≤16、深 ≤13 |
| `npm run preflight -- --fast --no-maintenance` | **全部通过（39 项检查）**；`smoke:observe` 与维护一致性两项 SKIP |

对比度原始脚本仍以退出码 1 报告已登记的违规项；preflight 的基线比较为 PASS（浅 16 / 深 13，未变多）。首次 `preflight --fast` 曾遇到 profile 5 条断链和维护一致性失败；随后 profile 被并发修复为 0 断链，上表记录的是最新复验结果。

新增集成测试覆盖：

1. 缺 primitives、缺三个必需导出、缺 react-dom 或缺 createPortal 时的完整 fallback。
2. body portal、`role=dialog`、top/end/8/8、252/368、1100 与非 DSH 极大 z-index 隔离。
3. OrbitMark、rows、错误、动作、空态及无 orbit 背板。
4. open / close hook 顺序，外点关闭，resize / scroll / pointer / key 监听注册与对称清理。
5. Escape 的 preventDefault / stopPropagation、dialog 初始焦点与圆环焦点归还。
6. 删除的“orbit 关闭 → 选中 watcher → 本地 Modal”状态顺序。
7. 取消与完成后的圆环回焦，以及只发一次 delete。

## 真实浏览器未验项

本次没有用真实 DSH 宿主做人工 Chromium 交互验收。Node 测试使用假 React / DOM / 宿主原语；对比度脚本虽运行了无头浏览器，但渲染源是静态预览与近似 token，不等于真实 DSH 弹层。因此以下仍未验：

- 真实宿主里的锚点边界坐标、四角/窄视口、resize 与嵌套 scroll 后的实际位置；集成测试中的坐标是假值 `{ left: 32, top: 48 }`。
- 真实指针事件、Escape 传播链、portal 内 Tab 顺序和初始/归还焦点的可见表现。
- 删除确认时真实宿主 Modal 与 orbit 的叠层、动画和最终焦点；测试证明的是状态顺序与组件挂载关系。
- 真实 `/state` 轮询与 pause / resume / delete 的联网结果；测试环境使用离线假响应。
- 真实 DSH 深浅主题 token 下的对比度；16/13 是静态预览基线计数，不冒充宿主实测。
