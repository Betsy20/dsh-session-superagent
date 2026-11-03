# 403 有两种意思：等着 vs 去修权限

## 出处
GitHub 排障文档专门有一节 **"Resource not accessible"**，而限流另有专节 —— 两者都可能带 403：

<https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api#resource-not-accessible>

| 403 的真实含义 | 该做什么 |
|---|---|
| 触发限流（primary/secondary/abuse detection） | **等**（按 `Retry-After` 或额度重置） |
| 权限不足 / 集成无权访问（`Resource not accessible by integration`、`Must have admin rights`） | **动手**：改 token 作用域或仓库权限 |

## 现场
我们的分类器只有一条：

```js
if (/HTTP 403|rate limit|API rate limit exceeded/i.test(text)) return { kind: 'ratelimit', … }
```

于是 `HTTP 403: Resource not accessible by integration` 显示成「被 GitHub 限流：等几分钟」——
**客户会一直等，而真正要做的是去加权限。**
这与 0.9.110（304 当成错误）、0.9.124（空响应怪代理）是同一类混淆：**"等一等" vs "动手修"。**

## 改法
1. 先判限流关键词（`rate limit` / `secondary rate limit` / `abuse detection`）；
2. 其余 403 归新分类 `permission`：`（权限不足：检查 token 作用域或这个仓库的访问权限）`；
3. 面板给 `permission` 配按钮「去填 token」。

## 判据
**一个状态码不是一种原因。** 判断分类时问的是"客户接下来该做什么"，
而不是"HTTP 语义上它属于哪一类"。

## 是否已落地
✅ 0.9.131。新增 1 例（三种 403 文本各归其类）。

## 还没做的
- 401（凭证无效）与 403（权限）在"去填 token"之后仍可能撞上同一堵墙，没有进一步指引；
- `abuse detection` 的具体等待时长没按文档建议（1 分钟起）单独设。
