# 真实 Chromium · DSH primitives 验收（0.9.270）

## 最终结论

```text
27 passed / 0 failed / 27 total
Chromium 156.0.8078.74
DSH frontend 0.2.1-rc.5
React 18.3.1
primitives exports 290
```

执行：`node --check scripts/verify-ui-primitives.mjs && ego-browser nodejs < scripts/verify-ui-primitives.mjs`，exit 0。
使用安装 bundle 中的同一 React/primitives 与仓库适配器，不进入、不绕过需要认证的 DSH Web GUI。

## 基线与方法

任务下达时仓库为 `0.9.269`；验收期间并行 T64 修复了本脚本发现的 Orbit 焦点问题，最终实测 `package.json` 已是 `0.9.270`。本任务没有修改版本或生产适配器。

| 项 | 最终实测 |
|---|---|
| 浏览器 | ego-lite 真实 Chromium `156.0.8078.74`（UA high-entropy `fullVersionList`） |
| React / ReactDOM | 安装 bundle 捕获的同一对象，React `18.3.1` |
| DSH frontend / primitives | `0.2.1-rc.5` / 290 exports |
| 安装 asar SHA-256 | `e1b6f25fa937da98086c3e77af77aa14791105963c4d337a1c42179d232c6915` |
| 入口 JS SHA-256 | `0f3fc6b857e4f8bd4d69619ce1010240cdaaa443abf0826532a24ef8f6e32ef0` |
| vendor JS SHA-256 | `c14ba1089d78f48b8959a7bc42c9013b4a57aa4122e053d54f74c0a4d1d156a7` |
| 入口 CSS SHA-256 | `47c890e8b3898eb4e5a53933bd318e58d4cf168cd7ccef46789d48a070bba591` |

脚本只用 `ELECTRON_RUN_AS_NODE=1` 读取 asar 内前端资源；组件创建、布局、事件和截图全部发生在 Chromium。独立 loopback 页面在真实 bundle 调用 `__ModuleLoader__.create({staticModules})` 时捕获模块，随后以 `intentional-capture-stop` 主动停止 DSH 应用启动。没有假 React、假 primitives、假 DOM 或测试桩替代浏览器，也没有访问 DSH Web GUI 认证接口。

`createHostUi` / `createOrbitPopover` 直接使用工作树源码，`createRoot` 使用捕获的 `react-dom/client`，Orbit portal 使用捕获的 `react-dom.createPortal`。鼠标 hover/click/wheel、DOM focus、键盘 Escape/Tab 均由 ego-browser 驱动；断言读取真实 `document.activeElement`、DOM、rect、computed style 和事件日志。

## 真实通过项

- Tooltip：hover/focus 打开、blur 关闭、click pinned、portal、Escape、Tab、外点；
- Tooltip scroll-close：嵌套容器滚动后关闭，trigger 焦点归还，原 ref 真实 detach/attach 对称；
- OrbitPopover：body portal、role=dialog、fixed、z-index=1100、top/end 坐标与 8px gap；
- Orbit 初始焦点：surface visible 后进入非 Modal dialog；
- 外点：记录 outside-pointer，焦点保留在用户点击的外部按钮；
- Escape：preventDefault，关闭后回圆环；
- 删除确认：orbit close → confirm request；Orbit(1100) 卸载后只有 Modal(1000)；
- Modal 初始焦点落在取消按钮；关闭后只回圆环，不回已卸载删除按钮；
- 无未预期页面错误。

计数拆分：基础环境 `3/3`、Tooltip `13/13`、Orbit/Modal `10/10`、页面错误检查 `1/1`，合计 `27/27`。

## DOM / computed style / 焦点 / 事件实录

### Tooltip

| 操作 | 真实结果 |
|---|---|
| hover | 出现 `SPAN[role=tooltip]`，父节点 `BODY`，`data-portal=true`；`position:fixed`、`z-index:1100`、`visibility:visible`、普通态 `pointer-events:none`；移出后节点消失 |
| focus / blur | focus 后 trigger 的 `aria-describedby` 指向 bubble 且打开；blur 后 bubble 消失 |
| click pinned | `data-pinned=true`、`pointer-events:auto`，指针移开后仍打开；最终 bubble rect 为 `left=12, top=176.8125, width=251.0625, height=26` |
| 嵌套 scroll | wheel 后 `scrollTop=70`，pinned bubble 消失；事件记录有 trigger `focusout → focusin`，最终 `activeElement=#tooltip-trigger` |
| keyed remount | 调用方原 ref 依次收到 `detach(null)`、`attach(#tooltip-trigger)`，不是只在假 ref 上断言 |
| Escape | bubble 关闭；capture 采样时 `defaultPrevented=false`，完整分发后为 `true`；最终焦点仍在 trigger |
| Tab | bubble 关闭，完整分发后 `defaultPrevented=false`；浏览器默认焦点移动到 `#after-tooltip` |
| 外点 | `pointerdown` 后关闭，外部按钮发生 `focusin`，最终 `activeElement=#outside` |

