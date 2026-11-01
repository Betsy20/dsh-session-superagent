# 更新记录

格式参照 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.8.0] - 2026-11-01 —— 移植官方 superagent 的 GUI

把官方 `dsh-superagent`（D:\主工作区\projects\dsh-superagent-prototype）的**设计系统与信息架构**
搬进「主理鱼」标签页，数据接我们自己的 `/state`、`/watch`。

### 移植了什么
- **整套样式表**：从官方编译产物里抽出 40,557 字符 / 383 行 / 376 条选择器（`dt-*` 设计系统，
  全部基于 `--dsw-alias-*` token），原样注入，视觉与官方一致。
  用 `node scripts/port-official-ui.mjs` 可重复生成，不是手抄。
- **UI 原语**：Icon（含官方 30 个 SVG 图标）、Btn、Tag、Pill、SegTabs、Input、Toggle、
  StateDot、Dot、Section、Hint、KeyValues、Modal、ConfirmBtn。
- **三页信息架构**（对应官方 overview / trigger / settings）：
  - 总览：统计条（条数 / 主理中 / 已暂停 / 异常）+ 每条主理鱼的状态点、标签（时段 / 隔离 / 过滤 / 退避）、
    操作（立刻 / 暂停恢复 / 删除二次确认）
  - 触发：新增表单（仓库 / 间隔 / 标签 / 时段 / 只看指派 / 隔离 / 工作目录）
  - 设置：凭证（token 只显示「已配置」）+ 会话 goal
- 删除旧面板 265 行 + 未使用的 `Field` 辅助（净减 ~110 行代码，功能更多）。

### 没移植的（附理由）
- `source` / `eval` / `execution` / `deployment` / `prompts` 五个页：官方是「飞书 + 执行器 + 评估 + 提示词」
  那一套多 agent 编排，我们没有对应后端，硬搬会变成假按钮。
- `sidebar.panellist` / `plugins.row.config` 两个槽位：我们的插件只 inject `ui-conversation`，
  这两个槽位不在可见面上。

### 测试
- 面板用例重写为官方布局断言（统计条、三个页签、行内三个按钮、退避/隔离标签）。合计 **63 例**。

## [0.7.5] - 2026-11-01 —— 严格审核后的修复

审核专员（独立上下文、只读、9 个复现脚本）对 v0.7.4 给出 **8 个必须修 + 14 个建议**，
完整结论见 `docs/review-2026-11-01.md`。八个必须修**全部已修**：

1. `recordReported` 从未 import —— 每次成功唤醒都抛 `ReferenceError`（冷却吸收因此在线上是死的）。
2. `polling` 并发闸跨对象失效 —— 同一条 issue 被唤醒 3 次、建 3 个 worktree。改成 `inFlight: Set`。
3. 每小时上限分支边「攒」边吞掉条目 —— 现在只记 `lastDeferred`，不动水位。
4. tick 收尾把「暂停」写回成运行中 —— 抽出 `mergePollResult()`，配置字段以盘上为准。
5. 隔离区在 idle 检查之前创建，忙时每轮白建 worktree —— 先 `decideWake` 再隔离。
6. `dispose` 没清定时器 —— 现在清 `timers` 与 5s sweep。
7. `trigger.json` 测试通道随包发布 —— 默认关闭，需 `DSH_SUPERAGENT_TRIGGER=1`。
8. SSH 私钥功能是空的且掩码泄露全路径 —— 面板不再回显路径，token 只回 `configured`。

### 顺带修的
- `workdir` 要求绝对路径 + 存在；`enabled` 未传时保持原值；状态文件改原子写；
  `client-note` 加键白名单；`github` 工具拒绝 `-` 开头的 path；9 处过期文档。

### 测试
- 新增 import 守门（能钉住 #1 这类事故）+ `mergePollResult` 用例。合计 **63 例**。

## [0.7.4] - 2026-11-01

