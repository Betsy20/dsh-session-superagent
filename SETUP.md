# SETUP：主理鱼安装剧本

> 给 coding agent：陪操作者把 `dsh-session-superagent` 装进当前 DSH，并绑到一个现有会话。
> 操作者只需对自己的 agent 说：「读仓库根目录的 SETUP.md，按它带我安装主理鱼。」

## 0. 纪律

- 收齐全部答案前，只读 [README](README.md) 和 [为什么做这个产品](docs/为什么做这个产品.md)，再跑一次下面的探测；除探测外不读别的文件、不改配置。
- 一条消息只问一个短问题，等回答再问下一题；每题给推荐答案和一句理由。上下文已经明确回答的题跳过。
- 提问期间不执行安装或配置。收齐全部答案后，一次给出完整计划；操作者明确确认后才执行。
- 密钥永远不在聊天里索要。登录只给操作者自己终端里的命令；token 只指向面板「主理鱼 → 设置 → 凭证」字段。
- 保留轻量形态：当前 profile、当前会话、一条插件安装命令。不另建 profile，不引入 tmux、独立 agent 账号或多角色执行体。

## 1. 只读探测

在仓库目录运行一次；逐项记录结果，缺失项进入计划，不变成追加问题：

```bash
dsh --version
gh --version
printf 'DSH_PROFILE=%s\nDSH_HOME=%s\n' "${DSH_PROFILE-}" "${DSH_HOME-}"
```

再按需调用现有工具：

- `repo_here`：只读当前 GitHub 仓库，作为第 1 题的推荐值；不可用就不猜仓库。
- `watch_doctor({format:"json"})`：插件已挂载时做安装前诊断；工具不存在就记为「尚未挂载或尚未加载」。它自己的隔离目录临时探针会自动删除。

除 `watch_doctor` 自身的检查外，不运行 `gh api`、`curl` 等网络探测，不运行 `gh auth token`，不读取凭证文件。
`DSH_PROFILE` 作为安装 profile；为空时在计划中列 `desktop`，由操作者随完整计划一起确认。

## 2. 一次一问

按顺序问以下五项。引号内是可改写的短模板，不要合并成问卷。

1. **仓库**
   「要盯哪个仓库？推荐：当前仓库（GitHub 用 `owner/name`，Gitee 用 `gitee:owner/name`）；直接用当前仓库最少抄录，也不容易绑错。」
2. **绑定会话**
   「绑到当前这个会话吗？推荐：当前会话；`watch_start` 只唤醒调用它的会话，不必新开窗口或 agent。」
   若答案是否，让操作者打开目标会话后从本剧本继续；不要编造 `sessionId` 参数。
3. **过滤与作者白名单**
   「首轮过滤怎么设？推荐：`labels` 留空、`allowAuthors` 只含你的登录名（回复『默认：登录名』即可）；先只让可信赖的人派活，噪音最小。」
   操作者选择其他过滤时，在同一题收齐 `labels` / `ignoreLabels` / `allowAuthors` / `onlyAssigned` 等值。
4. **隔离**
   「是否用一次性 worktree 隔离？推荐：首轮 `isolated:false`，先验证盯与唤醒，不创建副本；若选 `true`，请同答给出本地仓库的绝对 `workdir`。」
5. **goal**
   「每次唤醒要附带什么目标？推荐：『按仓库 AGENTS.md 分诊并推进已确认事项，处理后 watch_ack』；这样唤醒本身就是可执行的任务书。」

轮询间隔、限流、凭证和 profile 不另起问题：采用默认值或写进完整计划。

## 3. 收齐后给完整计划

用一条消息列全以下内容，末尾只问「按此计划执行吗？」：

