# fallback 可访问性报告

严格审查 W15 / W16 / W17 的修复记录。改动只在 `client.js`、`test/client.test.mjs` 与本报告；没有动 `lib/`、package、版本、preflight 或派单表。

## 修复

### W15 回退 Tooltip：Escape 关闭 + trigger↔tooltip 关联

`client.js` 的 `FallbackInfoTip`：

- 每个 trigger 用 `useRef` 持有稳定 id（`dt-info-tip-N`，模块级序号只在首次挂载时递增）。
- 打开时 `aria-describedby` 指向该 id，tooltip 节点带同一个 `id`；关闭时 `aria-describedby` 回到 `undefined`，不会指向已消失的节点。
- trigger 新增 Escape keydown：`preventDefault()` 后关闭气泡，不调用 `blur()`，焦点留在 trigger 上。
- 原有 click 开合、`onBlur` 关闭、`role="tooltip"` 与定位样式保持不变；两条回退路径（require 缺失、仅缺 Tooltip）都覆盖。

### W16 fallback 确认 Modal 独占 Escape，底层 Orbit 让位

`client.js`：

- 新增模块级 `localDialogDepth`：本地 `Modal` 打开时加一，effect 清理时减一。它是模块计数而不是 `StatusOrbit` 的新 hook，避免打乱既有按位置取值的 hook 契约。
- fallback `StatusOrbit` 的 capture `onKey` 在 `localDialogDepth > 0` 时直接返回：第一次 Escape 只由 Modal 的 document keydown（bubble）处理，关闭 Modal 并把焦点还给 opener；第二次 Escape 才关 Orbit 并回焦圆环。
- 同一层级的 `mousedown` 也加了同样的让位判断：Modal 打开时点背板/取消不会穿透关闭 Orbit。
- Modal 的 Escape 处理新增 `event.defaultPrevented` 判断：更上层控件（如 fallback Tooltip）已经消费的 Escape 不再关 Modal。

### W17 fallback Toast：用 `item.id` 作 key，重启动画

`client.js` 的 `useToast`：

- fallback 的 toast 节点加 `key: item.id`；连续两条 id 不同的通知会重建节点，`dt-toast-in` / `dt-toast-fade` 从头播放。
- 统一时长：`TOAST_HOLD_MS = 3000`、`TOAST_FADE_MS = 1000`，CSS `--dt-toast-hold` 与自动消失 timer 都按 3000 + 1000 = 4000ms；旧实现 CSS 是 3600ms、timer 是 4000ms，淡出会被提前卸载打断。
- `role="status"` / `aria-live="polite"` / 错误态左侧红条保持不变；DSH 宿主 Toast 路径未改。

## 验证

先写测试再改代码，三条新用例在旧代码上全红：

- W15：`tooltip 必须有稳定 id`（无 id / 无 describedby / Escape 无效）。
- W16：旧代码没有层级登记，且同一次 Escape 会同时调用 Orbit 与 Modal 的关闭。
- W17：fallback Toast `key` 为 `undefined`，hold 仍是 `3600ms`。

修复后：

- 定向：`node --test --test-name-pattern="W15|W16|W17" test/client.test.mjs` → 3/3 PASS；`test/client.test.mjs` 单文件 116/116 PASS。
- 相关回归：`client / ui-l84-tooltip / ui-l84-host-modal-toast / orbit-trigger-native / orbit-popover-integration` → 153/153 PASS。
- 全量：`npm test` → 669/669 PASS。
- UI 体检：`node scripts/ui-audit.mjs` → 11/11，100 分。
- `node --check client.js` 通过。

新增用例固定了这些断言：Escape `preventDefault` 且焦点仍在 trigger；关闭后 `aria-describedby` 被清除；同一 trigger 反复打开复用同一个 tooltip id；Modal 打开时 Orbit 的 capture Escape / mousedown 都不动作，Modal 关闭后焦点回到 opener；第二次 Escape 才关 Orbit；连续两条 Toast 的 key 不同且 hold 为 3000ms。

## 边界

- 真实 Chromium：本 worktree 未直接运行 fallback 专项浏览器脚本；主线的标准闸门（47/47，官方 primitives 路径）按派单由主线执行，不覆盖本次 fallback 分支。未进入真实 DSH Web GUI，未做物理读屏、触摸或 IME 验收。
- 官方 DSH Tooltip / Modal / Toast / Orbit 宿主路径没有改行为；fallback 的层级计数只在本地 Modal 与旧 Orbit 路径使用。
- 本次范围外发现、未处理：fallback Orbit 弹层用 inline `zIndex: 2147483000`，高于 `.dt-modal-root` 的 1000，真实浏览器里确认框可能被弹层面板遮挡；本轮只修键盘层级，未动视觉层叠。
