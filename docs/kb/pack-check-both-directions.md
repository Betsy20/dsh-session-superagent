# 打包检查要两个方向：不该进的、以及该进的

## 出处
- 包的完整性是**双向**问题：多带文件是体积与泄露风险，少带文件是"装上但不工作"。
  npm 文档明确列出"总是被包含"的文件（README / LICENSE / package.json）：
  <https://docs.npmjs.com/cli/v10/using-npm/developers#keeping-files-out-of-your-package>

## 现场
`scripts/audit-pack.mjs` 原本只查"不该进包的"（`test/`、`.tmp-`、`preview-panel.html` 等）。
但**更痛的是反方向**：该进的没进。

历史上真踩过一次：`lib/body.js` 没进 profile 的链路，**插件整体不挂载**。

## 改法
```js
const REQUIRED = ['lib/index.js', 'lib/watch.js', 'lib/gh-format.js', 'lib/redact.js', 'lib/body.js',
                  'client.js', 'cordis.patch.yml', 'package.json', 'README.md', 'LICENSE']
const missingRequired = REQUIRED.filter((rel) => !listed.includes(rel))
```

## 验证（顺带发现一件事）
- 把 `lib` 目录改成逐个列、故意漏掉 `lib/body.js` → `FAIL …（缺：lib/body.js）` exit=1 ✅
- 但把 `LICENSE` 从 `files` 删掉，**包里照样有** —— 因为 npm 强制包含 README / LICENSE / package.json。
  所以注入验证只能挑 `lib/` 里的文件，否则会得到一个"注入没生效"的假象。

## 判据
**列出"运行必需文件清单"，比列"排除清单"更可靠** ——
排除清单会随重构失效，必需清单会随功能点增长。

## 是否已落地
✅ 0.9.102。14 个文件全在，缺任一必需文件即红。

## 还没做的
- 清单是手写的；理论上可从 `dsh.bundle` / `main` / `require` 图里推导，但要处理动态 import；
- 没查 `CHANGELOG.md` 239.7 kB 是否值得打进包（占总体积 45%）。
