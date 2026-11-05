# 先查你有没有写权限，再让它跑起来

## 出处
- GitHub REST《Get a repository》：`GET /repos/{owner}/{repo}` 的响应里有
  `permissions: { admin, push, pull, maintain, triage }` —— 就是「你对这个仓库能做什么」的权威答案。
  <https://docs.github.com/en/rest/repos/repos#get-a-repository>

## 它怎么做的
把权限当成**仓库对象的属性**返回，调用方在读之前就能知道自己能不能写，而不必试一次拿 403。

## 我们能怎么用
主理鱼要在仓库里回写（评论 + 打标签）。如果客户用了一个只有读权限的 token，
现象是：守能建、能被叫醒、然后会话去评论 → 403 → 白跑一轮。

改法：新增守时**后台**查一次（不阻塞创建），把 `push` 存进 `entry.repoAccess`；
`push === false` 时唤醒消息里多一行：

```
【权限提示】你对 o/r 只有读权限：能看、能被叫醒，但没法回写评论或打标签 ——
要么换有写权限的 token，要么把结论写在本地/PR 描述里。
```

不确定（还没探测）时**不提示**，不猜。

## 是否已落地
✅ 0.8.64（`watch.js:accessNote` + `index.js:probeAccess`）。
用例：有写权限不提示、null/空对象不提示、只读给出人话、消息里单独成行。

## 还没做的（没有）
两个都做完了，见下。

## 已落地
- 面板上的能力徽章已渲染（`repoBadges(repoAccess)`，只读 / fork / 关闭 Issues 都在）；
- private 仓库单独提示也已接（同一个徽章源）。
