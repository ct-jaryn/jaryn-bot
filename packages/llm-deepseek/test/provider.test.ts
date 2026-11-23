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
