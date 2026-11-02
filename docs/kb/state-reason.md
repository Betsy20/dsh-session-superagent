# 「之前判过不做」又被重开，才是该看的信号

## 出处
- GitHub REST《Issues》：issue 对象带 `state_reason`（`completed` / `not_planned` / `reopened`）。
  本机实测 `cli/cli` 最近 5 条里 4 条是 `not_planned`、1 条是 `null`。
  <https://docs.github.com/en/rest/issues/issues>

## 它怎么做的
- `completed`：正常完成关闭；
- `not_planned`：明确"不做"；
- `reopened`：**被重新打开**（说明之前的关闭被推翻）。

## 我们能怎么用
主理鱼默认跳过 closed 条目。但有一种 closed 状态特别值得看：
**判过 not_planned 之后又被重开** —— 这说明"不做"的判断被推翻了，或有人在坚持。

改法：
1. 轮询时记住最近一条 `state_reason === 'reopened'` 的 issue 号（`entry.lastReopened`）；
2. 唤醒消息里给重开的条目加 `⚠ 这条被重新打开过（之前关过，判"不做"可能不对）`；
3. 面板「需要关注」显示 `o/r #N 被重新打开过`；
4. **正常的 `not_planned` / `completed` 在消息里不提示**（不喧哗）。

## 是否已落地
✅ 0.8.74（`watch.js:stateReasonNote` + `index.js` 记 `lastReopened` + 面板 problems）。
用例：null/无原因不吭声、reopened 有警示、not_planned 与 completed 的行文、消息里只有重开带 ⚠。

## 还没做的
- 没有统计"重开次数"（要查 timeline，成本高）；
- 没有把重开当成"优先级提升"（可考虑：重开的条目排到批次最前）。
