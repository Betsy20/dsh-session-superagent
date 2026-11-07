import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { loadGateConfig, mergeConfig } from '../lib/index.js'
import { tempDir, writeJsonFile, writeTextFile } from './helpers.mjs'

const rule = (id, extra = {}) => ({
  id,
  label: id,
  type: 'contains',
  value: id,
  triggers: ['issue.reply'],
  message: id,
  ...extra,
})

test('四层合并：default → user → project → local，同 id 覆盖、不同 id 追加', () => {
  const home = tempDir('gate-home-')
  const repo = tempDir('gate-repo-')
  writeJsonFile(join(home, '.dsh', 'state', 'session-superagent', 'gates.json'), {
    name: 'user',
    rules: [
      rule('secret', {
        label: '用户覆盖',
        type: 'contains',
        value: '只在这里出现',
        message: '用户命中',
      }),
      rule('user-only'),
    ],
  })
  writeJsonFile(join(repo, '.superagent', 'gates.json'), {
    name: 'project',
    rules: [rule('project-only')],
  })
  writeJsonFile(join(repo, '.superagent', 'gates.local.json'), {
    name: 'local',
    rules: [rule('local-only')],
  })

  const loaded = loadGateConfig({ repo, home, env: {} })
  assert.deepEqual(loaded.sources.map((source) => source.name), ['default', 'user', 'project', 'local'])
  assert.equal(loaded.config.name, 'local')
  // 10 条默认 - secret 被覆盖 + user-only / project-only / local-only = 13
  assert.equal(loaded.config.rules.length, 13)
  assert.equal(loaded.config.rules.filter((item) => item.id === 'secret').length, 1)
  const secret = loaded.config.rules.find((item) => item.id === 'secret')
  assert.equal(secret.message, '用户命中')
  assert.equal(secret.type, 'contains')
  assert.deepEqual(secret.triggers, ['issue.reply'])
  for (const id of ['user-only', 'project-only', 'local-only']) {
    assert.ok(loaded.config.rules.some((item) => item.id === id), id + ' 应该被追加')
  }
  assert.deepEqual(loaded.errors, [])
})

test('用户层可以开启语义复审并选择模型', () => {
  const home = tempDir('gate-home-')
  const repo = tempDir('gate-repo-')
  writeJsonFile(join(home, '.dsh', 'state', 'session-superagent', 'gates.json'), {
    name: 'user',
    rules: [],
    semantic: { enabled: true, baseURL: 'http://user.example/v1', model: 'user-model', mode: 'warn', prompt: 'p' },
  })
  const loaded = loadGateConfig({ repo, home, env: {} })
  assert.equal(loaded.config.semantic.enabled, true)
  assert.equal(loaded.config.semantic.model, 'user-model')
  assert.equal(loaded.config.semantic.baseURL, 'http://user.example/v1')
})

test('项目层尝试开启语义复审会被忽略并记录错误', () => {
  const home = tempDir('gate-home-')
  const repo = tempDir('gate-repo-')
  writeJsonFile(join(home, '.dsh', 'state', 'session-superagent', 'gates.json'), {
    name: 'user',
    rules: [],
    semantic: { enabled: true, baseURL: 'http://user.example/v1', model: 'user-model', prompt: 'p' },
  })
  writeJsonFile(join(repo, '.superagent', 'gates.json'), {
    name: 'project',
    rules: [],
    semantic: { enabled: true, baseURL: 'http://project.example/v1', model: 'project-model' },
  })
  const loaded = loadGateConfig({ repo, home, env: {} })
  assert.equal(loaded.config.semantic.enabled, true)
  // 项目层不能替用户换模型
  assert.equal(loaded.config.semantic.model, 'user-model')
  assert.equal(loaded.config.semantic.baseURL, 'http://user.example/v1')
  assert.ok(loaded.errors.some((item) => item.layer === 'project' && /只能关闭语义复审/.test(item.error)))
})