- **安装**：目标 profile；执行 `dsh plugin --profile <profile> add dsh-session-superagent`，已挂载则跳过重复安装。
- **绑定**：仓库、当前会话、过滤/作者白名单、`isolated`（开启时含 `workdir`）、goal。
- **默认值**：`intervalSec:60`、单次 5 条、单 watcher 每小时 6 次、整会话每小时 12 次、默认 ack 标签（GitHub `主理鱼:已处理` / Gitee `主理鱼-已处理`）—— 这三项（`brandName` / `defaultAckLabel` / `defaultAckLabelGitee`）可由插件配置覆盖，计划里按**实际配置**写，见 README「配置」一节；未选的过滤参数省略。
- **操作者步骤**：需要登录时在自己终端跑 `gh auth login`；token 只填面板凭证字段。Gitee 需要 ack 时先建标签 `主理鱼-已处理`（Gitee 不允许半角冒号），GitHub 首次 ack 会自动建 `主理鱼:已处理`。
- **写入与回滚**：`watch_start` 会保存 watcher 并开始轮询；可用 `watch_stop({repo})` 暂停，确认不再需要时用 `watch_stop({repo,delete:true})` 删除配置。
- **验收**：下列第 5 节全部步骤；`watch_ack` 是否执行、是否回写评论，以及评论正文，都列清楚。

计划未获明确确认前，不调用安装命令、`watch_start`、`watch_ack`，也不替操作者创建测试 issue。

## 4. 确认后执行

1. **先做操作者步骤**。等待其完成登录或面板凭证填写；凭证失效时只重复给出 `gh auth login` 或凭证字段位置。
2. **装进当前 profile**（把占位符换成已确认值）：

   ```bash
   dsh plugin --profile <profile> add dsh-session-superagent
   ```

   不用 `npm i` 代替 profile 安装。`dsh` 不在 PATH 时保留原报错，把同一条命令交给操作者在自己的 DSH 终端执行。
3. **登记 watcher**。将计划中确认的参数传给 `watch_start`，例如：

   ```json
   {
     "repo": "owner/name",
     "intervalSec": 60,
     "allowAuthors": ["operator-login"],
     "isolated": false,
     "goal": "按仓库 AGENTS.md 分诊并推进已确认事项，处理后 watch_ack"
   }
   ```

   示例不是固定答案：替换占位值；未选 `allowAuthors` 就省略，开启隔离则加入绝对路径 `workdir`。同一仓库重复调用会更新配置，不另造会话。
4. 任一步失败就报告原文；只修复已确认计划内的原因，新增外部写入先回到计划确认。

## 5. 安装后验收

| 顺序 | 动作 | 通过标准 |
|---|---|---|
| 1 | 已确认计划中的 `watch_start` 返回后，调用 `watch_status({format:"json"})` | 目标仓库出现，绑定当前会话，配置与计划一致，未处于意外暂停 |
| 2 | 调用 `watch_doctor({repo:"owner/name",format:"json"})` | gh 登录、仓库访问、挂载与隔离目录检查无 `FAIL`；GitHub 首次缺少 ack 标签的 `WARN` 可由首次 ack 消除 |
| 3 | 操作者看当前 DSH 面板 | 中间栏出现「主理鱼」，输入框下方总卫星环可展开，目标仓库可见；不另起面板服务 |
| 4 | 操作者用白名单账号新建一个测试 issue，或按计划更新既有 issue/PR | 在活跃时段和限额内，当前会话收到首轮「【主理鱼】」唤醒；面板「判定」能解释结果 |
| 5 | 首轮处理后执行已确认的 `watch_ack` | 返回成功，ack 标签与本地水位更新；同一条目不会无变化重复唤醒 |
| 6 | 再跑 `watch_status`，需要时复查面板「总览 / 判定」 | watcher 仍在运行，首轮结果与 ack 可追溯 |

第 5 步的最小形式（替换仓库与编号）：

```text
watch_ack({repo:"owner/name", number:123, note:"安装验收：首轮唤醒已处理", comment:false})
```

`watch_ack` 即使 `comment:false` 也会写远端 ack 标签并推进本地水位，必须已包含在确认计划里。
`comment:true` 是另一项**显式写操作**：会把 `note` 作为评论发布到原 issue/PR，只有操作者明确同意评论正文后才使用；Gitee 回写 PR 时还要传 `kind:"pull"`。

最后交付：仓库与绑定会话、面板所见、首轮唤醒条目、ack 结果，以及 `watch_stop` 回滚方式。首轮先窄后宽，噪音偏大时优先收紧白名单或过滤，而不是增加唤醒频率。