### 新增
- **路由层单测**（`test/routes.test.mjs`，7 例）：此前 HTTP 路由是 0 覆盖，全靠真机 curl 手测。
  现在用假 `ctx` 捕获 `apply()` 注册的工具与路由，再用假 req/res 跑完整链路：
  建 watcher → `/state` 查 → pause → resume → delete、非法 action、未知 id、405、探针写入。
- 两个测试隔离用开关（也是实用功能）：
  - `DSH_SUPERAGENT_STATE` 覆盖状态目录（默认 `~/.dsh/state/session-superagent`）；
  - `DSH_SUPERAGENT_NO_POLL=1` 只登记 watcher 不轮询。

### 变更
- watcher 的 `setInterval` 加 `unref()`，测试进程不会被定时器吊住（宿主不受影响）。

### 测试
- 合计 **61 例**。

## [0.7.3] - 2026-11-01

### 修复
- **CHANGELOG 丢了 14 个版本**：0.3.7 ~ 0.7.2 的条目全没进去。原因是插入新条目时用
  `s.replace('## [0.3.x] ...', 新条目 + 锚点)`，锚点早就不存在 → python 的 `str.replace` **静默无操作**，
  而我当时没 grep 验证。现在已按 git 提交历史补齐 0.3.7 起的全部条目。
- README 版本徽章停在 0.3.6，同步到当前版本。
- `package.json` 缺 `author` / `homepage` / `bugs`；`files` 漏了 `scripts/preview-orbit.mjs`
  （README 里写了 `pnpm run preview:orbit`，但发布包里没有那个文件）。

### 新增
- **版本一致性守门测试**（`test/meta.test.mjs`，4 例）：CHANGELOG 顶部版本、README 徽章版本、
  `CLIENT_VERSION`、必需元数据 —— 三者任一与 `package.json` 不一致就红。

### 测试
- 合计 **54 例**。

## [0.7.2] - 2026-11-01

### 新增
- **`watch_doctor` 自检工具**：一条命令体检所有 watcher —— gh 是否登录、仓库能不能访问、
  ack 标签在不在、隔离 workdir 是不是 git 仓库、上次轮询状态。只读。
- **唤醒历史**：每次唤醒记 `{at, numbers, ok, reason}`（保留 20 条），`/state` 回传最近 5 条；
  面板显示「上次唤醒 #12 #13 · 2 分钟前」或「上次唤醒失败 #7」。

### 测试
- 新增唤醒历史的面板用例。合计 **50 例**。

## [0.7.1] - 2026-11-01

### 新增
- 新增表单补齐三个开关：活跃时段、隔离执行、隔离工作目录（此前只能走 API 传）。
- **ack 标签自动创建**：GitHub 不会因为 `POST /issues/{n}/labels` 而自动建标签（不存在返回 422），
  现在先幂等建一次（已存在也返回 422，忽略），再打标签。
- **失败提示可执行化**：`lastError` 在原始 stderr 后补一句人话 —— 401 → 跑 gh auth login；
  404 → 检查 owner/name；找不到 gh → 确认已安装且在 PATH。

### 文档
- README / HANDOFF 同步。

## [0.7.0] - 2026-11-01

### 新增
- **活跃时段**（`activeHours: "09:00-23:00"`，支持跨夜）：不在时段只攒不唤醒。
- **会话忙时排队重试**：失败原因含 busy/running/idle 时**不退避**，下一轮直接重试；真失败才退避。
- **`watch_ack` 批量**：`numbers: "12,13,14"` 一次 ack 多条。
- **面板显示隔离状态与活跃时段**；**值守台「全部暂停 / 全部恢复」**。

### 测试
- 新增 `inActiveHours` 与两个 UI 用例。合计 **49 例**。

## [0.6.2] - 2026-11-01

### 新增
- **隔离区自动回收**：`staleWorktrees()` + `cleanupWorktrees()`，每次开新隔离区前回收超过
  `isolateKeepDays`（默认 3 天）没动过的旧副本。

