# HANDOFF —— 会话交接（2026-11-02 02:45，v0.8.11）

> 写给**接手的下一个 agent / 下一个会话**。读完它 + `docs/competitive-analysis.md` + `docs/deepseek-papers.md`，就能接着干，不用翻聊天记录。

## 一、项目现状

- 仓库：https://github.com/MYCF711/dsh-session-superagent
- 版本：**v0.8.11**
- 本地：`D:\主工作区\projects\dsh-session-superagent`（profile 里以 `file:` 安装，**硬链接**：改源码即改 profile 内文件）
- 真机：Windows 11 + DSH 0.2.1-rc.5，`node --test` **77/77**（重启后真机复验通过）

| 能力 | 实现位置 | 验证方式 |
|---|---|---|
| 主理鱼标签页（移植官方 GUI） | `client.js` → `conversation.view`，用 `docs/official-gui-ia.md` 的 IA 重建 | `desk-registered ok` + 70 例测试 |
| 状态栏「主理鱼」轨道环（0 条灰环占位 / 卫星公转 / 点击看详情） | `client.js` → `conversation.composer.dock`（`order: -10` 最左端） | `/client-note?key=client-version` 探针 + 面板实测 |
| 主理鱼 tab（增删/暂停/立刻跑/配过滤器/凭证/goal） | `client.js` → `conversation.view` | `desk-registered ok` |
| 轮询 + 唤醒 | `lib/index.js` + `lib/watch.js` | `lastPoll` 前进；`followup` 唤醒 |
| 过滤器 / 批量 / 每小时上限 / 失败退避 | `lib/watch.js` 纯函数 + `/watch` 路由 | `node --test`（`passesFilters` / `batchFresh` / `nextDelayMs` / `pruneWakeTimes`） |
| 活跃时段（含跨夜） | `inActiveHours()` + pollOnce 时段闸 | `node --test`（普通/跨夜/空值/起止相同） |
| 隔离执行 + 自动回收 | `worktreePlan` / `prepareIsolation` / `cleanupWorktrees` | 真机 `git worktree list` 出现 `.dsh-zhuli/<id>` |
| `watch_doctor` / 隔离 E2E | 真机跑过：doctor 五项检查全出；`git worktree list` 出现 `.dsh-zhuli/<id>` + `zhuli/<id>` |
| 幂等标记 | `watch_ack` 工具 + `hasAckLabel` | 打 `主理鱼:已处理` 标签后轮询跳过 |
| 会话 goal（真 goal） | `ctx.goals` | 面板读写，5s 轮询 |
| 凭证 | `~/.dsh/state/session-superagent/secrets.json` 0600 | 只回显掩码 |

**重启后真机复验（2026-11-02 01:25，v0.8.10）**：

```
server        = {at: 17:21:44Z, routes: 8}     ← 插件正常挂载
client-version= 0.8.10
/state /config= 200 / 200
gh 探针       = {"ok":true,"version":"gh version 2.101.0"}
watch_status  = 工具可用（重启前因插件未挂载曾消失）
建→查→删      = observe:true + note 正常往返
profile 同步   = 相对 import 全部可解析
```

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
8. **新增文件不会自动进 profile**（2026-11-01 23:59 事故）：`file:` 安装只对已有文件建硬链接，
   新增的 `lib/body.js` 没进 `node_modules/…/lib/`，宿主 import 失败 → **插件整个不挂载**
   （工具和路由全消失，客户端 bundle 却照常加载）。新增文件后必须 `pnpm run sync:profile`。
   这是硬链接安装的隐性坑，比"改内容要重启"严重得多。

9. **本地模拟 `apply()` 会写真实状态文件**：`server` 字段被模拟脚本的报错覆盖过
   （`webserver: duplicate exact route ...`）。写这类脚本必须先设 `DSH_SUPERAGENT_STATE` 指向临时目录，
   `scripts/smoke-observe.mjs` 就是这么做的。

10. **`file:` 安装是硬链接**：`edit` 工具原子替换会**断链**；用 python in-place 写不会。断链后 `cp` 回 profile 并 `ln -f` 重建。

## 三、踩过的坑（按代价排序）

1. **字符串替换静默失败**：替换目标文本已被改动时 `replace` 无操作 → 组件写好却没注册，白折腾 4 次重启。**每次替换后必须 grep 断言。**
2. **工具转义**：通过 shell 传给 python 的 `\\` 会被工具吃掉一层，写 `\n` / Windows 路径时用 `chr(92)` 拼，或先把代码块写文件再 splice。
3. **`bash` 工具可能整个消失**：插件层热重载失败时工具注册表会只剩插件工具；`pwsh`/`bash` 全无。重启宿主可恢复。
4. **`taskkill` / `schtasks` 的 `/run` 被 MSYS 改写** → `MSYS2_ARG_CONV_EXCL='*'`。
5. **`web_search` 工具在本机不可用**（magpie 端点不返回 search blocks）→ 用 `curl` + `gh api`；脚本在 `E:\Documents\deepseek-harness\default-workspace\research\web.py`。

