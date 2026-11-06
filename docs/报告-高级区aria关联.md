# WatcherForm 高级区 aria 关联修复报告

## 结论

已补齐高级区 Disclosure 的 `aria-controls` / body `id` 关联。新增与行内编辑分别通过既有 `idPrefix` 生成稳定且互不冲突的 `bodyId`；展开时 id 落在真实的 `.dt-disclosure-body` 上，收起时 body 仍按原行为卸载。未改 Orbit、样式、展开/收起状态机、键盘处理或草稿提交逻辑。

## 实现

- `client.js` 的 `DisclosureRow` 新增可选 `bodyId`，trigger 输出 `aria-controls={bodyId}`。
- 单元素展开内容复制 React element 并补同名 `id`，因此高级区原有 `.dt-disclosure-body` 不增加额外 wrapper；非单元素内容才使用无 `className`、无 `style` 的语义 wrapper。
- `WatcherForm` 传入 `bodyId: idPrefix + '-advanced-body'`：
  - 新增：`watcher-new-advanced-body`；
  - 编辑：`watcher-edit-<encodeURIComponent(watcher.id)>-advanced-body`。
- 未给 `CollapsibleList` 传 `bodyId`，其渲染路径保持原样；Orbit 未改。

## 回归覆盖

`test/update-ui.test.mjs` 新增一条同时遍历新增、行内编辑两棵组件树的用例，覆盖：

1. 默认收起时 `aria-expanded=false`、`aria-controls` 已声明且 body 不挂载，收起摘要保留；
2. Enter 展开后，`aria-expanded=true`，真实 `.dt-disclosure-body.id === trigger['aria-controls']`；
3. 两棵树同时展开所得 bodyId 不重复；
4. Space 收起后 body 卸载、`aria-expanded=false`、关联声明与收起摘要恢复；
5. Enter/Space 均调用 `preventDefault()`，每次只切换一个 open 状态，草稿槽位引用不变。

修复前先运行新增用例，实际结果为 **25 通过 / 1 失败**，失败值为 `aria-controls === undefined`，证明用例能抓住原缺陷。

## 最终验证

| 命令 | 真实结果 |
|---|---|
| `timeout 180s node --test test/update-ui.test.mjs test/client.test.mjs test/ui-l84-form-acceptance.test.mjs` | **128/128 通过，0 失败** |
| `timeout 180s node --test --test-name-pattern='预览快照里的字段\|/state 字段契约\|WatcherForm 高级区' test/preview-contract.test.mjs test/routes.test.mjs test/update-ui.test.mjs` | **3/3 通过，0 失败** |
| `timeout 300s npm test` | **613/613 通过，0 失败** |
| `timeout 120s node scripts/ui-audit.mjs --json` | **11/11 通过，100 分** |
| `timeout 120s node scripts/check-docs.mjs` | **5 项 PASS**；扫描 310 篇 Markdown、238 个内部链接目标 |

`ui-audit` 关键原始计数：可点但不可键盘操作的裸 div **0**、写死颜色（自造样式及含 inline/JS）**0**、自造 token **0**、自造类死代码 **0**、缺名图标按钮 **0**、官方结构采用 **8/8**。

过程记录：首次全量为 **611/613**；两处字段契约扫描把局部变量 `body.props` 误识别为 `/state` 字段。仅把该局部变量改名为 `content` 后，两个契约用例与全量均通过；未修改契约、后端或扫描器。

## 边界与交接

- 改动文件仅为 `client.js`、`test/update-ui.test.mjs` 和本报告；`test/client.test.mjs` 只运行、未修改。
- 本执行者未运行 `git commit` 或 `git push`。最终核验时分支 HEAD 已外部前进到 `6dd9aa9`（`fix: 补齐高级区 aria-controls 与 body id`），其中已包含前两个文件的本任务改动。
- 本任务未启动真实 Chromium、未生成 GUI 截图；以上结果来自真实客户端 UMD 的 Node 组件树测试与静态 UI 体检。主线继续执行真实 Chromium 严格断言复验。
