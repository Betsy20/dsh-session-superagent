# L84 · 主面板宿主 Modal 与 Toast 实施报告

> 版本基线：`dsh-session-superagent` **0.9.266**，未改版本号。实施日期：2026-11-05。
>
> 结果：主面板在 factory 能取得 `@deepseek-ai/dsh-client-ui-primitives` 时，内部确认框、规则/术语 Modal 与 Toast 切到 DSH primitives；业务调用面保持不变。缺少模块或所需 exports 不全时，完整保留原 superagent 同源实现。卫星环删除确认仍显式使用本地 Modal。

## 1. 范围与依据

依据：

- `docs/ui-decomp/04-host-primitives-smoke.md`：factory 注入 require、真实 Modal/Toast 参数、Toast 的 hold + fade 形状及 orbit 组合风险。
- `docs/ui-decomp/06-host-primitives-task.md`：ConfirmButton、keyed Toast、id guard 和分阶段迁移边界。
- `ui-host-primitives.js`：`createHostUi({ React, primitives })` 参数形状、`dismissToast(current, id)`、`holdMs=3000` 和官方 warning icon 适配方式。

本任务只写入：

1. `client.js`；
2. 新建 `test/ui-l84-host-modal-toast.test.mjs`；
3. 新建本报告。

未写 `ui-host-primitives.js`、`lib/`、共享测试夹具、其他既有测试、版本文件或派单表；未 commit、未 publish、未重启或刷新 DSH。工作树里其他并行任务的改动不属于本报告。

## 2. 实现

### 2.1 UMD 可选探测与薄适配

`client.js` 没有 import 相对 ESM 模块，而是在原 `factory(require)` 内：

- 以同样参数形状定义本任务需要的 `createHostUi({ React, primitives })` 薄适配；
- 通过 `require('@deepseek-ai/dsh-client-ui-primitives')` 做可选探测；
- 只有 `Modal`、`Toast`、`IconWarningOutlineMedium` 都存在才启用；
- require 抛错、exports 不全或适配初始化失败时，`hostUi=null`，插件继续注册，不阻断加载。

对应实现：`client.js:16-80`。

### 2.2 Modal

- `PanelModal` 是 DSH `hostUi.Modal` 与本地 `Modal` 的静态别名，见 `client.js:821-823`。
- 主面板 `ConfirmButton`、AGENTS 建议规则弹层和术语表均走 `PanelModal`。
- DSH 适配透传 `open/title/description/footer/onClose/className/children`，并固定 `closeLabel:'关闭'`。
- `ConfirmButton` 的 `busyRef`、同步防重入、`onConfirm()=>boolean`、成功才 `setOpen(false)`、失败保持打开、`busy` 按钮 props 均未改，见 `client.js:826-873`。
- orbit 调用显式增加内部上下文 `modalContext:'orbit'`，选择本地 `Modal`，见 `client.js:1249-1255`。没有强切组合风险尚未解决的卫星环删除确认。

`PanelModal` 使用静态别名而不是 `h(Component, props)` 转发 children。开发中共享假 React 曾因此丢掉 fallback 弹层正文并出现 3 条回归；改别名后，定向 115 条与完整 500 条测试均通过。

### 2.3 Toast

DSH 可用路径位于 `client.js:1322-1328`：

- 保持 `useToast()=>[view, notify]` 与 `notify(text, tone)` 调用面；
- 单个 `item` 替换，始终只渲染最新一条；
- 真正传给 DSH Toast 的 React `key=item.id`，不是只放在数据或 props 里；
- `holdMs=3000`；
- `onDone` 闭包只回传完成项 id，`dismissToast` 仅在当前 id 完全相同时清空，旧回调不能清掉新通知；
- success 不覆盖宿主内建勾；error 显式创建官方 `IconWarningOutlineMedium`；
- 该分支没有主面板自己的 Toast timer。

fallback 保留原来的单条 `dt-toast`、`role=status`、`aria-live=polite`、错误红条和 4000ms timer；新通知会取消旧 timer。重要错误仍同时写入主面板 Section 的 `notice`，不是只发 Toast。

注意：DSH Toast 的宿主根语义是 `role=alert`，不是 fallback 的 polite status。本报告不把二者宣称为读屏语义等价。

## 3. 自动化覆盖

新测试 `test/ui-l84-host-modal-toast.test.mjs` 通过独立 vm/fake React 夹具执行真实 `client.js` factory；没有修改共享 `panel-harness.mjs`，所以既有测试默认继续覆盖 fallback。

10 条新用例覆盖：

