# OrbitPopover 集成验收（0.9.268）

## 实现

- InfoTip：DSH Tooltip，top/portal/openOnClick/gap=8；capture scroll remount + cleanup；aria-describedby→aria-expanded；缺 Tooltip 只回退 InfoTip。
- StatusOrbit：OrbitPopover + useAnchoredPosition + useDismissOnOutsidePointer + MenuSurface + react-dom portal。
- 固定 top/end/8/8；无 center、无自动 flip、无背板；空态 252、常规 368。
- DSH 路径不使用手算 left/bottom 或极大 z-index；缺原语时完整保留旧 StatusOrbit。
- 删除确认：onRequestConfirm 先关 orbit，独立 ConfirmDialog 持有确认层；关闭后 onConfirmClose 回焦圆环。

## 证据

```text
Tooltip 定向 5/5
OrbitPopover 适配器 10/10
OrbitPopover 集成 7/7
主线集成锚点 2/2
npm test → 524/524
UI 体检 → 11/11 = 100
对比度 → 浅 16≤16，深 13≤13
```

包核对：`ui-orbit-popover.js` 已进入 `exports`、`files` 与 `sync-profile.TARGETS`，npm pack 共 24 个文件。

## 未验

真实 WebView 的 portal、键鼠、焦点、读屏、Toast 生命周期与 1100/1000 叠层仍需走查；测试桩和静态 Chromium 不冒充宿主验收。
