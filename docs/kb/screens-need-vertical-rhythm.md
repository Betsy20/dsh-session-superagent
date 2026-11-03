# 页面子块之间要有节奏：没有间距的块会读成一堵墙

## 出处
- 与 [弹层是摘要屏](popover-is-a-summary-screen.md) 同族：都在讲"信息怎么排才读得下去"。
- NN/g 关于视觉层级与留白（本轮未复核原文）：
  <https://www.nngroup.com/articles/visual-hierarchy-ux-definition/>

## 现场（出图核对发现）
`--only=总览 --dark` 出图后，一眼看到四个问题：

| 现象 | 根因 |
|---|---|
| 搜索框与按钮贴在标题下方左侧 | `.dt-page-head` 是 `column`，工具栏没有右对齐的机会 |
| 四个计数挂在「需要关注」后面 | 渲染顺序 filtered → problems → stats |
| 各块之间几乎零间距 | **`.dt-page` 是 block 布局，子块之间没有任何 margin/gap** |
| 三个小节标题和正文同色同重 | `.dt-section-title` 用 secondary + 13px |

## 改法
1. 页头改 `row + space-between`，工具栏 `margin-left: auto`；
2. 指标条提到最前，并做成卡片（`bg-module-platform` + 边框 + 圆角 12）；
3. `.dt-page > * + * { margin-top: 16px }` —— 一条规则给整页统一节奏；
4. 分节标题 13px/secondary → 14px/label-primary；
5. 「需要关注」每条加 2px 左竖线 + 8px 行距。

## 判据
**先看出图，再谈"好不好看"。**
这轮四个问题里，有三个是"结构/顺序"问题（工具栏位置、块顺序、块间无间距），
只有一个是配色问题 —— **改之前必须先把图调出来，否则会在配色上瞎改。**

## 顺带：预览工装的两个 bug
- `--only=<场景>` 过滤没生效（`sectionsForTheme` 用的是未过滤数组）→ 截图里永远是全部场景堆叠；
- `--dark` 只影响弹层，不影响面板。

## 是否已落地
✅ 0.9.136。出图前后各一张；`node --test` 250/250、`ui-audit` 11/11。

## 还没做的（下一轮目标）
- **设置页**：左侧导航与右栏「来源/凭证/…」标签重名、导航没有选中态、标签列过宽把值挤到中间；
- 判定页与触发页还没同样出图核对；
- 窄屏（<640px）下页头工具栏会折行，未验证观感。
