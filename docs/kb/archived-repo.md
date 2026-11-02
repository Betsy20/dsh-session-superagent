# 归档仓库是只读的，比"没写权限"更彻底

## 出处
- GitHub REST《Get a repository》：响应里有 `archived` / `disabled` / `visibility`
  （本机实测：`atom/atom` → `{"archived":true,"disabled":false,"visibility":"public"}`）。
  <https://docs.github.com/en/rest/repos/repos#get-a-repository>

## 它怎么做的
归档（archive）是 GitHub 的"冻结"状态：仓库内容只读，不再接受 issue/PR 编辑、评论、标签变更。

## 我们能怎么用
主理鱼要在仓库里回写（评论 + 打标签）。如果客户守的是归档仓库：
能读、能被叫醒、然后**所有回写都失败** —— 和"token 只有读权限"类似但更彻底
（换 token 也没用）。

改法：
1. `probeAccess` 一并取 `archived` / `disabled`，存进 `repoAccess`；
2. 「需要关注」区给出人话（归档 / 禁用 / 无 Issues 三种，排在轮询失败之前）；
3. 行内加**能力徽章**：已归档 / 已禁用 / 无 Issues / fork·上游 / 只读 / 私有 —— 一眼可见。

## 是否已落地
✅ 0.8.66（`watch.js:repoBadges` + `repoStructureNote` 扩充；客户端同语义徽章渲染在行内 stateTag 之后）。
用例：null 无徽章、正常仓库无徽章、归档/禁用/无 Issues/fork/只读/私有六枚齐全、fork 自己开了 Issues 不给 fork 徽章。

## 还没做的
- 徽章目前只读不可点（可做成点击筛选）；
- 没在**新增守**时就拦住（现在允许建，靠提示；拦住更硬，但会挡掉"先看着、以后再开"的用法）。
