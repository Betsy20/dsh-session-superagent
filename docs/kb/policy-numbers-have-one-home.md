# 政策数字只能有一处定义，展示文案要算出来

## 出处
Kubernetes Job 的做法：重试策略写在 `spec`（`backoffLimit`、退避上限），
**由控制器按它计算并把结果写进 `status`**：

> The `.spec.backoffLimit` is set by default to 6 … The number of retries is calculated in two ways …

<https://kubernetes.io/docs/concepts/workloads/controllers/job/>

政策一处定义、派生数字另一处计算 —— 而不是在界面里再抄一份。

## 现场
0.9.122 的面板写着「已放慢到 **2 小时**档」，而这个 2 小时是 `nextDelayMs` 里的字面量。
一旦有人把上限改成 90 分钟（或把预算从 6 改掉），**这句话立刻变成谎话，而且没有任何门禁会红。**

这和 [README 里的数字必须从代码里读出来](readme-numbers-come-from-code.md) 是同一类问题，
但更隐蔽：README 漂移有人会读出来，**面板里的一句"档位"漂移，客户根本不知道它错了**。

## 改法
1. `lib/watch.js` 导出 `RETRY_SLOW_CAP_MINUTES = 120`，`nextDelayMs` 用它算上限；
2. `/state` 顶层新增 `retryPolicy: { budgetAttempts, slowCapMinutes }`；
3. 面板档位文案由这两个数字算（≥60 分钟显示小时，否则显示分钟）。

## 证据
| retryPolicy | 面板文案 |
|---|---|
| `{ 6, 120 }` | 已放慢到 2 小时档 |
| `{ 6, 90 }` | 已放慢到 1.5 小时档 |
| `{ 20, 120 }`（8 次未超预算） | 不提"已放慢" |

## 判据
**凡是"从某个常量推出来的文案"，都要能从接口读到那个常量。**
写死的那一刻，你埋下了一颗"改常量就产生谎话、且无人报警"的雷。

## 是否已落地
✅ 0.9.123。用例覆盖三种 policy。

## 还没做的
- 面板其它写死的档位文案（如"每小时上限"的提示）还没逐一改成读接口；
- 没有门禁检查"client.js 里出现的分钟/小时数字是否都来自 payload"。
