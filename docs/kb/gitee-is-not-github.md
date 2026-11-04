# Gitee 不是「换了个域名的 GitHub」

## 出处
- Gitee OpenAPI v5：<https://gitee.com/api/v5/swagger>
- 真机需求：用户要盯 `Ghandi/workbuddy-pro`（Gitee），而插件只认 `gh` CLI + `api.github.com`。

## 现场（五处不一样，每处都会静默出错）

| 维度 | GitHub | Gitee | 只改 base URL 会怎样 |
|---|---|---|---|
| 认证 | `gh` CLI 登录态 / `GH_TOKEN` | 私人令牌（`token xxx`） | 401 一片 |
| 状态值 | `open` / `closed` | 还有 `progressing` / `rejected` | 「进行中」被当成关闭 → 永远不叫醒 |
| PR 列表 | `/issues` 里带 `pull_request` | 走独立 `/pulls` | PR 完全看不见 |
| 批量评论 | GraphQL 一次查 N 条 | 没有 GraphQL | 每条一次请求，或者直接崩 |
| 条件请求 | ETag/If-None-Match → 304 不计额度 | 没有 ETag | 以为在省额度，其实每轮全读 |

## 判据

**「同一个 API，换个域名」这个假设永远是错的。** 接入第二家之前先回答四件事：

1. **认证怎么走**（谁能替代 CLI）；
2. **状态/枚举有没有第三方值**（不是 `open/closed` 二元）；
3. **哪些数据在别的端点**（PR、评论、标签）；
4. **省额度的手段还在不在**（ETag / GraphQL / 批量）。

## 我们怎么做的

新增 `lib/gitee.js`，只做三件事：请求、归一化、失败分类。
**归一到和 GitHub 一样的条目形状**，然后把 `pollOnce` 里「拿到一页之后的所有事」
抽成 `pollWithItems()`，两家共用 —— 「怎么拿数据」分家，「要不要叫醒 / 说什么 / 水位怎么走」绝不分家，
否则同一条 bug 要修两遍。

## 是否已落地
✅ 0.9.177：`lib/gitee.js`（8 条用例）+ `parseRepoSpec`（认 `gitee:` 前缀与 gitee.com URL）
+ 轮询/评论/ack/doctor 四处分支 + 面板「Gitee 令牌」。

## 补记（0.9.182）：Gitee 缺的字段要用「上一轮」补

Gitee 的 issue 条目**没有 `state_reason`** —— 于是「重新打开（reopened）」这个信号在它上面永远不出现，
连带 ⚠ 标记和 +100 加权一起失效。

判据：**第三方缺的字段，先问「上一轮的值算不算它的定义」。**
reopen 的定义就是「上一轮 closed、这一轮 open」—— 本来就不需要服务端字段。
`markGiteeReopened(items, lastStates)` 用一张编号→状态的表自己判，判出来写回 `state_reason`，
下游一行不用改。**只在 Gitee 上调用**：GitHub 有原生字段，覆盖它等于篡改事实。

## 还没做的
- Gitee 没有 ETag，**额度消耗比 GitHub 高**，目前只靠轮询间隔控制；
- Gitee 的「标签必须先存在」还没做自动创建（GitHub 那边会幂等建）；
- 多仓库跨平台（GitHub 一条、Gitee 一条）没有联调过真机。

## 补记（0.9.182）：门禁不能并发跑 —— 它们会互相改文件

真机事故：一个早先启动的 `preflight --fast` 进程没退干净，和后来的 `regression-cases.mjs` 同时跑。
反向用例会**临时改坏** `package.json` / `client.js` / `README.md` 再还原；
两个进程交错之后，后一个把前一个的注入当成了 `original`，于是：
- `client.js` 里永久留下 `ZZ_DUP` 两行；
- `package.json` 的 `files` 永久少了两项（`lib/body.js`、`lib/gitee.js`）；
- `README.md` 的单测数永久变成 `9999`。

判据：**任何「先改坏再还原」的检查，都是全局独占资源。**
落地：`regression-cases.mjs` 开工前给所有会被改的文件各留一份快照，跑完 `restoreAll()` 兜底；
以及（本条最重要）**看到「改坏后 code=0 / 还原后 code=1」这种反号结果，先查是不是有另一个进程在同时改文件**。
