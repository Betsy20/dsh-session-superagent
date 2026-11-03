# `align-items: baseline` + 没有文字的内联盒 = 行高爆炸

## 出处
- flexbox 规范里 baseline 对齐取的是「项目的第一条基线」；**没有文字内容的盒子**没有文字基线，
  浏览器只能退回到它的**下边缘**。于是这一行的高度被拉到「另一项的下边缘 − 顶边」。
  <https://www.w3.org/TR/css-flexbox-1/#valdef-align-items-baseline>
- 与 [页面子块之间要有节奏](screens-need-vertical-rhythm.md) 同属"用图核对"能抓到的问题。

## 现场（量出来的）
「判定日志」上方空了一大截，但 DOM 是干净的。给预览工装加 `--measure`（无头浏览器里量
`getBoundingClientRect`，写进 DOM 再 `--dump-dom` 读回）：

```
修前：dt-section-title@405h89 | section@502h78 | timeline@588h185
修后：dt-section-name@405h22 | dt-count@405h22 | dt-subhead-actions@405h16
```

**一行 22px 的文字，标题行高 89px** —— 4 倍。

## 根因
```css
.dt-section-title { display: flex; align-items: baseline; }
```
标题里有一个「ⓘ」按钮：`<span style="display:inline-flex"><button class="dt-info"></button></span>`。
按钮**没有文字** → 没有文字基线 → 回退到盒子下边缘 → 整行被撑到 89px。
所有带 `action` 的 `Section`（判定日志、需要关注…）都被撑高。

## 改法
`align-items: baseline` → **`center`**。标题文字、计数、图标三个都垂直居中，行高回到 22px。

## 判据
**带图标的标题行别用 `baseline`。**
baseline 适合"多段文字对齐第一行底部"，一旦里面混进**没有文字的盒子**（图标按钮、开关、空 span），
行高就会以那个盒子的下边缘为准 —— 而这类盒子通常只有 16px。

## 顺带两个工装修复
- `aria-current` 不在预览的属性白名单里 → 设置页导航截图里「没有选中态」是**预览的假象**，
  真机一直是对的。**看图之前先确认工装没在骗你。**
- 新增 `--measure`（量位置/尺寸）与 `--outline`（每块画虚线）：眼睛看不出的问题，用数字看。

## 是否已落地
✅ 0.9.137。标题行 89px → 22px；设置页正文改卡片、导航 13px、正文标题 15px。

## 还没做的
- 触发页还没同样出图核对；
- 窄屏（<640px）下页头工具栏折行的观感未验证；
- 还没有"标题行高异常"的自动体检（现在靠人看图 + 量）。
