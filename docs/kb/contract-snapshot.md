# 数量对不等于形状对：用契约快照守住接口

## 出处
- Node 官方测试文档有 Snapshot testing 一节（<https://nodejs.org/api/test.html>，目录里有 `Snapshot testing`），
  但本机的 `assert.snapshot` 是 `undefined`（`t.assert.snapshot` 属实验 API）——
  **所以我们没用它**，改用「JSON fixture + deepEqual」这种最朴素的做法。
- 思路本身是 approval testing（审批式测试）：把当前正确的形状存成文件，之后任何漂移都让人看见。

## 为什么需要
0.8.87 的挂载冒烟只验了**数量**（当时 8 条路由、7 个工具；2026-11 已是 **9 条路由、8 个工具**，数量会继续涨，判据不能跟着写死）。
如果哪天路由改名、工具参数少一个，数量可能还是 8/7，但客户那边的调用会**全废**。
数量和形状是两件事。

## 它怎么做的
`scripts/contract.mjs`：假 ctx → 真 `apply()` → 抽出形状：

```json
{
  "inject": ["agents", "tools", "webServer"],
  "tools": [{ "name": "github", "params": ["body","confirm","method","path"], "required": ["path"] }],
  "routes": ["/session-superagent/client-error", "…"]
}
```

两个刻意的取舍：
1. 只记**参数名**，不记描述文案 —— 改文案不该让契约红（否则很快就没人管这条测试）；
2. **版本号不进快照** —— 它每次发版都变，放进来等于每次发版都强制 `--update`，纯摩擦。
   （第一版把它放进去了，当轮就发现不对并删掉。）

`test/contract-shape.test.mjs` 每次跑都用 deepEqual 比对；要改形状必须
`node scripts/contract.mjs --update` 并在 CHANGELOG 写清为什么。

## 是否已落地
✅ 0.8.88。**负例验证过**：故意把 `github` 的 params 改成只剩 `path`，测试立刻红；
`--update` 后恢复绿。

## 还没做的
- 没有快照工具参数里嵌套对象的字段（只到第一层）；
- 没把 `/state` 响应形状纳入快照（那由 `/state 字段契约` 测试覆盖）。
