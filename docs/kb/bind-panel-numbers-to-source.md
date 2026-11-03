# 面板上的每个数字，都要能指回一个来源

## 出处
- 这一轮没有可用的新外部来源（`en.wikipedia.org` 超时、`raw.githubusercontent.com` 与 `api.github.com` 502）。
  所以直接把前两轮的判据做成守卫：*要么同源，要么同测*
  —— 见 [政策数字只能有一处定义](policy-numbers-have-one-home.md) 与
  [默认值要当数据传下去](defaults-are-data-not-copy.md)。
- 「魔法数字」的通用讨论（本轮无法访问，仅作背景）：
  <https://en.wikipedia.org/wiki/Magic_number_(programming)>

## 现场（扫描 `client.js` 里含数字的中文文案，共 14 条）
真正有漂移风险的是这 4 个；其余是示例值（`如 42`、`09:00-23:00`）或 HTTP 码（401/404/5xx），写死无害：

| 面板文案 | 真实来源 |
|---|---|
| `最小 30 秒` | `Math.max(30, Math.min(3600, …))`（`watch_start` 的夹紧） |
| `判定日志（最近 5 次唤醒）` | `/state` 里 `filteredLog.slice(-5)` |
| `时间线（最近 20 条）` | `pushHistory(history, record, max = 20)` |
| `连续 2 次就会在「需要关注」里提示` | 面板判断 `silentWakes >= 2` |

## 改法
`test/panel-numbers.test.mjs`：从 `client.js` 抽出这四处数字，与 `lib/` 里的真实阈值逐条比对。
比对失败会直接打印"面板写 15，代码是 30"。

## 验证它会红
把文案改成「最小 **15** 秒」→ `pass 3 / fail 1`；还原后 `4/4` 通过。

## 判据
**先分类，再治理**：14 条里只有 4 条需要绑来源，其余写死是对的。
一上来就把所有数字都"参数化"，会得到一堆没人读的配置。

## 是否已落地
✅ 0.9.128。4 条守卫，注入验证过一次会红。

## 还没做的
- 只覆盖 `client.js`；`lib/` 里的中文提示（如"上限 2 小时"）还没同样的绑定（0.9.123 只绑了档位那一条）；
- 新加的数字需要人来补一条守卫 —— 没有"未绑定即报错"的自动发现。
