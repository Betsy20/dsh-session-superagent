# 标准悬空：写好了没人调用 = 没写

## 出处
- 一份对成熟开源项目维护标准的调研（55 条，必备 / 标杆 / 加分三档）：
  它在 `magpie-plugin-scaffold` 上指出的三处「标准悬空」，比缺文件更值得警惕。
- 本仓库对照后落地的版本：[docs/维护标准.md](../维护标准.md)。

## 现场（对照之后发现的三种悬空）

1. **脚本写好了，没人接**：`privacy-scan` 在脚手架里 109 行、10 条规则，
   但没有任何 workflow 调用它 —— 等于没写；
2. **门禁在报警，没人接**：`check-maintenance` 在 `from == to`（刚发完版的常态）时整段跳过，
   于是 15 个从未打 tag 的版本它报「✓ 没有跳过版本」；
3. **文档里的数字没有锚**：`MAINTENANCE.md` 四项里三项过期、`AGENTS.md` 标题写「十三条」表里 14 行。
   本仓库也中过：KB 索引写「共 158 篇」，实际 176 篇（0.9.169 才发现）。

## 判据

**一条标准要成立，必须能被机器判真。** 具体三个条件：

- 有命令：`node scripts/<name>.mjs` 能跑出退出码；
- 有接线：它被 `preflight` 或 CI 调用（否则永远没人跑）；
- 有锚：文档里的数字/清单由脚本比对，而不是人记。

缺任一条，它就是"写给人看的自我安慰"。

## 本仓库的落地（0.9.170）

| 悬空形态 | 我们怎么接上 |
|---|---|
| 脚本没人跑 | CI 新增 ui-audit / check-docs / check-maintenance 三步 |
| 门禁报警没人接 | `check-maintenance` 接进 `preflight`（37 项） |
| 数字没有锚 | `check-docs` 新增「索引总数 = 板块合计」；README 测试数早有 `audit-readme-tests` |
| 检查静默跳过 | 门禁自检 `verify-gates` 用注入验证「它真的会红」 |

## 是否已落地
✅ 0.9.170：CI 三步接线、`check-maintenance` 进 preflight、索引总数校验、分支保护已开。

## 还没做的
- CI 只在 push/PR 跑，**没有 nightly**：长期漂移（依赖、宿主 API）不会被提前发现；
- 分支保护开了 required check，但 `enforce_admins=false` —— 单人维护的取舍，写进了维护标准第四节。
