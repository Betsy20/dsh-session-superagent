# 按剩余额度自适应降频

## 出处
- GitHub REST 限流文档：<https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api>
- **更硬的证据**（本次直接抓的真实响应头，2026-11-02）：
  ```
  gh api --include "repos/MYCF711/dsh-session-superagent/issues?state=all&per_page=1"
  X-Ratelimit-Limit: 5000
  X-Ratelimit-Remaining: 4771
  X-Ratelimit-Reset: 1793608466      ← unix 秒，重置时刻
  X-Ratelimit-Resource: core
  ```

## 它怎么做的
GitHub 每个响应都带这三个头。`Remaining` 是**当前窗口剩余次数**，`Reset` 是窗口重置的绝对时间。

## 我们能怎么用
主理鱼最坏情况：客户挂 10 条守、间隔 60s → 每小时 600 次请求，一天 14,400 次，
而 core 额度是 **5000/小时**。也就是说「间隔 60s + 多条守」是会真的把额度打光的，
之前的行为是继续按间隔撞墙，然后每条守都开始报 403。

改法：每轮读 `Remaining`，低于 **500** 时把下一轮直接推到 `Reset`（+1 秒缓冲，最多等 1 小时），
并在 `lastDeferred` 写明「额度紧张（剩余 N），已推迟到 HH:MM」——客户在面板上看得见，不是静默变慢。

## 是否已落地
✅ 0.8.53（`lib/watch.js:parseGhInclude` 读三个头 + `throttleDelayMs`；`lib/index.js` 轮询路径接入）。
用例：真实头格式解析、充足不推迟、紧张推到重置、超 1 小时封顶、重置已过不推迟。

## 还没做的
- 没有区分 `resource`（core / search / graphql）：将来若改用 search API，需要按 resource 分别记额度；
- 没读 `Retry-After`（主要在 secondary rate limit 时出现），遇到它会走普通退避。
