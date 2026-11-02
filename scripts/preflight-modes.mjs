// preflight 的两种模式差在哪 —— 单一事实来源。
//
// preflight 用它决定跳过哪些项，render-preflight-modes 用它生成文档，
// 两边读同一份清单，文档就不会和实际行为漂开。
export const FAST_SKIPS = [
  {
    name: '门禁自检',
    why: '要 21 次注入（每次改文件再跑检查），约 4 秒',
    risk: '跳过后不会发现"某条检查已经装死"',
  },
  {
    name: '冒烟 smoke:observe',
    why: '需要真机宿主（DSH_SMOKE_HOST=1）',
    risk: '跳过后不会发现真机上的观察模式失效',
  },
]
