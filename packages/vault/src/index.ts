import { definePlugin } from '@jaryn/kernel'
import type { Plugin } from '@jaryn/kernel'
import type { Tool } from '@jaryn/agent-core'
import { VaultService, type FillClient, type VaultKind } from './store.ts'
import { fillCard } from '@jaryn/secrets'

export { VaultService } from './store.ts'
export { encrypt, decrypt, loadOrCreateMasterKey } from './crypto.ts'
export type { FillClient, VaultItem, VaultKind, VaultMeta } from './store.ts'

export interface VaultConfig {
  keyPath?: string
  /** Card filling stays off unless explicitly enabled. */
  allowCardPayments?: boolean
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

export function vaultToolsPlugin(cfg: VaultConfig = {}): Plugin {
  return definePlugin({
    name: '@jaryn/vault/tools',
    inject: ['vault', 'tools'],
    optional: ['computer'],
    apply(ctx) {
      const vault = ctx.get<VaultService>('vault')!
      const tools = ctx.get<{ register(t: Tool): () => void }>('tools')!
      const allowCard = cfg.allowCardPayments ?? false
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
          name: 'vault.fill_card',
          description: 'Fill a saved card into the checkout page. Disabled by default; every use requires approval.',
          risk: 'destructive',
          schema: { type: 'object', properties: { itemId: { type: 'string' }, botId: { type: 'string' } }, required: ['itemId'] },
          async execute(args) {
            if (!allowCard) throw new Error('card filling is disabled (set vault.allowCardPayments=true)')
            const item = vault.reveal(String(args.itemId))
            if (!item) throw new Error(`vault item not found: ${args.itemId}`)
            if (item.kind !== 'card') throw new Error(`item ${args.itemId} is not a card`)
            const computer = ctx.get<any>('computer')
            if (!computer) throw new Error('computer not mounted; cannot fill card')
            const client = await computer.client(String(args.botId ?? 'default'))
            const result = await fillCard(item.secret as any, client, { enabled: allowCard })
            return { filled: result.fields }
          },
        },
        {
          name: 'vault.rotate',
          description: 'Replace the stored secret for an item (value never returned to the model).',
          risk: 'write',
          schema: { type: 'object', properties: { id: { type: 'string' }, secret: { type: 'object' } }, required: ['id', 'secret'] },
          async execute(args) {
            vault.rotate(String(args.id), (args.secret ?? {}) as Record<string, unknown>)
            return { rotated: true }
          },
        },
        {
          name: 'vault.grant',
          description: 'Grant or revoke a bot access to a credential item.',
          risk: 'write',
          schema: {
            type: 'object',
            properties: { id: { type: 'string' }, botId: { type: 'string' }, revoke: { type: 'boolean' } },
            required: ['id', 'botId'],
          },
          async execute(args) {
            const id = String(args.id)
            const botId = String(args.botId)
            if (args.revoke) { vault.revoke(id, botId); return { granted: false } }
            vault.grant(id, botId)
            return { granted: true }
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
