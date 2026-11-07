import test from 'node:test'
import assert from 'node:assert/strict'
import {
  listModels,
  normalizeSemanticConfig,
  optimizePrompt,
  parseSemanticReply,
  resolveSemanticConfig,
  semanticReview,
} from '../lib/semantic.js'

const config = (semantic = {}) => ({
  version: 1,
  rules: [],
  semantic: {
    enabled: true,
    baseURL: 'http://gateway.test/v1',
    model: 'test-model',
    prompt: '你是审核员。',
    ...semantic,
  },
})

const chatReply = (content) => async () => ({
  ok: true,
  status: 200,
  json: async () => ({ choices: [{ message: { content } }] }),
})

test('normalizeSemanticConfig：undefined 不产生配置，false 表示关闭', () => {
  assert.equal(normalizeSemanticConfig(undefined), undefined)
  assert.equal(normalizeSemanticConfig(null), undefined)
  assert.deepEqual(normalizeSemanticConfig(false), { enabled: false })
  assert.deepEqual(normalizeSemanticConfig(true), { enabled: true })
  assert.equal(normalizeSemanticConfig([]), undefined)
})

test('normalizeSemanticConfig：只保留用户写了的字段', () => {
  assert.deepEqual(normalizeSemanticConfig({}), {})
  assert.deepEqual(normalizeSemanticConfig({ mode: 'block' }), { mode: 'block' })
  assert.deepEqual(normalizeSemanticConfig({ mode: 'nope' }), { mode: 'warn' })
  assert.deepEqual(normalizeSemanticConfig({ timeoutMs: 1, maxInputChars: 1 }), { timeoutMs: 100, maxInputChars: 200 })
  assert.deepEqual(normalizeSemanticConfig(true), { enabled: true })
  assert.deepEqual(normalizeSemanticConfig(false), { enabled: false })
})

test('resolveSemanticConfig：补全默认值', () => {
  const resolved = resolveSemanticConfig({})
  assert.equal(resolved.enabled, false)
  assert.equal(resolved.mode, 'warn')
  assert.equal(resolved.timeoutMs, 15000)
  assert.equal(resolved.maxInputChars, 8000)
  assert.ok(resolved.prompt.length > 0)
  assert.equal(resolveSemanticConfig(undefined), undefined)
})

test('parseSemanticReply：裸 JSON / 围栏 / 前后夹带说明', () => {
  assert.deepEqual(parseSemanticReply('{"pass":true}'), { pass: true })
  assert.deepEqual(parseSemanticReply('```json\n{"pass":false,"issues":[]}\n```'), { pass: false, issues: [] })
  assert.deepEqual(parseSemanticReply('模型说：{"pass":true} 以上。'), { pass: true })
  assert.equal(parseSemanticReply('不是 JSON'), null)
  assert.equal(parseSemanticReply(''), null)
  assert.equal(parseSemanticReply('[1,2]'), null)
})

test('未开启时跳过，不调用模型', async () => {
  let calls = 0
  const result = await semanticReview('正文', config({ enabled: false }), {
    trigger: 'merge',
    fetchImpl: async () => {
      calls += 1
      throw new Error('不该调用')
    },
  })
  assert.deepEqual(result, { skipped: true, ok: true, hits: [] })
  assert.equal(calls, 0)
})

test('issue.reply 即使开启也跳过；只有 merge / release 生效', async () => {
  let calls = 0
  const fetchImpl = async () => {
    calls += 1
    return { ok: true, json: async () => ({ choices: [{ message: { content: '{"pass":true}' } }] }) }
  }
  for (const trigger of ['issue.reply', 'pr.reply', 'pr.handle']) {
    const result = await semanticReview('正文', config(), { trigger, fetchImpl })
    assert.equal(result.skipped, true, trigger + ' 应该跳过')
  }
  assert.equal(calls, 0)
  for (const trigger of ['merge', 'release']) {
    const result = await semanticReview('正文', config(), { trigger, fetchImpl })
    assert.equal(result.skipped, false, trigger + ' 应该执行')
  }
  assert.equal(calls, 2)
})

test('没有配置模型时跳过并给 warning，不发请求', async () => {
  let calls = 0
  const result = await semanticReview('正文', config({ model: '' }), {
    trigger: 'merge',
    fetchImpl: async () => {
      calls += 1
      throw new Error('不该调用')
    },
  })
  assert.equal(result.skipped, true)
  assert.equal(result.ok, true)
  assert.match(result.warning, /未配置模型/)
  assert.equal(calls, 0)
})

test('空回复不调用模型：warn 放行、block 阻断', async () => {
  let calls = 0
  const fetchImpl = async () => {
    calls += 1
    throw new Error('不该调用')
  }
  const warn = await semanticReview('   ', config(), { trigger: 'merge', fetchImpl })
  assert.equal(warn.ok, true)
  assert.equal(warn.hits[0].id, 'semantic-empty')
  assert.equal(warn.hits[0].severity, 'warn')

  const block = await semanticReview('   ', config({ mode: 'block' }), { trigger: 'merge', fetchImpl })
  assert.equal(block.ok, false)
  assert.equal(block.hits[0].severity, 'error')
  assert.equal(calls, 0)
})

