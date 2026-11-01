# HANDOFF —— 会话交接（2026-11-01 23:10，v0.7.1）

> 写给**接手的下一个 agent / 下一个会话**。读完它 + `docs/competitive-analysis.md` + `docs/deepseek-papers.md`，就能接着干，不用翻聊天记录。

## 一、项目现状

- 仓库：https://github.com/MYCF711/dsh-session-superagent
- 版本：**v0.7.1**
- 本地：`D:\主工作区\projects\dsh-session-superagent`（profile 里以 `file:` 安装，**硬链接**：改源码即改 profile 内文件）
- 真机：Windows 11 + DSH 0.2.1-rc.5，`node --test` **63/63**

| 能力 | 实现位置 | 验证方式 |
|---|---|---|
| 状态栏「主理鱼」轨道环（0 条灰环占位 / 卫星公转 / 点击看详情） | `client.js` → `conversation.composer.dock`（`order: -10` 最左端） | `/client-note?key=client-version` 探针 + 面板实测 |
| 主理鱼 tab（增删/暂停/立刻跑/配过滤器/凭证/goal） | `client.js` → `conversation.view` | `desk-registered ok` |
| 轮询 + 唤醒 | `lib/index.js` + `lib/watch.js` | `lastPoll` 前进；`followup` 唤醒 |
| 过滤器 / 批量 / 每小时上限 / 失败退避 | `lib/watch.js` 纯函数 + `/watch` 路由 | `node --test`（`passesFilters` / `batchFresh` / `nextDelayMs` / `pruneWakeTimes`） |
| 活跃时段（含跨夜） | `inActiveHours()` + pollOnce 时段闸 | `node --test`（普通/跨夜/空值/起止相同） |
| 隔离执行 + 自动回收 | `worktreePlan` / `prepareIsolation` / `cleanupWorktrees` | 真机 `git worktree list` 出现 `.dsh-zhuli/<id>` |
| 幂等标记 | `watch_ack` 工具 + `hasAckLabel` | 打 `主理鱼:已处理` 标签后轮询跳过 |
| 会话 goal（真 goal） | `ctx.goals` | 面板读写，5s 轮询 |
| 凭证 | `~/.dsh/state/session-superagent/secrets.json` 0600 | 只回显掩码 |

## 二、必须知道的技术事实

1. **路由服务名是 `webServer`（大写 S）**，不是 `httpServer`。`inject: ['tools','agents','webServer']`。
2. **中栏 tab 槽位** `conversation.view`；**输入框下方那行** `conversation.composer.dock`（`order` 升序，负数即最左）。
3. **侧栏会话列表没有可插入槽位**（`sidebar.workspaces` 由 ui-workspace 独占）。
4. **唤醒必须用 `Agent.followup(msg)`**；`inbox.append('next-turn')` 只会留下「待发送」草稿。
5. **只在 `agent.status === 'idle'` 时注入**，否则草稿回放 → 重复发送。
6. **goal 服务是 `ctx.goals`**：`get(agent)` → `{objective, phase, ref}`，`create/edit/clear`。
7. ⚠️ **热重载的真相（2026-11-01 修正）**：
   - **客户端 `client.js` 会热重载** —— 文件落盘后约 20 秒浏览器里自动换新（`/client-note?key=client-version` 可验证，无需重启、无需刷新）。
   - **服务端 `lib/` 改动必须重启宿主**（托盘退出→重开）。
   - 早先文档写的「客户端必须重启」是错的，已按实测更正。
8. **`file:` 安装是硬链接**：`edit` 工具原子替换会**断链**；用 python in-place 写不会。断链后 `cp` 回 profile 并 `ln -f` 重建。

## 三、踩过的坑（按代价排序）

1. **字符串替换静默失败**：替换目标文本已被改动时 `replace` 无操作 → 组件写好却没注册，白折腾 4 次重启。**每次替换后必须 grep 断言。**
2. **工具转义**：通过 shell 传给 python 的 `\\` 会被工具吃掉一层，写 `\n` / Windows 路径时用 `chr(92)` 拼，或先把代码块写文件再 splice。
3. **`bash` 工具可能整个消失**：插件层热重载失败时工具注册表会只剩插件工具；`pwsh`/`bash` 全无。重启宿主可恢复。
4. **`taskkill` / `schtasks` 的 `/run` 被 MSYS 改写** → `MSYS2_ARG_CONV_EXCL='*'`。
5. **`web_search` 工具在本机不可用**（magpie 端点不返回 search blocks）→ 用 `curl` + `gh api`；脚本在 `E:\Documents\deepseek-harness\default-workspace\research\web.py`。

## 四、下一步（按性价比）

| # | 项 | 说明 |
|---|---|---|
| 1 | ~~真机验证隔离执行~~ | ✅ 2026-11-01 验证：`git worktree list` 出现 `.dsh-zhuli/<id>` + `zhuli/<id>` 分支 |
| 2 | ~~隔离工作区清理~~ | ✅ 0.6.2 实现 `staleWorktrees` + `cleanupWorktrees`，默认回收超过 3 天没动的 |
| 3 | npm publish | 需要 `npm login` |
| 4 | awesome-dsh-plugin 上架 | 仓库满 1 天后可提（11-02 17:53 +08 之后），材料在 `docs/awesome-submission.md` |

## 五、验证清单（改完必跑）

```bash
cd /d/主工作区/projects/dsh-session-superagent
node --test                        # 63 例
node --check client.js lib/index.js lib/watch.js
ls -li client.js "/d/DeepSeek Harness/home/profiles/desktop/node_modules/dsh-session-superagent/client.js"  # inode 必须相同
```
