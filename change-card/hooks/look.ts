import type { Card, Facts, Kind } from '../types'
import { KIND_LABEL, changedFiles, fileCount, plural, shortPath } from './card'

// Dark only: square slate panels on a navy ground, hairline rules, light wide
// numerals. Amber for what needs a look (a stale card, where to look first, what
// was not checked), periwinkle for the steady second series, teal for what was
// added and red for what went. An SVG is drawn as an image, so it takes real
// colours, not theme keys; the terminal uses the same.
export const C = {
  ground: '#1f2433',
  card: '#282e40',
  raised: '#2f3549',
  stroke: '#353c50',
  edge: '#4a5168',
  text: '#e8eaf0',
  soft: '#c4c8d4',
  muted: '#9aa1b5',
  dim: '#6b7287',
  accent: '#f5a524',
  amber: '#f5a524',
  ember: '#3d3220',
  done: '#8b90d6',
  good: '#3fc9b4',
  hot: '#f0605d',
} as const

// Kinds part by colour: teal for what was added, periwinkle for what moved,
// red for what went, amber for a fix, muted for chores.
export const KIND_COLOR: Record<Kind, string> = { new: C.good, fix: C.accent, change: C.done, removal: C.hot, chore: C.muted }

const SANS = `font-family="Barlow, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif"`
const MONO = `font-family="'JetBrains Mono', 'SF Mono', Consolas, Menlo, ui-monospace, monospace"`

