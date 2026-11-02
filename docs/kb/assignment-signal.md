# 「有没有人认领」如实标注，但别偷偷加权

## 出处
- issue 对象的 `assignees` 数组；GitHub 过滤语法里有现成限定词 `assignee:octocat`，
  我们自己的 `onlyAssigned` 过滤器就基于它。
  <https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/filtering-and-searching-issues-and-pull-requests>
- **坦白**："无人认领更紧急"属于团队经验，本轮没有找到 GitHub 官方的优先级建议，
  所以它**不能被当成规则**写进默认权重。

## 它怎么做的
GitHub 只提供事实（谁被指派了），不提供"因此谁更紧急"的判断。

## 我们能怎么用
1. **如实标注**：唤醒消息里给无人认领的条目加一句 `未认领` —— 这是事实，不需要理由；
2. **加权默认关闭**：想用的人自己去面板打开「未认领优先」（+3 分），
   默认不加，避免把我们的判断变成别人的。

这个分寸是刻意的：**事实默认展示，判断默认关闭。**

## 是否已落地
✅ 0.8.77（`watch.js:assignmentNote` + 消息行尾标注 + `priority.unassigned` 默认 false + 面板开关）。
用例：null / 有指派 / 空数组 / 缺字段；消息里出现"未认领"；默认 0 分、开启后 +3、已认领不加分。

## 还没做的
- 没区分"指派给别人"还是"指派给我"（要 `viewer`，已有缓存但没用在这）；
- 没做"指派变更"的通知（要 timeline，成本高）。
