# L84c · WatcherForm 共用表单实施报告

## 范围

按 `docs/ui-decomp/05-watcher-form-task.md` 完成新增与行内编辑的共用表单。本子任务写入：

- `client.js`
- `test/ui-l84-watcher-form.test.mjs`（新建）
- `docs/报告-L84-WatcherForm.md`（本文件）

未由本子任务修改 `lib/`、其它既有测试、版本文件或派单表，未 commit/publish。另一条子任务的 `test/ui-l84-form-acceptance.test.mjs` 仅作为独立验收运行。

## 实现

1. **一份 schema、一套组件**：`WATCHER_FIELD_SCHEMA` 统一声明基础/高级字段、label、hint、placeholder、条件与控件类型；新增和编辑都调用 `WatcherForm`，不再各维护一套字段顺序。
2. **Field/Fields**：`Field` 输出 `div.dt-field > span.dt-field-head > label[htmlFor]`，把控件 id 与 label 关联；新增/编辑 id 前缀不同，同一表单内 id 唯一。InfoTip 与 label 是兄弟节点，HoursField 的起止输入各有 id，label 内没有交互按钮。`Fields` 使用原生 `fieldset.dt-fieldset`。
3. **渐进披露**：限额、会话上限、优先级、隔离目录与保留策略位于 `DisclosureRow` 内的 `.dt-disclosure-body`，初始 `open=false`，展开后才挂载高级输入。收起摘要中的默认值仍读取 `/state.defaults`。
4. **数字与空值**：数字输入统一 `type=number`、`step=1` 及服务端对应的 min/max（30–3600、1–20、1–60、1–30、1–50）。`numberOrUndefined` 对空串返回 `undefined`，输入渲染保留空串，不把 optional 空值变成 0。
5. **SaveBar 草稿路径**：干净时不挂载；值相对打开快照变化后出现。保存期间本地 busy 锁定并用 fieldset 禁用控件；重复点击不会重复发请求。放弃恢复打开时快照；失败保留 draft、编辑器与原始错误（`role=alert`）。新增成功后把已保存的保留字段作为下一次新增基线。
6. **现有 API 与 touched**：仍只调用现有 `POST /watch`。编辑请求只带定位用 `repo/sessionId` 与 touched 字段；filters/priority 子字段被触碰时保留该块的其它值。新增按输入过的配置提交，未触碰项交给服务端默认值。新增成功只重置既定的 `repo/goal/labels/onlyAssigned/allowAuthors`，保留限额、时段和隔离策略。没有 revision 输入，不伪造 merge3。
7. **边界**：未用 DSH `InlineEditor` 替代多字段表单，未新增 Tab，未改变 `/watch` 契约或行内展开动线。

## 验证记录

| 命令/检查 | 实测结果 |
|---|---|
| `node --test test/ui-l84-watcher-form.test.mjs` | **11/11 通过** |
| `node --test test/client.test.mjs` | **94/94 通过** |
| `node --test test/ui-l84-form-acceptance.test.mjs` | **8/8 通过**（独立验收） |
| 上述三项定向合并 | **113/113 通过** |
| `npm test` | **486/486 通过，0 fail** |
| `node scripts/ui-audit.mjs` | **11/11，100 分** |
| `node scripts/audit-preview.mjs` | **PASS，38 块（含弹层）** |
| `node --check client.js` | 通过 |
| `git diff --check -- client.js` | 通过 |

### 对比度门禁

最后一次运行 `node scripts/audit-contrast.mjs --json` 的机读汇总：

- 浅色：**15 个 failGroups / 245 个 failNodes**；
- 深色：**14 个 failGroups / 184 个 failNodes**；
- 合计 29 个违规组，脚本退出码 **1**。

浅色没有超过任务规定的 **16 组**修复阈值（15 ≤ 16），因此没有为本次新增文字额外放宽或引入新颜色。退出码 1 代表当前预览仍有 WCAG 违规，不能把它写成“全量对比度零违规”。本次未改 `PORTED_CSS` 或颜色 token。

### 窄屏

用 `render-preview.mjs` 生成临时预览，在 Edge headless、视口 **368px** 下逐帧读取 `scrollWidth/clientWidth`：**36 个 preview frame，0 个横向溢出**。临时 HTML/测量输出均写在仓库外的 `D:/tmp/`。

### 覆盖路径

新测试实际点击/调用覆盖：新建与编辑同名字段 DOM 和 label 关联、Disclosure 默认收起/展开、数字约束与空 optional、新建/编辑 dirty/discard、保存中 fieldset 禁用与忙时重入、失败保留输入和错误、编辑 touched-only 请求、新增成功后的既定字段重置及未触碰项不提交。

未宣称完成真实 DSH 宿主 GUI 的鼠标/读屏走查；本次交互证据来自真实 `client.js` 的 harness 点击测试与临时 Chromium/Edge 预览测量。
