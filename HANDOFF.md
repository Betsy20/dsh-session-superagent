# HANDOFF —— 会话交接（2026-11-01 20:55）

> 这份文件写给**接手这个项目的下一个 agent / 下一个会话**。读完它 + `MAINTENANCE.md`，就能继续，不需要翻聊天记录。

## 一、项目现状

- 仓库：https://github.com/MYCF711/dsh-session-superagent
- 版本：**v0.3.1**（tag / Release / tarball 已齐）
- 本地：`D:\主工作区\projects\dsh-session-superagent`（profile 里以 `file:` 安装，**硬链接**：改源码即改 profile 内文件）
- 真机：Windows 11 + DSH 0.2.1-rc.5，`node --test` 20/20

已实现并验证：

| 能力 | 实现位置 | 验证证据 |
|---|---|---|
| 会话头部轨道点徽章（三态） | `client.js` → `conversation.session.header.actions` | `badge-registered ok` / `badge-state found:<repo>` |
| 主理鱼 tab | `client.js` → `conversation.view` | `desk-registered ok` |
| watcher 轮询 + 唤醒 | `lib/index.js` + `lib/watch.js` | `lastPoll` 持续更新；`followup` 唤醒实测成功 |
| 会话 goal（真 goal） | `ctx.goals`（get/create/edit/clear） | 面板读写，5s 轮询同步 |
| 凭证（token / SSH） | `~/.dsh/state/session-superagent/secrets.json` 0600 | 只回显掩码；`gh` 调用自动带 `GH_TOKEN` |
| 面板显示会话标题 | 服务端解析 `session/title` 事件（按 mtime 缓存） | 面板显示「会话级 superagent」 |
| 自回声抑制 | 逐条水位 + 180s 冷却「吸收」 | 见 `lib/watch.js` 的 `partitionItems` |

## 二、必须知道的技术事实（查不出来的那些）

1. **路由服务名是 `webServer`（大写 S）**，不是包文档里的 `httpServer`。`inject: ['tools','agents','webServer']`，用 `ctx.webServer.register({kind:'exact', path, handler})`。
2. **中栏 tab 槽位**是 `conversation.view`（list / session scope），注册时带 `id`、`order`、`label`。
3. **会话头部动作槽位**是 `conversation.session.header.actions`（list / session scope）。
4. **侧栏会话列表没有可插入的槽位**：`sidebar.workspaces` 是 single slot，由 `ui-workspace` 独占 → 列表行图标做不了（要改上游）。
5. **唤醒用 `Agent.followup(msg)`**，不要用 `inbox.append('next-turn')`——后者只排队，UI 显示成「待发送」草稿。
6. **只能在 `agent.status === 'idle'` 时注入**，运行中注入会导致客户端草稿回放 → 重复发送。
7. **goal 服务是 `ctx.goals`**（`@deepseek-ai/dsh-goal`）：`get(agent)`→`{objective,phase,ref}`，`create/edit/clear`。
8. **客户端改动必须完整重启应用**（托盘退出，不是关窗口、也不是刷新）；服务端改动刷新即可。
9. **`file:` 安装是硬链接**：读 profile 内文件与源码是同一 inode，`cp` 会报 "same file"。

## 三、踩过的坑（按代价排序）

1. **字符串替换静默失败**：用 python `replace` 插注册代码时目标文本已被改动，替换成功但内容没进去 → 组件写好了却没注册，白折腾 4 次重启。
   **规矩：每次替换后 grep 验证结果，关键注册位必须断言。**
2. `httpServer` vs `webServer`：猜错服务名导致路由全丢、面板 404。
3. `inject` 写成对象形式 `{required, optional}` 在这个 cordis 版本不认 → 整个插件不挂载（连 shell 工具一起没了）。
4. pnpm 的 `github:` 依赖会缓存到 commit；`#v0.2.0` 这类 ref 需要 allowBuilds 且有缓存，换版本时 `remove` + `add` 更可靠。
5. MSYS 会把 `/run` 这类参数改写为路径（`schtasks /run` → `C:/Program Files/Git/run`），需 `MSYS2_ARG_CONV_EXCL='*'`。
6. Python（Windows 原生）不认 `/d/...` 这类 MSYS 路径；写文件用相对路径。
7. 中文输出乱码：`PYTHONUTF8=1` + `PYTHONIOENCODING=utf-8`（已 setx 到用户环境）。

## 四、待办

| 项 | 状态 | 说明 |
|---|---|---|
| 徽章点击切换到主理鱼 | 未做 | `conversation.view` 的切换 API 没找到；header actions 槽位只给 sessionId，不给 view 控制权 |
| 面板 goal 双向同步实测 | **未验证** | 代码已实现（`ctx.goals`），需要人工在 UI 里改 `/goal` 看面板是否 5s 内跟随 |
| awesome-dsh-plugin 上架 | 待时间 | 仓库满 1 天门槛：最早 **2026-11-02T09:53Z（北京时间 17:53）**；材料见 `docs/awesome-submission.md` |
| npm publish | 未做 | 需操作者登录 npm；能让 Discover 的 format-1 索引收录 |
| SDK 化 RFC | 未做 | scout 结论：先开 issue 不写代码；数据否掉“每命令一工具”（见下） |
| trigger.json 测试通道 | 待清理 | 仍在正式包内，下个版本移入 dev 或加开关 |

## 五、团队调研结论（两个 teammate 的产出）

**gitbash SDK 化（`docs/gitbash-sdk-plan.md`，825 行）**
- 实测 41,857 次 bash 调用，**只有 5.54% 是单命令**，84–94% 是多步脚本；git 单命令仅 0.11%。
- “一个工具 + 一组 bindings”在 DSH 公开接口上不成立（binding 是工具面的 1:1 投影）。
- 建议：先开 RFC issue（0 代码）→ 裁决后 docs-only PR → 可选默认关闭的单工具开关。**不要直接提 N 工具 PR。**

**上架与推广（`docs/superagent-promo-plan.md`，659 行）**
- 渠道：加 `dsh-plugin` topic → npm publish → awesome PR；dshmarket/Discover 自动同步，无需单独提交。
- **事实修正：官方 dsh-superagent 也不是 webhook**，它同样是轮询；对外只说“形态不同”。
- v1.0.0 门槛是证据不是功能：8 项里当前只达标 1 项（CI 绿）。

## 六、最短接手路径

```bash
cd D:/主工作区/projects/dsh-session-superagent
node --test                       # 20 项单测
# 改服务端只改 lib/*.js → unlag 刷新即可生效
# 改客户端 client.js → 必须完整重启应用（托盘退出再启动）
```
