# L84c · WatcherForm 共用表单任务书

> 前置：T48（确认与 DecisionLine）完成后单独施工；同文件单写者，不与弹层迁移并行改 `client.js`。

## 目标

新增表单与行内编辑器共用一套 `WatcherForm`，直接复用 superagent `Field / Fields / DisclosureRow / SaveBar` 的结构；保持主理鱼 API 与字段语义不变。

## 可写路径

- `client.js`
- 新测试文件（待写，实施时按功能命名）
- `docs/报告-L84-WatcherForm.md`（新建）

## 必做

1. `Field`：`div.dt-field + label[htmlFor]`，input 有唯一 id；label 内不得嵌 InfoTip 按钮或 HoursField 按钮。
2. 新建与编辑使用同一字段 schema 和同一组件，不复制两套 label/hint/note/control 顺序。
3. 基础字段首屏保留；限额、会话上限、隔离保留策略等高级项进 `DisclosureRow + .dt-disclosure-body`，默认收起。
4. 数字字段使用 `type=number / min / max`；optional 空值保持空，不在 UI 偷换成 0。
5. `SaveBar`：干净时不显示，修改后出现；保存中 fieldset 禁用；放弃恢复打开时快照；失败保留输入和错误。
6. 保存仍走现有 `/watch`，只提交 touched 字段；新增成功后只重置既定字段。没有 revision，不伪造 merge3。
7. 不把多字段表单替换为 DSH 单文本 `InlineEditor`；不增加 Tab、不改行内展开动线。

## 验收

- 新增/编辑同名字段 DOM 一致；
- 高级项默认收起，展开后完整；
- 数字 min/max 与空 optional 正确；
- dirty/busy/error/discard 四条路径有真实点击测试；
- 保存请求体仍只带 touched 字段；
- 窄屏无横向滚动；
- `npm test` 全绿，`scripts/ui-audit.mjs` 通过。

## 不做

- 不搬官方 Prompt 编辑器、Provider、Ticket 详情页；
- 不改 `/watch` 契约；
- 不重写隔离、activeHours 等业务逻辑；
- 不在本任务替换 Toast/Tooltip/StatusOrbit 定位（另属 L84b）。

## 用户实拍后的补充（当前优先）

- 「展开像只读」不能靠测试桩宣称已解决；必须记录真实输入、焦点与保存路径。静态预览已证明没有 `disabled/readonly`，事件链仍在 T55 复现。
- 表单外壳按官方 DraftEditor 使用 `form.dt-card + Fields + SaveBar`，不能只给裸 `dt-form` 放在 ticket 里。几何、间距、分组和底部保存条以官方为准，不自创布局。
- `scripts/render-preview.mjs` 已补「行内编辑」与「行内编辑（已修改）」两个场景；以后改表单必须出这两张图，不能只截总览。
- 若官方证据不足，按项目 AGENTS 的硬约束 HIDE/留空或保留 superagent 同源实现，禁止自定义布局补位。
