# 凭证失效永远不会自己好 —— 要和"网络抖动"分开报

## 出处
- GitHub 文档关于 token 过期/吊销（本轮网络不可达：`raw.githubusercontent.com` 与 `api.github.com` 均返回 502，
  **未能复核原文**，仅依据本机实测）：
  <https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/token-expiration-and-revocation>
- 同族知识：[404 不等于「不存在」](404-is-not-always-missing.md)（同样是"错误码背后的语义差异"）

## 真机现场（2026-11-03 重启后）
```
$ gh auth status
X Failed to log in to github.com account MYCF711 (keyring)
  - The token in keyring is invalid.
  - To re-authenticate, run: gh auth login -h github.com

$ gh api repos/MYCF711/dsh-go --jq '.full_name'
unexpected end of JSON input
```

插件这边只显示一条普通失败：`（gh 登录失效：跑 gh auth login，或在面板填 token）`——
混在网络抖动里，客户很容易以为"等会儿就好"。而 **401 永远不会自己好**。

## 三类失败的"自愈性"
| 失败 | 会自己好吗 | 该等多久 | 谁来解决 |
|---|---|---|---|
| 网络抖动 / 5xx | 会 | 指数退避（上限 30 分钟） | 不用管 |
| 限流 | 会（额度恢复） | 按 `Retry-After` | 等 |
| **凭证失效（401）** | **永远不会** | —— | **人：`gh auth login`** |
| 404 / 改名 | 不会 | 30 分钟 | 人：改地址或修权限 |

## 改法
1. `auth` 纳入 30 分钟退避（每 60 秒重试无意义，反复 401 还可能被风控）；
2. `needsReauth` 标志：失败时置真，任何一次成功（含 304/204）清掉；
3. `watch_doctor` 单列一行、面板给红色横幅，都写明**"它不会自己恢复"**。

## 判据
**把"谁来解决"写进错误提示。** 提示里如果只有"哪里坏了"，客户会默认"系统会自己好"；
写明"需要你做 X"，才不会出现"等了 5 小时发现要重新登录"。

## 是否已落地
✅ 0.9.119。新增 3 例（退避取值、doctor 文案、面板横幅）。

## 还没做的
- 没有"凭证失效时自动暂停这些守"（现在只是长退避 + 显式提示）；
- 没验证面板"填 token"路径在 keyring 失效时是否真的可用（需要真机）。
