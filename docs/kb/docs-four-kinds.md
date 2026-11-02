# 文档分四种，别用一种应付

## 出处
- Divio Documentation System（"The Grand Unified Theory of Documentation"）：
  <https://docs.divio.com/documentation-system/>
  原文把文档分成四类：**tutorials / how-to guides / reference / explanation**，
  各自服务不同场景（学习 / 解决问题 / 查参数 / 理解为什么）。

## 它怎么做的
四类文档的写法**互相冲突**：
- tutorial 要"手把手、别讲原理"；
- reference 要"完整、准确、可查"；
- explanation 要"讲清取舍与背景"。
用一个文件同时做三件事，结果三件都做不好。

## 我们能怎么用
我们原来的文档结构其实是混着的：
- `README.md` 既是参考（工具表）又是安装说明；
- `CHANGELOG.md` 越写越长（现在是开发视角）；
- `docs/kb/` 是 explanation（讲取舍）。

缺的是最影响首次体验的一类：**tutorial**。新客户照着 README 装完，仍然不知道
"怎么确认它真的在工作"。

所以新增 `docs/首次唤醒走查.md`（tutorial）：
7 步，**每步都写"你应该看到什么"和"没看到时看哪里"**，
并且三条路径都能落到具体页面（总览 / 判定 / 设置 → 诊断）。

现在四类齐了：

| 类型 | 文件 |
|---|---|
| tutorial | `docs/首次唤醒走查.md` |
| how-to | `UPDATING.md`（仓库根目录）、`docs/首次唤醒走查.md` 的速查表 |
| reference | `README.md`（工具表、参数）、`docs/01-架构.md` |
| explanation | `docs/kb/*`（每条的"取舍"段）、`docs/whats-new-0.9.md` |

## 是否已落地
✅ 0.8.91（走查 + `docs/README.md` 索引）。

## 还没做的
- 没有为"多个仓库同时守"再写一份；`UPDATING.md`（仓库根目录） 也没有完全贴合 how-to 的写法。
