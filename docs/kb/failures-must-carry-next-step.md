# 失败要带着「下一步」回到调用方，而不是原始 stderr

## 出处
GitHub《Best practices for using the REST API》：
> **Do not ignore errors.** You should not ignore repeated `4xx` and `5xx` error codes.
> Instead, you should ensure that you are correctly interacting with the API.

<https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api>

引申一层：**"不忽略"不等于"原样贴出去"**。原始 stderr 只说明"哪里坏了"，
调用方（尤其是 agent）还需要"我该动什么"。

## 现场
我们有两类调用方：
- **轮询**（内置定时器）—— 0.9.110/0.9.114 已经让它带分类与提示；
- **`github` 工具**（agent 直接调）—— 之前只返回：
```
gh: HTTP 404 Not Found
[exit code: 1]
```
agent 拿到这行，得自己猜是"仓库名错了""没权限"还是"登录失效"。猜错就会反复重试同一路径。

## 改法
抽出 `formatGhCall()`，轮询与工具共用同一套分类：

| 情况 | 返回 |
|---|---|
| 404 | `…（仓库不存在或没权限：检查 owner/name）` + `[kind: notfound]` |
| 401 | `…（gh 登录失效：跑 gh auth login…）` + `[kind: auth]` |
| 304 | `…（没有变化 —— 条件请求命中 304，这不是错误）` + `[kind: notmodified]` |
| 成功 | 只加 `[exit code: 0]`（不带 kind，保持轻量） |

## 判据
**错误文本的三个层次**：发生了什么（原始信息）→ 属于哪类（机器可读 kind）→ 该做什么（人/agent 可执行）。
三层缺一层，接收方就得自己补，而补错的代价是重复调用与额度浪费。

## 是否已落地
✅ 0.9.115。新增 1 例（四种情况的返回形状，含"成功不带 kind"）。

## 还没做的
- `repo_here` 工具失败时仍是原始输出；
- 没有统计"agent 拿到 kind 后是否真的换了动作"（需要真机埋点）。
