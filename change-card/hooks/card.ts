import type { Card, Change, Facts, Kind, Spot } from '../types'

// The card stays short because the tool refuses anything longer: these are the caps.
export const LIMIT = {
  title: 70,
  gist: 160,
  changes: 5,
  changeTitle: 60,
  side: 60,
  look: 3,
  why: 80,
  unchecked: 3,
  uncheckedItem: 70,
} as const

export const KINDS: Kind[] = ['new', 'fix', 'change', 'removal', 'chore']
export const KIND_LABEL: Record<Kind, string> = { new: 'NEW', fix: 'FIX', change: 'CHANGED', removal: 'REMOVED', chore: 'CHORE' }
export const KIND_GLYPH: Record<Kind, string> = { new: '+', fix: '!', change: '~', removal: '-', chore: '·' }

// A nudge is worth it past about this much change.
export const BIG_FILES = 5
export const BIG_LINES = 200

const MAX_LISTED = 200

// The fork point from the default branch, else the branch itself (uncommitted work only).
export const FORK_REFS = ['origin/HEAD', 'origin/main', 'origin/master', 'main', 'master']

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
export const oneLine = (t: unknown) => (typeof t === 'string' ? t.replace(/\s+/g, ' ').trim() : '')

// ---- the diff

/** Facts from `git diff --numstat` and the untracked file list. */
export function factsOf(base: string, how: string, numstat: string, untracked: string): Facts {
  const files: Record<string, string> = {}
  let added = 0
  let deleted = 0
  for (const line of numstat.split('\n')) {
    const [a, d, ...rest] = line.split('\t')
    const path = rest.join('\t')
    if (!path) continue
    if (a === '-') {
      files[path] = 'binary'
      continue
    }
    added += Number(a) || 0
    deleted += Number(d) || 0
    files[path] = `+${a} -${d}`
  }
  for (const path of untracked.split('\n').map(p => p.trim())) {
    if (path && !files[path]) files[path] = 'new'
  }
  return { base: base.slice(0, 7), how, files, added, deleted }
}

export const fileCount = (f: Facts) => Object.keys(f.files).length
export const isBig = (f: Facts) => fileCount(f) > BIG_FILES || f.added + f.deleted > BIG_LINES
export const signature = (f: Facts) => JSON.stringify(f.files)

export const covers = (entry: string, path: string) => entry === path || (entry.endsWith('/') && path.startsWith(entry))

/** Files whose diff moved since the card was written. */
export function movedSince(card: Card, facts: Facts): string[] {
  const paths = new Set([...Object.keys(card.facts), ...Object.keys(facts.files)])
  return [...paths].filter(p => card.facts[p] !== facts.files[p]).sort()
}

export const changedFiles = (c: Change, facts: Record<string, string>) => Object.keys(facts).filter(p => c.files.some(e => covers(e, p)))

/** The file list Claude writes the card from. */
export function factsText(f: Facts): string {
  const paths = Object.keys(f.files).sort()
  const listed = paths.slice(0, MAX_LISTED).map(p => `  ${f.files[p]}\t${p}`)
  if (paths.length > MAX_LISTED) listed.push(`  … and ${paths.length - MAX_LISTED} more (git diff --stat ${f.base})`)
  return `${plural(paths.length, 'file')} changed since ${f.base} (${f.how}), +${f.added} -${f.deleted}:\n${listed.join('\n')}`
}

// ---- the card, from the change_card tool

type ChangeInput = { kind?: unknown; title?: unknown; before?: unknown; after?: unknown; files?: unknown }
type SpotInput = { file?: unknown; line?: unknown; why?: unknown }
export type CardInput = { title?: unknown; gist?: unknown; changes?: unknown; look?: unknown; unchecked?: unknown }

const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