## 四、验证与审核台账

### 审核（三轮，全部有结论落盘）
| 轮 | 对象 | 结论 | 落盘 |
|---|---|---|---|
| 一 | v0.7.4 全仓 | 8 个必须修 + 14 建议 | `docs/review-2026-11-01.md` |
| 二 | v0.8.4 GUI 移植 | 7 个必须修 + 13 建议；复核再抓出第 8 个（删除按钮 className 被覆盖） | 同上 |
| 三 | v0.8.8 发布门禁 | 2 个阻塞（goal 只算没拼、缓存 TTL 失效）；修复后复核 **「可以发布，无阻塞项」** | 同上 |

### 真机验证（不是单测，是跑起来的宿主上做的）
| 时间 | 验了什么 | 证据 |
|---|---|---|
| 01:25 | 重启后插件挂载 | `server.routes=8`、`/state /config` 200、`client-version` 一致 |
| 01:41 | `watch_doctor` 五项检查 | gh 登录 / 仓库可访问 / ack 标签 / 隔离目录是 git 仓库 / 上次轮询与错误 |
| 01:41 | 隔离执行 E2E | `git worktree list` 出现 `.dsh-zhuli/<id>` + `zhuli/<id>`；`lastWorktree`、`history` 正确 |
| 02:41 | 幽灵会话守卫（0.8.11） | 会话不存在时 `lastError="会话已不在…"`、**不建** worktree（修复前会白建一个） |
| 04:0x | 真唤醒 + 隔离（进程内冒烟 B） | followup 1 次、消息含【主理鱼】/编号/本条目主理目标/隔离路径、`.dsh-zhuli/` 下正好一个副本 |
| 03:5x | observe + 过滤落盘（进程内冒烟） | `pnpm run smoke:observe` 五项全 OK：不唤醒 / filteredLog 落盘 / 原因可读 / `/state` 读得到 / 空轮询清 deferred |
| 03:0x | **ack 幂等闭环（真 GitHub）** | `watch_ack` 给 `MYCF711/dsh-GOkifu-compact#2` 打上 `主理鱼:已处理`（中文+冒号 GitHub 接受），再 ack 一次不报错；随后已把标签与定义都撤掉 |
| 02:50 | npm 发布可安装性 | `npm i dsh-session-superagent@0.8.12` → `apply()` 成功、路由 7 条、client 语法通过 |
| 02:41 | 真实业务闭环前的数据面 | `/state.gh` = `gh version 2.101.0`；建→查→删 watcher 全部往返正常 |

### 两次生产事故（都已修 + 有守门）
| 事故 | 根因 | 守门 |
|---|---|---|
| GBK 路径乱码导致 body 解码失败 | Python/Git 输出 CP936 | `decodeBody` 字节层兜底 + 7 例路由测试 |
| 重启后插件整体不挂载（路由/工具全消失） | 新增 `lib/body.js` 没进 profile（`file:` 安装只对已有文件建硬链接） | `scripts/sync-profile.mjs`（同步 + 相对 import 自检） |

## 五、自动化约定（每小时定时任务）

- 定时任务每轮**第一步是自愈 goal**：`get_goal`，若不是 active 就 `create_goal`/`update_goal resume`。
  自动化不允许停在「无 goal / goal 已封存」状态 —— 这是用户明确要求的行为。
- 每轮开工先 `node --test`，红了先修红再干别的。
- 哨兵数据：`/session-superagent/state`（含 `server.at`、`client.note:client-version`、`gh`）。
- **新增文件后必须 `pnpm run sync:profile`**，否则下次重启插件整体不挂载（2026-11-01 23:59 事故）。

## 六、下一步（按性价比）

| # | 项 | 说明 |
|---|---|---|
| 1 | ~~npm publish~~ | ✅ 2026-11-02 已发 `dsh-session-superagent@0.8.11`（latest 已指向它，占位版已弃用） |
| 2 | awesome-dsh-plugin 上架 | 仓库满 1 天后可提（11-02 17:53 +08 之后），材料在 `docs/awesome-submission.md` |
| 3 | 真实仓库的隔离闭环 | 用真会话 + `isolated:true` 跑一次唤醒，确认 agent 在 worktree 里干活 |
| 4 | 仍未做的审核建议 | SegTabs 焦点跟随、Toast 顶部居中（内联容器已删但没用官方定位）、`/config` 与 `/state` 字段可再收敛 |

## 五、验证清单（改完必跑）

```bash
cd /d/主工作区/projects/dsh-session-superagent
node --test                        # 77 例
node --check client.js lib/index.js lib/watch.js
node scripts/sync-profile.mjs     # 新增文件后必须跑：同步 + 相对 import 自检
ls -li client.js "/d/DeepSeek Harness/home/profiles/desktop/node_modules/dsh-session-superagent/client.js"  # inode 必须相同
```
