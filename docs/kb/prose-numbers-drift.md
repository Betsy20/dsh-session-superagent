# 散文里的数字最容易过期：README 写着 136，实际 181

## 出处
- 这是 docs-as-code 里最典型的漂移：**结构性内容（表格/清单）有人维护，顺带提的数字没人看**。
- 上一轮（[文档里的标识符会漂移](identifier-drift.md)）已经覆盖了标识符；
  这一轮补的是**数字**这一类。

## 发现
README「开发」小节写着：

```
node --test          # 136 项单测
```

实际跑出来是 **181 项** —— 差了 45 项，跨了四十多个版本没人发现。
原因很直白：**谁加用例都不会想起去改 README 的注释**。

## 改法（让它自己报错）
`preflight` 在跑完 `node --test` 后顺手比对：

```js
const claimed = readFileSync('README.md','utf8').match(/(\d+) 项单测/)[1]
record('README 单测数', claimed === String(tests), claimed === String(tests) ? ok : 'README 写 136，实际 181（改 README）')
```

第一次跑就红：

```
FAIL README 单测数    README 写 136，实际 181（改 README）
```

改成 181 后：`PASS README 单测数　README 写 181，实际 181`。

## 为什么值得加
- 成本几乎为零（数字本来就在 preflight 手里）；
- 这类数字**只对外**（给客户看），错了会让人以为项目很轻；
- 它同时守住"用例数只增不减"这件事 —— 如果哪天数字变小了，也会立刻暴露。

## 是否已落地
✅ 0.9.45。`preflight --fast` 新增第 19 项。

## 还没做的
- 只覆盖 README 这一处；`docs/` 里还有几处写着旧数字（如早期评审记录，属于历史快照，不必改）。