test('项目层可以关闭用户层开启的语义复审', () => {
  const home = tempDir('gate-home-')
  const repo = tempDir('gate-repo-')
  writeJsonFile(join(home, '.dsh', 'state', 'session-superagent', 'gates.json'), {
    name: 'user',
    rules: [],
    semantic: { enabled: true, baseURL: 'http://user.example/v1', model: 'user-model', prompt: 'p' },
  })
  writeJsonFile(join(repo, '.superagent', 'gates.json'), {
    name: 'project',
    rules: [],
    semantic: { enabled: false },
  })
  const loaded = loadGateConfig({ repo, home, env: {} })
  assert.equal(loaded.config.semantic.enabled, false)
  assert.ok(!loaded.errors.some((item) => item.layer === 'project'))
})

test('本地层同样只能关闭语义复审', () => {
  const home = tempDir('gate-home-')
  const repo = tempDir('gate-repo-')
  writeJsonFile(join(repo, '.superagent', 'gates.local.json'), {
    name: 'local',
    rules: [],
    semantic: { enabled: true, model: 'local-model' },
  })
  const loaded = loadGateConfig({ repo, home, env: {} })
  assert.equal(loaded.config.semantic.enabled, false)
  assert.equal(loaded.config.semantic.model, 'group/deepseek-v4.1-flash-1017')
  assert.ok(loaded.errors.some((item) => item.layer === 'local' && /只能关闭语义复审/.test(item.error)))
})

test('extends:false 替换之前所有层', () => {
  const home = tempDir('gate-home-')
  const repo = tempDir('gate-repo-')
  writeJsonFile(join(repo, '.superagent', 'gates.json'), {
    extends: false,
    name: 'replace',
    rules: [rule('only')],
  })
  const loaded = loadGateConfig({ repo, home, env: {} })
  assert.deepEqual(loaded.sources.map((source) => source.name), ['default', 'project'])
  assert.equal(loaded.config.name, 'replace')
  assert.deepEqual(loaded.config.rules.map((item) => item.id), ['only'])
})

test('extends:"none" 与 false 等价', () => {
  const home = tempDir('gate-home-')
  const repo = tempDir('gate-repo-')
  writeJsonFile(join(repo, '.superagent', 'gates.json'), {
    extends: 'none',
    name: 'none',
    rules: [rule('only')],
  })
  const loaded = loadGateConfig({ repo, home, env: {} })
  assert.deepEqual(loaded.config.rules.map((item) => item.id), ['only'])
})

test('extends 相对路径：以该文件为基再追加本层规则', () => {
  const home = tempDir('gate-home-')
  const repo = tempDir('gate-repo-')
  writeJsonFile(join(repo, '.superagent', 'base.json'), {
    name: 'base',
    rules: [rule('base-rule')],
  })
  writeJsonFile(join(repo, '.superagent', 'gates.json'), {
    extends: './base.json',
    name: 'project',
    rules: [rule('own-rule')],
  })
  const loaded = loadGateConfig({ repo, home, env: {} })
  assert.equal(loaded.config.name, 'project')
  assert.ok(loaded.config.rules.some((item) => item.id === 'base-rule'))
  assert.ok(loaded.config.rules.some((item) => item.id === 'own-rule'))
  assert.ok(!loaded.errors.some((item) => item.layer === 'project'))
})

test('extends 对象：以内联对象为基', () => {
  const home = tempDir('gate-home-')
  const repo = tempDir('gate-repo-')
  writeJsonFile(join(repo, '.superagent', 'gates.json'), {
    extends: { rules: [rule('inline-base')] },
    name: 'project',
    rules: [rule('own-rule')],
  })
  const loaded = loadGateConfig({ repo, home, env: {} })
  assert.ok(loaded.config.rules.some((item) => item.id === 'inline-base'))
  assert.ok(loaded.config.rules.some((item) => item.id === 'own-rule'))
})

test('extends 循环被记录，且不阻断其他规则', () => {
  const home = tempDir('gate-home-')
  const repo = tempDir('gate-repo-')
  writeJsonFile(join(repo, '.superagent', 'a.json'), {
    extends: './b.json',
    rules: [rule('a-rule')],
  })
  writeJsonFile(join(repo, '.superagent', 'b.json'), {
    extends: './a.json',
    rules: [rule('b-rule')],
  })
  writeJsonFile(join(repo, '.superagent', 'gates.json'), {
    extends: './a.json',
    name: 'project',
    rules: [rule('c-rule')],
  })
  const loaded = loadGateConfig({ repo, home, env: {} })
  assert.ok(loaded.errors.some((item) => /循环/.test(item.error)))
  for (const id of ['a-rule', 'b-rule', 'c-rule']) {
    assert.ok(loaded.config.rules.some((item) => item.id === id), id + ' 应该保留')
  }
})