事件采样特意同时保存 capture 瞬时值与 `setTimeout(0)` 后值，避免把宿主后注册 capture listener 尚未执行时的 `defaultPrevented=false` 误判为官方行为。

### OrbitPopover

| 项 | 实测值 |
|---|---|
| DOM / portal | `body > div[role=dialog][aria-label="主理鱼 watcher"]`，class 含官方 `_surface_ri079_1` 与业务 `sa-dock-panel` |
| computed style | `position:fixed; left:424px; top:514px; width:368px; z-index:1100; visibility:visible; isolation:isolate` |
| anchor / rect | anchor `(left=720, top=650, right=792, bottom=690)`；panel `(left=424, top=514, width=368, height=128)` |
| top / end | `left = 792 - 368 = 424`；`top = 650 - 128 - 8 = 514`，符合 end 与 8px gap |
| 初始焦点 | surface visible 后出现 dialog `focusin`，500ms 复核时 `activeElement` 仍为该 dialog |
| 外点 | 适配器记录 `{reason:"outside-pointer"}`；真实序列为 dialog `focusout`、外部按钮 `focusin`，最终焦点留给 `#outside` |
| Escape | 完整分发后 `defaultPrevented=true`，记录 `{reason:"escape"}`，panel 卸载，最终焦点回 `#orbit-trigger` |

### 删除确认静态组合

- 适配器事件严格按 `delete-click → orbit-close({reason:"confirm"}) → confirm-request` 顺序出现。
- Modal 打开时 Orbit 已不存在，因此 Orbit `1100` 不会盖住 Modal root `1000`；Modal root 为 `position:fixed; inset:0; z-index:1000`，dialog 为 `position:relative; z-index:1`。
- 初始焦点落在 `#modal-cancel[data-modal-autofocus]`，没有再被 Orbit cleanup 抢回圆环。
- 取消后 `confirm-focus-restored=true`，最终焦点回圆环；未聚焦已卸载的 `#orbit-delete`。
- 这里只组合本地静态状态，没有发送 watcher 删除、刷新或轮询请求。

## 修复前发现与处理

真实浏览器曾发现：首帧 hidden 聚焦失败、Orbit cleanup 覆盖 Modal autofocus、外点被强制回圆环；旧 `0.9.269` 适配器对应完整运行曾为 `24/27`。
T64 已修：visible 后每次 open 只聚焦一次；outside/confirm 不抢焦点；Escape 才自动回焦；confirm 关闭后显式回圆环。最终脚本针对现行行为逐项复验为 `27/27`，没有跳过或删除这些焦点用例。
独立适配器 13/13、UMD 集成 8/8、同源审计 84 项通过；这三项来自并行 T64/审计任务，不计入本脚本的 27 项。

## 证据

- 可复跑脚本：[verify-ui-primitives.mjs](../scripts/verify-ui-primitives.mjs)，SHA-256 `a2ddfcad0052d2f7133b846199aa40ee748ebeed89ee604de0c20bccd72e605f`（写报告时的脚本内容）。
- [Tooltip pinned 截图](assets/ui-primitives-chromium-tooltip.png)，1680×957，SHA-256 `9c76d827aea0f25c34aad3a0bfdeae7eb7cbe26075467d0f9520876160c9800f`。
- [Orbit 打开截图](assets/ui-primitives-chromium-orbit.png)，1680×957，SHA-256 `57ed766a54282f1a1ead6076c956ff973884bad2800bc09541a99c7fe82a28a5`。
- [Orbit→Modal 截图](assets/ui-primitives-chromium-modal.png)，1680×957，SHA-256 `9658422adeb7f92004a3b83392416213d71a33fcfb9276e3722282cf86a6578e`。

适配器 hash：
- `ui-host-primitives.js`: `934f9178a4413c30bb430a044d61f9ed38bc63a33994ed4e903503551940a0d1`
- `ui-orbit-popover.js`: `4236099c9ade9f36c5cc378b2c673e8bf6cf795524f239abbbdb9ae75bb8df88`

## 未验

- 未进入真实 DSH Web GUI 的会话 slot；
- 未验 touch、读屏、双主题、reduced-motion、窗口 resize/窄视口翻转；
- 未区分 Tooltip 的 `focus-visible` 与键盘 Tab 打开路径；本轮 focus 是真实 DOM focus；
- 未验真实 watcher 请求/轮询；删除确认仅静态组合，不发请求。

本任务只新增验证脚本、本报告和三张截图，没有创建 `test/ui-primitives-browser.test.mjs`，没有修改 `client.js`、两个适配器、`package.json`、`lib/`、版本或派单表，也没有 commit。工作树中这些生产文件及 T64/审计文件的变化属于并行任务。
