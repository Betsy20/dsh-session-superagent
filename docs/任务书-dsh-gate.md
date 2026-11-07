# 任务书：dsh-gate 独立门禁插件（monorepo）

> 基线：`dsh-session-superagent@0.10.4`（main `79374e6`）
> 目标：把门禁从主插件里抽成可独立安装的 npm 包，主插件只保留接口与适配。
> 原则：最小模块、插件化、可替换 provider；不重复官方权限审查。

## 一、目标与非目标

### 目标

1. 新增 `packages/dsh-gate`，包名 `@mycf711/dsh-gate`。
2. 主插件通过 `@mycf711/dsh-gate` 依赖使用门禁，不再内嵌规则实现。
3. 门禁支持四层配置：默认 / 用户全局 / 项目 / 本地覆盖。
4. 主插件暴露稳定接口：`ctx.get('gate')` 优先，缺失时回退本地实现。
5. 保持现有 697 项测试全绿；新增门禁包独立测试。
6. 0.10.5 发布时同时发布 `@mycf711/dsh-gate@0.1.0`。

### 非目标

- 不做官方“自动授权审查”的替代；那是工具权限层。
- 不在本轮重写面板全部 UI；先接口 + API + 最小「门禁」页。
- 不引入 git submodule；使用 npm workspaces。
- 不自动向外部仓库发 PR、不自动重启宿主。

## 二、仓库布局

```text
package.json                         # workspaces: ["packages/*"]
packages/
  dsh-gate/
    package.json                     # @mycf711/dsh-gate
    lib/index.js                     # 稳定接口 + 四层配置 + 确定性规则
    packages/dsh-gate/lib/semantic.js                  # 可选语义复审 / 提示词润色
    bin/gate.mjs                     # CLI：--trigger --body-file --current --repo
    gates/default.json               # 默认规则（随包发）
    test/*.test.mjs
    README.md
```

主插件保留：

```text
lib/gates.js        # 兼容 re-export（旧测试/调用点不破）
lib/index.js        # 四条 /gates 路由 + ctx.get('gate') 适配
client.js           # 「门禁」设置页（最小）
```

## 三、接口契约

```ts
type Trigger = 'issue.reply' | 'pr.reply' | 'pr.handle' | 'merge' | 'release'

interface GateHit {
  id: string
  label: string
  severity: 'error' | 'warn'
  message: string
}

interface GateResult {
  ok: boolean
  hits: GateHit[]
  semantic?: { skipped: boolean; warning?: string }
}

interface GateProvider {
  id: string
  check(input: {
    trigger: Trigger
    text: string
    current?: number | string
    repo?: string
  }): Promise<GateResult>
}
```

主插件调用：

```js
const gate = ctx.get('gate') || createGate()
const result = await gate.check({ trigger: 'issue.reply', text, current, repo })
if (!result.ok) return
```

语义复审：

- 只允许 `merge` / `release`。
- 默认关闭；未选模型时跳过，硬门禁仍生效。
- 模型不可用/超时：默认放行并给 warning，不阻断硬门禁。

## 四、工作流与依赖

| 编号 | 工作流 | 写作用域 | 依赖 | 验收 |
|---|---|---|---|---|
| G1 | 门禁核心包 | `packages/dsh-gate/**` | 无 | 包内测试全绿；`node --check`；默认 JSON 可解析 |
| G2 | 主插件适配 + API | `lib/gates.js`、`lib/index.js`、`test/gates.test.mjs`、`test/routes.test.mjs` | G1 接口冻结 | 主插件 697+ 全绿；四条路由兼容 |
| G3 | 面板「门禁」页 | `client.js`、`test/client.test.mjs` | G2 API 形状 | 中文规则卡；编辑/保存/预览；无裸正则 |
| G4 | 发布与 CI | `package.json`、`package-lock.json`、`scripts/*`、`.github/workflows/*`、`README.md`、`CHANGELOG.md` | G1–G3 | workspaces 安装；pack 含 gate；0.10.5 + gate@0.1.0 发布 |

### 并行规则

- G1 先做；G2/G3/G4 在 G1 接口冻结后**同轮发出**。
- 写作用域按文件切开：G1 只写 `packages/dsh-gate/**`；G2 只写主插件服务端；G3 只写 `client.js`；G4 只写根配置/文档/CI。
- 禁止 `git add -A`；每个工作流只 `git add` 自己列出的路径。
- 同一文件单写者；G2 需要 G1 的接口时只 import，不复制实现。

## 五、验收清单

- [ ] `npm test` 全绿（主插件 + gate 包）。
- [ ] `node scripts/preflight.mjs` 41/41。
- [ ] `npm pack` 包含 `packages/dsh-gate` 的依赖声明；`@mycf711/dsh-gate` 独立 pack 含 `gates/default.json`。
- [ ] `node bin/gate.mjs --trigger issue.reply --body-file draft.md --current 15` 能 FAIL 串台、PASS 干净回复。
- [ ] 项目 `.superagent/gates.json` 可覆盖默认规则；`extends` 行为有测试。
- [ ] 语义复审只对 `merge`/`release` 生效；`issue.reply` 跳过。
- [ ] 面板显示中文 label/description，正则收进「高级」。
- [ ] 0.10.5 与 gate@0.1.0 的 npm、tag、Release、CI 全绿。

## 六、风险

| 风险 | 处理 |
|---|---|
| workspaces 让主包发布带上本地依赖 | 发布前 `npm pack` 检查；gate 用固定版本 `0.1.0`，不用 `workspace:*` |
| 主插件旧测试仍 import `lib/gates.js` | G2 保留 re-export，先绿再迁移 |
| 面板 hook 队列错位 | 新 UI 放子组件，不往主面板加 `useState` |
| 官方自动授权审查重复 | 门禁只做内容层；权限层留给官方 |
| 发布 tag 竞态 | 先合并 main，再打 tag；CI 失败重跑一次 |

## 七、完成定义

主插件与 gate 包都能独立安装；`ctx.get('gate')` 可替换；旧行为不回归；发布三件套齐全。
