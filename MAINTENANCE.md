# MAINTENANCE.md —— 维护台账（给接手的 agent 看）

> 接手前先读这一页，再按 [AGENTS.md](./AGENTS.md) 的「先定位你在哪一步」读对应文档。
> **每次干完活必须更新「二、当前状态」与「三、下一步」** —— 这页不是历史，是交接单。
>
> 形态参照 `MYCF711/magpie-plugin-scaffold` 的维护台账，本地化成这个仓库的真实命令与数字。

## 一、身份

| 项 | 值 |
|---|---|
| 仓库 | `MYCF711/dsh-session-superagent` |
| npm 包名 | `dsh-session-superagent` |
| 当前版本 | `0.9.168`（npm 已发布 / tag `v0.9.168` / GitHub Release 为 Latest） |
| 形态 | DSH 插件：7 个工具 + 自带 `cordis.patch.yml` + 客户端面板与状态栏圆环 |
| 目标宿主 | DeepSeek Harness ≥ 0.2.1-rc.5；Node ≥ 22.19；需已登录 `gh` CLI |

## 二、当前状态（2026-11-04）

```text
分支        main（HEAD 4a0e370）
版本        0.9.168；tag v0.9.168（远端已推）；release v0.9.168 = Latest
工作区      clean；安装副本 %DSH_HOME%\profiles\desktop\node_modules\... = 0.9.168
```

| 资产 | 数量 |
|---|---:|
| `node --test` | 267 例全过 |
| `scripts/preflight.mjs` | 37 项全 PASS（`--fast` 36 项） |
| `scripts/ui-audit.mjs` | 11/11，100 分（写死颜色 0 / 自造 token 0） |
| `docs/kb` | 177 篇 / 9 板块（`check-docs` 五项 PASS，含总数校验） |
| `scripts/` | 52 个门禁与工装脚本 |
| GitHub Release | 34 个（v0.9.136–v0.9.169 已补，其余待按批次回填） |
| CI / 分支保护 | `ci`（Node 22/24）在 PR 与 main 上跑；main 已开 required check，禁强推禁删 |

已验证（本轮实测）：

- `node --test` → 267/267；preflight 全量 37/37；ui-audit 11/11 = 100；`check-docs` 五项 PASS；
- `sync-profile --check` → 缺失 0 / 断链 0 / 陈旧 0；安装副本 `package.json` = 0.9.169；
- `npm publish` → `+ dsh-session-superagent@0.9.169`；`git push` → 见 `git log --oneline -1`；
- 外部 PR：#2 / #3 / #5 / #6 已处理（#2 #3 → 0.9.167，#6 → 0.9.168，#5 按重复关闭）；
  #7（`ghConfigDir`）留在 open 等作者按三条意见改完。

未验证（不能写成"通过"）：

- **真机走查 22 项**（`docs/真机走查清单-弹层.md`）—— 需要人在界面上按 Tab/Escape、看两套主题；
- 连续 24 小时运行的误唤醒率、限流表现；
- 键盘 Tab 顺序无自动化手段（只有静态断言）。

## 三、下一步

按价值排序，**不要一次混着做**：

1. 回填剩余 GitHub Release（`node scripts/release-gh.mjs`，用户要求"之前的慢慢改"）；
2. 收掉 `diagnoseBadBody()` 的盲区：本地切分错误不该被报成"网络/代理问题"；
3. PR #7（`ghConfigDir`）等作者改完三条后复核合入；
4. 真机走查 22 项（需要用户配合，或按用户截图逐条对照）。

## 四、硬约束

1. **不重启、不关闭宿主的 DSH**；需要重启才生效的改动（服务端部分）只提示用户，自己不执行。
2. **凭证永不出插件**：所有返回必须过 `redact()`；新增输出路径要补测试；
   **路径也不回显**（Windows 反斜杠曾让掩码整段漏出）。
3. **不修改用户 profile 的 `bundles`**；本项目只随包带 `cordis.patch.yml`。
4. **没跑过的写成"未验证"**，不写"通过"；"包含"式断言不算验证过（见 AGENTS 坑 7）。
5. **发布三处必须一致**：`package.json` / `lib/index.js` / `client.js` / README 徽章 / CHANGELOG
   （`test/meta.test.mjs` 会拦），外加 **tag 与 Release 标题只写版本号**。
6. **不代改他人 PR**：给意见让对方改，改完我复核合入。
7. **标准写在文档里不算数**：新加的检查必须接进 `preflight` 或 CI，否则就是「标准悬空」
   （写好了没人调用 = 没写）。见 [docs/维护标准.md](./docs/维护标准.md)。

## 五、给接手者的最短路径

1. 读本文件 + [AGENTS.md](./AGENTS.md) 的两张表（定位 / 坑）；
2. `git status` + `git log --oneline -5` + `node --test` 核实现状（**别信本文件的数字，跑一遍**）；
3. 按 AGENTS 定位表读对应专档，别通读；
4. 改完跑 `node scripts/preflight.mjs`（全量）再交付；
5. 发版按 [UPDATING.md](./UPDATING.md)，最后回来更新本文件的「当前状态」。
