export type Disposer = () => void
export type Listener = (payload: any) => any

export class EventBus {
  private map = new Map<string, Listener[]>()

  on(event: string, fn: Listener): Disposer {
    const list = this.map.get(event) ?? []
    list.push(fn)
    this.map.set(event, list)
    return () => {
      const cur = this.map.get(event)
      if (!cur) return
      const i = cur.indexOf(fn)
      if (i >= 0) cur.splice(i, 1)
    }
  }

  listeners(event: string): Listener[] {
    return [...(this.map.get(event) ?? [])]
  }

  emit(event: string, payload?: any): void {
    for (const fn of this.listeners(event)) fn(payload)
  }

  async parallel(event: string, payload?: any): Promise<void> {
    await Promise.all(this.listeners(event).map((fn) => fn(payload)))
  }

  async serial(event: string, payload?: any): Promise<void> {
    for (const fn of this.listeners(event)) await fn(payload)
  }

  async waterfall<In, Out = In>(
    event: string,
    input: In,
    final?: (v: In) => Out | Promise<Out>,
  ): Promise<Out> {
    const list = this.listeners(event)
    let i = 0
    const next = async (value: In): Promise<Out> => {
      if (i < list.length) {
        const fn = list[i++]!
        const result = await fn(value, next)
        return (result === undefined ? await next(value) : result) as Out
      }
      return final ? await final(value) : (value as unknown as Out)
    }
    return next(input)
  }
}
