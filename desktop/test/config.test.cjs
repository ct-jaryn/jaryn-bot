'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { DEFAULT_URL, loadConfig, normalizeServerUrl, saveConfig } = require('../config.cjs')

test('normalizes server urls', () => {
  assert.equal(normalizeServerUrl('192.168.1.10:8787'), 'http://192.168.1.10:8787')
  assert.equal(normalizeServerUrl('https://bot.example.com/'), 'https://bot.example.com')
  assert.equal(normalizeServerUrl('http://host:8787/ui/'), 'http://host:8787/ui')
  assert.equal(normalizeServerUrl(''), null)
  assert.equal(normalizeServerUrl('ftp://x'), null)
  assert.equal(normalizeServerUrl('not a url'), null)
})

test('saves and loads config with 0600 file mode', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jaryn-desktop-'))
  assert.deepEqual(loadConfig(dir), { serverUrl: DEFAULT_URL, configured: false })
  const saved = saveConfig(dir, 'example.com:8787', 'tok-1')
  assert.equal(saved.serverUrl, 'http://example.com:8787')
  const loaded = loadConfig(dir)
  assert.equal(loaded.serverUrl, 'http://example.com:8787')
  assert.equal(loaded.configured, true)
  const mode = fs.statSync(path.join(dir, 'config.json')).mode & 0o777
  assert.equal(mode, 0o600)
})

test('rejects invalid url on save', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jaryn-desktop-'))
  assert.throws(() => saveConfig(dir, '::::'), /invalid server URL/)
})
