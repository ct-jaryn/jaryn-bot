import type { Context } from './context.ts'
import type { Plugin } from './plugin.ts'
import { PluginError } from './plugin.ts'

export interface Row {
  id: string
  name: string
  config?: unknown
  disabled?: boolean
}

export interface PatchOp {
  id?: string
  name?: string
  config?: unknown
  disabled?: boolean
  insert?: Row[]
}

/** Apply one ordered layer of row operations. Config replacement is whole-value. */
export function applyPatch(rows: Row[], ops: PatchOp[]): Row[] {
  const next = rows.map((r) => ({ ...r }))
  for (const op of ops) {
    if (op.insert) {
      for (const row of op.insert) {
        const existing = next.findIndex((r) => r.id === row.id)
        if (existing >= 0) next[existing] = { ...row }
        else next.push({ ...row })
      }
      continue
    }
    if (!op.id) throw new PluginError('patch op needs id or insert', 'loader')
    const idx = next.findIndex((r) => r.id === op.id)
    if (idx < 0) {
      // insert by id with name (allows new rows)
      if (!op.name) throw new PluginError(`patch row not found: ${op.id}`, 'loader')
      next.push({ id: op.id, name: op.name, config: op.config, disabled: op.disabled })
      continue
    }
    const row = next[idx]!
    if (op.name) row.name = op.name
    if ('config' in op) row.config = op.config
    if ('disabled' in op) row.disabled = op.disabled
  }
  return next
}

export interface Bundle {
  name: string
  patch: PatchOp[]
}

export interface Profile {
  name: string
  bundles: Bundle[]
  patches?: PatchOp[]
}

export function composeProfile(profile: Profile): Row[] {
  let rows: Row[] = []
  for (const bundle of profile.bundles) rows = applyPatch(rows, bundle.patch)
  if (profile.patches) rows = applyPatch(rows, profile.patches)
  return rows
}

export interface LoadResult {
  loaded: string[]
  skipped: string[]
}

/**
 * Mount rows in dependency order. A plugin declares services via `provides`;
 * other rows depend on them via `inject` (hard) or `optional` (soft).
 */
export async function loadComposition(
  ctx: Context,
  rows: Row[],
  registry: Map<string, Plugin<any>>,
): Promise<LoadResult> {
  const enabled = rows.filter((r) => !r.disabled)
  const byId = new Map(enabled.map((r) => [r.id, r]))
  const providerOf = new Map<string, string>()
  for (const row of enabled) {
    const plugin = registry.get(row.name)
    if (!plugin) throw new PluginError(`unknown plugin: ${row.name} (row ${row.id})`, 'loader')
    for (const key of plugin.provides ?? []) {
      if (providerOf.has(key)) {
        throw new PluginError(`service ${key} provided twice: ${providerOf.get(key)} and ${row.id}`, 'loader')
      }
      providerOf.set(key, row.id)
    }
  }

  const done = new Set<string>()
  const loading = new Set<string>()
  const loaded: string[] = []

  const load = async (id: string): Promise<void> => {
    if (done.has(id)) return
    if (loading.has(id)) throw new PluginError(`circular dependency at row ${id}`, 'loader')
    const row = byId.get(id)
    if (!row) throw new PluginError(`missing row ${id}`, 'loader')
    const plugin = registry.get(row.name)!
    loading.add(id)
    for (const key of plugin.inject ?? []) {
      const provider = providerOf.get(key)
      if (!provider) {
        throw new PluginError(
          `plugin ${row.name} (row ${id}) needs service "${key}" but no enabled row provides it`,
          row.name,
        )
      }
      await load(provider)
    }
    await ctx.mount(plugin, row.config)
    loading.delete(id)
    done.add(id)
    loaded.push(row.id)
  }

  for (const row of enabled) await load(row.id)
  return { loaded, skipped: rows.filter((r) => r.disabled).map((r) => r.id) }
}

export function formatRows(rows: Row[], indent = ''): string {
  const lines: string[] = []
  for (const row of rows) {
    const state = row.disabled ? ' (disabled)' : ''
    lines.push(`${indent}${row.id}: ${row.name}${state}`)
    if (row.config !== undefined && Object.keys(row.config as object).length > 0) {
      lines.push(`${indent}  ${JSON.stringify(row.config)}`)
    }
  }
  return lines.join('\n')
}
