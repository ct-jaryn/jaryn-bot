#!/usr/bin/env node
/**
 * Print the CHANGELOG section for a version, for use as GitHub Release notes.
 *
 *   node scripts/release-notes.ts 1.12.0
 */
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const version = process.argv[2]?.replace(/^v/, '')
if (!version) {
  console.error('usage: node scripts/release-notes.ts <version>')
  process.exit(2)
}

const changelog = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8')
const lines = changelog.split('\n')
const start = lines.findIndex((line) => line.startsWith(`## v${version}`))
if (start < 0) {
  console.log(`## jaryn-bot v${version}\n\nSee [CHANGELOG.md](https://github.com/ct-jaryn/jaryn-bot/blob/main/CHANGELOG.md).`)
  process.exit(0)
}
let end = lines.length
for (let i = start + 1; i < lines.length; i++) {
  if (lines[i]!.startsWith('## ')) { end = i; break }
}
const title = lines[start]!.replace(/^## /, '')
const body = lines.slice(start + 1, end).join('\n').trim()
const repo = process.env.GITHUB_REPOSITORY ?? 'ct-jaryn/jaryn-bot'
console.log(`## ${title}\n\n${body}\n\n---\n\n完整记录与设计取舍：[CHANGELOG](https://github.com/${repo}/blob/main/CHANGELOG.md) · [文档](https://github.com/${repo}/tree/main/docs)`)