### 修复
- 又一个「改了没写盘」：给 `lib/watch.js` 加函数时只改了内存字符串，文件没写，而 `index.js` 已经 import
  —— `node --check` 查不出来，宿主重启时整块插件会加载失败。新增守门测试：解析 import 列表逐个断言导出。

### 测试
- 新增 2 例。合计 **46 例**。

## [0.6.1] - 2026-11-01 —— 隔离执行真机验证暴露的三个问题

### 修复
- **中文路径被写成乱码**：Windows 下 argv 里的中文常是 GBK 字节，按 UTF-8 解得到一串 U+FFFD
  （实测 `D:/主工作区/...` 存成 `D:/??????/...`，worktree 建不出来）。新增 `decodeBody()`：
  UTF-8 解码出现替换字符就用 `TextDecoder('gbk')` 重解。
- **同一个 watcher 并跑两轮**：首轮 tick 与手动「立刻」撞车会开两个隔离区。`entry.polling` 做并发闸，重复请求 409。
- `/state` 补 `isolated` / `workdir` / `lastWorktree`。

### 测试
- 新增 `decodeBody` 用例。合计 **44 例**。

## [0.6.0] - 2026-11-01

### 新增
- **隔离执行**（对标 DeepSeek DSec）：watcher 支持 `isolated: true` + `workdir`，每次唤醒前
  `git worktree add` 一个一次性副本（分支 `zhuli/<id>`，目录 `<workdir>/.dsh-zhuli/<id>`），
  唤醒消息给出路径与分支并写明「只在这里改、推这个分支开 PR、别碰主工作区」。
  建不出来不阻断唤醒，消息里改成「【隔离失败】原因」。

### 测试
- 新增 `worktreePlan` 与隔离消息用例。合计 **43 例**。

## [0.5.1] - 2026-11-01

### 新增
- 面板显示过滤器 / 退避 / 攒批；值守台状态列在退避窗口内显示「退避中」。

### 测试
- 合计 **41 例**。

## [0.5.0] - 2026-11-01

第一个「按竞品和论文调过」的版本，整合 0.4.1 + 0.4.2 并补齐文档。

- 触发许可 `filters`、限流 `batchLimit` / `maxWakesPerHour`、失败指数退避
- 幂等 `watch_ack`（GitHub 打标签）、交互「立刻」按钮、可验证的完成标准
- 记忆 `seen` 30 天 / 500 条自动遗忘
- 文档：`docs/competitive-analysis.md`、`docs/deepseek-papers.md`、`HANDOFF.md` 重写

## [0.4.2] - 2026-11-01

### 新增
- **幂等标记落在 GitHub 上**：`watch_ack` 给 issue/PR 打 `主理鱼:已处理` 标签并前移本地水位；
  轮询跳过带标签的条目（换机器、删状态文件都不重报）。
- **立刻跑一次**：`POST /watch {action:"poll"}`，面板/值守台每行「立刻」按钮。
- **面板配过滤器**：新增表单加「只处理这些标签」「只处理已指派给人的条目」。

### 变更
- 唤醒消息的完成标准改成可验证（没跑测试不算完成）。
- `seen` / `lastReported` 增加记忆遗忘。

### 测试
- 合计 **39 例**。

## [0.4.1] - 2026-11-01

### 新增（竞品蒸馏）
- **触发许可**：`filters`（labels / ignoreLabels / skipBots / skipDrafts / skipClosed / onlyAssigned / assignee）。
- **批量铺开**：`batchLimit`（默认 5），其余给编号。
- **每小时上限**：`maxWakesPerHour`（默认 6）。
- **失败退避**：30s → 60s → 120s … 封顶 30 分钟。
- **唤醒消息结构化**：类型、草稿、标签、指派、链接 + 明确约束。

### 测试
- 合计 **37 例**。

## [0.4.0] - 2026-11-01

