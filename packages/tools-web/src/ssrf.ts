import { lookup } from 'node:dns/promises'

const PRIVATE = [
  /^10\./, /^127\./, /^169\.254\./, /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  /^::1$/, /^f[cd][0-9a-f]{2}:/i, /^fe80:/i,
]

export function isPrivateAddress(address: string): boolean {
  if (address.includes(':')) {
    const lower = address.toLowerCase()
    if (lower === '::1') return true
    if (lower.startsWith('::ffff:')) return isPrivateAddress(lower.slice(7))
    return PRIVATE.some((re) => re.test(lower))
  }
  return PRIVATE.some((re) => re.test(address))
}

/** Reject non-http(s), credentials in URL, loopback/private/link-local hosts. */
export async function assertSafeUrl(raw: string): Promise<URL> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`invalid url: ${raw}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`blocked protocol: ${url.protocol}`)
  if (url.username || url.password) throw new Error('credentials in URL are not allowed')
  const host = url.hostname
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error(`blocked host: ${host}`)
  }
  const literal = /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':')
  if (literal) {
    if (isPrivateAddress(host)) throw new Error(`blocked private address: ${host}`)
    return url
  }
  const records = await lookup(host, { all: true }).catch(() => [])
  if (records.length === 0) throw new Error(`cannot resolve host: ${host}`)
  for (const record of records) {
    if (isPrivateAddress(record.address)) throw new Error(`blocked private address for ${host}: ${record.address}`)
  }
  return url
}
