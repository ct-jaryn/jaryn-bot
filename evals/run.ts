import { readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Context, applyPatch, composeProfile, loadComposition } from '@jaryn/kernel'
import { agentPlugin, approvalPlugin, pricingPlugin, questionsPlugin, toolRegistryPlugin } from '@jaryn/agent-core'
import { storePlugin } from '@jaryn/store-sqlite'
import { shellPlugin } from '@jaryn/tools-shell'
import { fsPlugin } from '@jaryn/tools-fs'
import { memoryPlugin, memoryToolsPlugin } from '@jaryn/memory'
import { tasksPlugin, taskToolsPlugin } from '@jaryn/tasks'
import { artifactsPlugin, artifactToolsPlugin } from '@jaryn/artifacts'
import { officePlugin } from '@jaryn/office'
import { deepseekPlugin } from '@jaryn/llm-deepseek'

interface Task {
  id: string
  category?: string
  prompt: string
  expect: string[]
}

const ROOT = resolve(import.meta.dirname, '..')
const raw = readFileSync(join(import.meta.dirname, 'tasks.json'), 'utf8')
const tasks = JSON.parse(raw) as Task[]
const dry = process.argv.includes('--dry')

// Structural validation always runs (works without an API key).
const problems: string[] = []
if (!Array.isArray(tasks) || tasks.length < 10) problems.push('tasks.json must contain at least 10 tasks')
const ids = new Set<string>()
for (const [i, task] of tasks.entries()) {
  if (!task.id || typeof task.id !== 'string') problems.push(`task ${i}: missing id`)
  else if (ids.has(task.id)) problems.push(`task ${i}: duplicate id ${task.id}`)
  else ids.add(task.id)
  if (!task.prompt || task.prompt.length < 10) problems.push(`task ${task.id}: prompt too short`)
  if (!Array.isArray(task.expect) || task.expect.length === 0) problems.push(`task ${task.id}: expect must be non-empty`)
}
if (problems.length > 0) {
  console.error('eval tasks invalid:\n' + problems.map((p) => ' - ' + p).join('\n'))
  process.exit(1)
}

if (dry) {
  console.log(`eval tasks ok (${tasks.length} tasks) — dry run, no model calls`)
  process.exit(0)
}

if (!process.env.DEEPSEEK_API_KEY && !process.env.OPENAI_API_KEY) {
  console.log(`DEEPSEEK_API_KEY / OPENAI_API_KEY not set — structural check ok (${tasks.length} tasks), model run skipped`)
  process.exit(0)
}

const home = mkdtempSync(join(tmpdir(), 'jary-eval-'))
const workdir = mkdtempSync(join(tmpdir(), 'jary-eval-work-'))
process.env.JARY_HOME = home
const base = JSON.parse(readFileSync(join(ROOT, 'packages/bundles/base/patch.json'), 'utf8'))
const rows = applyPatch(composeProfile({ name: 'eval', bundles: [{ name: 'base', patch: base }] }), [
  { id: 'store', name: '@jaryn/store-sqlite', config: { path: join(home, 'eval.db') } },
  { id: 'llm', name: '@jaryn/llm-deepseek', config: {} },
  // Pre-approve shell execution for unattended benchmark runs while keeping destructive actions blocked.
  { id: 'approvals', name: '@jaryn/agent-core/approvals', config: { rules: [{ effect: 'allow', risk: ['execute'] }] } },
])
const ctx = new Context({ scope: 'root' })
const needed = new Set([
  '@jaryn/store-sqlite',
  '@jaryn/llm-deepseek',
  '@jaryn/agent-core/tools',
  '@jaryn/agent-core/approvals',
  '@jaryn/agent-core/pricing',
  '@jaryn/agent-core/questions',
  '@jaryn/tools-shell',
  '@jaryn/tools-fs',
  '@jaryn/memory',
  '@jaryn/memory/tools',
  '@jaryn/tasks',
  '@jaryn/tasks/tools',
  '@jaryn/artifacts',
  '@jaryn/artifacts/tools',
  '@jaryn/office',
  '@jaryn/agent-core',
])
const filteredRows = rows.map((row) => (needed.has(row.name) ? row : { ...row, disabled: true }))
await loadComposition(
  ctx,
  filteredRows,
  new Map([
    ['@jaryn/store-sqlite', storePlugin()],
    ['@jaryn/llm-deepseek', deepseekPlugin()],
    ['@jaryn/agent-core/tools', toolRegistryPlugin()],
    ['@jaryn/agent-core/approvals', approvalPlugin()],
    ['@jaryn/agent-core/pricing', pricingPlugin()],
    ['@jaryn/agent-core/questions', questionsPlugin()],
    ['@jaryn/tools-shell', shellPlugin()],
    ['@jaryn/tools-fs', fsPlugin()],
    ['@jaryn/memory', memoryPlugin()],
    ['@jaryn/memory/tools', memoryToolsPlugin()],
    ['@jaryn/tasks', tasksPlugin()],
    ['@jaryn/tasks/tools', taskToolsPlugin()],
    ['@jaryn/artifacts', artifactsPlugin()],
    ['@jaryn/artifacts/tools', artifactToolsPlugin()],
    ['@jaryn/office', officePlugin()],
    ['@jaryn/agent-core', agentPlugin()],
  ]),
)
const store = ctx.get<any>('store')
store.createSession('eval', 'eval', ROOT)
const agent = ctx.get<any>('agent')
let passed = 0
const results: { id: string; category?: string; ok: boolean; steps: number; ms: number; text: string }[] = []
for (const task of tasks) {
  const t0 = Date.now()
  const prompt = task.prompt.replaceAll('$EVAL_WORKDIR', workdir)
  const result = await agent.runTurn({ sessionId: 'eval', text: prompt })
  const ms = Date.now() - t0
  const ok = task.expect.every((e) => result.text.toLowerCase().includes(e.toLowerCase()))
  if (ok) passed++
  results.push({ id: task.id, category: task.category, ok, steps: result.steps ?? 0, ms, text: result.text.slice(0, 200) })
  console.log(`${ok ? 'PASS' : 'FAIL'} [${task.category ?? 'general'}] ${task.id} (${result.steps ?? 0} steps, ${ms}ms)${ok ? '' : ` — ${result.text.slice(0, 160)}`}`)
}
await ctx.dispose()
const ratio = passed / tasks.length
console.log(`\n${passed}/${tasks.length} passed (${Math.round(ratio * 100)}%, home: ${home})`)
if (process.argv.includes('--json')) console.log(JSON.stringify({ passed, total: tasks.length, results }, null, 2))
process.exit(ratio >= 0.7 ? 0 : 1)