test('extends 目标不存在：记录错误，本层规则仍然生效', () => {
  const home = tempDir('gate-home-')
  const repo = tempDir('gate-repo-')
  writeJsonFile(join(repo, '.superagent', 'gates.json'), {
    extends: './missing.json',
    name: 'project',
    rules: [rule('own-rule')],
  })
  const loaded = loadGateConfig({ repo, home, env: {} })
  assert.ok(loaded.errors.some((item) => /extends 目标不存在/.test(item.error)))
  assert.ok(loaded.config.rules.some((item) => item.id === 'own-rule'))
})

test('坏 JSON 层被跳过，其他层照常生效', () => {
  const home = tempDir('gate-home-')
  const repo = tempDir('gate-repo-')
  writeTextFile(join(repo, '.superagent', 'gates.json'), '{ broken json')
  writeJsonFile(join(repo, '.superagent', 'gates.local.json'), {
    name: 'local',
    rules: [rule('local-only')],
  })
  const loaded = loadGateConfig({ repo, home, env: {} })
  assert.deepEqual(loaded.sources.map((source) => source.name), ['default', 'local'])
  assert.ok(loaded.errors.some((item) => item.layer === 'project' && /合法 JSON/.test(item.error)))
  assert.equal(loaded.config.rules.length, 11)
  assert.ok(loaded.config.rules.some((item) => item.id === 'local-only'))
})

test('mergeConfig：同 id 覆盖、不同 id 追加、保持首次出现顺序', () => {
  const base = {
    name: 'base',
    rules: [rule('rule-a'), rule('rule-b')],
    semantic: { enabled: false, model: 'base-model', prompt: 'base-prompt' },
  }
  const override = {
    name: 'override',
    rules: [rule('rule-b', { label: 'B2' }), rule('rule-c')],
    semantic: { enabled: true, model: 'override-model' },
  }
  const merged = mergeConfig(base, override)
  assert.deepEqual(merged.rules.map((item) => item.id), ['rule-a', 'rule-b', 'rule-c'])
  assert.equal(merged.rules[1].label, 'B2')
  assert.equal(merged.name, 'override')
  assert.equal(merged.semantic.enabled, true)
  assert.equal(merged.semantic.model, 'override-model')
})

test('mergeConfig：只写 mode 的语义配置保留上层 baseURL / model', () => {
  const base = {
    name: 'base',
    rules: [],
    semantic: { enabled: true, baseURL: 'http://base.example/v1', model: 'base-model', prompt: 'base-prompt' },
  }
  const merged = mergeConfig(base, { rules: [], semantic: { mode: 'block' } })
  assert.equal(merged.semantic.enabled, true)
  assert.equal(merged.semantic.mode, 'block')
  assert.equal(merged.semantic.baseURL, 'http://base.example/v1')
  assert.equal(merged.semantic.model, 'base-model')
})

test('mergeConfig：override 不写 semantic 时保留 base 的语义配置', () => {
  const base = { name: 'base', rules: [], semantic: { enabled: true, model: 'base-model', prompt: 'base-prompt' } }
  const merged = mergeConfig(base, { name: 'next', rules: [rule('rule-a')] })
  assert.equal(merged.semantic.enabled, true)
  assert.equal(merged.semantic.model, 'base-model')
})

test('mergeConfig：semantic:false 只关闭，不丢其他字段', () => {
  const base = { name: 'base', rules: [], semantic: { enabled: true, model: 'base-model', prompt: 'base-prompt' } }
  const merged = mergeConfig(base, { rules: [], semantic: false })
  assert.equal(merged.semantic.enabled, false)
  assert.equal(merged.semantic.model, 'base-model')
})

test('mergeConfig：空配置不改变 base', () => {
  const base = { name: 'base', rules: [rule('rule-a')], semantic: { enabled: true, model: 'm', prompt: 'p' } }
  const merged = mergeConfig(base, {})
  assert.deepEqual(merged.rules.map((item) => item.id), ['rule-a'])
  assert.equal(merged.name, 'base')
  assert.equal(merged.semantic.enabled, true)
})
