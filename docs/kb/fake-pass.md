# 最容易骗过自己的是"条件断言"：不满足条件就跳过 = 永远通过

## 出处
- 测试反模式里的经典一条：**测试里的条件逻辑**会让断言在特定输入下静默失效
  （"conditional test logic" 被列为 test smell，见 xUnit Test Patterns 的归纳：
  <http://xunitpatterns.com/Test%20Code%20Smells.html>）。

## 本轮实例
给 `watch_trace.results[]` 加字段稳定性断言时，我写的是：

```js
if (Array.isArray(trace.results) && trace.results.length > 0) {
  assert.ok(sameSet(Object.keys(trace.results[0]), ...))
}
```

跑起来 **PASS**。但真相是：测试里没有任何"有痕迹的条目"，
`results` 一直是空数组 —— **这段断言一次都没执行过**。

## 改法
1. 先在测试里造痕迹（`seen` / `lastReported` / `filteredLog` / `history`）；
2. 断言本身改成"必须非空，否则失败"：

```js
assert.ok(trace.results.length > 0, '这条断言需要非空 results —— 为空说明筛选逻辑变了')
assert.ok(sameSet(Object.keys(trace.results[0]), ...))
```

这样一旦将来 trace 的筛选逻辑变了导致 results 为空，**红的是这里**，而不是悄悄跳过。

## 判断标准（以后写断言时自问）
- 这条断言有没有可能因为"数据正好不满足前提"而根本没跑？
- 如果能，就把前提也 assert 出来。

## 是否已落地
✅ 0.9.48。契约用例仍 2 例，但 `results[]` 分支现在真的执行。

## 还没做的
- 全仓库没有做一次"条件断言"普查（可能还有别处写了 `if (...) assert`）；
- 这类问题纯靠自觉，暂时没有静态检查能可靠识别。