/** The card, or every reason it was refused, so one retry can fix them all. */
export function check(input: CardInput, facts: Facts, now: number): { card: Card } | { errors: string[] } {
  const errors: string[] = []
  const cap = (name: string, v: unknown, max: number, required = true) => {
    const t = oneLine(v)
    if (!t && required) errors.push(`${name} is missing.`)
    else if (t.length > max) errors.push(`${name} is ${t.length} characters; the limit is ${max}. Say less: "${t.slice(0, 40)}…"`)
    return t
  }

  const title = cap('title', input.title, LIMIT.title)
  const gist = cap('gist', input.gist, LIMIT.gist)

  const rawChanges = list(input.changes)
  if (rawChanges.length === 0) errors.push('changes needs at least one entry.')
  if (rawChanges.length > LIMIT.changes) errors.push(`${rawChanges.length} changes; the limit is ${LIMIT.changes}. Merge related ones, and sweep small leftovers into one "chore".`)
  const changes: Change[] = rawChanges.slice(0, LIMIT.changes).map((raw, i) => {
    const c = (raw ?? {}) as ChangeInput
    const at = `changes[${i + 1}]`
    const kind = KINDS.includes(c.kind as Kind) ? (c.kind as Kind) : 'change'
    const files = list(c.files).map(oneLine).filter(Boolean)
    if (files.length === 0) errors.push(`${at} names no files.`)
    const before = cap(`${at}.before`, c.before, LIMIT.side, false)
    const after = cap(`${at}.after`, c.after, LIMIT.side, false)
    return { kind, title: cap(`${at}.title`, c.title, LIMIT.changeTitle), ...(before && { before }), ...(after && { after }), files }
  })

  const rawLook = list(input.look)
  if (rawLook.length > LIMIT.look) errors.push(`${rawLook.length} look entries; the limit is ${LIMIT.look}. Keep the ones a reviewer must check first.`)
  const look: Spot[] = rawLook.slice(0, LIMIT.look).map((raw, i) => {
    const s = (raw ?? {}) as SpotInput
    const file = oneLine(s.file)
    if (!file) errors.push(`look[${i + 1}].file is missing.`)
    const line = Number(s.line)
    return { file, ...(Number.isInteger(line) && line > 0 && { line }), why: cap(`look[${i + 1}].why`, s.why, LIMIT.why) }
  })

  const rawUnchecked = list(input.unchecked)
  if (rawUnchecked.length > LIMIT.unchecked) errors.push(`${rawUnchecked.length} unchecked entries; the limit is ${LIMIT.unchecked}.`)
  const unchecked = rawUnchecked.slice(0, LIMIT.unchecked).map((u, i) => cap(`unchecked[${i + 1}]`, u, LIMIT.uncheckedItem))

  // Nothing hides: every changed file sits under a change, and every named file changed.
  const named = changes.flatMap(c => c.files)
  const loose = Object.keys(facts.files).filter(p => !named.some(e => covers(e, p)))
  if (loose.length) {
    errors.push(`No change covers ${plural(loose.length, 'file')}: ${loose.slice(0, 20).join(', ')}${loose.length > 20 ? ', …' : ''}. Add them to a change (a path ending in "/" covers a folder).`)
  }
  const unknown = named.filter(e => !Object.keys(facts.files).some(p => covers(e, p)))
  if (unknown.length) errors.push(`Not changed since ${facts.base}: ${unknown.join(', ')}. Use paths from the repository root, as git prints them.`)

  if (errors.length) return { errors }
  return { card: { title, gist, changes, look, unchecked, writtenAt: now, facts: { ...facts.files } } }
}

/** The card as plain text, for the model and the command. */
export function cardText(card: Card): string {
  const lines = [card.title, card.gist, '']
  for (const c of card.changes) {
    lines.push(`[${KIND_GLYPH[c.kind]}] ${c.title} (${plural(changedFiles(c, card.facts).length, 'file')})`)
    if (c.before || c.after) lines.push(`    ${c.before ?? '…'} → ${c.after ?? '…'}`)
  }
  if (card.look.length) lines.push('', 'Look here first:', ...card.look.map(s => `  ${s.file}${s.line ? `:${s.line}` : ''}  ${s.why}`))
  if (card.unchecked.length) lines.push('', `Not checked: ${card.unchecked.join('; ')}`)
  return lines.join('\n')
}

/** The last two parts of a path: enough to recognise it. */
export const shortPath = (p: string) => {
  const parts = p.replace(/\/$/, '').split('/')
  return (parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : parts.join('/')) + (p.endsWith('/') ? '/' : '')
}
