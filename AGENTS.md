# 本仓库的 agent 规则

## 可以做

- 读代码、跑 `node --test`、改 `lib/` 与 `test/`；
- 按 `CHECKLIST.md` 的 A 表自查后开 PR；
- 在 issue 里讨论设计。

## 不可以做

- 关闭 / 重启宿主的 DSH 实例；
- 修改用户 profile 的 `bundles`；
- 在仓库里提交任何 token、私钥、本机绝对路径；
- 把没跑过的结论写成“通过”。

## 改动边界

| 目录 | 谁能动 |
|---|---|
| `lib/watch.js`、`lib/redact.js` | 纯函数，必须带测试 |
| `lib/index.js` | 插件装配，改动需说明影响面 |
| `cordis.patch.yml` | 改行 id 视为 major |
| 文档 | 跟随代码同步更新 |
