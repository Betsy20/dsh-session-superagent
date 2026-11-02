# 重试也要花预算：花完就该慢下来

## 出处
Google SRE《Handling Overload》：

> We implement a **per-request retry budget of up to three attempts**. If a request has already failed
> three times, we let the failure bubble up to the caller. …
> Secondly, we implement a **per-client retry budget**.

<https://sre.google/sre-book/handling-overload/>

核心不是"退避到多少秒"，而是**重试要有预算**：次数用完后就不该继续按同样的热情重来。

## 现场
我们的 `nextDelayMs` 是指数退避，但**封顶 30 分钟之后就一直是 30 分钟**：

| 连续失败 | 改前 | 改后 |
|---|---|---|
| 1 | 2 分钟 | 2 分钟 |
| 3 | 8 分钟 | 8 分钟 |
| 5 | 30 分钟 | 30 分钟（预算内上限） |
| **6** | 30 分钟 | **最多 2 小时** |
| 20 | 30 分钟 | 2 小时 |

一条凭证失效的守，按改前的节奏会以每 30 分钟一次重试**好几天**（真机就是这个状态：失败 4 次、lastPoll 5 小时前）。

## 改法
```js
export const RETRY_BUDGET_ATTEMPTS = 6
const overBudget = failures >= RETRY_BUDGET_ATTEMPTS
const factor = Math.min(2 ** failures, overBudget ? 120 : 60)
const cap = overBudget ? 2 * 60 * 60 * 1000 : 30 * 60 * 1000
```
并在 `watch_doctor` 里加一行解释：`已连续失败 8 次，重试间隔已放慢到最多每 2 小时一次`。

## 判据
**"很久没动"必须有解释。** 否则客户会把"我们主动放慢了"看成"定时器坏了"——
这和 0.9.96「刚重启 vs 定时器丢了」是同一类误会：**系统状态变化，必须能被读出来**。

## 是否已落地
✅ 0.9.121。新增 1 例（doctor 解释）+ 更新 1 例（退避取值，含 30s/60s 两种基准）。

## 还没做的
- 预算只在"连续失败"上计数，成功一次就清零 —— 没有"跨天累计"的客户端级预算；
- 没有把"当前退避档位"展示在面板上（只有 doctor 里有）。
