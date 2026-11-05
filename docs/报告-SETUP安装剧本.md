# 报告：主理鱼 SETUP 安装剧本

## 交付与边界

- 新增 [SETUP.md](../SETUP.md)：109 行，面向「coding agent 陪操作者装好主理鱼」。
- 更新 [docs/README.md](README.md)：只新增一条 SETUP 索引，现 33 行。
- 新增本报告；未改生产代码、版本号或派单表，未 commit、publish。

## 官方来源与取舍

读取本机官方 checkout `D:\主工作区\projects\dsh-superagent-prototype\SETUP.md`，当时 HEAD 为 `841f2ff5719302f348e771b820d848bcba026d17`；项目为 [deepseek-ai/dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype)。

| 吸收的安装纪律 | 主理鱼落点 |
|---|---|
| 提问前只读产品说明并做一次探测 | 只读 [README](../README.md) 与 [为什么做这个产品](为什么做这个产品.md)，探测版本、profile、`watch_doctor` |
| 一条消息只问一件事，带推荐答案与理由 | 固定为仓库、会话、过滤/白名单、隔离、goal 五题 |
| 提问期间不执行，收齐后给完整计划 | 计划一次列全安装、配置、操作者步骤、写入、回滚与验收，确认后才动手 |
| 密钥不进入聊天 | 只给操作者终端的 `gh auth login`，或指向面板「设置 → 凭证」字段 |
| 安装后验证并交付面板与试用方式 | `watch_start` → `watch_status` → `watch_doctor` → 面板 → 首轮唤醒 → `watch_ack` |

没有复制官方的独立 `superagent` profile、专用端口、tmux、独立 agent 账号、Source/Policy/Executor 多角色配置或 hourly repair。主理鱼仍装进当前 profile，插件安装保持一条命令：

```bash
dsh plugin --profile <profile> add dsh-session-superagent
```

## 本次探测记录

| 探测 | 结果 | 对剧本的影响 |
|---|---|---|
| `dsh --version` | 当前子代理 Git Bash 返回 `dsh: command not found` | 作为 PATH/操作者终端计划项，不据此误判 DSH 宿主不存在 |
| `gh --version` | `gh version 2.101.0 (2026-09-15)` | 满足 README 的 gh CLI 前置条件 |
| 当前 profile | `DSH_PROFILE=desktop` | 安装命令使用已确认 profile，不另建 profile |
| `watch_doctor({format:"text"})` | 插件 `0.9.261`；9 条面板接口挂载无失败；gh 登录正常；已有 watcher 可访问 | 证明 doctor 可用；已有安装时跳过重复安装 |
| doctor 警告 | 一个已有 watcher 缺少 `主理鱼:已处理` 标签；另一个已存在 | 剧本保留「GitHub 首次 ack 自动建标签」说明 |

未运行 `gh api`、`gh auth token` 或 `curl`，未读取或输出任何凭证。`watch_doctor` 使用其自带检查，并删除了隔离目录临时探针。

## 链接静态核对

用本地 Python 遍历 Markdown 链接；外部 URL 只检查语法，不发起网络请求。相对链接按所在文件解析并检查目标存在：

- `SETUP.md → README.md`：通过。
- `SETUP.md → docs/为什么做这个产品.md`：通过。
- `docs/README.md → ../SETUP.md`：通过。
- `docs/README.md` 原有相对链接：全部通过，未因新增索引产生断链。
- 本报告中的 `../SETUP.md`、`../README.md`、`README.md`、`为什么做这个产品.md`：通过。

## 命令与工具静态核对

| 项 | 核对结果 |
|---|---|
| 插件安装命令 | 与 README「安装」节的 `dsh plugin --profile ... add dsh-session-superagent` 一致；只把具体 profile 换成占位符 |
| 登录命令 | `gh auth login` 与 README 故障说明一致；未出现打印 token 的命令 |
| `watch_start` | 使用的 `repo / intervalSec / labels / ignoreLabels / allowAuthors / onlyAssigned / isolated / workdir / goal` 均在当前工具 schema 中 |
| 会话绑定 | 未伪造 `sessionId`；明确 watcher 绑调用 `watch_start` 的当前会话 |
| 默认值 | 60 秒、单批 5 条、单 watcher 6 次/小时、会话 12 次/小时与 README/工具默认值一致 |
| 状态与诊断 | `watch_status({format:"json"})`、`watch_doctor({repo,format:"json"})` 参数合法 |
| 回滚 | `watch_stop({repo})` 与 `watch_stop({repo,delete:true})` 参数合法 |
| ack | `repo / number / note / comment / kind` 均在当前工具 schema 中；Gitee PR 评论使用 `kind:"pull"` |
| 写操作边界 | `comment:false` 仍写 ack 标签与本地水位；`comment:true` 被单列为发布原 issue/PR 评论的显式写操作 |

## 静态验收结论

- SETUP 少于 200 行，命令块未使用不存在的安装子命令。
- 五个问题均含推荐答案与一句理由，并明确收齐答案、计划确认后才执行。
- 验收覆盖 `watch_start`、`watch_status`、`watch_doctor`、面板出现、首轮唤醒和 `watch_ack`。
- 改动范围仅限任务允许的三个文档路径。
