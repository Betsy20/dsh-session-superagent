# 更新与发布

## 铁律

1. 默认分支只接受通过门禁的 PR；`main` 永远可安装。
2. **发版三步缺一不可**：`npm publish` + `git tag` + `GitHub Release`。
   只发 npm 不发 Release，客户打开仓库「发布」看到的是旧版本 —— 等于假装没在更新（0.9.168 之前就是这样，页面停在 v0.8.11）。
3. **Release 标题只写版本号**（`v0.9.168`），说明放正文。标题带中文描述会让列表不可扫读。

## 发一个版本（标准流程）

```bash
# 1) 改代码 + 补测试
node --test

# 2) bump 版本 + 写 CHANGELOG
#    语义化：修 bug → patch；加能力 → minor；改默认行为 / 改 patch 行 id → major
#    五处必须一起改：package.json / lib/index.js / client.js / README 徽章 / CHANGELOG
node scripts/check-maintenance.mjs      # 会告诉你哪处没对齐

# 3) 全量门禁（不是 --fast）
node scripts/preflight.mjs

# 4) 提交 + 推送
git add -A && git commit -m "fix: ..." && git push origin main

# 5) 发 npm
npm publish

# 6) 打 tag + 建 Release（标题自动是纯版本号）
node scripts/release-gh.mjs --latest

# 7) 同步到本机安装副本（用户重启后生效）
node scripts/sync-profile.mjs
```

历史遗留版本要补 Release 时用 `node scripts/release-gh.mjs`（不带 `--latest`），
它会按 CHANGELOG 顺序回填；`--dry-run` 可以先看要做多少事。

## 发布后必须核对

```bash
node scripts/check-maintenance.mjs                 # 六项：CHANGELOG / tag / 四处版本一致
gh release view v<版本> --repo MYCF711/dsh-session-superagent --json name,isLatest
node -e "console.log(require('<安装副本>/package.json').version)"
```

## 用户怎么升级

```bash
dsh plugin --profile <p> update dsh-session-superagent
```

pnpm 依据 `github:` 规格重新解析；或重新 `add` 一次覆盖。

**服务端改动（`lib/`）要重启宿主才生效；`client.js` 改动刷新即可。**
面板报「代码已更新到 X，但宿主还在跑 Y」时，就是这一条没做。

## 兼容性

插件依赖宿主内部 API（`ctx.tools`、`ctx.agents`）。升级到新的 DSH 内部 API 视为 **major**，
因为旧宿主可能不再提供同样的服务。
