# 工具描述是 agent 的契约：承诺要两头都对得上

## 出处
- 同一份能力有两种读者：agent 读工具描述，人读文档。
  这与我们 KB 里 [同一套规则，两个读者](two-audiences-one-contract.md) 同源，
  但这里更具体：**描述里的承诺性措辞**（Idempotent / Read-only / never）是契约，必须有人对账。

## 现场
工具描述里有 5 类承诺：
```
watch_start  Idempotent per (repo, session)   Default interval 60 s
watch_ack    … so the same item will never wake this session again
github       credential … never returned
watch_*      Read-only — changes nothing
```
而 `docs/规则对照表.md` 一条都没写。也就是说：**客户读到的文档里，看不到这些承诺。**

## 做法
`scripts/audit-promises.mjs` 双向检查：
1. 描述里出现的承诺 → 对账表必须有对应关键词；
2. 对账表承诺的 → 描述里必须还写着。

第 2 条是重点：单向检查抓不到"**承诺被悄悄删掉**"这种情况。

## 验证
把 `Idempotent` 从描述里删掉 →
```
FAIL 表里承诺了但描述里找不到：幂等
```

## 是否已落地
✅ 0.9.79。对账表补第 12–16 行；`preflight` 对应检查。

## 还没做的
- 只覆盖英文承诺词（`Idempotent`/`Read-only`/`never`/`Default`）；中文描述里的承诺没抽；
- 参数级承诺（例如"最多 20 条"）没有纳入。
