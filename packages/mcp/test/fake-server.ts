import { createInterface } from 'node:readline'
const rl = createInterface({ input: process.stdin })
rl.on('line', (line) => {
  let msg: any
  try { msg = JSON.parse(line) } catch { return }
  const reply = (result: unknown) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }) + '\n')
  if (msg.method === 'initialize') return reply({ protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'fake', version: '0.1' } })
  if (msg.method === 'tools/list') {
    return reply({ tools: [{ name: 'echo', description: 'echo text', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } }] })
  }
  if (msg.method === 'tools/call') {
    return reply({ content: [{ type: 'text', text: `mcp-echo:${msg.params?.arguments?.text}` }] })
  }
  if (msg.id !== undefined) process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'not found' } }) + '\n')
})
