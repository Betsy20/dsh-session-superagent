# 让「为什么没叫醒」有答案

## 出处
- GitHub《Filtering and searching issues and pull requests》：
  <https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/filtering-and-searching-issues-and-pull-requests>
  关键点：过滤语义就是「限定词 + 集合运算」（`label:` / `assignee:` / `state:` …）。

## 它怎么做的
GitHub 把「被哪个限定词排除」表达成**可枚举的条件**，而不是一个黑盒结果；
所以用户能自己复现「为什么这条没出现」。

## 我们能怎么用
主理鱼的过滤链有 8 种原因（不在标签白名单 / 机器账号 / 草稿 / 已关闭 / 未指派 / 已 ack / 上限 / 时段外）。
我们原来只保留最近 5 条日志 —— 客户问「为什么我加了标签还是一条都没叫醒」时，
看到的只是最近 5 条，看不出**总共**被什么刷掉。

改法：按原因累计计数（`countReasons`，只留次数最多的 12 种），
在「判定」页顶部显示「跳过原因累计：不在标签白名单: ai-fix × 37 / 机器人 × 12 …」。

## 是否已落地
✅ 0.8.55（`lib/watch.js:countReasons` → `entry.filterCounts` → `/state` → 判定页标签行）。
用例：累计、排序、空原因不记、种类上限 12。

## 还没做的
- 分布只在「判定」页，没有做成可点击的筛选（点一下只看该原因的条目）；
- 没有按时间窗口统计（现在是从加守以来的全量累计）。
