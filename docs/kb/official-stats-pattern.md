# 官方"统计"只用两种写法：`dt-stat` 与 `dt-count`

## 出处
从移植来的 `PORTED_CSS`（224 个 `.dt-*` 类）里**机械抽出**，不是手抄。
复核命令见文末。

## 官方那两条规则
```css
.dt-stat       { display:inline-flex; align-items:baseline; gap:6px;
                 font-size:12px; color:var(--dsw-alias-label-caption); }
.dt-stat-value { font-size:14px; font-weight:500; color:var(--dsw-alias-label-primary);
                 font-variant-numeric:tabular-nums; }

.dt-count      { font-size:14px; color:var(--dsw-alias-label-caption);
                 font-variant-numeric:tabular-nums; font-weight:400; }
```

| 用法 | 结构 | 例子 |
|---|---|---|
| `dt-stat` + `dt-stat-value` | **数值（14/500/主色/等宽）** + **单位（12/弱色）**，基线对齐 | `3 条主理鱼` |
| `dt-count` | 纯计数，跟在标题后面 | `判定日志（最近 5 次唤醒） 4` |
| `dt-status-text` | 右对齐状态文字（12/次级） | 行尾的"异常" |

**官方没有圆环、没有彩色大数字、没有渐变条。** 弹层里那条 4px 分段条是我为了"看比例"自己加的，
保持极细（4px）就是为了不和 `dt-stat` 抢注意力。

## 我们踩过的坑
弹层顶部指标原来是：

```
<b>1</b> / 3 主理中      ← 混排：数字加粗、斜杠和单位同色同字号
```

改成官方同构的两段：

```
1 / 3     ← 14px / 500 / label-primary / tabular-nums
主理中     ← 12px / label-caption
```

## 判据
**"数值强、单位弱"是这套设计系统里唯一允许的数字强调方式。**
要突出某个数，调字号/字重/颜色三件套里的**一个**（官方只调字号+字重），不要上圆环、渐变、大号描边。

## 怎么复核
```bash
# 抽 PORTED_CSS 里所有 .dt-* 类与对应规则
node -e "…读 client.js 的 PORTED_CSS 再 matchAll(/[.]dt-[a-z0-9-]+/g)…"
```

## 是否已落地
✅ 0.9.154：弹层指标拆成 `sa-dock-metric-main` / `-unit` 两段，与 `.dt-stat` 完全同构；
副行改为「会话标题 · #短ID」。

## 后续（0.9.155）：结构对了，类名还得是官方的
0.9.154 我把弹层指标拆成 `sa-dock-metric-main` / `-unit` 两段 —— **结构对了，但类名是自造的**。
面板统计条用的是官方 `dt-stat` / `dt-stat-value`，于是同一件事有了两套实现。

改成直接用官方素材，CSS 只留靠右：

```jsx
h('span', { className: 'dt-stat sa-dock-metric' },
  h('span', { className: 'dt-stat-value' }, '1 / 3'),
  h('span', null, '主理中'))
```

> 判据：**移植的设计系统里如果已经有这个组件，就不要自己写一份"看起来一样"的。**
> 自造的那份不会跟着官方更新，而且下次改样式必然只改一半。

## 还没做的
- 面板「总览」的统计条与弹层指标现在共用 `dt-stat`，但渲染代码仍有两处（可抽成一个 `Stat` 组件）；
- 没有"数值/单位必须拆开"的自动体检。
