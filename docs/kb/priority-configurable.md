# 权重是产品判断，别写死

## 出处与坦白
- GitHub 列表接口能按 `created|updated|comments` 排序（<https://docs.github.com/en/rest/issues/issues#list-repository-issues>），
  但**没有任何官方推荐"该给评论/标签/重开各多少权重"**。
- 本轮想找 triage 优先级的官方说明时，`/communities/managing-your-work-with-project-boards` 返回 404、
  Projects 内建字段页也没抓到可读正文 —— 所以下面的权重**是我们自己的产品判断**，不是抄来的行业标准。

## 它怎么做的（我们）
默认：重开 100 / 有人评论 10 / 有标签 5（见 `batch-priority.md`）。

## 我们能怎么用
既然权重是判断而非标准，就该让用户能关掉 —— 有人就想要"严格按时间"。

实现：每条守存 `priority: { reopened, comments, labels }`（默认全 true）；
面板「编辑」页三个开关；三项全关 = 退回 GitHub 的 updated 顺序（稳定排序，不会乱跳）。

## 是否已落地
✅ 0.8.76（`watch.js:priorityScore(items, options)` + `batchFresh(..., priority)`；
`/watch` 接受 `priority`；面板三个 Toggle；`/state` 回传 `priority`）。
用例：全开→重开在前、关掉重开→退回原序、三项全关→原序、权重本身不受开关影响。

## 还没做的
- 没有"自定义数值"（只能开/关，不能填 200）；
- 没有把开关状态显示在行内（要进编辑页才看得到）。
