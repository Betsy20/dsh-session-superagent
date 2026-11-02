# 从"内部"发现版本漂移：加载版本 vs 磁盘版本

## 出处 / 依据
- 没有任何外部规范能覆盖这件事 —— 这是 ESM 模块加载的必然结果：
  **进程启动时把模块读进内存，之后磁盘上的文件变了，内存里的代码不会变。**
  Node 文档对 ESM 缓存的说明本质如此（`import` 的结果按 URL 缓存）。
- 上一轮 `verify-live` 是从 HTTP 外面看（拿到 `serverVersion` 再和仓库比）；
  这一轮是让**宿主内部**自己发现同一件事。

## 它怎么做的
```js
const here = dirname(fileURLToPath(import.meta.url))
const installed = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')).version
if (installed !== SERVER_VERSION) → "代码已更新但未生效"
```
- `SERVER_VERSION` 常量 = **当前进程里跑着的**代码版本；
- 磁盘 `package.json` = **装好的**版本；
- 两者不同 = 「文件换了，但宿主还在跑老模块」。

## 我们能怎么用
`watch_doctor` 的第一行现在就是这个检查：

```
WARN 代码已更新但未生效：磁盘 0.8.92 / 正在运行 0.8.93 —— 需要重启宿主（不是重装）
```

意义：以前要"点开面板看某功能在不在"才能间接判断；现在问一句 doctor 就行。
而且它给出的建议是**准确的**（重启，不是重装）—— 少一次误操作。

## 是否已落地
✅ 0.8.93（`lib/index.js:installedVersion` + `watch_doctor` 首行）。
实测：把 `package.json` 与 `SERVER_VERSION` 故意错开一版，doctor 立刻输出 WARN。
用例：源码必须含该实现与文案，且仓库内两者保持一致。

## 还没做的
- 没有把"落后几个版本"标出来（要读 npm latest，那是 `/update` 的活）；
- 面板上没有对应提示（面板只显示 `serverVersion`，不和磁盘比）。
