# L84e · StatusOrbit 接入 OrbitPopover 任务书

> 前置：T57 的独立适配器完成。当前 `StatusOrbit` 仍有手算 `anchor/bottom`、capture mousedown、极大 z-index 与 inline 按钮样式。迁移只做壳，不改 watcher rows/轮询/动作语义。

## 可写路径

- `client.js`
- `ui-orbit-popover.js`（只读适配，不在集成时改 API）
- 新集成测试与 `docs/报告-OrbitPopover集成.md`

## 必做

1. `createOrbitPopover` 缺原语时保留现有实现；有时才删除旧手算定位与 capture mousedown。
2. 使用 `side:'top', align:'end', gap:8, margin:8`；不得传 `align:'center'`，不得宣称自动 flip。
   portal 通过宿主 React facade 注入 `require('react-dom').createPortal`；适配器不伪造 `primitives.createPortal`。
3. 保留空态 252 / 常规 368、现有行、错误、pause/resume/delete、OrbitMark 与入口顺序。
4. 弹层 `role=dialog`，初始焦点与关闭归还清晰；不加背板、不用 Tooltip 装列表。
5. 主 surface 自己 portal；z-index 不再写任意极大值，按适配器与宿主层级执行。

## 删除确认策略（阻断项）

1. 点击 orbit 内「删除」时先关闭 orbit，再打开确认 Modal。
2. 确认打开期间不得让 orbit 的 1100 层压住 Modal 的 1000 层。
3. 确认取消/完成后焦点回圆环按钮，不回已随 orbit 卸载的删除按钮。
4. 若原删除按钮已卸载，宿主 Modal 的 opener isConnected 检查不会自动找回；必须由适配器显式回焦圆环。
5. 上述路径没有真实测试前，不删除现有 `modalContext='orbit'` 的 superagent 同源 Modal。

## 验收

- 原语缺失时旧路径完全可用；
- open/close 不改变 hook 顺序；
- Escape、外点、resize、scroll 的注册与清理有测试；
- 删除确认的「orbit 关闭 → Modal → 回焦圆环」有状态调用测试；
- 真实 Chromium 记录边界坐标、外点、Escape、确认叠层与焦点；未验项单列；
- `npm test`、`ui-audit`、对比度与 preflight 全绿。
