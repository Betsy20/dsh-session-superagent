# 「声明版本」与「已生效版本」要分别暴露

## 出处
- Kubernetes API 概念：`generation`（期望状态改到了第几代）与 `observedGeneration`
  （控制器实际处理到第几代）。两者不等 = **控制器还没跟上**。
  <https://kubernetes.io/docs/reference/using-api/api-concepts/#generation-and-observedgeneration>

## 它怎么做的
把「我想要的」和「系统实际做到的」当成**两个独立字段**暴露出来，
而不是让用户去猜"我改了这么久，到底生效没有"。

## 我们能怎么用
我们有完全同构的问题：
- 磁盘上的 `package.json` 版本 = **声明版本**（我们写进去的）；
- 进程里 `SERVER_VERSION` = **已生效版本**（宿主真正在跑的）。

客户端热重载会让界面变新，服务端不会 —— 于是最常见的困惑是
"界面变了，功能没变"。以前只能靠 agent 调 `watch_doctor` 才知道。

改法（0.8.94）：
1. `/state` 暴露 `installedVersion` 与 `runningVersion`；
2. 两者不等时，面板**顶部横幅**说明原因与动作（重启宿主，不是重装）。

## 是否已落地
✅ 0.8.94（`/state` 两字段 + 面板横幅 + 上轮的 `watch_doctor` 首行）。
用例：漂移时必须出现横幅且写出两个版本号；一致时不出现。

## 还没做的
- 没做"自动提示重启"（推送/系统通知）；
- 面板没有给出"重启"的具体操作链接（我们不做重启，只能写文字）。
