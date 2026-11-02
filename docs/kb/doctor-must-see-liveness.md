# 自检要能看出"还活着吗"，而不只看"配置对不对"

## 出处
- 这是 liveness 与 readiness 的区别：配置正确（readiness）不等于还在工作（liveness）。
  Kubernetes 的探针设计把两者分开，正是因为"进程在跑但已经不干活"是最难发现的状态：
  <https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#container-probes>

## 我们的情况
`watch_doctor` 原本检查的是"配置层"：版本、挂载、gh 登录、仓库可访问、ack 标签、隔离目录是否存在。
**全都是"配得对不对"，没有一条是"还在不在工作"。**

两类真实故障它看不见：
1. **定时器丢了**（进程挂起、`setInterval` 被清）：`lastPoll` 停在几小时前，面板显示"运行中 · 正常"；
2. **隔离目录存在但不可写**（权限 / 磁盘）：第一次唤醒建 worktree 就失败。

## 改法
```js
// 停滞：超过 max(3×interval, 5min) 没轮询过
if (age > staleMs) lines.push(`WARN ${repo} 已经 ${N} 分钟没轮询过（预期每 ${n} 秒）—— 定时器可能丢了`)

// 可写：写一个探针文件再删
try { writeFileSync(probe, Date.now()); rmSync(probe, { force: true }) }
catch (error) { lines.push(`FAIL 隔离工作目录不可写：${wd}（${error.code}）`) }
```

## 判据
自检清单里**至少要有两条属于 liveness**（最近一次成功是什么时候 / 关键路径能不能写），
否则"全绿"只说明配置没坏。

## 是否已落地
✅ 0.9.77。用例：造一个 2 小时没轮询的守，doctor 必须报「没轮询过」。

## 还没做的
- 没有"上次成功唤醒距今多久"的检查（同样是 liveness，属于会话侧）；
- 磁盘剩余空间没查（只靠写入失败间接发现）。
