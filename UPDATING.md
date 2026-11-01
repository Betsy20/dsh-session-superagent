# 更新与发布

## 铁律

默认分支只接受通过门禁的 PR；`main` 永远可安装。

## 发一个版本

```bash
git checkout main && git pull
git checkout -b feat/<主题>

# 1) 改代码 + 补测试
node --test

# 2) bump 版本 + 写 CHANGELOG
#    语义化：修 bug → patch；加能力 → minor；改默认行为/改 patch 行 id → major

# 3) 提交并推分支
git add -A && git commit -m "feat: ..."
git push -u origin feat/<主题>

# 4) PR 全绿后合并
gh pr create --fill && gh pr merge --squash --delete-branch

# 5) 回到 main 打 tag 并发 Release
git checkout main && git pull
git tag -a v0.1.1 -m "v0.1.1"
git push origin v0.1.1
gh release create v0.1.1 --title "v0.1.1" --notes-from-tag
```

## 用户怎么升级

```bash
dsh plugin --profile <p> update dsh-session-superagent
```

pnpm 依据 `github:` 规格重新解析；或重新 `add` 一次覆盖。

## 兼容性

插件依赖宿主内部 API（`ctx.tools`、`ctx.agents`）。升级到新的 DSH 内部 API 视为 **major**，因为旧宿主可能不再提供同样的服务。
