import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export function loadOrCreateMasterKey(path: string): Buffer {
  if (process.env.JARY_VAULT_KEY) {
    return createHash('sha256').update(process.env.JARY_VAULT_KEY).digest()
  }
  if (existsSync(path)) {
    const raw = readFileSync(path, 'utf8').trim()
    return createHash('sha256').update(raw).digest()
  }
  mkdirSync(dirname(path), { recursive: true })
  const raw = randomBytes(32).toString('base64')
  writeFileSync(path, raw, { mode: 0o600 })
  try { chmodSync(path, 0o600) } catch { /* best effort */ }
  return createHash('sha256').update(raw).digest()
}

export function encrypt(secret: unknown, key: Buffer): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const data = Buffer.from(JSON.stringify(secret), 'utf8')
  const enc = Buffer.concat([cipher.update(data), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, enc]).toString('base64')
}

export function decrypt(blob: string, key: Buffer): unknown {
  const buf = Buffer.from(blob, 'base64')
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(12, 28)
  const data = buf.subarray(28)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8'))
}
