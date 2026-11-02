# `open(p,'w').write(open(p).read())` 会把文件清空

## 出处
- 这是 Python 的求值顺序陷阱：外层 `open(p,'w')` **先**执行（立即截断文件），
  内层读到的已经是空文件。属于"看起来是链式一行，实际有副作用顺序"的经典坑。

## 现场
把 README 的版本号从 0.9.54 更新到 0.9.55 时，我写成了：

```python
io.open('README.md','w',newline='').write(
  io.open('README.md', encoding='utf-8', newline='').read().replace(...))
```

结果：**README 变成 0 行**（208 行没了）。

## 怎么发现的
门禁立刻红了两条：
```
FAIL 单测 node --test ─ README 徽章版本 = package.json 版本
FAIL README 单测数    README 没写单测数
FAIL 版本一致（4 处）  0.9.55 / client 0.9.55 / badge undefined / changelog 0.9.55
```
`badge undefined` 是最先露馅的 —— 它说明连版本徽章那一行都不见了，不只是"数字没更新"。

## 恢复
`git show HEAD:README.md > README.md` —— 上一版刚提交过，所以零损失；
再用**先读后写**的两步写法改两处。**这就是"每轮都 commit"的实际价值：任何时刻都有回退点。**

## 正确写法
```python
s = io.open(p, encoding='utf-8', newline='').read()   # 先读，关闭
s = s.replace(...)
io.open(p,'w',encoding='utf-8',newline='').write(s)   # 再写
```

## 是否已落地
✅ 0.9.56（修复 + 本条目）。README 恢复为 208 行，版本 0.9.55 → 徽章与单测数同步。

## 还没做的
- 没有给"写文件"加防护（比如写前断言内容非空）—— 靠纪律；
- 同类风险还存在于"多个脚本同时改同一文件"，目前靠串行跑规避。
