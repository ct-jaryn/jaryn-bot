import { readFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Context, applyPatch, composeProfile, loadComposition } from '@jaryn/kernel'
import { agentPlugin, toolRegistryPlugin } from '@jaryn/agent-core'
import { storePlugin } from '@jaryn/store-sqlite'
import { shellPlugin } from '@jaryn/tools-shell'
import { fsPlugin } from '@jaryn/tools-fs'
import { deepseekPlugin } from '@jaryn/llm-deepseek'

interface Task {
  id: string
  prompt: string
  expect: string[]
}

const ROOT = resolve(import.meta.dirname, '..')
const tasks = JSON.parse(readFileSync(join(import.meta.dirname, 'tasks.json'), 'utf8')) as Task[]

if (!process.env.DEEPSEEK_API_KEY) {
  console.log('DEEPSEEK_API_KEY not set — eval skipped (10 tasks defined)')
  process.exit(0)
}

const home = mkdtempSync(join(tmpdir(), 'jary-eval-'))
const base = JSON.parse(readFileSync(join(ROOT, 'packages/bundles/base/patch.json'), 'utf8'))
const rows = applyPatch(composeProfile({ name: 'eval', bundles: [{ name: 'base', patch: base }] }), [
  { id: 'llm', name: '@jaryn/llm-deepseek', config: {} },
])
const ctx = new Context({ scope: 'root' })
await loadComposition(
  ctx,
  rows,
  new Map([
    ['@jaryn/store-sqlite', storePlugin()],
    ['@jaryn/llm-deepseek', deepseekPlugin()],
    ['@jaryn/agent-core/tools', toolRegistryPlugin()],
    ['@jaryn/tools-shell', shellPlugin()],
    ['@jaryn/tools-fs', fsPlugin()],
    ['@jaryn/agent-core', agentPlugin()],
  ]),
)
// Sessions run from the repo root so file tasks are meaningful.
const store = ctx.get<any>('store')
store.createSession('eval', 'eval', ROOT)
const agent = ctx.get<any>('agent')
let passed = 0
for (const task of tasks) {
  const result = await agent.runTurn({ sessionId: 'eval', text: task.prompt })
  const ok = task.expect.every((e) => result.text.includes(e))
  if (ok) passed++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${task.id}${ok ? '' : ` — ${result.text.slice(0, 160)}`}`)
}
await ctx.dispose()
console.log(`\n${passed}/${tasks.length} passed (home: ${home})`)
process.exit(passed >= 7 ? 0 : 1)
