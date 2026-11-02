# 删了目录还不够：git worktree 要 prune

## 出处
- git 官方文档 `git worktree`：<https://git-scm.com/docs/git-worktree>
  子命令里有 `prune` / `list` / `remove`；`prune` 的职责是「清掉那些工作目录已经不在了的管理记录」。

## 它怎么做的
每个 worktree 在 `.git/worktrees/<id>/` 有一份管理文件。`git worktree remove` 会同时删目录和记录；
但如果**目录是被外部删掉的**（我们的孤儿兜底就是 `rmSync`），记录会留下 ——
于是 `git worktree list` 永远显示一个不存在的路径。

## 我们能怎么用
我们的 `cleanupWorktrees` 有两条路径：
1. `git worktree remove --force` 成功 → 记录也跟着没了；
2. 失败（说明已经是孤儿目录）→ `rmSync` 删目录，**但没人清记录**。

第 2 条就是缺口：长期运行会攒下 ghost worktree。修法：孤儿分支删完目录后补一条
`git worktree prune`。

## 是否已落地
✅ 0.8.59（`lib/index.js` 的 `cleanupWorktrees`）。
用例 `test/worktree-prune.test.mjs` 用**真 git 仓库**把现象和修复都跑了一遍：
建 worktree → 手删目录 → `list` 仍显示 → `prune` 之后干净。

## 附带：让占用看得见
同版本在 `/state` 里加了 `isolation`（每个 worktree 根下的个数与总字节），
面板「设置 → 来源」显示「隔离占用 N 个 · 3.2 MB」。客户长期运行能看见磁盘在涨。