1. require 缺失、exports 不全时仍可注册并使用本地 Modal；
2. 主面板 DSH Modal 的 `open/title/description/footer/onClose/closeLabel`；打开、取消和 onClose 均为 0 个写请求；
3. 术语表也走 DSH Modal，不混用本地 shell；
4. 确认成功、busy true→false、成功关闭、同步 busyRef 防第二次提交及 busy DOM props；
5. 409 失败保持打开，同时写 Section notice 与 error Toast；
6. DSH 可用时 orbit 仍是本地 Modal，确认只发一次 delete；
7. Toast key、props.key 被剥离、text/tone、3000ms、success/error 图标；
8. `notify(text,tone)` 连续调用只替换一个 item，DSH 路径创建 0 个自有 timer；
9. 旧 `onDone` 保留新 item，当前 `onDone` 才清空；
10. fallback 的 polite status、4000ms timer、取消旧 timer 和错误样式。

这些断言证明元素、props 与业务状态，不冒充真实浏览器事件验收。

独立子代理另做了严格只读复核，范围为可选 require、UMD 初始化、静态 hostUi 分支与 hooks 顺序、ConfirmButton、orbit、Toast/id guard/fallback 及新测试；结论为**无阻断问题**。该复核未修改文件、未运行测试，不替代下述实测。

## 4. 实测命令与真实计数

| 命令 | 实测结果 |
|---|---|
| `node --check client.js` | PASS，语法错误 0 |
| `git diff --check -- client.js` | PASS，空白错误 0 |
| `node scripts/test.mjs test/ui-l84-host-modal-toast.test.mjs` | **10/10 通过，0 失败** |
| `node scripts/test.mjs test/ui-l84-host-modal-toast.test.mjs test/client.test.mjs test/ui-l84-acceptance.test.mjs test/ui-l84-records-confirm.test.mjs` | **115/115 通过，0 失败** |
| `npm test` | 当时完整工作树快照 **500/500 通过，0 失败，0 skipped/todo**；总数包含并行任务已有测试，不全部归属于本任务 |
| `node scripts/ui-audit.mjs --json` | **11/11 通过，100 分**；写死颜色 0、自造 token 0、死自造类 0、缺名图标按钮 0 |
| `node scripts/audit-contrast.mjs --json` | 完成双主题无头浏览器静态测量；独立脚本 exit 1，实际 failGroups 为浅色 16、深色 13，均不超过本任务基线 |

`npm test` 另输出一条既有的 `node:test run() is being called recursively ... skipping running files` runner warning；本次 500 条仍全部通过。该警告不属于本任务改动范围，未顺手修改 runner。

### 4.1 对比度计数与退出码

| 主题 | 测量节点 | 总组数 | blocking failGroups | failNodes | 本任务上限 | 基线结论 |
|---|---:|---:|---:|---:|---:|---|
| light | 1486 | 122 | **16** | 310 | 16 | **16≤16，未超基线** |
| dark | 1486 | 135 | **13** | 231 | 13 | **13≤13，未超基线** |

- 独立 `audit-contrast` 在仍有 blocking WCAG 违规时按设计返回 1；本轮共 29 组（16+13），所以不能写成“WCAG 全部达标”。
- 本任务要求的 `浅≤16 / 深≤13` 比较的是 `summary[theme].failGroups`，不是总组数或 failNodes。failNodes 仅如实记录，不参与该上限判断。
- 测量来自真实 `client.js` 经静态 preview 在无头浏览器中的 computed style，不等于运行中 DSH Web GUI 的宿主 token、弹层 portal 或交互状态验收。

## 5. 真实浏览器 / 宿主未验项

本轮**没有**在实际 DSH Web GUI 中重载主理鱼并点击验证，也没有 GUI 截图。因此下列项目保持未验，不能由 500 条单测或静态对比度代替：

1. **factory 实机接入**：修改后的运行中宿主是否实际取得同一 primitives 对象、是否命中 DSH 分支；本轮新测试使用的是显式假 primitives 注入。
2. **DSH Modal 行为**：真实 portal、mask、Escape、背板点击、Tab/Shift+Tab 焦点圈、关闭后焦点归还、轮询重渲染不抢焦点、嵌套 modal stack、IME 与 opener 卸载场景。
3. **确认动线真机**：真实连点、busy 期间键盘/背板行为、成功/失败后的可见焦点位置与读屏结果。
4. **DSH Toast 生命周期**：真实 3000ms hold + 1000ms fade 后 onDone、连续通知的 key remount、旧回调在真实计时下不清新通知、官方 warning/success 图标外观、`role=alert` 读屏。
5. **视觉与层级**：DSH CSS-module DOM 的 computed style、真实宿主双主题、Toast 与 Modal 同屏层级、orbit 与确认框同屏的组合表现。orbit 本地实现虽保留，但组合视觉仍未做真机回归。
6. **静态审计边界**：hover、focus-visible、reduced-motion、真实滚动/resize、读屏与键鼠未由本轮脚本覆盖。

## 6. 回滚边界

- 宿主无 primitives 时自动走原实现，无需数据迁移。
- 若要撤销本任务，只需还原 `client.js` 并删除新测试、新报告；不会触及 watcher 数据、服务端状态或版本。
- orbit 的 DSH Modal 迁移仍未开始；不要把本报告解释为卫星环组合风险已经解决。
