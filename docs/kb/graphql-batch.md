# 一次 GraphQL 查 N 条，别 N 次 REST

## 出处
- GitHub GraphQL API：<https://docs.github.com/en/graphql>
  同一请求里可以用**别名**（alias）查多个对象。

## 它怎么做的
```graphql
query($owner:String!,$name:String!,$a:Int!,$b:Int!,$c:Int!){
  repository(owner:$owner,name:$name){
    i0: issue(number:$a){ number comments(last:1){ nodes { author{login} createdAt } } }
    i1: issue(number:$b){ … }
    i2: issue(number:$c){ … }
  }
}
```

## 我们能怎么用
上一轮（0.8.70）为每条 issue 单独取"最后评论"，批次 3 条 = **3 次 REST + 1 次 `/user`**。
改成一次 GraphQL 批量后 = **1 次请求**。

### 本机实测（2026-11-02，`cli/cli` 的 3 条 issue）
```
批量 GraphQL: 671ms，命中 2/3 条（第 3 条作者已注销，节点为空）
逐条 REST  : 1443ms（3 次调用）
```
→ 耗时约 **1/2.1**，调用次数 **3 → 1**。

### 两个坑（都已处理）
1. **`gh api graphql` 在有 `errors` 时退出码是 1**，但 `stdout` 里 `data` 仍然完整 ——
   所以必须先解析 `stdout`，**不能因为退出码非 0 就整体放弃**（否则只要有一条 issue 不存在，整批白跑）。
   用例里专门造了 `i1: null` + `errors` 的形态来锁这个行为。
2. GraphQL 不可用（老版本 gh / 权限不足）时要有兜底：仍然保留逐条 REST 路径。

## 是否已落地
✅ 0.8.72（`watch.js:buildCommentBatchQuery` / `parseCommentBatch` + `index.js:fetchLastComments` 首选批量、失败回落 REST）。
用例：别名与变量声明、上限 10 条、单条 NOT_FOUND 不影响其他条、无评论不放进来。

## 还没做的
- 没把「取 issue 列表」本身也换成 GraphQL（那是主路径，改动面大，风险高）；
- 没做 GraphQL 的点数预算控制（我们的查询很浅，点数可忽略）。
