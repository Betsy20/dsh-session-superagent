# 宿主升级怎么「看兼容」：比读 changelog 更靠谱的三件事

## 出处
- `@deepseek-ai/dsh` npm dist-tags：`latest = 0.2.1-rc.5`、**`next = 0.2.2-rc.1`**（2026-11-04 实测）。
- 本仓库对宿主的耦合点只有五个：`ctx.tools`、`ctx.get('agents')`、`ctx.get('goals')`、`ctx.webServer`、`ctx.on/effect`。

## 做法（不装新版也能查）

```bash
npm pack @deepseek-ai/dsh@0.2.2-rc.1 && npm pack @deepseek-ai/dsh@0.2.1-rc.5
# 解开后逐个比对 .d.ts，而不是读 release notes
```

1. **CLI 包类型声明**：`lib/types/*.d.ts` 逐字相同 → 启动器契约没变；
2. **真正提供服务的那几个包**：`dsh-web-app`（webServer）、`dsh-goal`（goals）的 `.d.ts` 逐字相同；
3. **框架层 cordis 4.0.5 → 4.1.0**：
   - `ctx.effect` / `ctx.on` / `ctx.get` 契约不变（我们只用这三个）；
   - **日志级别数值被重排**（`INFO=1,WARN=2` → `WARN=1,INFO=2`）—— 按名字调没问题，传数字会反；
   - provision 形状从 `{fiber}` 变成 `{ctx, uid}` —— 我们不碰 reflect。

## 结论（0.2.2-rc.1）

| 检查 | 结果 |
|---|---|
| `ctx.tools.register` | 不变 |
| `ctx.get('agents' / 'goals')` | 不变 |
| `ctx.webServer.register` | 不变（dsh-web-app 声明逐字相同） |
| `ctx.on('dispose')` / `ctx.effect` | 不变 |
| Node 引擎 | 新宿主要求 **≥24.9.0**；我们写 `≥22.19` 是下界，跑在新宿主上没问题 |
| 新默认包 | official-bundles / liveshare / personalized-recommendations —— 可能新增界面浮层，需真机看是否与状态栏圆环抢位置 |

## 判据

**「兼容新版」= 服务契约没变 + 缺服务时能自己降级。**
所以我们同时做了一件事：`apply()` 里检查 `ctx.tools`，缺了只打一条日志就返回 ——
这样即使某个服务改名，也只是"这个插件不工作"，而不是整棵插件树挂掉。

## 是否已落地
✅ 0.9.179：`apply()` 缺服务守卫 + `lib/gitee.js` 的 `since` 增量（顺带）。

## 还没做的
- **没在真 0.2.2-rc.1 上跑过**（要下载新版并重启宿主，按本机铁律不由我触发）；
- 新默认包（liveshare / forge）与我们的状态栏圆环是否会抢位置，只能真机看。
