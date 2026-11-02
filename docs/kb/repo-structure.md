# 守一个"没有 issue"的仓库是空转

## 出处
- GitHub REST《Get a repository》：响应里有 `fork` / `has_issues` / `parent.full_name`
  （本机实测这三个字段都在：`{"fork":false,"has_issues":true,"parent":null,"private":false}`）。
  <https://docs.github.com/en/rest/repos/repos#get-a-repository>
- 关于"fork 默认不带 Issues"这一条：本轮想抓 `about-forks` 文档正文时页面没给出可读文本，
  **这一句按社区常识使用、未取得官方原文引用**（我把它写成提示语里的"默认"，并在 0.8.65 里
  对 `has_issues === true` 的 fork **不提示**，避免误伤）。

## 它怎么做的
仓库对象自带结构信息：有没有开 Issues、是不是 fork、fork 的上游是谁。

## 我们能怎么用
主理鱼只认 issue / PR。两种仓库注定收不到条目：
1. `has_issues === false`（关掉了 Issues）；
2. fork 且自己没开 Issues —— issue 都落在大都上游仓库。

以前客户填进去，看到的是"守着一个永远安静的仓库"，还以为插件坏了。

改法：新增守时后台探测（和权限一起），`/state` 回传 `repoAccess`；
面板「需要关注」区多一条人话提示，**在轮询失败之前**就该说清楚。

## 是否已落地
✅ 0.8.65（`watch.js:repoStructureNote` + `index.js:probeAccess` 扩充字段 + 面板 problems 区）。
用例：null 不提示、正常仓库不提示、关闭 Issues 提示、fork 提示上游、fork 但自己开了 Issues 不提示。

## 还没做的
- 面板上还没有"只读/fork/关闭 Issues"的徽章（数据已备好，前端可读 `repoAccess`）。
