# CI 红绿：零成本拿到，值得展示

## 出处
- GraphQL `PullRequest.statusCheckRollup.state`（`SUCCESS` / `FAILURE` / `PENDING` / `ERROR` / `EXPECTED`）
  <https://docs.github.com/en/graphql/reference/objects#pullrequest>
- 本机实测：把 `statusCheckRollup { state }` 加进**已有的** cross-reference 查询，
  返回 `"statusCheckRollup":{"state":"SUCCESS"}` —— **没有多一次请求**。

## 上一轮的顾虑与实测结论
上一轮我担心"要多一轮联合查询"，所以先没做。实测结论：**不用**。
它只是同一个 union 片段里多一个字段，请求数不变、响应体积可忽略。

## 我们能怎么用
「该不该我接管这个 PR」的第三个依据：
- `FAILURE` / `ERROR` → `·CI 失败`（可能是可修的，值得看）
- `PENDING` / `EXPECTED` → `·CI 运行中`（等结果，别急着下结论）
- `SUCCESS` → **不显示**（绿的不用提，避免噪音）

## 是否已落地
✅ 0.8.83（查询加 `statusCheckRollup`；解析带出 `ci`；`linkedPrNote` 叠加 `·CI 失败` / `·CI 运行中`）。
用例：FAILURE/PENDING 会显示、SUCCESS 不显示。

## 还没做的
- 没取具体失败的 job 名（要多一层 `contexts`，体积大）；
- 没把 CI 失败用于优先级（先只提示）。
