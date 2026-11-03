# 弹层是摘要屏，不是详情屏

## 出处
NN/g《Progressive Disclosure》（Jakob Nielsen）：

> Progressive disclosure defers advanced or rarely used features to a secondary screen,
> making applications easier to learn and less error-prone.

<https://www.nngroup.com/articles/progressive-disclosure/>

## 现场（用户截图反馈："太乱了，太糙了"）
点开状态栏卫星环后的弹层：

| 问题 | 表现 |
|---|---|
| 信息密度 | 每条守最多 **5 行**（goal / 会话 / 每 120s · 轮询 · 唤醒 / 时段 · 隔离 · workdir · 304 / 错误） |
| 层级 | 按钮「立刻 暂停 删除」与正文抢同一行 |
| **没有底色** | `.dt-card` 只定义了边框 → 弹层叠在聊天上直接透字，视觉上文字互相压着 |
| 间距 | `.dt-card` 自带 `gap: 12px` 没被覆盖，块之间被撑散 |

前两条是信息架构问题，后两条是**纯样式缺陷** —— 但用户感知到的是一个："糙"。

## 改法（对齐官方 Token 用量 / 上下文弹层）
1. 实心卡片：`bg-layer-2` + `elevation-prominent` + 圆角 16 + `gap: 0`；
2. 头部：标题 + 右对齐等宽主指标（`1 / 2 主理中`）；
3. 4px 比例条（运行中 / 其他 / 异常），官方「上下文已用」同款表达；
4. 每行**两行封顶**：`● repo  会话后缀  [状态]` + 副行 `每 120s · 83 秒前 · 时段 …`；
5. 动作收进 hover / focus（触屏常显）；
6. goal、过滤、退避、隔离、历史全部挪进 `title` —— **信息不丢，只是不挤**。

## 判据
**摘要屏只回答一个问题：现在整体怎么样。**
"这条守的 worktree 在哪、上次唤醒失败原因是什么"属于详情，应该在面板里，而不是在弹层里跟摘要抢位置。

## 顺带学到的样式教训
`.dt-card` 是从官方移植来的**内容卡片**（只有边框、没有底色）。
拿它做浮层就要自己补 `background` 和 `box-shadow` —— 否则一定透字。

## 是否已落地
✅ 0.9.134。5 个弹层用例按新信息架构改写，信息仍全部断言在 `title` 里。

## 还没做的
- 真机肉眼核对（深浅两套主题、弹层在窄屏下的换行）；
- 面板各 tab 的视觉层级还没逐一按官方对齐（下一项）。