test('模型 pass:true 时不产生命中', async () => {
  const result = await semanticReview('正文', config(), {
    trigger: 'merge',
    fetchImpl: chatReply('{"pass":true,"issues":[{"rule":"scope","reason":"不该出现"}]}'),
  })
  assert.equal(result.skipped, false)
  assert.equal(result.ok, true)
  assert.deepEqual(result.hits, [])
  assert.equal(result.model, 'test-model')
})

test('warn 模式：语义问题只告警，不阻断', async () => {
  const result = await semanticReview('正文', config({ mode: 'warn' }), {
    trigger: 'merge',
    fetchImpl: chatReply('{"pass":false,"issues":[{"rule":"scope","reason":"答非所问"}]}'),
  })
  assert.equal(result.ok, true)
  assert.equal(result.hits.length, 1)
  assert.equal(result.hits[0].id, 'semantic-scope')
  assert.equal(result.hits[0].severity, 'warn')
  assert.equal(result.hits[0].message, '答非所问')
})

test('block 模式：语义问题算 error 并阻断', async () => {
  const result = await semanticReview('正文', config({ mode: 'block' }), {
    trigger: 'release',
    fetchImpl: chatReply('{"pass":false,"issues":[{"rule":"evidence","reason":"没有验证证据"}]}'),
  })
  assert.equal(result.ok, false)
  assert.equal(result.hits[0].severity, 'error')
})

test('模型返回不是合法 JSON：放行 + warning', async () => {
  const result = await semanticReview('正文', config(), {
    trigger: 'merge',
    fetchImpl: chatReply('我觉得可以通过'),
  })
  assert.equal(result.ok, true)
  assert.deepEqual(result.hits, [])
  assert.match(result.warning, /不是合法 JSON/)
})

test('模型不可用：放行 + warning，且错误信息已脱敏', async () => {
  const result = await semanticReview('正文', config(), {
    trigger: 'merge',
    fetchImpl: async () => {
      throw new Error('boom ghp_' + 'a'.repeat(30))
    },
  })
  assert.equal(result.ok, true)
  assert.deepEqual(result.hits, [])
  assert.match(result.warning, /语义复审不可用/)
  assert.ok(!result.warning.includes('ghp_'))
  assert.ok(result.warning.includes('***'))
})

test('发往模型的正文先脱敏', async () => {
  let captured = null
  const fetchImpl = async (url, init) => {
    captured = { url, body: JSON.parse(init.body) }
    return { ok: true, json: async () => ({ choices: [{ message: { content: '{"pass":true}' } }] }) }
  }
  await semanticReview('token=ghp_' + 'a'.repeat(30) + ' 结束', config(), { trigger: 'merge', fetchImpl })
  assert.ok(captured)
  assert.ok(captured.url.endsWith('/chat/completions'))
  assert.equal(captured.body.model, 'test-model')
  const body = captured.body.messages[1].content
  assert.ok(!body.includes('ghp_'))
  assert.ok(body.includes('***'))
})

test('超时：放行 + warning', async () => {
  const fetchImpl = (url, init) => new Promise((resolve, reject) => {
    assert.ok(init.signal, '必须传 AbortSignal')
    init.signal.addEventListener('abort', () => reject(new Error('aborted')))
  })
  const result = await semanticReview('正文', config({ timeoutMs: 100 }), { trigger: 'merge', fetchImpl })
  assert.equal(result.ok, true)
  assert.match(result.warning, /语义复审不可用/)
})

test('HTTP 非 2xx：放行 + warning', async () => {
  const result = await semanticReview('正文', config(), {
    trigger: 'merge',
    fetchImpl: async () => ({ ok: false, status: 502, json: async () => ({}) }),
  })
  assert.equal(result.ok, true)
  assert.match(result.warning, /502/)
})

test('optimizePrompt：返回模型文本并 trim', async () => {
  const text = await optimizePrompt('旧提示词', {
    baseURL: 'http://gateway.test/v1',
    model: 'm',
    fetchImpl: chatReply('  优化后的提示词  '),
  })
  assert.equal(text, '优化后的提示词')
})

test('optimizePrompt：空返回 / 缺配置都抛错', async () => {
  await assert.rejects(
    () => optimizePrompt('旧', { baseURL: 'http://x', model: 'm', fetchImpl: chatReply('   ') }),
    /模型返回空内容/,
  )
  await assert.rejects(() => optimizePrompt('旧', { fetchImpl: chatReply('x') }), /缺少 baseURL/)
  await assert.rejects(() => optimizePrompt('旧', { baseURL: 'http://x', fetchImpl: chatReply('x') }), /缺少 model/)
})

test('listModels：映射 id / label 并过滤空 id', async () => {
  const models = await listModels({
    baseURL: 'http://gateway.test/v1/',
    fetchImpl: async (url) => {
      assert.ok(url.endsWith('/models'))
      return {
        ok: true,
        json: async () => ({
          data: [
            { id: 'group/a', display_name: '模型 A' },
            { id: 'group/b' },
            { id: '' },
            { display_name: '没有 id' },
          ],
        }),
      }
    },
  })
  assert.deepEqual(models, [
    { id: 'group/a', label: '模型 A' },
    { id: 'group/b', label: 'group/b' },
  ])
})

test('listModels：缺 baseURL 或非 2xx 抛错', async () => {
  await assert.rejects(() => listModels({}), /缺少 baseURL/)
  await assert.rejects(
    () => listModels({ baseURL: 'http://x', fetchImpl: async () => ({ ok: false, status: 500 }) }),
    /HTTP 500/,
  )
})
