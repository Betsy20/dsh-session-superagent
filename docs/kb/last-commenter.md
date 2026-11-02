# 叫醒一个人时，先告诉他"有没有人已经在处理"

## 出处
- GitHub REST《List issue comments》：`GET /repos/{owner}/{repo}/issues/{issue_number}/comments`
  支持 `sort=created&direction=desc&per_page=1`，一次就能拿到最新一条。
  <https://docs.github.com/en/rest/issues/comments#list-issue-comments>

## 它怎么做的
评论是**独立资源**，不在 issue 对象里（issue 只带 `comments` 计数）。要"最后一条评论是谁"，
必须单独取一次 —— 所以这是**有成本的**信息。

## 我们能怎么用
会话被叫醒后第一件事是判断「是不是已经有人处理了」。我们原来只给：
issue 作者、更新时间、标签、指派。问题是：**更新时间可能是我自己打标签引起的**，
而作者永远是开 issue 的人 —— 真正该看的是最后一条评论。

改法（成本受控）：
- 只对批次**前 3 条**且 `comments > 0` 的条目取；
- 并发取，单条 12 秒超时；
- 失败**静默省略**这一行，绝不阻断唤醒；
- 消息里呈现为 `最后评论: @helper 2026-11-02T07:00:00Z`。

## 是否已落地
✅ 0.8.70（`watch.js:commentSummaryLine` + `index.js:fetchLastComments`）。
用例：null/空对象给空、只有 login 也能出、完整信息拼成一行、消息里出现「最后评论: @helper」。

## 还没做的
- 没有取评论**正文摘要**（能更有用，但要多传一份数据，先不做）；
- 没有区分「评论是我发的」还是「别人发的」（`viewer` 是当前 token 的 login，可加，但要多存一个字段）。
