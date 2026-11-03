# 同一个失败在不同平台措辞不同，分类要认全

## 出处
Node 的错误参考把系统级错误码列成一张表（`ENOENT` / `EACCES` / `EPIPE`…），
并说明这些是**平台相关的**系统调用失败：

> Common system errors … `ENOENT` (No such file or directory) …

<https://nodejs.org/api/errors.html#common-system-errors>

## 现场（真实字符串实测）
我们的 `classifyGhError` 只认 `ENOENT` / `gh: command not found`：

| gh 产出的文本 | 我们的分类 |
|---|---|
| `spawn gh ENOENT` | `nogh` ✅ |
| `gh: command not found` | `nogh` ✅ |
| `'gh' is not recognized as an internal or external command,`（Windows cmd） | **`other`** ❌ 显示"没归类的错误" |

也就是说：**Windows 客户没装 gh 时，看到的是"没归类的错误"**，
而不是"找不到 gh：确认已安装且在 PATH"。

## 改法
把 Windows cmd 的措辞也加进同一条正则（保持一个分类、一个动作）：

```js
if (/ENOENT|not found.*gh|gh: command not found|not recognized as an internal or external command/i.test(text))
```

## 判据
**分类规则要按"同一失败的多种措辞"来收集，而不是按"我见过的那一条"。**
收集来源就是各平台的真实报错 —— 这也是为什么真机日志比文档更值钱。

## 顺带
`watch_doctor` 里写死的「最多每 **2 小时**一次」改成由 `RETRY_SLOW_CAP_MINUTES` 计算 ——
上一轮立的"数字要能指回来源"还没覆盖到 `lib/` 自己的中文提示。

## 是否已落地
✅ 0.9.129。新增 1 例（三种措辞）+ 更新 1 例（doctor 按常量断言）。

## 还没做的
- `EACCES`（无执行权限）、`EPIPE` 等码还没各自给动作；
- 分类正则里的措辞仍是人工收集，没有"未知措辞进 other 时留样本"的机制。
