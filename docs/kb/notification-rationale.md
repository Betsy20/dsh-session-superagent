# 通知要带「为什么是你」

## 出处
- GitHub 通知的 `reason` 字段（为什么通知你：subscribed / mention / review_requested …）：
  <https://docs.github.com/en/rest/activity/notifications>
- Slack 的摘要把「分组依据」写在摘要里，而不是只堆消息（Slack API 文档 / changelog 里关于 digest 的说明）。
- 共性：**只给结果不给依据，接收方无法判断要不要调整自己的订阅/过滤条件。**

## 它怎么做的
通知内容里带一个可读的「依据」：为什么发给你、按什么分组的、还有多少没发。

## 我们能怎么用
主理鱼的唤醒消息就是"任务书"。原来只有条目列表 + 完成标准。问题是：
会话（和排查的客户）看到 3 条，不知道*为什么是这 3 条*——可能一共 9 条变化，也可能 30 条被过滤掉了。

改法：在消息里加一行

```
【为什么是这几条】本轮共 9 条变化；按「最近更新」取前 3 条；同时跳过 不在标签白名单: ai-fix × 5、机器人 × 3
```

## 是否已落地
✅ 0.8.57（`watch.js:formatWatchText` 的 `whyLine` + `index.js` 传入 `changedTotal / batchLimit / skippedReasons`）。
用例：有依据时必须出现该行、次数 0 的不凑数、没信息时不许硬编一行。

## 还没做的
- 没有做"优先级排序"（现在按 GitHub 的 updated desc 取）—— 真要做需要定义权重（如：指派给我 > 有标签 > 纯评论），
  这属于产品判断，先记着。
