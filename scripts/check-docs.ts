import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const files: string[] = [join(ROOT, 'README.md')]
for (const name of readdirSync(join(ROOT, 'docs'))) {
  if (name.endsWith('.md')) files.push(join(ROOT, 'docs', name))
}
for (const name of ['CHANGELOG.md', 'CONTRIBUTING.md', 'SECURITY.md', 'NOTICE.md', 'COMMERCIAL.md']) {
  const p = join(ROOT, name)
  if (existsSync(p)) files.push(p)
}

const problems: string[] = []

for (const file of files) {
  const rel = file.slice(ROOT.length + 1)
  const text = readFileSync(file, 'utf8')

  // balanced code fences
  const fences = (text.match(/^```/gm) ?? []).length
  if (fences % 2 !== 0) problems.push(`${rel}: unbalanced code fences (${fences})`)

  // table column consistency
  const lines = text.split('\n')
  let block: number[] = []
  let start = 0
  const flush = () => {
    if (block.length > 0) {
      const counts = new Set(block)
      if (counts.size > 1) problems.push(`${rel}:${start}: table column mismatch ${JSON.stringify([...counts])}`)
    }
    block = []
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (/^\|/.test(line)) {
      if (block.length === 0) start = i + 1
      block.push((line.match(/\|/g) ?? []).length)
    } else flush()
  }
  flush()

  // relative links resolve
  for (const match of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const url = match[1]!
    if (/^(https?:|#|mailto:)/.test(url)) continue
    const target = resolve(dirname(file), url.split('#')[0]!)
    if (!existsSync(target)) problems.push(`${rel}: broken link ${url}`)
  }
}

// top-level layout checks
for (const required of ['README.md', 'LICENSE', 'CHANGELOG.md', 'package.json', 'deploy/Dockerfile', 'deploy/docker-compose.yml', 'docs/README.md', 'desktop/package.json', 'desktop/main.cjs', '.github/workflows/desktop.yml']) {
  if (!existsSync(join(ROOT, required))) problems.push(`missing required file: ${required}`)
}
if (statSync(join(ROOT, 'docs')).isDirectory() && readdirSync(join(ROOT, 'docs')).filter((f) => f.endsWith('.md')).length < 15) {
  problems.push('docs/ has fewer markdown files than expected')
}

if (problems.length > 0) {
  console.error(`docs check failed (${problems.length}):`)
  for (const p of problems) console.error(' - ' + p)
  process.exit(1)
}
console.log(`docs check ok (${files.length} files)`)
