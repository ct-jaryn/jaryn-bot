import type { Context } from './context.ts'

export interface PluginConfigSchema<C = unknown> {
  parse(input: unknown): C
}

export interface Plugin<C = unknown> {
  name: string
  provides?: string[]
  inject?: string[]
  optional?: string[]
  config?: PluginConfigSchema<C>
  apply(ctx: Context, cfg: C): void | Promise<void>
}

export function definePlugin<C = unknown>(p: Plugin<C>): Plugin<C> {
  return p
}

export class PluginError extends Error {
  readonly plugin: string
  constructor(message: string, plugin: string) {
    super(message)
    this.name = 'PluginError'
    this.plugin = plugin
  }
}
