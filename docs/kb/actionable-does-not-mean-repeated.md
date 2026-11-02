# Actionable 不等于"把同一份指令印 N 遍"

## 出处
Google SRE 书《Monitoring Distributed Systems》：

> **Every page should be actionable.** … Every time the pager goes off, I should be able to react
> with a sense of urgency. I can only react with a sense of urgency a few times a day before I become fatigued.

<https://sre.google/sre-book/monitoring-distributed-systems/>

原文讲的是"告警必须可行动"，但**可行动 ≠ 重复**：同一份指令出现三次，读者只会更快跳过它。

## 现场
我们的唤醒消息（本质就是一条 page）结构是：
```
【主理鱼】owner/name 有 N 条新动态：
…每条明细…
【完成标准】…
接下来：
1. 先读仓库 AGENTS.md 的判断规则，再决定「修 / 回 / 待定」；
2. 没有测试结果不算完成；
3. 做完一条就写回 GitHub，并调用 watch_ack。
```

多条合并时（`mergeWakeTexts`），**每条都带一份「接下来」**，3 条就是 3 份完全相同的指令。
原先只去重了【完成标准】和「本条目主理目标」，漏了这段收尾。

## 改法
剥掉每条里的 `接下来：` 之后的部分，最后**统一附一份**；
每条自己的完成标准仍各自保留（内容不同，合并会丢信息）。

## 证据（3 条合并，实测）
| | 长度 | 「接下来」出现次数 |
|---|---|---|
| 改前 | 309 字符 | **3** |
| 改后 | 259 字符 | **1** |

长度只净省 50（合并会补上「—— 第 N 处 ——」分隔行），真正改善的是**读感**。

## 判据
**合并类消息要问两个问题**：
1. 哪些段落是"每条都有、且内容相同"（→ 只留一份）？
2. 哪些段落"看着相同、其实不同"（→ 必须每条都留）？
判错任一边都会出事：前者让消息变噪音，后者让你丢信息。

## 是否已落地
✅ 0.9.120。新增 1 例（「接下来」恰好 1 次 + 每条完成标准都在 + 净省 > 30）。

## 还没做的
- 收尾文案目前是写死的三条，没有按仓库定制（不同仓库的判断规则其实不一样）；
- 没有统计"合并消息被读完后是否真的执行了"（需要真机埋点）。
