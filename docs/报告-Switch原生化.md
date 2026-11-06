# 主理鱼共享 Toggle 迁移 DSH 官方 Switch

日期：2026-11-06  
工作树：`D:\主工作区\projects\dsh-session-superagent-native-switch`  
分支：`task/native-switch`

## 1. 官方证据

核对上游固定 commit `66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db` 的 [`packages/client/ui-primitives/src/Switch.tsx`](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db/packages/client/ui-primitives/src/Switch.tsx)：

- 受控 API 为 `checked`、`onChange(next)`、`label`、`disabled`、`title`、`className`。
- 官方渲染原生 `button[type=button][role=switch]`，自行写入 `aria-checked={checked}` 与 `aria-label={label}`。
- 官方点击处理自行调用 `onChange(!checked)`，并渲染官方 thumb。
- 官方 props 没有 `id`，因此不能把 `id` 伪装成受支持属性透传。

## 2. 实现

### 2.1 独立探测与回退

`client.js` 新增 `hostSwitch` 独立探测：从 `@deepseek-ai/dsh-client-ui-primitives` 读取 `Switch`。缺 `Switch` 导出或整个 primitives 不可用时，仅共享 `Toggle()` 回退，不影响 Button、Input、SegmentedTabs 等其它原语。

### 2.2 官方路径

`Toggle()` 在 `hostSwitch` 存在时直接创建官方 `Switch`：

- 传递 `checked: !!checked`、原始 `onChange`、`label`、`disabled`、`title`。
- 不传旧 `dt-switch` / `dt-switch-thumb`，不附加自制 `onClick`，由官方拥有 `role=switch`、`aria-checked`、键盘/点击和 next 计算。
- 调用方提供 `id` 时，仅增加一个无 `className`、无 `role`、无样式的 `span[id]`，其唯一子节点就是官方 `Switch`；没有 `id` 时直接返回官方元素，不增加 wrapper。

### 2.3 回退路径

保留原有 `button.dt-switch > span.dt-switch-thumb` 完整结构与样式类，继续保留：

- `id`、`type=button`、`role=switch`、`aria-checked`、`aria-label`；
- `disabled` 与 `onClick: () => onChange(!checked)`；
- 本次补齐与官方调用面一致的 `title` 透传。

未修改 `PORTED_CSS`，旧 `dt-switch` 主题只存在于回退分支。

### 2.4 业务调用面不变

未修改 `WatcherSwitch` 与 `WatcherPriority` 两个现有 `Toggle` 调用面，也未改新增表单、行内编辑、字段 schema、状态槽位、保存或提交逻辑。真实渲染验收覆盖每个表单的 3 个普通开关与 5 个优先级开关。

## 3. 测试覆盖

`test/update-ui.test.mjs` 新增可辨识的 `HOST.Switch`，并通过测试捕获点取得真实 `Toggle()`，不是手写复制品。新增 3 条测试：

1. **官方委托**：检查官方组件类型、`checked`、原始 `onChange`、`label`、`disabled`、`title`，以及最小 `span[id]`；同时检查无 `id` 时直接委托，官方路径没有旧主题类或自制 `onClick`。
2. **完整回退**：分别覆盖整个 primitives 缺失、空 exports、仅缺 `Switch`；在 `checked=false/true` 两态检查原生 button+thumb、`id`、`role`、`aria-checked`、`aria-label`、`disabled`、`title` 与 `onChange(!checked)`。
3. **真实调用面**：在新增与行内编辑两种真实面板树中，检查 3 个普通开关和 5 个优先级开关全部委托；核对 8 个唯一 `id`、受控值和 disabled，并实际调用普通/优先级回调，确认仍写回原有 form/draft 槽位。

既有 `test/client.test.mjs` 无需修改。

## 4. 实际执行结果

| 命令 | 真实结果 |
|---|---|
| `timeout 120 node scripts/test.mjs test/update-ui.test.mjs`（修改前基线） | 22/22 通过，0 失败 |
| `timeout 120 node scripts/test.mjs test/update-ui.test.mjs`（修改后） | **25/25 通过，0 失败**；新增 3 条均通过 |
| `timeout 300 npm test` | **612/612 通过，0 失败，0 跳过，0 todo** |
| `timeout 120 node scripts/ui-audit.mjs` | **11/11 通过，100 分** |
| `timeout 30 git diff --check && timeout 30 node --check client.js` | 退出码 0，无输出 |

`ui-audit` 关键计数：可点但不可键盘操作的裸 div=0、自造样式写死颜色=0、图标按钮缺可读名字=0、自造类死代码=0、写死颜色=0、自造 token=0、官方结构采用数=8/8。

## 5. 验收边界

- 本子代理未运行真实 Chromium；真实浏览器中的官方 DOM、双主题、键盘与焦点表现由主线继续验收，本报告不提前宣称通过。
- 未修改 `lib/`、`package.json`、版本号、preflight、派单表或既有业务调用面。
- 未 commit、未 push。

## 6. 主线真实复验

真实 Chromium 新增表单默认显示 3 面普通开关（5 面优先级在高级区未展开）。点击第一面后 `aria-checked=false→true`，SaveBar 继续显示未保存，未提交 mutation；完整面板与 Orbit/Modal 同时通过。
