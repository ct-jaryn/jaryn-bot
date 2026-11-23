import { definePlugin } from '@jaryn/kernel'
import type { Plugin } from '@jaryn/kernel'
import type { Tool } from '@jaryn/agent-core'
import { VaultService, type FillClient, type VaultKind } from './store.ts'

export { VaultService } from './store.ts'
export { encrypt, decrypt, loadOrCreateMasterKey } from './crypto.ts'
export type { FillClient, VaultItem, VaultKind, VaultMeta } from './store.ts'

export interface VaultConfig {
  keyPath?: string
}

export function vaultPlugin(cfg: VaultConfig = {}): Plugin<VaultConfig> {
  return definePlugin({
    name: '@jaryn/vault',
    provides: ['vault'],
    inject: ['store'],
    apply(ctx, config = {}) {
      const store = ctx.get<any>('store')
      ctx.provide('vault', new VaultService(store.db, { keyPath: config.keyPath ?? cfg.keyPath }))
    },
  })
}

export function vaultToolsPlugin(): Plugin {
  return definePlugin({
    name: '@jaryn/vault/tools',
    inject: ['vault', 'tools'],
    optional: ['computer'],
    apply(ctx) {
      const vault = ctx.get<VaultService>('vault')!
      const tools = ctx.get<{ register(t: Tool): () => void }>('tools')!
      const list: Tool[] = [
        {
          name: 'vault.list',
          description: 'List saved credential metadata (never returns secrets).',
          risk: 'read',
          schema: { type: 'object', properties: { scope: { type: 'string' } } },
          async execute(args) { return vault.list(args.scope ? String(args.scope) : undefined) },
        },
        {
          name: 'vault.fill',
          description: 'Fill a saved login into the current browser page (model never sees the secret).',
          risk: 'external',
          schema: {
            type: 'object',
            properties: { itemId: { type: 'string' }, botId: { type: 'string' }, origin: { type: 'string' } },
            required: ['itemId'],
          },
          async execute(args) {
            const computer = ctx.get<any>('computer')
            if (!computer) throw new Error('computer not mounted; cannot fill')
            const botId = String(args.botId ?? 'default')
            const client = await computer.client(botId)
            const pageOrigin = args.origin ? String(args.origin) : await client.evaluate<string>('location.origin')
            return vault.fill(String(args.itemId), { client: client as FillClient, botId, origin: pageOrigin })
          },
        },
        {
          name: 'vault.secure_form',
          description: 'Create a one-time secure form link so the user can enter a credential without exposing it to the model.',
          risk: 'write',
          schema: {
            type: 'object',
            properties: { origin: { type: 'string' }, purpose: { type: 'string' }, kind: { type: 'string' } },
            required: ['origin', 'purpose'],
          },
          async execute(args) {
            const token = vault.createSecureForm({
              origin: String(args.origin), purpose: String(args.purpose), kind: (args.kind as VaultKind) ?? 'login',
            })
            return { token, url: `/secure/${token}` }
          },
        },
        {
          name: 'vault.remove',
          description: 'Delete a saved credential.',
          risk: 'write',
          schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
          async execute(args) { return { removed: vault.remove(String(args.id)) } },
        },
      ]
      for (const tool of list) ctx.effect(() => tools.register(tool))
    },
  })
}
