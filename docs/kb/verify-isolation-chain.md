# 以为懂的链路，真跑一遍才知道

## 出处
- 这是"集成测试 > 单元测试"的老结论在新场景的应用：
  单测验证**函数**,集成验证**命令序列**。我们的隔离执行正好是一串 git 命令，
  每个函数都对，也不代表整串对。
- 具体依据就是本轮的实测 FAIL —— 见下。

## 做法
`scripts/verify-isolation.mjs`：在 `os.tmpdir()` 里造一个最小 git 仓库，然后：

1. `git worktree add <repo>/.dsh-zhuli/zhuli-demo -b zhuli/demo`
2. 在隔离区改文件 + 提交
3. 验证**主工作区没被污染**
4. `git worktree remove --force` + `git branch -D`
5. 数量线：8 个副本只留最近 5 个（喂纯函数）
6. 手工删掉副本目录 → `git worktree prune` → 列表里不再挂着

9 步全部打印 PASS/FAIL，1.3 秒跑完，已接进 `preflight --fast` 对应检查。

## 它纠正的误解
第一版脚本断言"`worktree remove` 会连分支一起删" → **FAIL：分支还在**。

真实情况：`remove` 只拆工作区；分支要显式 `git branch -D`。
产品代码里本来就是两条命令，但**我心里以为是"remove 顺带处理"** ——
如果哪天有人"优化"掉那条 `branch -D`，单测不会红（那条命令在 I/O 层），
而这个脚本会立刻红。

## 顺带澄清的一处产品行为
回收时若 `worktree remove` 失败（目录已被手工删），产品会：
`rmSync` 目录 → `git worktree prune` → `branch -D`。
第 6 步验证的正是"prune 之后列表不再挂着"，这是之前真机遇到过的问题。

## 是否已落地
✅ 0.9.27。`preflight --fast` 对应检查：`PASS 隔离链路　9 步全部通过`。

## 还没做的
- 没有模拟"两个会话同时对一个仓库开隔离区"（并发，需要更复杂的时序）；
- 没有验证 `push` 到远端（需要真远端，属于必须宿主/账号的事）。
