# 先量，再决定改不改；改行结构必须整块重写

## 出处
- 与 [页面子块之间要有节奏](screens-need-vertical-rhythm.md)、[面板行也不能「一堵墙」](panel-row-density.md) 同族。
- 数据来自 `scripts/render-preview.mjs --measure`（无头浏览器里量 `getBoundingClientRect`）。

## 先量：一行 154px 花在哪
```
body h154 | title h20 | meta h21 | note h20 | note h20 | note h20 | actions h30
```

**动作行（立刻/暂停/删除）占 30px + 间距 ≈ 整行高度的 22%。**
这个数字让"要不要合并动作行"从感觉变成了取舍：省 22% 高度，代价是行结构复杂度。

## 再改：两次都炸在同一处
想把动作并进徽章行（右侧对齐）：

| 尝试 | 结果 |
|---|---|
| 按行号剪切 + 插入 | `actions` 被挪到 `const editor` 之后，行结构错位 |
| 按文本锚点替换 | meta 的 `)` 丢失，备注行被塞进徽章行（出图可见） |

两次都 `git checkout -- client.js` 回滚 + `node --check` + 257 例测试确认回到基线。

**根因：这段行结构是 5 层嵌套的 `h()` 调用，靠文本替换搬 12 行 JSX，收尾括号必然错位。**

## 判据
1. **改之前先量**：`--measure` 给出的数字才能支撑"值不值得改"；
2. **动 JSX 行结构只整块重写，不做剪贴**：把整段（从 `h('li'…` 到行尾）一次写完，
   `node --check` 之后再跑测试；
3. **改坏了立刻回滚到基线**，不要在坏掉的树上继续改 —— 本机 `git checkout -- <file>` 最省事。

## 顺带交付
新增结构保护用例：**每条守必须有 3 个动作控件**（立刻 / 暂停或恢复 / 删除）。
下次再动这一块，测试会先拦住。

## 后续（0.9.149）：换个改法就成功了

上一轮结论是"必须整块重写"，这一轮发现还有第三条路：**不改 JSX，改组合**。

```js
// bodyChildren 拼完之后，把 actions 节点挪进 meta 的 children
const actionsAt = bodyChildren.findIndex((n) => has(n, 'dt-ticket-actions'))
const metaAt = bodyChildren.findIndex((n) => has(n, 'dt-ticket-meta'))
bodyChildren[metaAt] = { ...meta, props: { ...meta.props, children: [...meta.props.children, actions] } }
bodyChildren.splice(actionsAt, 1)
```

零括号改动、`node --check` 一次过。结果：

```
改前：body h154 | actions 独占一行 30px
改后：body h125 | actions 并进 meta（meta 21 -> 28）
```

**每条守矮 29px（-19%）。**

> 判据升级：**结构难改时，先问"能不能不改结构"** —— 把节点在数据层拼装，
> 比在源码里剪贴安全一个数量级。剪贴怕括号，组合不怕。

## 是否已落地
✅ 0.9.149：动作行并入徽章行（-19% 行高），600px 窄屏确认不溢出。
✅ 0.9.148：`--measure` 按行量、结构保护用例（每条守 3 个动作控件）。

## 还没做的
- 行内"标题 + 徽章行 + 三行说明"仍有进一步压缩空间（目标行高 ≤ 110px）；
- 判定/触发页的浅色主题只做了肉眼核对，没有像素级对比。