### 变更
- **「盯办」改名「主理鱼」**：「主理人」的职责（盯场子 + 拿主意 + 动手办）搬到会话里就是这条鱼；
  本机主力模型是条大肥鱼（deepseek-v4.1），所以不叫主理人，叫主理鱼。
- 标签页 `主理鱼`、状态 `主理中`、量词用「条」。

### 测试
- 合计 **30 例**。

## [0.3.9] - 2026-11-01

### 变更
- **「值守」改名「盯办」**：旧词只覆盖被动半边（轮询/去重/唤醒），漏掉醒之后的主动推进。
  标签页 `盯办台`、状态 `盯办中`。

## [0.3.8] - 2026-11-01

### 变更
- 状态栏面板表头由「会话级 superagent」改为「值守」，右侧计数改「0 个」——
  那个短语是插件自称，和会话标题撞名会让人以为是会话名。

## [0.3.7] - 2026-11-01

### 新增
- 客户端版本探针 `CLIENT_VERSION`：每次模块加载写一次 `/client-note?key=client-version`，
  用来确认浏览器里跑的是哪一版（顺带发现客户端插件是**热重载**的，不需要重启）。

## [0.3.6] - 2026-11-01

### 变更
- 空态面板收紧：宽度 344 → 252，正文压成一句「在「值守台」填 owner/name 添加。」，
  不再显示「点「暂停 / 删除」直接停掉」这条脚注（没有值守时它没有指向对象）。

## [0.3.5] - 2026-11-01

### 变更
- **0 个值守也占位**：之前整条直接不渲染，看起来像插件失效；现在画一个灰色空环
  （`currentColor` + 0.38 透明度、无卫星、不转、不呼吸），点开面板提示「还没有值守，去值守台添加」。
- **轨道环挪到 dock 行最左端**：`order: 2` → `order: -10`，排在「轮/步」「token」之前，
  不再紧贴上下文环。
- `pnpm run preview:orbit` 的预览里加了空态这一行。

## [0.3.4] - 2026-11-01

### 修复
- **凭证卡片里的 SSH 路径示例是坏的**：源码写成 `'D:\keys\id_ed25519'`，JS 把 `\k` `\i`
  当转义吃掉，界面上显示成 `D:keysid_ed25519`。现在示例正确显示 `D:\keys\id_ed25519`。

### 变更
- 凭证卡片底部补一句说明：不填也能用（插件直接复用已登录的 gh CLI）；只有想给 agent
  单独一个 token、或走 SSH 推代码时才需要填。

## [0.3.3] - 2026-11-01

### 新增
- **值守能关了**：`POST /session-superagent/watch` 接受 `{ action: "pause" | "resume" | "delete", id }`，
  `id` 形如 `owner/name#session-…`（`/state` 现在会把 `id` 一起返回）。
  - `pause`：`enabled=false` 并**清掉那条定时器**（原来只能靠宿主重启才停得下来）；
  - `resume`：重新起定时器，顺手清掉旧的 `lastError`，卫星不会一上来就是红的；
  - `delete`：连条目一起删（`seen` 水位也走掉，重新加会重新报一遍历史动态）。
- **状态栏面板每行**有「暂停 / 恢复 / 删除」；**值守台表格**新增「操作」列，同样两个按钮。删除前 `confirm` 一次。
- 暂停后的 tick 会直接 return，不再轮询。

### 修复
- `persistEntry` 会把已删除的条目写回来（tick 与删除的竞态）：现在目标条目不在状态里就跳过写回。

### 测试
- `applyWatcherAction` 4 组断言（只动目标条目、恢复时清错误、删除不连带、非法动作/未知 id/空状态全部拒绝）；
- 客户端新增 2 例：状态栏面板每行有暂停/删除、值守台表格有「操作」列且按状态切换暂停/恢复。
  合计 **29 例**。

## [0.3.2] - 2026-11-01

