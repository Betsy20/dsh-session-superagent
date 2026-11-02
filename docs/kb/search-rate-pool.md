# search 池：30 次/分钟，别拿它当 core 用

## 出处
- GitHub REST《Search repositories》：<https://docs.github.com/en/rest/search/search#search-repositories>
- **本机实测响应头**（2026-11-02）：
  ```
  gh api --include "search/repositories?q=dsh&per_page=1"
  X-Ratelimit-Limit: 30
  X-Ratelimit-Remaining: 28
  ```
  对照 core 池实测 `X-Ratelimit-Limit: 5000` —— **两个池差 166 倍**。

## 它怎么做的
按 `X-RateLimit-Resource` 分池记账，各池独立 `Remaining` / `Reset`。
搜索还有"每分钟"这种更细的窗口（与 core 的按小时不同）。

## 我们能怎么用
本轮加了「仓库名纠错」：填错仓库 → 404 → 用 `search/repositories` 找最像的一个，提示"是不是想填 X？"。

正因为 search 只有 **30 次/分钟**：
- 只在 **404 之后**才调用（正常路径一次都不调）；
- 名字短于 5 个字符不搜（噪声大、命中率低）；
- `per_page=5`，拿到就停，不做分页；
- 失败（含被限流）**静默放弃**，绝不影响添加流程。

## 是否已落地
✅ 0.8.69（`watch.js:pickSuggestion` + `index.js:precheckRepo` 的 404 分支）。
用例：同名优先、包含关系次之、完全不相关不乱猜、空输入/无候选不崩。

## 顺带把知识库第 16 条补实
之前那条只写了"限流分池"的准则，现在有了**具体数字**（core 5000 / search 30），
以后要给 search 加功能时，按 30 次/分钟设计即可。
