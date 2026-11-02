# GitHub 会告诉你「多久之后再问」——听它的

## 出处
GitHub《Best practices for using the REST API》：
> If you cannot use webhooks and you must poll the API, poll as efficiently as possible…
> - Poll only as often as you need to, on a fixed schedule. **If a response includes an `x-poll-interval`
>   header, wait at least that many seconds before you poll the same endpoint again.**
> - Make authenticated conditional requests…
> - **Repeatedly requesting a missing resource wastes your rate limit and can trigger a secondary rate limit.**

<https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api>

## 我们原来怎么做的
- 轮询间隔只由用户配置（默认 60 秒）决定，**完全忽略响应头**；
- 失败退避只按指数增长（上限 30 分钟），**不区分"网络抖动"与"这个仓库根本不存在"**。

## 现在怎么做的
1. `parseGhInclude` 解析 `x-poll-interval`；
2. 实际间隔 = `max(配置间隔, x-poll-interval)`，**成功路径也生效**（此前 `nextAt` 只在失败时设置、成功后清空，下限等于没用）；
3. 永久性错误（`notfound` / `moved`）用 `permanentBackoffMs()`：**至少 30 分钟**再试。

## 踩到的一个坑
`Number(null) === 0`，于是"没有 `x-poll-interval` 头"会被解析成 **0 秒下限**。
必须先判断 header 是否存在再转数字 —— 这类 bug 不会报错，只会让功能静默失效。

## 判据
**凡是协议里"服务器告诉你的节流/间隔提示"，都要当成下限而不是建议。**
它们通常免费提供，忽略它们是最容易被忽略的浪费。

## 是否已落地
✅ 0.9.114。新增 2 例（解析 + 永久退避取值）。

## 还没做的
- `github` 工具（任意 REST 调用）没有同样的 404 长退避；
- 没有统计"304 命中率"来验证间隔调整是否真的省了额度（需要真机埋点）。