export const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Text in an image cannot wrap or truncate itself: cut it to an estimated width,
// a sans letter about 0.55 of its size, an uppercase one 0.68.
const chars = (px: number, size: number, spacing = 0, per = 0.55) => Math.max(3, Math.floor(px / (size * per + spacing)))
export const fit = (t: string, px: number, size: number, spacing = 0, per = 0.55) => {
  const max = chars(px, size, spacing, per)
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
const label = (x: number, y: number, fill: string, body: string, px: number, extra = '') =>
  text(x, y, 10, fill, esc(fit(body.toUpperCase(), px, 10, 1.2, 0.68)), `letter-spacing="1.2" ${extra}`)
/** A big light numeral. */
const big = (x: number, y: number, size: number, fill: string, body: string, extra = '') =>
  text(x, y, size, fill, esc(body), `font-weight="300" letter-spacing="1" ${extra}`)
/** A card's title with the bar marker at its left. */
const title = (y: number, body: string, W: number, bar: string = C.text, fill: string = C.text) =>
  `<rect x="16" y="${y - 11}" width="2" height="14" fill="${bar}"/>` + text(26, y, 13.5, fill, esc(fit(body, W - 42 - 100, 13.5)), 'font-weight="500"')
const square = (x: number, y: number, fill: string) => `<rect x="${x}" y="${y}" width="6" height="6" fill="${fill}"/>`

const svg = (W: number, H: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" ${SANS}>${body}</svg>`
const panel = (y: number, W: number, h: number, stroke: string = C.stroke) =>
  `<rect x="0.5" y="${y + 0.5}" width="${W - 1}" height="${h - 1}" fill="${C.card}" stroke="${stroke}"/>`
const hollow = (y: number, W: number, h: number, stroke: string = C.edge) =>
  `<rect x="0.5" y="${y + 0.5}" width="${W - 1}" height="${h - 1}" fill="none" stroke="${stroke}" stroke-dasharray="4 4"/>`

const num = (n: number) => String(n).replace(/\B(?=(\d{3})+$)/g, ',')
export const statLine = (f: Facts) => `${plural(Object.keys(f.files).length, 'file')} · +${num(f.added)} −${num(f.deleted)} · since ${f.since}`

const GAP = 10

/** The whole card as one SVG: headline, changes, where to look, what was not checked. */
export function cardSvg(card: Card, facts: Facts | null, moved: string[], width: number): { source: string; height: number; alt: string } {
  const W = Math.max(300, Math.round(width))
  const parts: string[] = []
  let y = 0

  // ---- stale: the code moved on since the card was written
  if (moved.length) {
    const h = 60
    parts.push(panel(y, W, h, C.accent))
    parts.push(square(16, y + 18, C.accent))
    parts.push(text(30, y + 25, 13.5, C.accent, esc(fit(`${plural(moved.length, 'file')} changed since this card`, W - 46, 13.5)), 'font-weight="500"'))
    parts.push(text(16, y + 45, 11.5, C.muted, esc(fit(`${moved.slice(0, 4).map(shortPath).join(', ')}${moved.length > 4 ? ', …' : ''} · /changes to update`, W - 32, 11.5))))
    y += h + GAP
  }

  // ---- the headline and gist, then the files and line counts as big light numbers
  const files = facts ? fileCount(facts) : Object.keys(card.facts).length
  const head: string[] = []
  let ty = y + 30
  wrap(card.title, W - 42, 16, 2).forEach((l, i) => {
    if (i === 0) head.push(`<rect x="16" y="${ty - 13}" width="2" height="16" fill="${C.text}"/>`)
    head.push(text(26, ty, 16, C.text, esc(l), 'font-weight="500"'))
    ty += 22
  })
  ty += 2
  for (const l of wrap(card.gist, W - 32, 12.5, 3)) {
    head.push(text(16, ty, 12.5, C.soft, esc(l)))
    ty += 18
  }
  ty += 2
  head.push(`<line x1="16" y1="${ty}" x2="${W - 16}" y2="${ty}" stroke="${C.stroke}"/>`)
  const col = (W - 32) / 3
  const stats: [string, string, string][] = [[files === 1 ? 'file' : 'files', String(files), C.text]]
  if (facts) stats.push(['added', `+${num(facts.added)}`, C.good], ['removed', `−${num(facts.deleted)}`, C.hot])
  stats.forEach(([name, value, color], i) => {
    const x = 16 + i * col
    head.push(label(x, ty + 22, C.muted, name, col - 8))
    head.push(big(x, ty + 54, 30, color, fit(value, col - 8, 30, 1, 0.56)))
  })
  ty += 64
  if (facts) {
    // "since 3f9c2e1 / fork point from origin/HEAD"
    const [sha = '', ...why] = facts.since.split(' ')
    const rest = why.join(' ').replace(/^\(|\)$/g, '')
    head.push(
      `<text x="16" y="${ty + 12}" font-size="11.5"><tspan fill="${C.muted}">since ${esc(fit(sha, 120, 11.5))}</tspan>` +
        (rest ? `<tspan fill="${C.edge}"> / </tspan><tspan fill="${C.muted}">${esc(fit(rest, W - 32 - 120, 11.5))}</tspan>` : '') +
        `</text>`,
    )
    ty += 22
  }
  const headH = ty - y + 10
  parts.push(panel(y, W, headH), ...head)
  y += headH + GAP

  // ---- the changes as a table: a header strip, then kind / title / files rows, before → after under
  const kindW = 92
  const rowH = card.changes.map(c => (c.before || c.after ? 46 : 28))
  const listH = 82 + rowH.reduce((a, b) => a + b, 0)
  parts.push(panel(y, W, listH))
  parts.push(title(y + 28, 'What changed', W))
  parts.push(label(W - 16, y + 28, C.muted, plural(card.changes.length, 'change'), 120, 'text-anchor="end"'))
  parts.push(`<rect x="16" y="${y + 42}" width="${W - 32}" height="22" fill="${C.stroke}"/>`)
  parts.push(label(26, y + 57, C.muted, 'kind', kindW))
  parts.push(label(16 + kindW, y + 57, C.muted, 'change', W - 32 - kindW - 60))
  parts.push(label(W - 26, y + 57, C.muted, 'files', 60, 'text-anchor="end"'))
  ty = y + 88
  card.changes.forEach((c, i) => {
    const color = KIND_COLOR[c.kind]
    parts.push(square(26, ty - 7, color))
    parts.push(label(37, ty, color, KIND_LABEL[c.kind], kindW - 26))
    parts.push(text(16 + kindW, ty, 13, C.text, esc(fit(c.title, W - 32 - kindW - 50, 13))))
    parts.push(text(W - 26, ty, 13, C.muted, String(changedFiles(c, card.facts).length), 'text-anchor="end"'))
    if (c.before || c.after) {
      const side = (W - 32 - kindW - 26 - 3 * 7) / 2
      parts.push(
        `<text x="${16 + kindW}" y="${ty + 18}" font-size="11.5"><tspan fill="${C.muted}">${esc(fit(c.before ?? '…', side, 11.5))}</tspan>` +
          `<tspan fill="${C.accent}"> → </tspan><tspan fill="${C.text}">${esc(fit(c.after ?? '…', side, 11.5))}</tspan></text>`,
      )
    }
    ty += rowH[i] ?? 28
  })
  y += listH + GAP

  // ---- where a reviewer looks first: needs a look, so amber
  if (card.look.length) {
    const h = 46 + card.look.length * 44
    parts.push(panel(y, W, h, C.accent))
    parts.push(title(y + 28, 'Look here first', W, C.accent))
    parts.push(label(W - 16, y + 28, C.accent, `${card.look.length} to check`, 120, 'text-anchor="end"'))
    card.look.forEach((s, i) => {
      const sy = y + 58 + i * 44
      parts.push(big(16, sy + 6, 22, C.accent, String(i + 1).padStart(2, '0')))
      parts.push(text(52, sy, 12, C.text, esc(fit(`${shortPath(s.file)}${s.line ? `:${s.line}` : ''}`, W - 68, 12, 0, 0.6)), MONO))
      parts.push(text(52, sy + 18, 12, C.muted, esc(fit(s.why, W - 68, 12))))
    })
    y += h + GAP
  }

  // ---- what nobody checked: a dashed amber outline, nothing ticked off
  if (card.unchecked.length) {
    const h = 46 + card.unchecked.length * 22
    parts.push(hollow(y, W, h, C.accent))
    parts.push(title(y + 28, 'Not checked', W, C.accent, C.accent))
    card.unchecked.forEach((u, i) => {
      const uy = y + 54 + i * 22
      parts.push(square(16, uy - 8, C.accent))
      parts.push(text(30, uy, 12.5, C.text, esc(fit(u, W - 46, 12.5))))
    })
    y += h + GAP
  }

  const height = Math.round(y - GAP)
  const lines = facts ? `, +${facts.added} −${facts.deleted}` : ''
  const alt =
    `${card.title}: ${card.gist} ${plural(files, 'file')}${lines}; ${plural(card.changes.length, 'change')}` +
    `${card.look.length ? `; ${card.look.length} to look at first` : ''}${card.unchecked.length ? `; ${card.unchecked.length} not checked` : ''}` +
    `${moved.length ? `; ${plural(moved.length, 'file')} changed since` : ''}`
  return { source: svg(W, height, parts.join('')), height, alt }
}

/** No card yet: a dashed outline with the way to get one. */
export function emptySvg(facts: Facts | null, width: number): { source: string; height: number } {
  const W = Math.max(300, Math.round(width))
  const how = wrap('Run /changes to have Claude explain what changed on this branch.', W - 32, 12, 2)
  const H = 66 + how.length * 17 + (facts ? 20 : 0)
  const p: string[] = [hollow(0, W, H), big(16, 42, 28, C.muted, 'No card yet')]
  how.forEach((l, i) => p.push(text(16, 66 + i * 17, 12, C.muted, esc(l))))
  if (facts) p.push(text(16, 66 + how.length * 17 + 8, 11.5, C.muted, esc(fit(statLine(facts), W - 32, 11.5))))
  return { source: svg(W, H, p.join('')), height: H }
}
