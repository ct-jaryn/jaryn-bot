import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@jaryn/kernel'
import { dockerAvailable, dockerSandboxPlugin } from '../src/index.ts'

test('docker plugin only provides sandbox when docker is available', async () => {
  const ctx = new Context({ scope: 'root' })
  await ctx.mount(dockerSandboxPlugin())
  assert.equal(ctx.has('sandbox'), dockerAvailable())
  await ctx.dispose()
})
