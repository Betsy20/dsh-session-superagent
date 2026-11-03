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

## 后续（0.9.126）
第一次只给两个工具加了短路，**但真正发请求的地方有七八处**（轮询、`watch_ack` 打标签、仓库体检、评论查询…）。
于是把它下沉到 `run()` —— 所有 `gh` 调用的唯一出口：
- `gh auth status` 与 `--version` **豁免**（否则无法自检、也永远解不开）；
- 顺序放在离线模式之前，让「凭证坏了」在测试里也一致；
- 工具层那两处重复短路与死常量 `AUTH_BROKEN_REPLY` 一并删除。

## 还没做的
- 缓存是进程内的，重启后第一条请求仍会真的试探一次（可接受）；
- 断路器只按「凭证」判定，HTTP 5xx 连续失败还没做成同样的开关。
