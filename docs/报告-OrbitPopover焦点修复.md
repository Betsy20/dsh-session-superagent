# OrbitPopover 焦点修复报告

- 日期：2026-11-05
- 版本范围：0.9.270 候选工作树
- 实现范围：`ui-orbit-popover.js` 与 `client.js` 内联 UMD 同源实现
- 浏览器复验分工：真实 Chromium 复验由主线执行；本任务未修改验收脚本

## 1. 真实 Chromium 验收证据

### A. 打开后焦点仍停在圆环

Orbit 打开后，panel 已经 `visible`，body portal、`side=top`、`align=end` 均正确，但 500ms 后 `document.activeElement` 仍是 `#orbit-trigger`，panel 从未收到 `focusin`。

根因是首帧 `useAnchoredPosition` 返回 `position=null`，surface 此时为 `visibility:hidden`。旧 effect 在这一帧调用 `focus()`，浏览器不能聚焦隐藏元素；position 随后到达时，旧 effect 又不包含 position 依赖，不会补做初始聚焦。

### B. 删除确认被 Orbit cleanup 抢焦

真实焦点顺序为 `#orbit-delete` → `#modal-cancel` → `#orbit-trigger`，后两步相隔约 0.2ms。Modal 已经完成初始聚焦，Orbit 的无条件 cleanup 随后又把焦点抢回圆环，导致 Modal 打开 500ms 后焦点不在 Modal 内。

### C. 外点按钮被 cleanup 抢焦

点击外部可聚焦按钮时，最终焦点应留在该外部按钮。`close reason=outside-pointer` 已正确传递，但旧 cleanup 不区分关闭原因，仍无条件回焦圆环，覆盖了用户刚刚选择的焦点目标。

## 2. 修复策略

### 2.1 等 panel 可见后再聚焦，且每次 open 只尝试一次

- 在 effect 依赖中加入 `position`，使 `null → 非空` 时重新执行。
- 只有 `position` 非空、surface 已为 `visibility:visible` 时才调用 `focusIfConnected(panelRef.current)`。
- `didFocusRef` 在首次可见聚焦尝试前置为 `true`；后续 scroll/resize 引起的 position 更新不会重复抢焦点。
- `open=false` 时重置 `didFocusRef`，下次重新打开可再执行一次初始聚焦。

### 2.2 cleanup 按关闭原因决定是否回焦

`close()` 统一经 `closeReason(detail)` 归一化并写入 `closeReasonRef`。cleanup 仍先对称移除 keydown 监听，但只有 `reason === 'escape'` 才回焦 `orbitRef || anchorRef`：

| 关闭路径 | Orbit cleanup 行为 | 焦点归属 |
| --- | --- | --- |
| `outside-pointer` | 不回焦 | 留给外部点击目标 |
| `confirm` | 不回焦 | 留给 Modal 初始焦点 |
| `escape` | 回焦圆环 | 键盘关闭后回到触发器 |
| trigger toggle / 无显式原因 | 不额外回焦 | trigger 自身已有焦点 |

### 2.3 confirm 原因跨父组件关闭路径传递

`useOrbitConfirm.requestConfirm` 的既有顺序保持不变：先记录 `restoreFocus='orbit'`，再 `onCloseOrbit({reason:'confirm'})`，最后调用 `onRequestConfirm` 打开 Modal。

这条路径由父组件直接关闭 Orbit，不经过 `OrbitPopover.close`。为不增加公开 props、不改变两个适配器的参数面，实现使用按 `orbitRef` 对象关联的 `WeakMap` 记录 confirm 原因；Orbit cleanup 能据此识别 confirm 并放弃回焦。关闭后的 effect 会删除该关联，WeakMap 不持有已卸载 ref 的强引用。

Modal 关闭后的焦点归还仍只由 `useOrbitConfirm.onConfirmClose` 显式执行：清除一次性恢复标记并聚焦当前圆环，不回焦已卸载的删除按钮。

### 2.4 独立 ESM 与 UMD 同源

两个实现保留相同 props、定位参数、portal、keydown、focus 与 confirm 调用顺序。为兼容原 82 项结构化同源审计，初始聚焦与 Escape cleanup 仍位于同一个含 keydown 的 effect 中；UMD 仅保留既有的 `React/HostReact`、`h/hostH` 适配差异。

## 3. 回归测试

### 独立适配器

`test/orbit-popover-adapter.test.mjs` 新增或修正以下断言：

1. `position=null` 首帧不聚焦；position 到达后聚焦一次；position 后续更新不重复聚焦；重新 open 后才重置。
2. `outside-pointer` cleanup 不回焦圆环，外部按钮保留焦点。
3. confirm cleanup 在“Modal 初始焦点先到、Orbit cleanup 后到”的顺序下不抢焦；`onConfirmClose` 才显式回圆环。
4. Escape 继续 `preventDefault`、`stopPropagation`，关闭后回焦圆环。

### client.js UMD 集成

`test/orbit-popover-integration.test.mjs` 通过真实 UMD factory 与 React hook/ effect harness 覆盖：

1. `position null → visible` 的延迟聚焦及后续定位更新。
2. 外点关闭的监听对称清理与不抢外部焦点。
3. 删除时先关 Orbit、再选 watcher、再开 Modal；confirm cleanup 不覆盖 Modal 初始焦点。
4. 取消和确认删除都只由 `onConfirmClose` 显式回圆环一次，删除请求仍只发一次。
5. Escape 回圆环与旧 capture mousedown 不回归。

## 4. 验证记录

- `node --test test/orbit-popover-adapter.test.mjs test/orbit-popover-integration.test.mjs test/orbit-popover-source.test.mjs`：23/23 通过。
- `node --check ui-orbit-popover.js`、`node --check client.js` 及三个 OrbitPopover 测试文件：全部通过。
- 原 82 项结构化同源断言（以内存中的原审计副本执行，不写回审计脚本）：82/82 通过，0 处漂移。
- `node scripts/audit-adapter-parity.mjs`：当前主线 84/84 通过，0 处漂移（本任务未修改审计脚本或其专属测试）。
- `npm test`：544/544 通过，0 失败。

## 5. 主线 Chromium 复验点

1. 打开 Orbit 后 500ms，焦点位于 panel，且 panel 收到一次 `focusin`；scroll/resize 不再次抢焦。
2. 点击删除后，`#modal-cancel` 保持焦点，不再出现随后跳回 `#orbit-trigger` 的记录。
3. 外点可聚焦按钮后，最终焦点留在该按钮。
4. Escape 关闭后焦点回到 `#orbit-trigger`。
5. 取消或确认删除关闭 Modal 后，`onConfirmClose` 将焦点显式带回圆环。

本任务没有运行或修改真实 Chromium 验收脚本，以上复验点交由主线执行。