### 变更
- **轨道环从会话头部挪到输入框下方那一行**（`conversation.composer.dock`，与「轮/步 · token · 上下文环」同一行，`order: 2`）。
  会话头部那个"只代表当前会话"的徽章不再注册。
- **改成机器级聚合环**：一个环代表这台机器，环上每一颗卫星 = 一个在运行的会话级 superagent
  （绿=值守中，琥珀=已暂停，红=上次轮询失败）；超过 6 个时环上只画 6 颗，其余进详情面板。
- **点击展开详情面板**：逐条列出 仓库 / 会话标题 / 间隔 / 上次轮询 / 上次唤醒 / 状态 / 错误原文；
  定位在按钮正上方，Esc 或点击空白关闭。无值守时整条不渲染。

### 修复
- **轨道环是个死图标**：`OrbitMark` 给 `<g>` 打了 `class="sa-sat-spin"`，但注入的样式表里
  **根本没有这条规则**（只在代码里引用了类名，没写 CSS），所以环一动不动。
  现在改成把动画写进 SVG 本身：`<animateTransform>` 让卫星公转（6s/圈）、`<animate>` 让环呼吸
  （2.6s）、红点呼吸（1.6s）—— 不依赖注入的 `<style>`，也不吃 CSP / `transform-box` 的差异，
  一个 .html 就能预览。并遵守 `prefers-reduced-motion`。
- 面板每行补 **8 位会话后缀**（标题由标题模型生成，多个会话可能重名）与 **`goal` 摘要**；
  顺带修掉值守台里把 goal 对象直接拼成 `[object Object]` 的老问题。

### 工具
- `pnpm run preview:orbit` → 用**真实组件**渲染出 `orbit-preview.html`（5 种状态 × 放大/原尺寸两种尺寸），
  改动画后不用重启宿主就能先看效果。

### 测试
- 新增 `test/client.test.mjs`（6 例）：在 Node 里用假 React 跑**真实** `client.js`，断言
  槽位注册（含"头部不再注册"）、无值守返回 null、卫星数=值守数且上限 6、
  **动画是 SVG 自带的 SMIL（暂停/异常不转，值守中才转）**、异常点呼吸而正常点不呼吸、
  详情面板文案齐全。合计 26 例。

## [0.3.1] - 2026-11-01

### 修复
- **头部徽章从未注册**：0.3.0 的注册代码插入时目标文本已被其他改动替换，字符串替换静默失败，
  导致组件存在但 `apply()` 没有注册它。现在 `apply()` 整体重写，两处注册分别独立 try/catch 并留探针。
- 诊断探针改为每次页面加载只写一次（原来 `badge-state` 每 5 秒写状态文件）。

### 验证（Windows 11 + DSH 0.2.1-rc.5 真机）
```
apply done · desk-registered ok · badge-registered ok
badge-mount  session-1e82afca-…
badge-state  found:MYCF711/dsh-GOkifu-compact
server.routes 8
```

## [0.3.0] - 2026-11-01

### 新增
- **会话头部轨道点徽章**（`conversation.session.header.actions`，仅图标 + 原生 tooltip）：
  - 值守中：绿点沿环匀速绕行（3s/圈）
  - 已暂停：虚线环 + 琥珀点静止
  - 有错误：实线环 + 红点呼吸闪烁
  - tooltip 三行：仓库 / 每 Ns + 上次轮询 / 状态（与会话列表原生 tooltip 同构）
- **真实会话 goal**：面板读写 `ctx.goals`，与 `/goal` 命令、`create_goal`/`update_goal` 工具同一份状态，5 秒轮询双向同步。
- **面板显示会话标题**：服务端从会话日志 `session/title` 事件解析（按 mtime 缓存），替换原始 session id；标题前加状态点。
- **凭证配置**：面板可填 GitHub token / SSH 私钥路径，存 `~/.dsh/state/session-superagent/secrets.json`（0600），只回显掩码摘要；所有 `gh` 调用自动带 `GH_TOKEN`。
- **新增值守**：面板直接添加 watcher，绑定当前会话。

