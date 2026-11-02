# preflight 的两种模式

> 这份文档由 `scripts/render-preflight-modes.mjs` 生成，清单来自 `scripts/preflight-modes.mjs`。
> 手改会被 `preflight` 的「模式差异文档」检查发现。

| 模式 | 用途 | 约耗时 |
|---|---|---|
| 全量 `node scripts/preflight.mjs` | 提交前 / 发布前 | 约 30 秒 |
| 快速 `node scripts/preflight.mjs --fast` | 边改边跑 | 约 12 秒 |

## `--fast` 会跳过什么

| 跳过的检查 | 为什么跳过 | 跳过后的风险 |
|---|---|---|
| 门禁自检 | 要 21 次注入（每次改文件再跑检查），约 4 秒 | 跳过后不会发现"某条检查已经装死" |
| 冒烟 smoke:observe | 需要真机宿主（DSH_SMOKE_HOST=1） | 跳过后不会发现真机上的观察模式失效 |

## 什么时候必须跑全量

- 提交前（`--fast` 全绿**不代表**可以提交）
- 改了任何 `scripts/*` 检查脚本之后（注入验证要重新确认它们真的会红）
- 发布前一版（`npm publish` 之前）
