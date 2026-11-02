# 要不要把主轮询换成 GraphQL？—— 先测，再决定（结论：不换）

## 出处
- GitHub GraphQL 列表查询（`issues(first:, orderBy:)` + `comments(last:1)`）：<https://docs.github.com/en/graphql>
- GitHub 条件请求（我们已用的 ETag/304）：<https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api>

## 数字（本机实测，`scripts/bench-api.mjs` 可复现）
`MYCF711/dsh-GOKifu-compact`：
```
REST 列表(20, --include): 769ms，13.9 KB（含响应头）
GraphQL 列表(20, 含最后评论): 709ms，1.0 KB
取最后评论(3 条): 逐条 1786ms vs 批量 439ms
```
`cli/cli`（大仓库，20 条满载）：
```
REST 列表(20, --include): 1418ms，113 KB
GraphQL 列表(20, 含最后评论): 1067ms，6.9 KB
```

## 结论：**主路径不换**，理由
1. 我们已经用 ETag：**没变化时整轮是 304，零解析、零传输**。GraphQL 没有等价的条件请求用法，
   换过去等于把"大多数轮次几乎免费"变成"每轮都拉一遍数据"——净亏。
2. GraphQL 的优势（体积小 10~16 倍、一次带评论）只在**确实有变化**时才兑现，
   而我们的批次大小 ≤5 条，评论请求已在 0.8.72 里批量化了（逐条 1786ms → 批量 439ms，**快 4 倍**）。
3. 主路径是核心，改动风险高；收益要靠侧证，**侧证不支持**就不动。

## 顺带证伪的一个"想当然"
"用 `state=open` 代替 `state=all` 能减小响应" —— 实测同一仓库同样 20 条：
`all` 113,895 字节 vs `open` 130,274 字节（**反而更大**，因为返回的是不同批 issue）。
所以这条优化**不做**。

## 是否已落地
✅ 交付物是**可复现的基准脚本** `scripts/bench-api.mjs`（`node scripts/bench-api.mjs owner/name`），
以及"不动主路径"的决定本身。0.8.73 里没有改主轮询逻辑 —— 这是有意识的选择，不是遗漏。
