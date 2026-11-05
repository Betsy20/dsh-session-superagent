# L84d · 宿主原语迁移任务书

> 依据：`docs/ui-decomp/04-host-primitives-smoke.md`（290 exports、8/8 调用 smoke）。浏览器行为均未验，不能按“同名组件”直接全站替换。

## 当前状态

- Modal/Toast：主面板已接入（0.9.267），orbit 仍保留 superagent 同源确认。
- InfoTip：已接 DSH Tooltip；真实 Chromium 的 scroll-close、ref detach/attach 与焦点归还已实测通过。
- OrbitPopover：已接入 StatusOrbit；真实 Chromium 发现首帧 hidden 聚焦失败、outside/confirm 清理抢焦点，T64 修复中。
- 真实 DSH WebView 的宿主 slot、计时、读屏与双主题键鼠仍未验，不能因测试桩全绿提前删除回退路径。

## 顺序与可写边界

1. **Modal**：保留 `ConfirmButton` 业务适配器与 `busyRef + onConfirm()=>boolean`，只把内部本地 Modal shell 换成 DSH Modal。
2. **Toast / InfoTip**：分别做 keyed Toast + id guard、scroll-close 适配。
3. **StatusOrbit**：最后迁移；先 OrbitPopover 适配器，不动领域 rows。

每一步单独可回滚，不把三步塞进一个不可拆 diff。

## Modal 验收

- `open/title/description/footer/onClose` 与现有调用面一致，`closeLabel:'关闭'`；
- 保留 busy、成功才关闭、错误保持打开；
- 取消/Escape/背板不写请求；
- 真实浏览器焦点圈、焦点归还、轮询不抢焦点；
- DSH CSS-module DOM 与 `.dt-*` 不混拼；术语表宽度走适配选择器。

## Toast 验收

- `key=item.id`；`onDone` 按 id 清除，旧完成回调不能清掉新 Toast；
- 使用 `holdMs` + 宿主 onDone，不保留第二套 timer；
- success/error 图标显式；宿主根是 `role=alert`，不得宣称仍是 polite status；
- 重要错误仍留 Section，不只 Toast。

## InfoTip 验收

- 保留 `{text,icon,warn}` 调用面与 trigger 样式；
- `side:'top', portal:true, openOnClick:true, gap:8`；
- scroll-close 必须另实现；无法实现就保留现有 InfoTip；
- hover/focus/touch/Escape/边缘定位需真机验。

## StatusOrbit 验收

- 先引 `OrbitPopover`：portal、fixed left/top、Escape、初始/归还焦点、role=dialog、宽度、z-index、stable close；
- hooks 无条件调用，不因 open 提前 return 改 hook 顺序；
- `side:'top', align:'end', gap:8, margin:8`；hook 无 center/自动 flip，不得传未实现参数；
- 不用 Tooltip 承载交互列表，不加背板；
- **打开删除确认时 orbit 必须关闭或隐藏**；确认关闭后焦点回圆环还是删除按钮，先定策略再迁移；
- 删除旧 left/bottom 手算、capture mousedown 和任意极大 z-index 前，必须有真机回归证据。

## 禁止

- 不把普通删除改成 RiskConfirmation；
- 不为了 DSH 同名件丢掉 watcher 字段或业务状态；
- 不在未验证前删除现有 superagent 同源焦点/定位实现；
- 不新增第三套弹层。
