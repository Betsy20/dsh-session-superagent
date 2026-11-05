# 界面内更新任务书（T66/T67）

## 目标

设置→版本与更新从「只给命令」升级为「可在界面执行更新」，同时保留命令回退。更新只修改安装副本，不触发宿主重启，不把 installed 当成 running。

## 官方命令依据

DSH 官方 CLI 文档 [`docs/cli-help.md`](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/cli-help.md)：`dsh plugin --profile <name> add <package>` 会把树外插件安装进 profile；`add/update` 等 pnpm 参数原样转发。当前面板命令与之一致。

## 后端

- 现有 GET `/session-superagent/update` 只读不变；POST 走 `guardWrite`。
- body 仅允许可选 semver version；默认 latest，禁止任意命令字符串。
- 使用 execFile/spawn 参数数组，不经过 shell 拼接。
- profile 来自运行环境，不写死 desktop；CLI 按 DSH_CLI_PATH、PATH、安装布局解析。
- runner 可注入，测试不真实安装；并发、超时、非零、stdout/stderr 截断均有响应。
- 返回 installedVersion/runningVersion/needsReload，成功不代表运行中代码已换。

## 前端

- hasUpdate 时显示官方 primary「安装更新」；DSH Modal 确认后才 POST。
- busy 防重复；成功/失败均有 Section/Toast；复制命令始终保留作回退。
- 成功后刷新 GET update；needsReload 明示，不能显示「已运行新版」。
- 不新增自造样式，缺原语完整回退。

## 验收

非法 version、403/405、找不到 CLI、非零、超时、并发、确认才发送、busy 连点、成功/失败/needsReload、命令回退。
真实安装只在用户明确点击后发生，测试与发布流程不调用真实更新。
