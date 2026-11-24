import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const problems: string[] = []

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) walk(path, out)
    else if (path.endsWith('.md')) out.push(path)
  }
  return out
}

const docsFiles = walk(join(ROOT, 'docs'))
const rootDocs = ['README.md', 'CHANGELOG.md', 'CONTRIBUTING.md', 'SECURITY.md', 'NOTICE.md', 'COMMERCIAL.md']
  .map((name) => join(ROOT, name))
  .filter((path) => existsSync(path))
const subReadmes = ['deploy/README.md', 'desktop/README.md', 'mobile/README.md']
  .map((name) => join(ROOT, name))
  .filter((path) => existsSync(path))
const files = [...rootDocs, ...docsFiles, ...subReadmes]

for (const file of files) {
  const rel = file.slice(ROOT.length + 1)
  const text = readFileSync(file, 'utf8')
  const lines = text.split('\n')

  if (text.trim().length === 0) { problems.push(`${rel}: empty file`); continue }

  // every docs page has a status header, and exactly one H1
  if (rel.startsWith('docs/') && rel !== 'docs/README.md') {
    if (!/^# \S/m.test(text)) problems.push(`${rel}: missing H1`)
    if (!lines.slice(0, 6).some((line) => line.startsWith('> 适用版本：'))) problems.push(`${rel}: missing "> 适用版本：" header`)
    let h1 = 0
    let inFence = false
    for (const line of lines) {
      if (line.startsWith('```')) { inFence = !inFence; continue }
      if (!inFence && /^# /.test(line)) h1++
    }
    if (h1 !== 1) problems.push(`${rel}: expected exactly one H1, found ${h1}`)
  }

  // balanced code fences
  const fences = (text.match(/^```/gm) ?? []).length
  if (fences % 2 !== 0) problems.push(`${rel}: unbalanced code fences (${fences})`)

  // table column consistency
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

// layout / structure rules
for (const required of [
  'README.md', 'LICENSE', 'CHANGELOG.md', 'package.json',
  'deploy/Dockerfile', 'deploy/docker-compose.yml',
  'docs/README.md', 'docs/getting-started.md', 'docs/concepts.md',
  'docs/reference/inventory.md', 'docs/reference/tools.md',
  'desktop/package.json', 'desktop/main.cjs', '.github/workflows/release.yml', '.github/workflows/ci.yml', 'scripts/release-notes.ts', 'docs/operations/release.md',
]) {
  if (!existsSync(join(ROOT, required))) problems.push(`missing required file: ${required}`)
}

// no legacy numbered docs or per-version release notes at the top level
for (const name of readdirSync(join(ROOT, 'docs'))) {
  if (/^\d{2}-/.test(name)) problems.push(`legacy numbered doc still present: docs/${name}`)
}
for (const name of readdirSync(ROOT)) {
  if (/^RELEASE-v.*\.md$/.test(name)) problems.push(`per-version release note should live in CHANGELOG/GitHub Releases: ${name}`)
}
if (docsFiles.length < 20) problems.push(`docs/ has too few markdown files (${docsFiles.length})`)

if (problems.length > 0) {
  console.error(`docs check failed (${problems.length}):`)
  for (const p of problems) console.error(' - ' + p)
  process.exit(1)
}
console.log(`docs check ok (${files.length} files, ${docsFiles.length} under docs/)`)
