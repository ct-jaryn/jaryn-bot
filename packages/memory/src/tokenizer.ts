const STOP = new Set([
  '的', '了', '是', '我', '你', '他', '她', '它', '在', '有', '和', '就', '不', '也', '都', '而',
  '及', '与', '或', '这', '那', '个', '们', '上', '下', '中', '来', '去', '说', '要', '会', '可以',
  'the', 'a', 'an', 'is', 'are', 'was', 'be', 'to', 'of', 'and', 'or', 'in', 'on', 'for', 'with',
])

/** Bigram tokenizer for CJK plus lowercase ASCII words; no external deps. */
export function tokenize(text: string): string[] {
  const lower = text.toLowerCase()
  const tokens: string[] = []
  const runs = lower.match(/[\u4e00-\u9fff]+|[a-z0-9_.-]+/g) ?? []
  for (const run of runs) {
    if (/^[a-z0-9_.-]+$/.test(run)) {
      if (run.length >= 2 && !STOP.has(run)) tokens.push(run)
      continue
    }
    const chars = [...run]
    if (chars.length === 1) {
      if (!STOP.has(chars[0]!)) tokens.push(chars[0]!)
      continue
    }
    for (let i = 0; i < chars.length - 1; i++) {
      const bigram = chars[i]! + chars[i + 1]!
      if (!STOP.has(bigram)) tokens.push(bigram)
    }
  }
  return [...new Set(tokens)]
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  const union = a.size + b.size - inter
  return union === 0 ? 0 : inter / union
}
