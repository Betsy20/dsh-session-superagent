# 代理拦下来的时候，你收到的是网页，不是 JSON

## 出处
- 与 [空响应先查凭证，再谈代理](empty-response-check-credentials-first.md) 互补：
  上一轮解决"空的怎么办"，这一轮解决"不空但根本不是 JSON 怎么办"。
- GitHub 的限流文档要求 secondary/abuse 限流**至少等一分钟**再重试
  （本轮网络不可达，未复核原文）：
  <https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api>

## 现场
抓到的两条真实状态（同一台机器、相隔几分钟）：

| 场景 | gh 输出 | 我们的提示 |
|---|---|---|
| 代理 502 | 一个 HTML 页面 | `返回内容不是合法 JSON（可能是代理干扰）` ← 含糊 |
| 正常 | `HTTP/2.0 200 OK` + `[]`（**2 字节**） | 正常处理 |

"可能是代理干扰"这句话，对客户来说等于没说：他不知道自己该看代理设置、还是该改代码。

## 改法
新增 `diagnoseBadBody({ bodyText, authStatusText })`：

| body | 分类 | 提示 |
|---|---|---|
| 空 | 走 `diagnoseEmptyBody`（先判凭证） | 登录 / 看 watch_doctor |
| 像 HTML/网关页（`<!DOCTYPE`、`<body`、`Bad Gateway`） | `gateway` | **返回的是网页而不是 JSON：本地代理/网关拦了请求 —— 检查代理设置** |
| 合法 JSON | `null` | 不诊断 |

顺带：限流分支在服务端没给 `Retry-After` 时兜底 **60 秒**（此前会立刻重试）。

## 判据
**"看起来不像我们的数据"本身就是一个分类依据。**
收到 HTML、收到登录页、收到 `<html>502`，这些都不是"解析失败"，而是"请求根本没到对端"。

## 是否已落地
✅ 0.9.132。新增 1 例（HTML → gateway；合法 JSON 不报；空内容仍先判凭证）。

## 还没做的
- 只认 HTML/网关关键词；被运营商劫持成其它格式（如纯文本提示）仍会落回"不是合法 JSON"；
- `abuse detection` 的具体等待时长仍是统一 60 秒，没有按文档的分级建议。
