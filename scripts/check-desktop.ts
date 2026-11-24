import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const problems: string[] = []
const desktop = join(ROOT, 'desktop')
const manifest = JSON.parse(readFileSync(join(desktop, 'package.json'), 'utf8'))
const workflowPath = join(ROOT, '.github/workflows/release.yml')

// electron-builder config
for (const file of manifest.build.files as string[]) {
  if (!existsSync(join(desktop, file))) problems.push(`desktop build.files missing: ${file}`)
}
if (manifest.main !== 'main.cjs') problems.push('desktop main must be main.cjs')
if (!manifest.build.appId) problems.push('electron-builder appId missing')
for (const platform of ['mac', 'win', 'linux'] as const) {
  if (!manifest.build[platform]) problems.push(`electron-builder target missing: ${platform}`)
}

// packaging workflow: one automatic pipeline for all clients
if (!existsSync(workflowPath)) {
  problems.push('missing .github/workflows/release.yml')
} else {
  const workflow = readFileSync(workflowPath, 'utf8')
  const required = [
    ['tag trigger', "tags: ['v*']"],
    ['manual trigger', 'workflow_dispatch'],
    ['scheduled build', 'schedule:'],
    ['ubuntu runner', 'ubuntu-latest'],
    ['windows runner', 'windows-latest'],
    ['mac runner', 'macos-15'],
    ['electron-builder', 'electron-builder'],
    ['android gradle', 'assembleDebug'],
    ['artifact upload', 'actions/upload-artifact'],
    ['artifact download', 'actions/download-artifact'],
    ['checksums', 'SHA256SUMS'],
    ['github release', 'action-gh-release'],
    ['version from tag', 'GITHUB_REF_NAME#v'],
  ] as const
  for (const [label, needle] of required) {
    if (!workflow.includes(needle)) problems.push(`release workflow missing ${label} (${needle})`)
  }
  if (/\t/.test(workflow)) problems.push('release workflow must not contain tabs')
}

// old per-client workflows must not come back (they would double-publish)
for (const legacy of ['desktop.yml', 'desktop-macos.yml', 'mobile-android.yml']) {
  if (existsSync(join(ROOT, '.github/workflows', legacy))) problems.push(`legacy workflow still present: ${legacy}`)
}
if (!existsSync(join(ROOT, '.github/workflows/ci.yml'))) problems.push('missing .github/workflows/ci.yml')
if (!existsSync(join(ROOT, 'scripts/release-notes.ts'))) problems.push('missing scripts/release-notes.ts')

if (problems.length > 0) {
  console.error('desktop/packaging check failed:')
  for (const problem of problems) console.error(' - ' + problem)
  process.exit(1)
}
console.log(`packaging check ok (desktop: ${(manifest.build.files as string[]).length} files, 3 platforms; workflow: release.yml)`)
