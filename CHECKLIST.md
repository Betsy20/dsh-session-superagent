# CHECKLIST —— 两张表，两个交付门

## A 表 · 代码交付前

- [ ] `node --test` 全绿，且新增行为有测试
- [ ] 所有返回字符串都过 `redact()`（新增输出路径重点查）
- [ ] 写操作仍要求 `confirm: true`
- [ ] 唤醒仍受 `agent.status === 'idle'` 约束
- [ ] 唤醒失败时不推进水位（`entry.seen` 不动）
- [ ] `package.json` 的 `files` 覆盖所有要发布的文件（`lib` + 文档 + patch）
- [ ] 没有把本地路径、个人 token、机器名写进仓库

## B 表 · 发版前

- [ ] 从最新 `main` 起功能分支
- [ ] `CHANGELOG.md` 增加条目，`package.json` bump 版本
- [ ] 本地 `node --test` 通过
- [ ] PR 合并到 `main`
- [ ] 打 annotated tag `vX.Y.Z` 并推送
- [ ] 创建 GitHub Release，说明取自 CHANGELOG
- [ ] 安装验证：`dsh plugin --profile <p> add github:MYCF711/dsh-session-superagent`

## 发完之后

- [ ] 在测试仓库 `watch_start` 跑一轮，确认唤醒可达
- [ ] 记录一次真实运行的观察结果到本仓库 issue
