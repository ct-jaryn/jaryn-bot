import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DeepSeekProvider } from '../src/index.ts'

function sse(chunks: string[]): Response {
  const body = chunks.map((c) => `data: ${c}\n\n`).join('') + 'data: [DONE]\n\n'
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

test('parses text, tool calls and usage', async () => {
  const fetchImpl = async () => sse([
    JSON.stringify({ choices: [{ delta: { content: 'hi' } }] }),
    JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'shell.run', arguments: '{"command":"ls"}' } }] } }] }),
    JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 10, completion_tokens: 5 } }),
  ])
  const p = new DeepSeekProvider({ apiKey: 'k', fetchImpl: fetchImpl as any })
  const deltas: any[] = []
  for await (const d of p.stream({ messages: [{ role: 'user', content: 'x' }], tools: [] }, new AbortController().signal)) deltas.push(d)
  assert.ok(deltas.some((d) => d.type === 'text' && d.text === 'hi'))
  assert.ok(deltas.some((d) => d.type === 'tool_call' && d.call.name === 'shell.run' && d.call.args.command === 'ls'))
  assert.ok(deltas.some((d) => d.type === 'usage' && d.usage.inputTokens === 10))
  assert.ok(deltas.some((d) => d.type === 'finish' && d.reason === 'tool'))
})

test('retries on 5xx then fails', async () => {
  let calls = 0
  const fetchImpl = async () => {
    calls++
    return new Response('boom', { status: 503 })
  }
  const p = new DeepSeekProvider({ apiKey: 'k', fetchImpl: fetchImpl as any, retries: 1 })
  await assert.rejects(async () => {
    for await (const _ of p.stream({ messages: [{ role: 'user', content: 'x' }], tools: [] }, new AbortController().signal)) { /* noop */ }
  }, /HTTP 503/)
  assert.equal(calls, 2)
})

test('supports OPENAI_API_KEY and OPENAI_BASE_URL fallback', async () => {
  const prev = {
    dsKey: process.env.DEEPSEEK_API_KEY,
    oaKey: process.env.OPENAI_API_KEY,
    oaBase: process.env.OPENAI_BASE_URL,
    oaModel: process.env.OPENAI_MODEL,
  }
  delete process.env.DEEPSEEK_API_KEY
  process.env.OPENAI_API_KEY = 'oa-test-key'
  process.env.OPENAI_BASE_URL = 'https://compat.example/v1'
  process.env.OPENAI_MODEL = 'qwen-plus'
  try {
    let calledUrl = ''
    let calledModel = ''
    const fetchImpl = async (url: string, init: any) => {
      calledUrl = String(url)
      calledModel = JSON.parse(init.body).model
      return sse([JSON.stringify({ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] })])
    }
    const p = new DeepSeekProvider({ fetchImpl: fetchImpl as any })
    const deltas: any[] = []
    for await (const d of p.stream({ messages: [{ role: 'user', content: 'ping' }], tools: [] }, new AbortController().signal)) deltas.push(d)
    assert.equal(calledUrl, 'https://compat.example/v1/chat/completions')
    assert.equal(calledModel, 'qwen-plus')
    assert.ok(deltas.some((d) => d.type === 'text' && d.text === 'ok'))
  } finally {
    if (prev.dsKey === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = prev.dsKey
    if (prev.oaKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = prev.oaKey
    if (prev.oaBase === undefined) delete process.env.OPENAI_BASE_URL; else process.env.OPENAI_BASE_URL = prev.oaBase
    if (prev.oaModel === undefined) delete process.env.OPENAI_MODEL; else process.env.OPENAI_MODEL = prev.oaModel
  }
})
