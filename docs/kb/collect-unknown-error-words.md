# 分类器补不上的原因：没见过的措辞没有留下来

## 出处
Node 的系统错误表（本轮用 `gh api` 直接取到 `doc/api/errors.md`）把每个码的含义写得很具体：

> `EACCES` (Permission denied): An attempt was made to access a file in a way forbidden by its file access permissions.
> `EPIPE` (Broken pipe): A write on a pipe, socket, or FIFO for which there is no process to read the data.

<https://nodejs.org/api/errors.html#common-system-errors>

## 现场
这四类原本全落 `other`（"没归类的错误：已按退避自动重试"）：

| 文本 | 改前 | 改后 |
|---|---|---|
| `spawn gh EACCES` | other | `permfile`（检查安装权限或重装） |
| `spawn gh EPERM` | other | `permfile` |
| `EPIPE: broken pipe` | other | `network`（连接被中断，不需要手动处理） |
| `ETIMEDOUT connect` | other | `network` |

## 更根本的问题
分类器只认**我们见过的措辞**。没见过的如果只显示"没归类的错误"，**下次还是收集不到** —— 死循环：
- 客户看到"没归类的错误"，只能贴图给作者；
- 作者下次依然没见过这条措辞。

所以新增 `recordOtherError()`：`other` 时把原始措辞（≤120 字）记进事件流。
样本会随 `watch_trace` / 事件列表一起出现，下一轮就能照着补规则。

## 判据
**"兜底分支"必须自己产出素材。** 一个只说"我不知道这是什么"的兜底，永远不会变聪明；
一个把素材留下的兜底，才能被下一次改进消费。

## 是否已落地
✅ 0.9.133。新增 2 例（系统码分类、`other` 留样本且不无限增长）。

## 还没做的
- 样本只留在单条守的事件流里，没有"导出全部未归类样本"的入口；
- 没有把样本自动聚合成"候选规则"（现在仍靠人读）。
