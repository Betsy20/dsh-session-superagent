# 仓库改名是最安静的一种故障

## 出处
- GitHub 对仓库改名/转移的策略：旧地址返回 **301 重定向**，API 客户端如果只看"是不是 200"，
  就容易把这件事当成"暂时没数据"：<https://docs.github.com/en/repositories/creating-and-managing-repositories/renaming-a-repository>

## 现场
守是 `owner/name` 字符串。仓库被改名或转移到别的组织后：
- 轮询请求拿到 301 / `Repository has been moved`；
- 原来的错误分类把它归进 `other`，给一句笼统失败；
- **客户看到的是"这条守一直没动静"**，而正确动作是"去改 owner/name"。

三类失败长得像但要做的事完全不同：
| 现象 | 真实原因 | 该做什么 |
|---|---|---|
| 404 | 删了 / 没权限 / 名字打错 | 检查 owner/name 或权限 |
| 301 | 改名或转移 | 换成新地址（旧地址还能用，但会一直重定向） |
| EOF / 5xx | 网络抖动 | 等 |

## 改法
```js
if (/moved permanently|has moved|HTTP 301|Repository has been moved/i.test(text)) {
  return { kind: 'moved', hint: '（仓库改名或转移了：用新地址重新添加，或把守改成新的 owner/name）' }
}
```
`moved` **不在**"可自动恢复"名单里（只有网络/限流/网关会自己好）。
`watch_doctor` 的可访问性检查也改用分类提示，不再贴 120 字原始 stderr。

## 判据
**"能自动好" 与 "要人动手" 之外，还需要第三类："地址变了"。**
它的特征是：重试永远成功不了，但也不是错误 —— 是**新地址存在**。

## 是否已落地
✅ 0.9.94。用例：`HTTP 301` 与 `Repository has been moved` 都判为不可自动恢复。

## 还没做的
- 没有"自动跟随 301 更新守的 repo 字段"（GitHub 的 `GET /repos/{old}` 会返回新 `full_name`，
  理论上可以自动迁移，但会静默改客户配置，需要产品决策）；
- 面板上没有"这条守的仓库已改名"的专门样式（仍走通用 lastError 行）。
