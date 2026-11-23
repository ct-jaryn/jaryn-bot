import { EventBus } from './events.ts'
import type { Disposer, Listener } from './events.ts'
import type { Plugin } from './plugin.ts'
import { PluginError } from './plugin.ts'

export type Scope = 'root' | 'bot' | 'session' | 'agent'

export interface ContextOptions {
  id?: string
  scope: Scope
  parent?: Context
}

export class Context {
  readonly id: string
  readonly scope: Scope
  readonly parent?: Context
  readonly events: EventBus
  private services = new Map<string, unknown>()
  private disposers: Disposer[] = []
  private children: Context[] = []
  private disposed = false

  constructor(opts: ContextOptions) {
    this.id = opts.id ?? opts.scope
    this.scope = opts.scope
    this.parent = opts.parent
    this.events = opts.parent ? opts.parent.events : new EventBus()
    opts.parent?.children.push(this)
  }

  child(scope: Scope, id?: string): Context {
    return new Context({ scope, id: id ?? `${this.id}/${scope}`, parent: this })
  }

  get<T>(key: string): T | undefined {
    if (this.services.has(key)) return this.services.get(key) as T
    return this.parent?.get<T>(key)
  }

  has(key: string): boolean {
    return this.get(key) !== undefined
  }

  provide<T>(key: string, value: T): Disposer {
    this.assertAlive()
    if (this.services.has(key)) throw new PluginError(`service already provided: ${key}`, key)
    this.services.set(key, value)
    const dispose = () => {
      if (this.services.get(key) === value) this.services.delete(key)
    }
    this.disposers.push(dispose)
    return dispose
  }

  effect(setup: () => void | Disposer): Disposer {
    this.assertAlive()
    const result = setup()
    const disposeFn: Disposer = typeof result === 'function' ? result : () => {}
    let done = false
    const disposer: Disposer = () => {
      if (done) return
      done = true
      disposeFn()
      const i = this.disposers.indexOf(disposer)
      if (i >= 0) this.disposers.splice(i, 1)
    }
    this.disposers.push(disposer)
    return disposer
  }

  on(event: string, fn: Listener): Disposer {
    return this.effect(() => this.events.on(event, fn))
  }

  emit(event: string, payload?: unknown): void {
    this.events.emit(event, payload)
  }

  async mount(plugin: Plugin<any>, cfg?: unknown): Promise<void> {
    this.assertAlive()
    for (const key of plugin.inject ?? []) {
      if (!this.has(key)) {
        throw new PluginError(`missing dependency "${key}" for plugin ${plugin.name}`, plugin.name)
      }
    }
    const config = plugin.config ? plugin.config.parse(cfg ?? {}) : cfg
    try {
      await plugin.apply(this, config)
      this.emit('plugin/loaded', { name: plugin.name, id: config })
    } catch (err) {
      throw new PluginError(
        `plugin ${plugin.name} failed: ${(err as Error).message}`,
        plugin.name,
      )
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    for (const child of this.children.reverse()) await child.dispose()
    for (const dispose of [...this.disposers].reverse()) {
      try {
        dispose()
      } catch {
        /* disposal is best effort */
      }
    }
    this.disposers = []
    this.services.clear()
  }

  get isDisposed(): boolean {
    return this.disposed
  }

  private assertAlive(): void {
    if (this.disposed) throw new Error(`context disposed: ${this.id}`)
  }
}
