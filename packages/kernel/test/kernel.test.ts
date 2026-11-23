import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context, PluginError, applyPatch, composeProfile, definePlugin, loadComposition } from '../src/index.ts'

test('provide and effect disposal', async () => {
  const ctx = new Context({ scope: 'root' })
  const order: string[] = []
  ctx.effect(() => () => order.push('first'))
  await ctx.mount(definePlugin({
    name: 'svc',
    provides: ['svc'],
    apply(c) {
      c.provide('svc', { ok: true })
      c.effect(() => () => order.push('svc'))
    },
  }))
  assert.deepEqual(ctx.get('svc'), { ok: true })
  await ctx.dispose()
  assert.deepEqual(order, ['svc', 'first'])
})

test('waterfall and serial events', async () => {
  const ctx = new Context({ scope: 'root' })
  const seen: string[] = []
  ctx.on('chain', (v: number, next: (n: number) => Promise<number>) => next(v + 1))
  ctx.on('chain', (v: number) => v * 10)
  const out = await ctx.events.waterfall<number>('chain', 1, (v) => v)
  assert.equal(out, 20)
  ctx.on('serial', (v: string) => seen.push(v))
  await ctx.events.serial('serial', 'x')
  assert.deepEqual(seen, ['x'])
})

test('patch apply, disable and compose', () => {
  let rows = composeProfile({
    name: 'p',
    bundles: [{ name: 'b', patch: [{ insert: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B', config: { x: 1 } }] }] }],
  })
  rows = applyPatch(rows, [{ id: 'b', disabled: true }, { id: 'a', config: { y: 2 } }])
  assert.deepEqual(rows.find((r) => r.id === 'a')?.config, { y: 2 })
  assert.equal(rows.find((r) => r.id === 'b')?.disabled, true)
})

test('loader orders by provides/inject and fails loud', async () => {
  const ctx = new Context({ scope: 'root' })
  const order: string[] = []
  const plugin = (name: string, provides: string[], inject?: string[]) => definePlugin({
    name,
    provides,
    inject,
    apply(c: any) { order.push(name); for (const key of provides) c.provide(key, { name }) },
  })
  const registry = new Map([
    ['A', plugin('A', ['a'])],
    ['B', plugin('B', ['b'], ['a'])],
  ])
  const rows = [{ id: 'b', name: 'B' }, { id: 'a', name: 'A' }]
  const result = await loadComposition(ctx, rows, registry)
  assert.deepEqual(order, ['A', 'B'])
  assert.deepEqual(result.loaded, ['a', 'b'])

  const bad = new Map([['B', plugin('B', ['b'], ['missing'])]])
  await assert.rejects(() => loadComposition(new Context({ scope: 'root' }), [{ id: 'b', name: 'B' }], bad), PluginError)
})
