# token 权限要看得见，也要够窄

## 出处
- GitHub《Permissions required for fine-grained personal access tokens》：
  <https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens>
  按端点列权限（Issues / Labels / Comments …），可以只给需要的仓库 + 需要的读写。
- 对照：经典 PAT 的 `repo` scope 一把就是**该账号可见的全部仓库**读写。

## 它怎么做的
细粒度 token 把权限切成「资源 × 操作 × 仓库范围」，而经典 PAT 是「一揽子」。
最小权限的好处是泄漏后的影响面——对一个会在客户机器上跑的插件尤其重要。

## 我们能怎么用
我们的功能只需要：**读 issue/PR、写评论、加标签**。
本机实测当前 token 的 scopes：

```
admin:repo_hook, delete:packages, gist, notifications, project,
read:org, read:user, repo, workflow, write:discussion, write:packages
```

其中 `delete:packages`、`admin:repo_hook`、`workflow` 我们**一个都用不到** ——
一旦泄漏，别人能删包的版本、改 webhook。

改法：探测 `x-oauth-scopes`（`gh api -i user`，缓存 5 分钟），面板「设置 → 来源」显示
「权限范围: …」，命中宽 scope 时多出一行提示，建议换细粒度 token 只授 Issues 读写。

## 是否已落地
✅ 0.8.63。`/state` 带 `tokenScopes`（缓存值，不额外打 GitHub），设置页展示 + 宽 scope 提示。

## 还没做的
- 没做"一键生成细粒度 token 的链接"（GitHub 有带参数的 URL 模板，可做）；
- 没校验 token 是否真能读写目标仓库（要试写才知道，风险高，先不做）。
