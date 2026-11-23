import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const problems: string[] = []
const desktop = join(ROOT, 'desktop')
const manifest = JSON.parse(readFileSync(join(desktop, 'package.json'), 'utf8'))

for (const file of manifest.build.files as string[]) {
  if (!existsSync(join(desktop, file))) problems.push(`desktop build.files missing: ${file}`)
}
if (manifest.main !== 'main.cjs') problems.push('desktop main must be main.cjs')
if (!manifest.build.appId) problems.push('electron-builder appId missing')
for (const platform of ['mac', 'win', 'linux'] as const) {
  if (!manifest.build[platform]) problems.push(`electron-builder target missing: ${platform}`)
}
if (!existsSync(join(ROOT, '.github/workflows/desktop.yml'))) problems.push('desktop workflow missing')
if (!existsSync(join(ROOT, '.github/workflows/ci.yml'))) problems.push('ci workflow missing')

const workflow = readFileSync(join(ROOT, '.github/workflows/desktop.yml'), 'utf8')
for (const need of ['ubuntu-latest', 'windows-latest', 'electron-builder', 'upload-artifact']) {
  if (!workflow.includes(need)) problems.push(`desktop workflow missing: ${need}`)
}
if (!existsSync(join(ROOT, '.github/workflows/desktop-macos.yml'))) problems.push('desktop-macos workflow missing')

if (problems.length > 0) {
  console.error('desktop check failed:')
  for (const problem of problems) console.error(' - ' + problem)
  process.exit(1)
}
console.log(`desktop check ok (${(manifest.build.files as string[]).length} files, 4 targets)`)
