# 报告：唤醒 section 稳定化

- 仓库版本：`0.9.261`
- 日期：2026-11-05
- 范围：`lib/watch.js`、`test/wake-sections.test.mjs`、本报告
- 未做：版本修改、contract fixture 修改、commit、publish；未引入编辑器、orchestrator、worker 或多角色结构

## 1. 实现

新增纯函数：

```js
buildWakeSections(repo, items, options) -> Array<{ id, lines }>
```

section 使用稳定 id 和统一 `lines: string[]` 形状。顺序如下；无内容的可选 section 不生成：

1. `header`：仓库与本轮数量（始终存在）
2. `facts`：逐条 issue / PR 事实（始终存在；空输入时为 `[]`）
3. `selection`：为什么是这几条（可选）
4. `overflow`：未展开条目（可选）
5. `isolation`：隔离工作区或隔离失败（可选）
6. `goal`：本条目主理目标（可选）
7. `identity`：提交身份（可选）
8. `access`：权限提示（可选）
9. `criteria`：完成标准（可选）
10. `next`：下一步与 GitHub / Gitee 回写说明（始终存在）

`formatWatchText(repo, fresh, options)` 不再自行组织业务内容，只消费上述 sections：

```js
buildWakeSections(repo, fresh, options)
  .map((section) => section.lines.join('\n'))
  .join('\n')
```

采用两层 `join` 是为了连空 `facts` 的旧空行行为也保持不变。`next.lines` 的第一个元素是空字符串，用于保留收尾前原有的一个空行。

## 2. 注入边界与兼容策略

保留并直接覆盖原有防护行为：

- issue 标题：压平 CR / LF，将 `【` / `】` 分别替换为 `[` / `]`，长标题继续截断并添加省略号。
- goal：压平 CR / LF，内容始终留在 `goal` section 的一行中。
- 测试同时放入伪 `【完成标准】`、`【主理鱼】`、`【隔离工作区】` 和 `接下来：`，验证它们不能制造新的结构段落。
- 完成标准位于 `criteria`；隔离成功 / 失败说明位于 `isolation`；`watch_ack` 与平台回写要求位于 `criteria` / `next`。

本次没有故意修改任何正常输出文案，也没有顺带“修复”旧空行、空白或截断行为。

## 3. 新增测试

`test/wake-sections.test.mjs` 共 7 条：

1. 全量 section 顺序、id 唯一性、统一形状和可重复性。
2. goal 与 issue 标题的换行 / 伪 section 注入边界。
3. 完成标准、隔离成功 / 失败、GitHub / Gitee 回写说明的归属。
4. 空 `items` 与 `null` 的 section 和旧空行快照。
5. 长标题清洗、省略号与全消息行宽不超过 120 字符。
6. 普通输出的旧文本逐字快照。
7. 六个 `wake-samples` 对 0.9.261 旧实现完整文本的 SHA-256 快照。

旧快照哈希在重构前通过 `git show HEAD:lib/watch.js` 加载旧 `formatWatchText` 生成，不是根据新实现反写。

## 4. 真实验证结果

| 命令 | tests | pass | fail | 结果 |
|---|---:|---:|---:|---|
| `node scripts/test.mjs test/watch.test.mjs` | 121 | 121 | 0 | PASS |
| `node scripts/test.mjs test/wake-sections.test.mjs` | 7 | 7 | 0 | PASS |
| `npm test` | 441 | 441 | 0 | PASS |

补充检查：`node --check lib/watch.js`、`node --check test/wake-sections.test.mjs`、`git diff --check -- lib/watch.js` 均通过。

### 旧实现逐字对拍

使用 `git show HEAD:lib/watch.js` 取得旧模块，对同一输入分别调用旧、新 `formatWatchText`；再对合并场景比较旧、新 `mergeWakeTexts`：

```text
IDENTICAL ① 1 条 issue (435/435)
IDENTICAL ② 7 条（超过 batchLimit=5） (892/892)
IDENTICAL ③ 带客户目标 (457/457)
IDENTICAL ④ PR + CI 状态 (432/432)
IDENTICAL ⑤ 带跳过原因 (503/503)
IDENTICAL ⑥ 150 字标题 + 长目标 (635/635)
IDENTICAL ⑦ 合并两个守
RESULT 7/7 identical
```

结论：上述 7 个场景输出逐字兼容，未发现差异。

### `node scripts/wake-samples.mjs --stats`

```text
① 1 条 issue             9 行 / 435 字符 / 最长 106
② 7 条（超过 batchLimit=5）  15 行 / 892 字符 / 最长 106
③ 带客户目标                 10 行 / 457 字符 / 最长 106
④ PR + CI 状态            9 行 / 432 字符 / 最长 106
⑤ 带跳过原因                 10 行 / 503 字符 / 最长 106
⑥ 150 字标题 + 长目标         11 行 / 635 字符 / 最长 120
⑦ 合并两个守                 15 行 / 513 字符 / 最长 105
```

这些统计与重构前记录逐项相同。

## 5. 保留的旧现象（未在本任务修改）

样本②没有给 `restNumbers`，因此旧文本中的 `（另有 2 条：，处理完这批再看）` 在冒号后为空。本任务不允许修改 `scripts/wake-samples.mjs`，且要求逐字兼容，所以原样保留；它不是本次 section 拆分引入的回归。
