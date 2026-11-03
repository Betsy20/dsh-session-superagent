# 断路器不是"重试更慢"，而是"这次根本不发"

## 出处
Martin Fowler《CircuitBreaker》：

> Once the failures reach a certain threshold, the circuit breaker trips, and **all further calls to the
> circuit breaker return with an error, without the protected call being made at all.**

<https://martinfowler.com/bliki/CircuitBreaker.html>

关键区别：**退避是"晚点再试"，断路器是"明知会失败就不发"**。两者可以并存，但不能互相替代。

## 现场
0.9.124 已经能识别"凭证失效"（`needsReauth`），但**只有轮询路径**用它：
`github` 工具与 `repo_here` 仍会照常 spawn `gh`，拿到空内容再走一遍诊断 —— 典型的"明知会失败还去调"。

真机背景（本轮实测）：
```
- MYCF711/dsh-go | fails 4 | nextAt 2026-11-03T02:40:27.997Z
  lastError: gh: HTTP 502（GitHub 或本地代理短暂故障）
```
外部网络此刻也不健康，多一次调用就是多一次必然失败的进程。

## 改法
1. 抽出 `isAuthBroken()`（`diagnoseEmptyBody` 复用它，避免两处正则各写一份）；
2. `gh auth status` 结论缓存 60 秒；两个工具在**已知失效**时直接返回：
   `[error: 凭证已失效，本次没有发起请求] 跑 gh auth login 重新登录后再试`
3. 缓存过期/为空时照常调用。

## 判据
**"晚点再试"和"这次别试"是两种策略。** 对于"人必须先去修"的失败（凭证、权限、地址错了），
继续发请求只会产生更多同样的错误和更多噪音。

## 顺带撞到的门禁
两个工具里我写了两份相同的返回文案，`整句文案不重复` 当场报红（`x2 lib/index.js`），
抽成 `AUTH_BROKEN_REPLY` 常量才过 —— **门禁又一次替我发现了复制粘贴**。

## 是否已落地
✅ 0.9.125。新增 1 例（缓存失效 → 短路；缓存清空 → 恢复调用）。

## 还没做的
- 短路只覆盖 `github` / `repo_here`，其它内部调用（如 ack 打标签）没走同一个开关；
- 缓存是进程内的，重启后第一条请求仍会真的试探一次（可接受）。
