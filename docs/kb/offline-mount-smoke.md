# 「挂不挂得上去」要在离线就有答案

## 出处
- Node 的 ESM 动态 import + 手写假 ctx 就能完整跑一遍插件 `apply()`；
  这也是我们测试套件一直在用的方式（`test/routes.test.mjs` 的假 ctx）。
- 原则来自真机事故：**插件整体不挂载 = 工具与路由一起消失**，而这类失败在真机上只表现为
  "面板空白 / 工具不见了"，看不出根因。

## 背景（为什么这轮要做）
本机实测线上 `/state` 的 `serverVersion` 还是 **0.8.38**，仓库已到 0.8.86 ——
服务端改动只有重启宿主才生效，所以**下一次重启会一口气跳 48 个版本**。
一次性跨越这么多改动，最该担心的不是某条逻辑，而是"能不能挂上去"：
新增文件没同步进 profile、路由撞车、import 写错，任何一种都会让整块功能消失。

## 它怎么做的
`scripts/smoke-mount.mjs`：
1. 造一个够用的假 ctx（`tools.register` / `webServer.register` / `agents` / `get` / `effect` / `inject`）；
2. 真的 `import` 当前 `lib/index.js` 并 `apply(ctx)`；
3. 断言 8 条路由一条不少、工具 > 0、无异常；
4. 输出一行：`挂载冒烟 OK：0.8.86，工具 7 个，路由 8 条`。

`preflight` 已接入（第 9 项检查），所以每次推送前都会被守一次。

## 是否已落地
✅ 0.8.87（`scripts/smoke-mount.mjs` + preflight 第 9 项）。

## 还没做的
- 没有模拟"真宿主重载两次"的场景（那由 `test/route-resilience.test.mjs` 覆盖）；
- 没有校验工具参数 schema（`apply` 注册即可，schema 错要到调用时才炸）。
