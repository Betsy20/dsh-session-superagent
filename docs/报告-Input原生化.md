# 共享 Input 原生化报告

## 结论

主理鱼共享 `Input()` 已在独立 worktree `D:\主工作区\projects\dsh-session-superagent-native-input`（分支 `task/native-input`）迁移到 DSH 官方 `Input`。宿主存在导出时直接委托；整个 primitives 不存在或仅缺 `Input` 时，完整保留原 `span.dt-input > [span.dt-input-icon] + input` 回退结构。

没有逐个修改搜索、repo/goal、ghDir/token、WatcherForm 新增或行内编辑调用点；没有改 `textarea`、`select`、`HoursField` 的原生 `type=time` 输入，也没有改 `lib/`、`package.json`、版本号、preflight 或派单表。未 commit、未 push。

## 官方证据

核对的是上游固定 commit `66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`，不是凭截图推测：

- [packages/client/ui-primitives/src/Input.tsx](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db/packages/client/ui-primitives/src/Input.tsx)：`forwardRef<HTMLInputElement>`；`className` 与官方 `css.wrap` 合并在唯一外层 `span`；可选 icon 由官方 `span.css.icon` 渲染；`ref` 落到真正的 native input；其余 `InputHTMLAttributes` 通过 `...rest` 透传。
- [packages/client/ui-primitives/src/Input.module.css](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db/packages/client/ui-primitives/src/Input.module.css)：官方 wrapper 为 `inline-flex / 32px / gap 6px / padding 0 8px / 0.5px border`，native input 为 `flex:1 / min-width:0 / border:none / outline:none / transparent`。

## 实现

### 1. 独立探测与回退

`client.js` 在原语探测区新增 `hostInput`：

- `primitives.Input` 存在：共享 `Input()` 返回 `h(hostInput, ...)`。
- 仅缺 `Input`：只降级输入框，已接入的 Button、SegmentedTabs、Modal/Toast 等不受影响。
- 整个 primitives `require` 失败：`hostInput=null`，走原有本地结构。

### 2. props 与 ref

官方路径透传受控 `value/onChange`、`type=password/number/search`、`placeholder`、`aria-*`、`disabled`、`required`、数字 `min/max/step`、`icon`、`key` 与 `ref`。`ref` 留在 `...rest` 中交给官方 `forwardRef`；回退路径同一个 `ref` 落到真正的 native input。

### 3. wrapper / className / icon 兼容

官方 `Input` 的 `className` 作用于 wrapper，因此适配层传入 `cx('dt-input', className)`：

- `dt-input` 与官方 `css.wrap` 同时落在**同一个**官方 wrapper 上，不新增第二层 span；两套几何规则一致，边框不是两个元素各画一层。
- 现有 `.dt-field .dt-input`、`.dt-search .dt-input`、`.dt-form > .dt-field > .dt-input` 继续命中，宽度和 480px 上限不因迁移失效。
- 现有 `.dt-input input` 继续作用于官方唯一 native input；官方 `.css.input` 的无边框、透明背景与该规则兼容。
- `icon` 只作为 prop 交给官方；适配层不再创建 `dt-input-icon`，所以官方路径只有一个 icon wrapper。回退路径仍只创建原来的一个 `dt-input-icon`。
- 业务 `className` 在官方路径按官方契约落在 wrapper；回退仍按旧契约落在 native input。现有生产调用点没有给共享 `Input` 传额外 `className`。

未改 `PORTED_CSS`，因为现有 `dt-input` 布局与原生输入规则仍需同时服务官方路径和回退路径。

## 测试覆盖

`test/update-ui.test.mjs` 新增 3 个测试：

1. **官方委托**：password/search/number、受控 value/onChange、placeholder、aria、disabled、required、数字约束、icon、key、ref、业务 className；断言无本地双 wrapper、无双 icon。
2. **完整回退**：覆盖整个 primitives 缺失、空 exports、仅缺 Input 三种场景，并逐一验证三种 type、原 DOM、单 icon、受控 props 与 native input ref。
3. **真实调用面**：实际渲染主面板，覆盖顶部搜索、repo/goal/interval、新增表单、行内编辑数字字段、GitHub/Gitee password、ghDir；同时验证会话 goal 仍为 `textarea`，两个 `type=time` 控件未迁移。顶部搜索调用保持原 props；显式 `type=search` 的共享组件能力由前两项测试覆盖。

测试捕获点只存在于测试执行时的源码替换，不向生产 `client.js` 增加测试导出。

## 最终真实计数

| 命令 | 结果 |
|---|---|
| `node --test test/update-ui.test.mjs` | **22/22 通过，0 失败** |
| `node --test test/update-ui.test.mjs test/client.test.mjs` | **116/116 通过，0 失败**（迁移前同组合实测 113/113，新增 3 项） |
| `npm test` | **609/609 通过，0 失败，0 跳过** |
| `node scripts/ui-audit.mjs --json` | **11/11，100 分**；写死颜色、自造 token、自造死类均为 0 |
| `git diff --check` | **通过，无输出** |

所有长命令均套了 `timeout`。

## 未验边界

本 worktree 未运行主线真实 Chromium 34 项，未把 Node 桩或静态 UI 体检冒充真机交互验收。官方组件在真实 Chromium 中的键盘、焦点、受控编辑、双主题与窄屏表现由主线 34 项继续验收。

最终改动仅限：`client.js`、`test/update-ui.test.mjs`、本报告。未改 `test/client.test.mjs`，因为现有回退面板回归已足够，新增定向场景集中在已有宿主原语测试文件中即可。

## 主线真实复验

合并后真实 Chromium 全部功能项 PASS：搜索筛选、行内编辑/放弃、三个凭证输入、goal 编辑，以及 Orbit/Modal 焦点与防写 403。textarea/select/time 保持原实现。
