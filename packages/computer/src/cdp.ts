/** Minimal Chrome DevTools Protocol client over Node's global WebSocket. */
export class CdpClient {
  private ws?: WebSocket
  private nextId = 1
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()

  readonly baseUrl: string
  constructor(baseUrl: string) {
    this.baseUrl = baseUrl
  }

  async connect(): Promise<void> {
    const targets = await (await fetch(`${this.baseUrl}/json/list`)).json() as any[]
    const page = targets.find((t) => t.type === 'page') ?? targets[0]
    if (!page?.webSocketDebuggerUrl) throw new Error('no page target found')
    this.ws = new WebSocket(page.webSocketDebuggerUrl)
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP connect timeout')), 5000)
      this.ws!.addEventListener('open', () => { clearTimeout(timer); resolve() }, { once: true })
      this.ws!.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP socket error')) }, { once: true })
    })
    this.ws.addEventListener('message', (event) => this.onMessage(String(event.data)))
    await this.send('Page.enable')
    await this.send('Runtime.enable')
  }

  send<T = any>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (!this.ws) return Promise.reject(new Error('CDP not connected'))
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws!.send(JSON.stringify({ id, method, params }))
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`CDP timeout: ${method}`))
      }, 15_000).unref?.()
    })
  }

  async navigate(url: string, timeoutMs = 10_000): Promise<void> {
    await this.send('Page.navigate', { url })
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      const ready = await this.evaluate<string>('document.readyState').catch(() => '')
      if (ready === 'complete' || ready === 'interactive') return
      await new Promise((r) => setTimeout(r, 100))
    }
    throw new Error(`navigation timeout: ${url}`)
  }

  async evaluate<T = unknown>(expression: string): Promise<T> {
    const result = await this.send<any>('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? 'evaluate failed')
    return result.result?.value as T
  }

  async text(): Promise<string> {
    return (await this.evaluate<string>('document.body ? document.body.innerText : ""')) ?? ''
  }

  async click(selector: string): Promise<void> {
    const ok = await this.evaluate<boolean>(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true })()`)
    if (!ok) throw new Error(`selector not found: ${selector}`)
  }

  async type(selector: string, text: string): Promise<void> {
    const ok = await this.evaluate<boolean>(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.focus();
      el.value = ${JSON.stringify(text)};
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`)
    if (!ok) throw new Error(`selector not found: ${selector}`)
  }

  async screenshot(): Promise<string> {
    const result = await this.send<any>('Page.captureScreenshot', { format: 'png' })
    return result.data as string
  }

  private onMessage(data: string): void {
    let msg: any
    try { msg = JSON.parse(data) } catch { return }
    if (msg.id === undefined) return
    const entry = this.pending.get(msg.id)
    if (!entry) return
    this.pending.delete(msg.id)
    if (msg.error) entry.reject(new Error(msg.error.message ?? 'CDP error'))
    else entry.resolve(msg.result)
  }

  close(): void {
    this.ws?.close()
    this.ws = undefined
  }
}
