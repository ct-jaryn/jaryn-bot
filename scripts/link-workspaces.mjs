#!/usr/bin/env node
/**
 * Link internal @jaryn/* packages into node_modules so the monorepo runs with plain Node
 * (no bundler, no install step). Safe to re-run: existing links are replaced.
 */
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGES = join(ROOT, 'packages')
const SCOPE = join(ROOT, 'node_modules', '@jaryn')

mkdirSync(SCOPE, { recursive: true })
let linked = 0
for (const name of readdirSync(PACKAGES)) {
  const pkgDir = join(PACKAGES, name)
  if (!existsSync(join(pkgDir, 'package.json'))) continue
  let manifest
  try { manifest = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')) } catch { continue }
  const target = manifest.name
  if (!target?.startsWith('@jaryn/')) continue
  const linkPath = join(ROOT, 'node_modules', ...target.split('/'))
  mkdirSync(dirname(linkPath), { recursive: true })
  try {
    const stat = lstatSync(linkPath)
    if (stat.isSymbolicLink() || stat.isFile() || stat.isDirectory()) rmSync(linkPath, { force: true, recursive: true })
  } catch { /* not present */ }
  const relative = join('..', '..', 'packages', name)
  symlinkSync(relative, linkPath, 'dir')
  linked++
}
console.log(`linked ${linked} workspace packages into node_modules/@jaryn`)
