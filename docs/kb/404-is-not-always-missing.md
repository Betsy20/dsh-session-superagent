# 404 不等于"不存在"：也可能是"没权限"

## 出处
GitHub《Troubleshooting the REST API》：
> If you make a request to access a private resource and your request isn't properly authenticated,
> you will receive a `404 Not Found` response. GitHub uses `404` instead of `403`
> **to avoid confirming the existence of private repositories.**

<https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api#404-not-found-for-an-existing-resource>

## 它怎么做的
GitHub 用 404 而非 403 来回应"无权限访问私有资源"，目的是**不泄露私有仓库是否存在**。
所以对调用方来说，同一个 404 至少对应三种情况：

| 真实原因 | 该做什么 |
|---|---|
| 仓库名/owner 打错 | 改地址 |
| 仓库真被删了 | 换地址或删掉这条守 |
| **私有仓库、当前 token 没权限** | **修凭证**（这是最容易被误判成"删了"的一种） |

## 我们能怎么用
1. 提示语不能只写"不存在"：改成
   `（不存在或没权限 —— 私有仓库也回 404：检查 owner/name 与 token）`
2. **别据 404 做不可逆动作**（例如自动删除守）。0.9.114 给 `notfound` 加了 30 分钟退避 —— 这是安全的
   （只是少问几次），但如果哪天想"见 404 就删守"，就会把"没权限"误杀成"仓库没了"。
3. `repo_here` 工具失败时也走同一套分类（此前只贴原始 stderr）。

## 判据
**"资源不存在"永远不是 4xx 能单独证明的事。** 凡是基于 4xx 做自动决策，要先问：
这个码还有哪些别的成因？有没有更小代价的做法（退避、提示、让人确认）？

## 是否已落地
✅ 0.9.116。`classifyGhError` 的 notfound 提示 + `repo_here` 走 `formatGhCall`。

## 还没做的
- 没有"先 `gh auth status` 再判定"的主动区分（能做到，但每次失败多一次调用）；
- 面板上"删除这条守"的确认文案没有提到"也可能只是没权限"。
