/**
 * Out-of-process plugin example (run by @jaryn/plugin-host).
 * Speaks newline-delimited JSON on stdio; exposes tools to jaryn without sharing its heap.
 */
import { createInterface } from 'node:readline'

const tools = [
  {
    name: 'echo',
    description: 'echo back the given text',
    risk: 'read',
    schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  },
  {
    name: 'sum',
    description: 'add numbers',
    risk: 'read',
    schema: { type: 'object', properties: { values: { type: 'array', items: { type: 'number' } } }, required: ['values'] },
  },
]

process.stdout.write(JSON.stringify({ type: 'ready', tools }) + '\n')

createInterface({ input: process.stdin }).on('line', (line) => {
  let msg: any
  try { msg = JSON.parse(line) } catch { return }
  if (msg.type !== 'call') return
  try {
    let output: unknown
    if (msg.tool === 'echo') output = { echo: String(msg.args?.text ?? '') }
    else if (msg.tool === 'sum') output = { sum: (msg.args?.values ?? []).reduce((a: number, b: number) => a + b, 0) }
    else throw new Error(`unknown tool: ${msg.tool}`)
    process.stdout.write(JSON.stringify({ type: 'result', id: msg.id, ok: true, output }) + '\n')
  } catch (err) {
    process.stdout.write(JSON.stringify({ type: 'result', id: msg.id, ok: false, error: (err as Error).message }) + '\n')
  }
})
