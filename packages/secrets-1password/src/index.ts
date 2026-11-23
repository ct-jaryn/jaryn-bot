import { spawnSync } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { definePlugin } from '@jaryn/kernel'
import type { Plugin } from '@jaryn/kernel'

export interface OnePasswordConfig {
  /** Reference like "op://Private/GitHub/password" or an item id. */
  references?: Record<string, string>
  binary?: string
  timeoutMs?: number
}

/** Read a secret through the 1Password CLI (`op read`), never returning it to the model. */
export class OnePasswordService {
  private cfg: OnePasswordConfig
  constructor(cfg: OnePasswordConfig = {}) {
    this.cfg = cfg
  }

  read(name: string): string {
    const reference = this.cfg.references?.[name] ?? (name.startsWith('op://') ? name : undefined)
    if (!reference) throw new Error(`unknown 1Password reference: ${name}`)
    const result = spawnSync(this.cfg.binary ?? 'op', ['read', reference], {
      encoding: 'utf8', timeout: this.cfg.timeoutMs ?? 15_000, env: { ...process.env },
    })
    if (result.status !== 0) throw new Error(`1Password read failed: ${(result.stderr ?? '').slice(0, 200)}`)
    return (result.stdout ?? '').trim()
  }

  /** Fill a login into the page without exposing the value. */
  async fill(name: string, client: { evaluate<T = unknown>(expression: string): Promise<T> }): Promise<{ ok: boolean }> {
    const [usernameRef, passwordRef] = name.split('|')
    const username = usernameRef ? this.read(usernameRef) : ''
    const password = passwordRef ? this.read(passwordRef) : this.read(name)
    if (password) {
      await client.evaluate(`(() => {
        const el = document.querySelector('input[type="password"]');
        if (!el) return false;
        el.focus(); el.value = ${JSON.stringify(password)};
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()`)
    }
    if (username) {
      await client.evaluate(`(() => {
        const el = document.querySelector('input[type="email"],input[name*="user" i],input[type="text"]');
        if (!el) return false;
        el.focus(); el.value = ${JSON.stringify(username)};
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      })()`)
    }
    return { ok: Boolean(username || password) }
  }
}

/** RFC 6238 TOTP (SHA-1, 6 digits, 30s) for optional verification codes. */
export function totp(secret: string, at = Date.now(), digits = 6, period = 30): string {
  const normalized = secret.replace(/\s+/g, '').replace(/=+$/, '').toUpperCase()
  const key = base32Decode(normalized)
  const counter = Math.floor(at / 1000 / period)
  const buf = Buffer.alloc(8)
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0)
  buf.writeUInt32BE(counter >>> 0, 4)
  const digest = createHmac('sha1', key).update(buf).digest()
  const offset = digest[digest.length - 1]! & 0x0f
  const code = ((digest.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits).toString().padStart(digits, '0')
  return code
}

function base32Decode(input: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const char of input) {
    const idx = alphabet.indexOf(char)
    if (idx < 0) continue
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

export function onePasswordPlugin(cfg: OnePasswordConfig = {}): Plugin<OnePasswordConfig> {
  return definePlugin({
    name: '@jaryn/secrets-1password',
    provides: ['onePassword'],
    apply(ctx, config = {}) {
      ctx.provide('onePassword', new OnePasswordService({ ...cfg, ...config }))
    },
  })
}
