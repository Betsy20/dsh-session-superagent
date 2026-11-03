# 空响应先查凭证，再谈代理

## 出处
GitHub 排障文档在"结果不对"时的第一步就是确认凭证：

> If you are using pagination correctly and still do not see all of the results that you expect,
> you should **confirm that the authentication credentials** that you used have access…

<https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api#missing-results>

## 真机现场（09:00 时段开门后的真实轮询）
```
serverVersion: 0.9.116
- MYCF711/dsh-go | 启用 | 失败 5 | nextAt 2026-11-03T01:30:27.698Z
  lastError: 返回内容不是合法 JSON（可能是代理干扰）—— 已按退避自动重试
```

时段到了它确实在轮询（`nextAt` 排到 09:30），但**失败原因归错了类**：
真实原因是 `gh` 令牌失效 → **输出为空** → `JSON.parse('')` 抛错 → 我们甩锅给"代理"。
客户会去查一个不存在的代理，而正确动作是 `gh auth login`。

## 改法
纯函数 `diagnoseEmptyBody({ bodyText, authStatusText })`：

| 情况 | 分类 | 提示 |
|---|---|---|
| 空内容 + 凭证失效 | `auth` | `跑 gh auth login 重新登录` |
| 空内容 + 凭证正常 | `empty` | `可能是代理拦截或未登录 —— 跑 watch_doctor 看凭证` |
| 有内容 | `null` | 不诊断 |

解析失败时**先跑一次 `gh auth status`**（60 秒缓存，只在失败路径），判为 `auth` 时置 `needsReauth` 并走 30 分钟退避。

## 判据
**"空"是最容易被误分类的输入。** 空文件、空响应、空列表 —— 它们既可能是"没问题但没数据"，
也可能是"根本没拿到数据"。在归因之前，先问一句：**我有没有可能连请求都没成功？**

## 是否已落地
✅ 0.9.124。新增 1 例（三种情况）。

## 还没做的
- 只在轮询路径做了；`github` 工具拿到空内容时仍是"empty"提示，没有查凭证；
- `gh auth status` 是额外一次进程调用（失败路径上可接受，但没测过耗时）。
