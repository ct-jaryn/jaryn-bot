import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const problems: string[] = []

const dockerfile = readFileSync(join(ROOT, 'deploy/Dockerfile'), 'utf8')
const compose = readFileSync(join(ROOT, 'deploy/docker-compose.yml'), 'utf8')

if (!/FROM node:24/.test(dockerfile)) problems.push('Dockerfile should use node:24 image')
if (!/node_modules/.test(dockerfile) || !/@jaryn\//.test(dockerfile)) problems.push('Dockerfile must wire @jaryn workspace links')
// The image links workspaces dynamically; make sure that loop is still there and that
// every package on disk would resolve to an @jaryn/* name.
if (!/readdirSync\("packages"\)/.test(dockerfile)) problems.push('Dockerfile must link all packages dynamically (readdirSync("packages"))')
const packageDirs = readdirSync(join(ROOT, 'packages'))
for (const dir of packageDirs) {
  const manifest = join(ROOT, 'packages', dir, 'package.json')
  if (!existsSync(manifest)) continue
  const name = JSON.parse(readFileSync(manifest, 'utf8')).name as string
  if (!name.startsWith('@jaryn/')) problems.push(`package ${dir} must be named @jaryn/* (got ${name})`)
}
if (!/packages\/cli\/src\/index\.ts/.test(dockerfile)) problems.push('Dockerfile must run the CLI entry')
if (!/context:\s*\.\./.test(compose)) problems.push('compose build context should be repo root')
if (!/dockerfile:\s*deploy\/Dockerfile/.test(compose)) problems.push('compose must reference deploy/Dockerfile')
if (!/127\.0\.0\.1:8787:8787/.test(compose)) problems.push('compose should bind 8787 to loopback')

// every workspace package referenced by the CLI registry must exist on disk
const cli = readFileSync(join(ROOT, 'packages/cli/src/index.ts'), 'utf8')
const registry = [...cli.matchAll(/\['(@jaryn\/[^']+)'/g)].map((m) => m[1]!)
const seen = new Set<string>()
for (const name of registry) {
  if (seen.has(name)) continue
  seen.add(name)
  const dir = name.split('/')[1]!
  if (!existsSync(join(ROOT, 'packages', dir, 'package.json'))) problems.push(`registry references missing package: ${name}`)
}

const computerDockerfile = readFileSync(join(ROOT, 'deploy/computer/Dockerfile'), 'utf8')
for (const need of ['chromium', 'Xvfb', 'websockify', '--remote-debugging-port']) {
  if (!computerDockerfile.includes(need)) problems.push(`computer image missing: ${need}`)
}

if (problems.length > 0) {
  console.error('deploy check failed:')
  for (const p of problems) console.error(' - ' + p)
  process.exit(1)
}
console.log(`deploy check ok (${seen.size} registry plugins)`)
