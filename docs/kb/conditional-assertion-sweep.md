# 条件断言普查：脚本只能列，判断还得靠人

## 出处
- 上一轮（[条件断言等于永远通过](fake-pass.md)）记了坑；这一轮做**普查**。
- 这类 smell 没有可靠的静态规则（`if` 里两分支都断言是正常的），
  所以工具定位是"列出来给人看"，不是门禁 —— 与 [审计器最怕假警报](audit-false-positives.md) 一致。

## 脚本
`scripts/audit-conditional-asserts.mjs` 扫三类形态：
1. `if (…) {` 多行块里出现 `assert.`；
2. `if (…) assert.…` 单行；
3. `if (…)` 换行后无花括号的断言。

**故意不接进 preflight**：正常的两分支代码也会被列出，接成门禁只会制造噪音。

## 普查结果（15 个测试文件）
| 位置 | 判定 |
|---|---|
| `meta.test.mjs:66` | 正常 —— 那是 while 循环里的转义分支，断言在循环之外 |
| `watch.test.mjs:405` | **真问题** —— 见下 |

## 修掉的那一处
```js
// 改前：hintPart 为空时这条断言直接跳过（'other' 那一档等于没检查）
if (hintPart) assert.ok(got.hint.includes(hintPart), …)

// 改后：两种分支都是断言
assert.equal(typeof got.hint, 'string')
if (hintPart) assert.ok(got.hint.includes(hintPart), …)
else assert.equal(got.hint, '', '这类错误不该给提示')
```

改完 `node --test test/watch.test.mjs` 77 例仍全过 —— 说明行为没变，
但**'other' 那一档从"没检查"变成了"必须不给提示"**。

## 判断标准（写进本文，以后照用）
- 断言的**前提**如果是"数据碰巧满足"，就该把前提也 assert 出来；
- 如果两个分支**都有**断言，那只是分支，不算绕过。

## 是否已落地
✅ 0.9.49。扫描器 + 一处真实修复。

## 还没做的
- 扫描器按行匹配，不解析 AST；`if` 与断言跨越多行、或断言在 helper 里的情况会漏；
- 没有覆盖 `scripts/` 下的断言（那些是门禁脚本，抽样成本更高）。
