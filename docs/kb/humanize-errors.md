# 错误提示要回答"我该做什么"，不是复述异常

## 出处
- NN/g《Error-Message Guidelines》：错误信息要**用平实语言说明问题并给出建设性解决方案**，
  不要只显示系统错误码；同时不要责怪用户。
  <https://www.nngroup.com/articles/error-message-guidelines/>

## 我们怎么做的（分两层）
### 第一层：GitHub 相关的错误（服务端 `classifyGhError`）
已有归类 + 一句 hint。但本轮拿**真机上真见过的 12 条错误串**去测，只有 **8 条**命中：

```
other   | （无提示）| error: unable to get local issuer certificate
other   | （无提示）| HTTP 502 Bad Gateway
other   | （无提示）| repository "o/r" not found
other   | （无提示）| context deadline exceeded
```

补齐后 **12/12** 命中，并新增 `gateway` 一类（GitHub 或本地代理短暂故障 ——
这类最容易被当成"我的仓库有问题"）。

### 第二层：面板自己的错误（客户端 `humanizeError`）
面板拉自己接口失败时**不经过**上面那套，以前界面上是一行 `Failed to fetch`。
现在映射成人话 + 动作：

| 原始 | 面板显示 |
|---|---|
| `Failed to fetch` | 连不上宿主：DSH 可能正在重启…稍等几秒会自动重试；一直这样就去「设置 → 诊断」 |
| `HTTP 5xx` | 宿主内部报错：先复制诊断信息，再重启宿主 |
| `HTTP 404` | 接口不存在：多半还在跑旧版本代码，重启宿主 |
| 超时 | 宿主可能正忙（比如同时在建隔离 worktree），稍后自动重试 |

## 判断标准（可复用）
1. **说人话**：不出现 `EOF` / `fetch` / `ECONNRESET` 这类词给客户看；
2. **给动作**：每条都回答"我现在该做什么"，或者明确说"不用管，会自动重试"；
3. **不甩锅**：不说"你的配置有问题"，说"检查 owner/name"。

## 是否已落地
✅ 0.8.97。用例：12 条真实错误串必须命中且都带 hint；`command not found` 不许被误判成仓库不存在；
面板遇 `Failed to fetch` 必须显示"连不上宿主"且提到「诊断」。

## 还没做的
- 没做错误码与文案的多语言；
- 没把 hint 做成可点击的动作（例如直接打开诊断）。
