# 默认值要当数据传下去，而不是在界面里抄一遍

## 出处
JSON Schema 对 `default` 的说明正好是这件事的规范表述：

> The `default` keyword specifies a default value. … **Non-validation tools such as documentation generators
> or form generators may use this value to give hints to users about how to use a value.**

<https://json-schema.org/understanding-json-schema/reference/annotations>

也就是：**默认值在数据里声明一次，由表单/文档去渲染**，而不是两边各写一份。

## 现场（本轮扫描）
`client.js` 里写死的默认值有 3 处：

| 位置 | 写死的值 | 真实来源 |
|---|---|---|
| 会话上限占位符 | `12（1-60）` | `DEFAULT_SESSION_WAKES = 12` |
| 隔离保留占位符 + 提示 | `3（1-30）` / "留空用默认 3 天" | `?? 3` |
| 术语表「上限」 | 单守 6 次、会话 12 次 | `?? 6` / `DEFAULT_SESSION_WAKES` |

改任一常量，面板就开始说谎 —— 与 [政策数字只能有一处定义](policy-numbers-have-one-home.md) 是同一类问题，
只是位置从"档位文案"换成了"占位符/术语表"。

## 改法
1. 抽出 `DEFAULT_WAKES_PER_HOUR = 6` / `DEFAULT_ISOLATE_KEEP_DAYS = 3`，读状态处复用；
2. `/state` 顶层新增 `defaults: { sessionMaxWakes, maxWakesPerHour, isolateKeepDays }`；
3. 占位符与提示读 `body.defaults`，缺省才回落。

## 一个"门禁不许我合并"的插曲
我一开始把术语表那句也改成动态拼接，`术语表对照` 门禁立刻报 `待补：上限` ——
因为它是**按字面量**抽取术语去和 `docs/术语表.md` 比对的。

于是改成分工：**术语表保持字面量，另加一条用例把字面量与 `/state.defaults` 对齐**。
两边谁改了都会红，而门禁的解析方式不用动。

## 判据
**能做成"数据 + 渲染"的就别做成"两处字面量"。**
真做不到时（比如门禁只认字面量），就用一条断言把两处绑在一起 —— **要么同源，要么同测。**

## 是否已落地
✅ 0.9.127。新增 2 例：`/state.defaults` 精确值、术语表字面量与默认值一致。

## 还没做的
- 面板其它类似提示（例如批次上限 `batchLimit` 的说明）还没逐一接入 `defaults`；
- 没有通用门禁扫描"面板里出现的数字是否都有来源"。
