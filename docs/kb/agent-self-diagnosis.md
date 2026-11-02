# agent 要能靠工具自诊，不用让人截屏面板

## 出处
- 这是"可观测性对 agent 同样重要"的具体化：自动化系统要能自己解释状态，
  否则每次异常都得由人转述（SRE 的 runbook 也是这个思路：机器能查的别让人问）。
  <https://sre.google/workbook/on-call/>

## 本轮发现
面板上有三类诊断信息，工具 `watch_status` 里**一个都没有**：

| 信息 | 面板 | watch_status（改前） |
|---|---|---|
| 为什么暂停（`deferReason`） | ✅ | ❌（只有一句 `deferred="…"` 截断 40 字） |
| 叫醒后没回音几次（`silentWakes`） | ✅ | ❌ |
| 会话用量 / 上限 / 建议值 | ✅ | ❌ |

后果：客户问"为什么没动静"，agent 只能回答"请把面板截图给我"。

## 改法
`watch_status` 每条守多输出 `defer=<原因码>` 与 `silent=N`，
末尾再加一行会话汇总：

```
o/a → s1 | every 60s | defer=cap-session silent=3 | cursor=- | lastPoll=- | lastWake=- | err=-
session: 12/12 wakes last hour，2 条守正因上限暂停，建议把会话上限调到 24
```

用例断言三者都在，且用量行格式稳定（`/session:\s*\d+\/12 wakes last hour/`）。

## 一个自己挖的坑
改写这段时我用模板字符串拼代码，`'\n'` 被写成了**真实换行**，
生成了 `return body + '` + 换行 + `' + summary` 这种语法错误 ——
`node --check` 立刻报 `Invalid or unexpected token`。
**凡是用脚本生成代码，都要在生成后立刻 `node --check`。**

## 是否已落地
✅ 0.9.42。用例覆盖三个字段 + 汇总行格式。

## 还没做的
- `watch_doctor` 还是只查凭证/仓库/标签，没有覆盖"隔离区目录是否存在"等状态类检查；
- 工具输出仍是纯文本，没有结构化 JSON（agent 解析靠字符串匹配，脆）。
