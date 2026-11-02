# 工具能做的要和面板能做的对齐

## 出处
- 这是"单一能力、多个入口"的经典要求：**两个入口暴露的能力不同，用户就会以为其中一个是残的**。
  类似 API 与 GUI 的 parity 讨论（例如 GitHub CLI 与 Web 的功能对齐问题）。

## 本轮发现
`watch_start` 的参数比面板少三项：

| 配置 | 面板 | `watch_start`（改前） |
|---|---|---|
| 单守每小时上限 | ✅ | ✅ |
| **整条会话每小时上限** | ✅ | ❌ |
| **隔离区保留天数** | ✅ | ❌ |
| **最多留几个隔离区** | ✅ | ❌ |

后果很具体：客户说"把隔离区最多留 3 个"，agent 只能回答"面板里可以改" ——
一个只需要一句话就能完成的事，变成了"你去点一下"。

## 改法
补三个参数，**夹紧范围与面板完全一致**（1-60 / 1-30 / 1-50），并在描述里写清默认值：

```js
sessionMaxWakes: 'Max wakes per hour for the whole session, summed across watchers (1-60, default 12).'
isolateKeepDays: 'With isolated: remove isolation worktrees older than this many days (1-30, default 3).'
maxIsolated:     'With isolated: keep at most this many worktrees, oldest removed first (1-50, default 5).'
```

用例：断言三个参数在 schema 里存在，并真的写入状态（24 / 7 / 3）。

## 一个实现细节（踩过）
工具对象的参数在 `tool.parameters.properties`（JSON Schema），不是 `tool.parameters[key]` ——
第一条断言写错路径导致"缺参数"假警报。

## 是否已落地
✅ 0.9.41。契约快照更新；用例覆盖参数存在 + 落盘生效。

## 还没做的
- 没有把「工具/面板能力差异」做成自动化对照（现在靠人看 schema 与面板字段）；
- `watch_stop` / `watch_status` 等工具还没有同类 parity 检查。