### 说明
- 侧栏会话列表行**没有**可插入的槽位（`sidebar.workspaces` 是 single slot，由 ui-workspace 独占），
  所以徽章放在会话头部；列表行图标需要上游暴露 row badge 槽位。

## [0.2.1] - 2026-11-01

### 修复
- **面板数据 404**：路由注册的服务名是 `webServer`（大写 S），不是包文档写的 `httpServer`。
  `inject` 改为 `['tools','agents','webServer']`，直接 `ctx.webServer.register(...)`。
- 移除了会静默失败的 `ctx.inject` 延迟注册路径；`registerRoutes` 失败时把错误写进状态文件 `server.error`。

### 新增（诊断）
- 客户端加载时 `GET /session-superagent/client-hello`、注册失败时 `GET /session-superagent/client-error`，
  结果落在状态文件 `client.{hello,error}`，用于区分「客户端没被加载」与「注册抛错」。
- 面板 tab 的 `order` 从 50 调到 30，避免被挤进溢出菜单。

### 验证
- 真机：Windows 11 + DSH 0.2.1-rc.5，面板显示 1 个 watcher（`MYCF711/dsh-GOkifu-compact`，30s，运行中）。

## [0.2.0] - 2026-11-01

### 新增
- **「值守台」中栏面板**：注册到 `conversation.view`，与 Chat / Trajectory / Waterfall 并排。
  每 5 秒读取 `/session-superagent/state`，显示每个 watcher 的仓库、会话、间隔、上次轮询、上次唤醒、运行状态与错误。
- 服务端新增只读路由 `/session-superagent/state`（`ctx.httpServer`，可选注入；无 Web 表面的宿主照常提供工具）。
- `inject` 改为 `{ required: ['tools','agents'], optional: ['httpServer'] }`。

### 说明
- 面板只读：不提供暂停/恢复按钮，也不显示任何凭证。
- 浏览器侧零依赖（React 由宿主提供）。

## [0.1.2] - 2026-11-01

### 修复
- **吸收而非延迟**：冷却窗口内的自更新不再只是“跳过”，而是把水位推到最新（`partitionItems().absorbed`）。
  0.1.1 只延迟，窗口一过同一条 issue 会再次上报；本版彻底吸收，不再复现。
- `pollOnce` 新增 `absorbed` 分支：静默推进 `seen` 与 `cursor`，不唤醒、不计数。

### 测试
- 20 项单测（新增 2 项：吸收行为、窗口结束后不复现）。

## [0.1.1] - 2026-11-01

### 修复
- **冷却窗口**：处理完某条 issue/PR 后，默认 180 秒内忽略它的再次变化。
  原来只靠逐条水位，挡不住“回复完 → 关闭它”这类自己造成的后续 bump，会再唤醒一次。
- 新增 `recordReported()` 与 `splitFresh(..., {now, cooldownMs})`，均有单测覆盖。

### 测试
- 18 项单测（原 15）。

## [0.1.0] - 2026-11-01

### 新增
- `github`：调用 GitHub REST API，凭证不进模型，返回统一脱敏；写方法必须 `confirm: true`。
- `repo_here`：报告当前工作目录对应的仓库。
- `watch_start` / `watch_status` / `watch_stop`：轮询单个仓库并在变化时唤醒当前会话。
- `trigger.json` 手工测试通道：5 秒扫描，用于在不重启宿主的前提下验证注入链路。

### 修复（开发期发现）
- 唤醒失败时不再推进水位，避免事件被永久吞掉。
- 逐条水位替代全局 cursor，消除“自己评论→自己再被唤醒”的回声。
- 仅在 `agent.status === 'idle'` 时注入，消除“已发送内容回退到待发送并重复发送”的客户端草稿回放。

### 已知限制
- 轮询模型，无 webhook。
- 单会话单仓库。
