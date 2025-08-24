export function fourGramOverlapRatio(a: string, b: string): number {
  const gramsA = ngrams(normalize(a), 4)
  if (gramsA.size === 0) return 0
  const gramsB = ngrams(normalize(b), 4)
  let overlap = 0
  for (const g of gramsA) {
    if (gramsB.has(g)) overlap++
  }
  return overlap / gramsA.size
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function ngrams(text: string, n: number): Set<string> {
  const words = text.split(' ').filter(Boolean)
  const set = new Set<string>()
  for (let i = 0; i <= words.length - n; i++) {
    set.add(words.slice(i, i + n).join(' '))
  }
  return set
}

