# 门禁偶发红比不绿更糟

## 出处
- Google 的测试博客里那条老结论：**flaky test 的代价不是"多跑一次"，而是人开始无视红灯**
  （<https://testing.googleblog.com/2016/05/flaky-tests-at-google-and-how-we.html>）。
  同样的道理适用于任何门禁。

## 现场
本小时 `node --test` 偶发红了一次（`176/177`），重跑又绿。查下来只有一条会真走网络：

```js
test('/update 只读地报告版本', { timeout: 60000 }, async () => {
  const res = await call('GET', '/session-superagent/update')   // → 真的请求 registry.npmjs.org
```

`checkUpdate` 用 `AbortSignal.timeout(5000)` 请求 npm registry，网络一抖就 5 秒超时 →
断言失败。**这不是产品 bug，但会让门禁不可信。**

## 改法
给 `checkUpdate` 加离线开关：`DSH_SUPERAGENT_UPDATE_OFFLINE=1` 时跳过网络，
只返回 `current` 与命令模板；那条用例显式打开开关。

```js
if (process.env.DSH_SUPERAGENT_UPDATE_OFFLINE === '1') { … return value }
```

## 验证
连跑 3 次 `node --test`：`187/187` ×3。

## 为什么值得单独记一条
- 门禁的价值全在"红了一定是问题"；一旦有偶发红，人就会先怀疑门禁本身；
- 这一次红没有任何产品信息，却差点让我去改产品代码 —— **排除噪音比加功能更省时间**。

## 是否已落地
✅ 0.9.59。离线开关 + 用例改造。

## 还没做的
- 没有全局扫描"哪些测试依赖网络/时间/临时目录"（目前靠偶发红才发现）；
- 没有对 `node --test` 记录历史通过率。
