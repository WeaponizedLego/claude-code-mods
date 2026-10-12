import type { Card, Facts, Kind } from '../types'
import { KIND_LABEL, changedFiles, plural, shortPath } from './card'

// The palette the other mods share: dark violet cards with a lilac accent,
// orange and red for what needs a look. An SVG is drawn as an image, so it
// takes real colours, not theme keys; the terminal uses the same.
export const C = {
  card: '#23222b',
  raised: '#2a2933',
  stroke: '#363541',
  text: '#ececf1',
  soft: '#c9c7d3',
  muted: '#8e8c9a',
  dim: '#5f5d6b',
  accent: '#a98bff',
  deep: '#7d68c9',
  glow: '#c4b2ff',
  track: '#3b3650',
  warn: '#ff8a4c',
  hot: '#ff5c7a',
} as const

export const KIND_COLOR: Record<Kind, string> = { new: C.accent, fix: C.warn, change: C.glow, removal: C.hot, chore: C.muted }

const FONT = `font-family="Inter, 'Segoe UI', system-ui, -apple-system, sans-serif"`
const MONO = `font-family="'JetBrains Mono', 'SF Mono', Menlo, monospace"`

export const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Text in an image cannot wrap or truncate itself: cut it to an estimated width.
const chars = (px: number, size: number) => Math.max(3, Math.floor(px / (size * 0.52)))
const fit = (t: string, px: number, size: number) => {
  const max = chars(px, size)
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}
function wrap(t: string, px: number, size: number, maxLines: number): string[] {
  const max = chars(px, size)
  const lines: string[] = []
  let line = ''
  for (const word of t.split(' ')) {
    if (!line) line = word
    else if (line.length + 1 + word.length <= max) line += ` ${word}`
    else {
      lines.push(line)
      line = word
    }
  }
  if (line) lines.push(line)
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines)
    kept[maxLines - 1] = fit(`${kept[maxLines - 1]} ${lines[maxLines]}`, px - size, size).replace(/…?$/, '…')
    return kept.map(l => fit(l, px, size))
  }
  return lines.map(l => fit(l, px, size))
}

const text = (x: number, y: number, size: number, fill: string, body: string, extra = '') =>
  `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" ${extra}>${body}</text>`

