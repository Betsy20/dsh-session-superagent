# 贵的动作放在便宜的判断之后

## 出处
- 与"时段判断要前移"同源（[active-hours-before-fetch](active-hours-before-fetch.md)），
  但这里的代价不是网络请求，而是**本地 git 操作**：
  一次 `git worktree add` + 若干次 `worktree remove`/`branch -D` 回收。
- 一般原则：把"能不能做"的判断放在"做"之前；判断越便宜越该靠前。

## 实测
本机在插件仓库上：
```
time git worktree add /tmp/wt-timing --detach
real 0m0.187s
```
小仓库 0.19s；回收阶段每个过期副本还要 `worktree remove` + `branch -D` 各一次 ——
5 个过期副本就是 1 秒级别的空转。大仓库按比例更久。

## 我们原来的顺序
`pollOnce` 里：先 `prepareIsolation()`（回收 + 开新副本），再 `wake()`。
而 `wake()` 第一步就是 `decideWake(agent.status)`：**会话不是 idle 就直接拒绝**。
所以"会话忙"这个很常见的状态，会白白付出一次完整的隔离区开销 ——
而且开出来的副本没人用，还得等下一次回收。

## 改法
在 `prepareIsolation()` **之前**先判一次：

```js
const pre = decideWake(agent && agent.status)
if (!pre.ok) { entry.lastDeferred = '会话正忙…，这一轮不准备隔离区，下一轮再试'; return }
```

两个好处：
1. 省掉 git 开销（0.19s ~ 1s+）；
2. 面板原因更准确（以前写"wake failed"，现在是"会话正忙，下一轮再试"）。

## 是否已落地
✅ 0.9.6。用例 `test/wake-order.test.mjs` 是**源码顺序断言**：
`decideWake` 的前置判断必须出现在 `prepareIsolation` 之前，且文案含"下一轮再试"。
（顺序类约束没法用行为测试表达，只能守源码位置。）

## 尚未做的
- 回收（cleanupWorktrees）本身仍是每次唤醒都跑一遍；可以按"距上次回收超过 N 分钟"节流。
- 没有测大仓库下 `worktree add` 的真实耗时（本机只有小仓库可用）。
