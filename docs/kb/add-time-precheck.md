# 输入错误要在"点添加"那一刻说

## 出处
- GitHub REST《Get a repository》：对**不存在**的仓库与**无权访问**的私有仓库都返回 `404`
  <https://docs.github.com/en/rest/repos/repos#get-a-repository>
  —— 所以提示文案必须同时覆盖两种可能（"不存在，或没有权限"），否则会误导。
- 交互原则来自官方仓库对象的语义：`has_issues` / `archived` / `permissions.push`
  都是**读一次就知道**的事实，没有理由等到运行失败。

## 它怎么做的
把"能不能干活"的判断前置到用户动作发生的时刻，而不是后台跑完再报错。

## 我们能怎么用
之前的顺序是：填仓库 → 点添加 → 后台 `probeAccess` → 下一次 `/state` 才出现提示。
填错名字（最常见）的客户要等十几秒才看到"这个仓库不存在"。

改法：**新建时**同步做一次体检（10 秒超时），把结论直接放进 `POST /watch` 的响应：

```json
{ "ok": true, "id": "...", "warnings": ["仓库 o/x 不存在，或当前 token 没有访问权限 …"] }
```

面板拿到 `warnings` 就立刻提示，不再干等。

关键取舍：
- **只告警、不阻断** —— 网络抖动不该让人加不了守；
- 测试环境（`DSH_SUPERAGENT_NO_POLL=1`）跳过网络，`warnings` 仍返回空数组，契约不变；
- 编辑已有守不做体检（避免每次保存都打一次网络）。

## 是否已落地
✅ 0.8.68（`index.js:precheckRepo` + `/watch` 响应 `warnings` + 面板 `notify`）。
用例：新增守的响应里 `warnings` 必须始终是数组。

## 还没做的
- 面板还没有"填写时就校验"（现在仍是提交后才查）；
- 没做仓库名纠错建议（GitHub 的 `search/repositories` 能给近似名，但会消耗 search 池额度）。
