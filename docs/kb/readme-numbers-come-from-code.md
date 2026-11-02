# README 里的数字必须从代码里读出来

## 出处
- 文档与实现漂移是工程质量里最常见的负债（Documentation debt）。
  与 [文档里的标识符会漂移](identifier-drift.md) 同源，但数字更危险：**客户会拿它算时间**。
- 相关实践：把文档里的可验证断言做成测试（docs-as-tests），
  <https://martinfowler.com/bliki/SelfTestingCode.html> 的延伸。

## 现场
README 写着「冷却期 **3 分钟**」「12 次/小时」「30–3600 秒」。
这些都是 `lib/index.js` 里的常量，但**改常量时没人会想起 README**。
客户按文档算"什么时候能再唤醒"，就会算错。

## 做法
`scripts/verify-readme-claims.mjs` 从源码里读常量，和 README 的说法逐组对照：

| 组 | 代码 | README |
|---|---|---|
| 轮询范围 | `Math.max(30, Math.min(3600, …))` | 30–3600 秒 |
| 冷却期 | `DEFAULT_COOLDOWN_MS = 180_000` | 冷却期 3 分钟 |
| 会话上限 | `DEFAULT_SESSION_WAKES = 12` | 12 次/小时 |
| 单守上限 | `maxWakesPerHour ?? 6` | 6 次/小时 |
| 隔离默认 | `maxIsolated ?? 5` / `isolateKeepDays ?? 3` | 最多 5 个、超 3 天 |
| 状态路径 | `watchers.json` | `~/.dsh/state/session-superagent/watchers.json` |
| README 里的脚本 | 4 个文件 | 都真实存在 |
| README 里的工具 | 8 个工具名 | 都真的注册（离线 apply） |

## 验证它会红
把「冷却期 **3 分钟**」改成 4 分钟：
```
FAIL 冷却期  代码 3 分钟 / README 没写
```
还原后 PASS。

## 判据
**能写死的数字，就要能从代码里读出来；读不出来的（体验描述）不硬凑。**
8 组里 6 组是数字，2 组是"名字必须存在"。

## 是否已落地
✅ 0.9.101。`preflight` 第 31 项「README 与代码一致」。

## 还没做的
- 只覆盖 README 顶部的"快速开始 + 已知限制"；`UPDATING.md` / `docs/` 里的数字没查；
- 时间类说法（"约 1 小时"）无法精确对照，仍靠人。