const svg = (W: number, H: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" ${FONT}>${body}</svg>`

const num = (n: number) => String(n).replace(/\B(?=(\d{3})+$)/g, ',')
export const statLine = (f: Facts) => `${plural(Object.keys(f.files).length, 'file')} · +${num(f.added)} −${num(f.deleted)} · since ${f.since}`

const GAP = 10
const ROW = 22

/** The whole card as one SVG: headline, changes, where to look, what was not checked. */
export function cardSvg(card: Card, facts: Facts | null, moved: string[], width: number): { source: string; height: number; alt: string } {
  const W = Math.max(300, Math.round(width))
  const parts: string[] = []
  let y = 0

  // ---- the code moved on since the card was written
  if (moved.length) {
    const h = 54
    parts.push(`<rect x="0.5" y="0.5" width="${W - 1}" height="${h - 1}" rx="14" fill="${C.raised}" stroke="${C.warn}"/>`)
    parts.push(text(18, 23, 12.5, C.warn, esc(`${plural(moved.length, 'file')} changed since this card`), 'font-weight="600"'))
    parts.push(text(18, 41, 11, C.muted, esc(fit(`${moved.slice(0, 4).map(shortPath).join(', ')}${moved.length > 4 ? ', …' : ''} · /changes to update`, W - 36, 11))))
    y += h + GAP
  }

  // ---- headline and gist
  const titleLines = wrap(card.title, W - 36, 15, 2)
  const gistLines = wrap(card.gist, W - 36, 12.5, 3)
  const headH = 30 + titleLines.length * 20 + gistLines.length * 18 + (facts ? 26 : 6)
  parts.push(`<rect x="0.5" y="${y + 0.5}" width="${W - 1}" height="${headH - 1}" rx="16" fill="${C.card}" stroke="${C.stroke}"/>`)
  let ty = y + 30
  for (const l of titleLines) {
    parts.push(text(18, ty, 15, C.text, esc(l), 'font-weight="600"'))
    ty += 20
  }
  ty += 2
  for (const l of gistLines) {
    parts.push(text(18, ty, 12.5, C.soft, esc(l)))
    ty += 18
  }
  if (facts) parts.push(text(18, ty + 6, 10.5, C.muted, esc(fit(statLine(facts), W - 36, 10.5))))
  y += headH + GAP

  // ---- one row per change, a second line for before → after
  const rows = card.changes.map(c => (c.before || c.after ? 2 : 1))
  const listH = 44 + rows.reduce((a, b) => a + b, 0) * ROW - 4
  parts.push(`<rect x="0.5" y="${y + 0.5}" width="${W - 1}" height="${listH - 1}" rx="14" fill="${C.raised}" stroke="${C.stroke}"/>`)
  parts.push(text(16, y + 25, 13.5, C.text, 'What changed', 'font-weight="600"'))
  ty = y + 52
  card.changes.forEach((c, i) => {
    const color = KIND_COLOR[c.kind]
    const tag = KIND_LABEL[c.kind]
    const tagW = Math.round(tag.length * 6.2 + 14)
    parts.push(`<rect x="16" y="${ty - 13}" width="${tagW}" height="17" rx="8.5" fill="none" stroke="${color}"/>`)
    parts.push(text(16 + tagW / 2, ty - 1.5, 9, color, tag, 'text-anchor="middle" font-weight="600" letter-spacing="0.6"'))
    const n = plural(changedFiles(c, card.facts).length, 'file')
    parts.push(text(W - 18, ty, 11, C.muted, n, 'text-anchor="end"'))
    parts.push(text(24 + tagW, ty, 12.5, C.text, esc(fit(c.title, W - 60 - tagW - n.length * 6, 12.5))))
    if (rows[i] === 2) {
      ty += ROW - 2
      parts.push(
        `<text x="${24 + tagW}" y="${ty}" font-size="11.5"><tspan fill="${C.muted}">${esc(fit(c.before ?? '…', (W - 60 - tagW) / 2, 11.5))}</tspan>` +
          `<tspan fill="${C.accent}"> → </tspan><tspan fill="${C.soft}">${esc(fit(c.after ?? '…', (W - 60 - tagW) / 2, 11.5))}</tspan></text>`,
      )
      ty += ROW + 2
    } else ty += ROW
  })
  y += listH + GAP

  // ---- where a reviewer looks first
  if (card.look.length) {
    const h = 44 + card.look.length * 38 - 6
    parts.push(`<rect x="0.5" y="${y + 0.5}" width="${W - 1}" height="${h - 1}" rx="14" fill="${C.raised}" stroke="${C.stroke}"/>`)
    parts.push(text(16, y + 25, 13.5, C.text, 'Look here first', 'font-weight="600"'))
    card.look.forEach((s, i) => {
      const sy = y + 50 + i * 38
      parts.push(`<rect x="16" y="${sy - 11}" width="3" height="30" rx="1.5" fill="${C.deep}"/>`)
      parts.push(text(26, sy, 11.5, C.glow, esc(fit(`${shortPath(s.file)}${s.line ? `:${s.line}` : ''}`, W - 50, 11.5)), MONO))
      parts.push(text(26, sy + 16, 11.5, C.soft, esc(fit(s.why, W - 50, 11.5))))
    })
    y += h + GAP
  }

  // ---- what nobody checked
  if (card.unchecked.length) {
    const h = 40 + card.unchecked.length * 18
    parts.push(`<rect x="0.5" y="${y + 0.5}" width="${W - 1}" height="${h - 1}" rx="14" fill="${C.card}" stroke="${C.warn}" stroke-opacity="0.6" stroke-dasharray="4 4"/>`)
    parts.push(text(16, y + 25, 13.5, C.warn, 'Not checked', 'font-weight="600"'))
    card.unchecked.forEach((u, i) => {
      const uy = y + 46 + i * 18
      parts.push(`<circle cx="21" cy="${uy - 4}" r="2.5" fill="${C.warn}"/>`)
      parts.push(text(30, uy, 11.5, C.soft, esc(fit(u, W - 48, 11.5))))
    })
    y += h + GAP
  }

  const height = Math.round(y - GAP)
  const alt = `${card.title}: ${card.gist} ${plural(card.changes.length, 'change')}${moved.length ? `; ${plural(moved.length, 'file')} changed since` : ''}`
  return { source: svg(W, height, parts.join('')), height, alt }
}

export function emptySvg(facts: Facts | null, width: number): { source: string; height: number } {
  const W = Math.max(300, Math.round(width))
  const H = facts ? 110 : 92
  const body =
    `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="16" fill="${C.card}" stroke="${C.stroke}" stroke-dasharray="4 4"/>` +
    text(20, 38, 14, C.text, 'No change card yet', 'font-weight="600"') +
    text(20, 60, 11.5, C.muted, esc(fit('Run /changes to have Claude explain what changed on this branch.', W - 40, 11.5))) +
    (facts ? text(20, 84, 10.5, C.dim, esc(fit(statLine(facts), W - 40, 10.5))) : '')
  return { source: svg(W, H, body), height: H }
}
