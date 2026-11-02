// 可用性抽检：客户遇到三种典型问题时，界面"第一句话"是什么、是否指向下一步。
// 只读不改：输出当前文案，供人工判断；真正的断言在 test/client.test.mjs。
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

// 复用 client.test.mjs 里的极简渲染器思路：这里只做静态提取，避免复制一整套桩。
const grab = (marker, span = 120) => {
  const i = src.indexOf(marker)
  return i < 0 ? '(未找到)' : src.slice(i, i + span).replace(/\s+/g, ' ').trim()
}

console.log('== 三种典型问题的"第一句话" ==\n')

console.log('① 仓库没权限（只读）')
console.log('  行内徽章：' + grab("badges.push({ text: '只读'"))
console.log('  需要关注：' + grab("return '你对 ' + String(repoAccess.repo"))
console.log('')

console.log('② 会话没规则（叫醒了没回音）')
console.log('  需要关注：' + grab("text: watcher.repo + ' 已连续 '"))
console.log('  下一步动作：' + grab("action: { label: '看建议规则'"))
console.log('')

console.log('③ 一直没动静')
console.log('  判定页时间线：' + grab("title: '时间线（最近 20 条）'"))
console.log('  总览中间态：' + grab("'还没有唤醒过：守会在仓库出现新条目时叫醒这个会话。'"))
console.log('  跳过原因：' + grab('const skipped = options.skippedReasons'))
console.log('')
console.log('判据：每句都要能回答"我现在该做什么"，或明确"不用管"。')

console.log('')
console.log('== 另外三条 ==')

console.log('')
console.log('④ 面板接口挂了（/state 500）')
console.log('  顶部横幅：' + grab('if (/HTTP 5'))
console.log('')

console.log('⑤ gh 未安装 / 未登录')
console.log('  设置页：' + grab("['gh CLI', !body.gh"))
console.log('  需要关注：' + grab("text: 'gh CLI 不可用，且没有配置 token"))
console.log('')

console.log('⑥ 仓库已归档 / 关闭 Issues')
console.log('  需要关注：' + grab("return repo + ' 已归档："))
console.log('           ' + grab("return repo + ' 关闭了 Issues —— 主理鱼只认"))
console.log('  动作：暂无可点操作（文案提示换仓库）')
