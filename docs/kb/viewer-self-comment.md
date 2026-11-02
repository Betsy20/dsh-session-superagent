# 「最后一条评论是我发的」≠「有人在处理」

## 出处
- GitHub REST《Get the authenticated user》：`GET /user` 返回当前 token 对应的账号。
  本机实测：`gh api user --jq .login` → 我们的账号名。
  <https://docs.github.com/en/rest/users/users#get-the-authenticated-user>

## 它怎么做的
REST 用 `/user` 表示"我是谁"（GraphQL 里叫 `viewer`）。拿到它就能把"我干的"和"别人干的"分开。

## 我们能怎么用
上一轮我们给唤醒消息加了「最后评论: @helper 时间」。但如果最后一条**是我们自己**发的
（上一轮唤醒时留下的回复 / ack 评论），会话会误判成"已经有人在处理了"，于是什么都不做 ——
这正是最坏的一种静默失效。

改法：取评论时同时拿到 `/user`（缓存 10 分钟），比较后标记 `self: true`；
消息里呈现为 `最后评论: 我（上一轮留的） 2026-11-02T06:00:00Z`。

边界：
- 大小写不敏感（GitHub 登录名不区分大小写）；
- 拿不到"我是谁"时**照常显示 @login**，不猜；
- 多一次 `/user` 调用，但 10 分钟缓存一次，可忽略。

## 是否已落地
✅ 0.8.71（`watch.js:commentSummaryLine` 增加 `viewer` 参数 + `index.js:viewerLogin` + `fetchLastComments` 标记）。
用例：@helper 原样、`ME` vs `me` 识别为自己、不知道我是谁时照常、消息里出现"我（上一轮留的）"。

## 还没做的
- 没有把 self 信息用到判定上（比如"我评论过但没关单"→ 提醒换个做法），只做了展示；
- 面板上暂时看不到这条信息（只在唤醒消息里）。
