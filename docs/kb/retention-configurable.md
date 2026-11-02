# 保留策略要能配，而且要在界面上

## 出处
- GitHub Actions 的 artifact / log 保留天数**可按仓库配置**（默认 90 天，1~90 天可选）：
  <https://docs.github.com/en/actions/managing-workflow-runs-and-deployments/managing-workflow-runs/removing-workflow-artifacts>
- 共性做法：把会长期增长的资源（日志、产物、缓存）的保留期做成**用户可调**，并给默认值与上下限。

## 我们能怎么用
我们的隔离执行会在 `.dsh-zhuli/` 下留一次性 worktree，回收阈值 `isolateKeepDays` 默认 3 天 ——
服务端早就支持（`cleanupWorktrees(workdir, keepDays)`），但**面板上一直没有入口**，
客户仓库大、每次 worktree 几百 MB 时只能忍着。

## 是否已落地
✅ 0.8.60：编辑表单里加了「隔离区保留天数」（1–30，留空用默认 3），
保存走 `/watch` 的 `isolateKeepDays`；配合 0.8.59 的「隔离占用」显示，客户能看见涨也能自己调。

## 顺带修的一个真 bug
同一个表单里，**打开编辑态时只回填了 5 个字段**（间隔/标签/时段/目标/已指派），
`observe / isolated / workdir / batchLimit / maxWakesPerHour` 都没填 ——
意味着打开一条"隔离执行"的守、不做修改直接「保存」，会把 `isolated` 写回 `false`。
已补齐全部字段，并加了一条**源码级守门**（假 DOM 的 setState 是空实现，跑不到这一步，所以只能守源码）。
