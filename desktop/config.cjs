'use strict'
const fs = require('node:fs')
const path = require('node:path')

const DEFAULT_URL = 'http://127.0.0.1:8787'

/** Normalize a user-entered server URL: add scheme, strip trailing slash, validate. */
function normalizeServerUrl(input) {
  const raw = String(input || '').trim()
  if (!raw) return null
  const scheme = raw.match(/^([a-z][a-z0-9+.-]*):\/\//i)?.[1]?.toLowerCase()
  if (scheme && scheme !== 'http' && scheme !== 'https') return null
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`
  let url
  try {
    url = new URL(withScheme)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  url.hash = ''
  url.search = ''
  const pathname = url.pathname.replace(/\/+$/, '')
  return `${url.protocol}//${url.host}${pathname}`
}

function configPath(userDataDir) {
  return path.join(userDataDir, 'config.json')
}

function loadConfig(userDataDir) {
  try {
    const data = JSON.parse(fs.readFileSync(configPath(userDataDir), 'utf8'))
    const url = normalizeServerUrl(data.serverUrl)
    if (!url) return { serverUrl: DEFAULT_URL, configured: false }
    return { serverUrl: url, configured: Boolean(data.configured) }
  } catch {
    return { serverUrl: DEFAULT_URL, configured: false }
  }
}

function saveConfig(userDataDir, serverUrl, apiToken) {
  const url = normalizeServerUrl(serverUrl)
  if (!url) throw new Error(`invalid server URL: ${serverUrl}`)
  fs.mkdirSync(userDataDir, { recursive: true })
  const payload = { serverUrl: url, configured: true }
  if (apiToken) payload.apiToken = String(apiToken)
  fs.writeFileSync(configPath(userDataDir), JSON.stringify(payload, null, 2), { mode: 0o600 })
  return payload
}

module.exports = { DEFAULT_URL, normalizeServerUrl, configPath, loadConfig, saveConfig }
