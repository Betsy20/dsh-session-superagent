# 「schemaVersion」还不够，要说清哪个字段可以依赖

## 出处
- 语义化版本解决的是"什么时候算破坏性变更"，但它不回答**哪个字段**是承诺。
  Kubernetes API 的做法是把字段分成 `stable / beta / alpha` 并在文档里明示
  <https://kubernetes.io/docs/reference/using-api/deprecation-policy/>
- 我们缩小成两档：`stable`（不会无故改名/删除）与 `experimental`（可能变）。

## 做法
`test/fixtures/contract-stability.json` 是**唯一口径**：

```json
"watch_status": {
  "root":    { "schemaVersion": "stable", "session": "stable", "watchers": "stable" },
  "session": { "id": "stable", "used": "stable", "cap": "stable", "capped": "stable", "suggest": "stable" },
  "watcher": { "repo": "stable", …, "lastDeferred": "experimental", "cursor": "experimental" }
}
```

配套用例做两件事：
1. **实测 JSON 的字段集合必须与清单完全一致** —— 新增字段不登记就红；
2. 清单里的级别只能是 `stable` / `experimental`，且至少有一个 stable（防止清单自我腐烂）。

## 本轮它抓到的
第一次跑就红两次：
- `watch_stop` 实际返回 `{schemaVersion, ok, id, repo}`，我漏登记了 `repo`；
- `watch_ack` 失败时返回 `{schemaVersion, ok, repo, acked, failed}`，与成功形状不同 —— 用例改成**两种形状都接受**。

这两处都是"我以为我记得返回值，实际不是"的典型。

## 为什么值得
- 有清单之后，"加个字段"从随手改变成**一个决定**（stable 还是 experimental）；
- 消费方能据此写代码：依赖 stable，容忍 experimental；
- 清单本身也有用例守着，不会变成没人看的死文档。

## 是否已落地
✅ 0.9.47。`test/contract-stability.test.mjs`（2 例）；清单覆盖 6 个工具的 JSON 输出。

## 还没做的
- 没有覆盖**嵌套更深**的结构（如 `results[]` 里每条的字段）；
- 没有把清单渲染进 README（消费方仍要去 test/fixtures 里看）。
