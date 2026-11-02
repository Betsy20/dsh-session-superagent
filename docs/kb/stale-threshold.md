# 「躺了多久」的阈值：60 天是社区默认，我们用 30 天展示

## 出处
- `actions/stale` 的 `days-before-stale` 默认值 = **60 天**：
  <https://github.com/actions/stale#readme>（README 参数表第一行）
- 社区实践里 30 / 60 两档都常见：30 天偏"提醒"，60 天偏"清理"。

## 它怎么做的
stale bot 只做两件事：到天数打 `stale` 标签；再等 N 天没动静就关掉。

## 我们能怎么用
我们的定位不是清理，是**提醒人还有积压**，所以：
- **30 天**就标注（比 stale bot 早一档，留出人工决策时间）；
- 只标 `open` 的条目（closed 的不吵）；
- 默认**只展示**（消息里 `躺了 62 天`），`stale` 加权默认关，开启后 +2 分；
- 阈值可配置（`stalenessNote(item, { thresholdDays })`）。

## 写代码时踩到的一个坑（值得记）
```js
// 错：Number(now) || (Date.now() - at)  —— 传了 now 就把 epoch 毫秒当成"天数差"
const days = Math.floor((Number(options.now) || Date.now() - at) / 86400000)
// 对：
const days = Math.floor(((Number(options.now) || Date.now()) - at) / 86400000)
```
用例立刻抓到了（显示成 `躺了 20759 天`）。这类运算符优先级错误**单看代码很容易漏**，
但一旦有用例就是一行红的。

## 是否已落地
✅ 0.8.79（`watch.js:stalenessNote` + 消息行尾标注 + `priority.stale` 默认 false + 面板「积压优先」开关）。
用例：62 天会标、刚更新不标、closed 不标、无时间戳不猜、阈值可调、默认 0 分、开启 +2。

## 还没做的
- 没读 `updated_at` 之外的时间（如 `created_at` 的"开了很久没动"）；
- 没做成"到期自动提醒"（要定时任务，超出本插件范围）。
