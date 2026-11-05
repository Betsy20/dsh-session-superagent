# 测试桩比运行时干净，就会掩盖 bug

## 问题

2026-11-05，客户截图反馈：**设置页左栏点哪一项都不换内容，右边永远是「来源」**。

根因在 `client.js`：

```js
const settingsBody = settingsSections.find((node) => node.props && node.props.key === settingsSection)
```

`key` 是 React 的**特殊 prop**：它挂在 `element.key` 上，**不出现在 `props` 里**。
所以真机上 `node.props.key` 恒为 `undefined` → `find` 永远落空 → 回退到 `find(Boolean)` = 第一块。

**387 条用例一条都没发现**，因为 `test/fixtures/panel-harness.mjs` 的手写 `createElement` 把 `key` 留在了 `props` 里。

这不是第一次。同一类问题在这个仓库里出现过两次：

| 时间 | 桩里成立、真机不成立 |
|---|---|
| 0.9.2xx（T26） | `panel-harness` 的 `watcher()` 桩里 `intervalSec: 30` 恒存在、`goal: null` 恒为空、`gh` 根本不在桩里 —— 于是「假数据造出来的正确」掩盖了「真数据下的错误」 |
| 0.9.248 | `createElement` 保留 `props.key` —— 于是「靠 props.key 找子节点」在桩里能跑 |

## 规则

1. **桩必须模仿运行时的「坏脾气」，不是模仿它的「好脾气」。**
   真 React 剥 `key`、冻结 `props`、`useState` setter 会触发重渲染 —— 桩要跟着做，哪怕这让用例更难写。
2. **凡是「桩里绿、真机红」，一律先怀疑桩。**
   修 bug 之前，先把桩和运行时对齐，否则同类 bug 会再出现一次。
3. **夹具宁可脏，不要干净。**
   `dirtyWatcher()` / `dirtyState()` 就是按后端真实形状造数据（缺失字段、对象当字符串、三态 null）。

## 是否已落地

- ✅ 落地 0.9.248：`client.js` 改成按序取块；桩的 `createElement` 剥掉 `key`（与 React 一致）；
  新增用例把 `settingsSection` 设成三种值，断言三块内容各不相同。
- ✅ 落地 0.9.249：新增门禁 `scripts/audit-react-semantics.mjs` —— 三条判据：
  代码里不许用 `props.key` 做判断、不许改写 `props`、桩必须剥 `key`。

## 依据

- React 文档：`key` 是保留属性，不会被传入组件的 `props`（"Keys … are not passed to your component"）。
- 本仓实证：`docs/报告-测试桩保真度审计.md`、0.9.248 的 CHANGELOG 小节。
