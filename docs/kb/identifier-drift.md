# 文档里的标识符会漂移，能自动查的那一半要先查掉

## 出处
- 这与"文档当作代码来测"的思路一致：可执行/可校验的部分交给门禁，
  不可校验的部分（语气、取舍）留给人。
  参考 docs-as-code 的常见实践（`vale` 之类的 lint 做的是另一类事：
  <https://vale.sh/>）。

## 这轮做了什么
`scripts/audit-claims-consistency.mjs`：从 `lib/index.js` 抽出真实存在的
**工具名**（`watch_*`）与**路由**，扫 README / MAINTENANCE / HANDOFF / whats-new /
optimization-plan 里提到的同名标识符，对不上就 FAIL。

实测：
```
工具 6 个：watch_ack watch_trace watch_doctor watch_start watch_status watch_stop
路由 9 条
PASS 文档里提到的工具名都真实存在
PASS 文档里提到的路由都真实存在
```

**这次没抓到漂移** —— 说明最近的重构（拆文件、加路由）都同步改了文档。
但门禁的价值在于"以后忘改会红"，而不是"这次能抓到"。

已接进 `preflight --fast` 对应检查：`PASS 文档标识符　6 个工具 / 9 条路由都对得上`。

## 顺手补的一个真缺口
README 原来只写了「会话级 12 次/小时」，**没写单守 6 次/小时、也没写冷却期 3 分钟** ——
客户看到"6 次"会以为是会话级。现在改成三层并列写清（数据均与代码常量一致）：

| 层 | 默认 | 代码位置 |
|---|---|---|
| 单守 | 6 次/小时 | `maxWakesPerHour ?? 6` |
| 会话 | 12 次/小时 | `DEFAULT_SESSION_WAKES` |
| 冷却期 | 3 分钟 | `DEFAULT_COOLDOWN_MS` |

## 哪些地方自动查不了
- 「三层限制」这种**语义表述**（数字对得上不代表解释对得上）；
- 「不影响别人提交」这句结论（要靠阅读 ++ 离线模拟交叉验证）。

## 是否已落地
✅ 0.9.32。preflight 对应检查 + README 三层限制补全。

## 还没做的
- 没有检查**默认值**是否漂移（数字散在 README 与常量两处，做成断言要额外维护一张映射表）；
- 没有检查面板里的字段名与 `/state` 回传字段（已有 `/state` 契约用例覆盖）。
