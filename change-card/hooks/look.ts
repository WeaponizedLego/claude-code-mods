import type { Card, Facts, Kind } from '../types'
import { KIND_GLYPH, KIND_LABEL, changedFiles, fileCount, plural, shortPath } from './card'

// Dark only: near-black cards on a warm black, one orange for what needs a look
// (a stale card, where to look first, what was not checked). An SVG is drawn as
// an image, so it takes real colours, not theme keys; the terminal uses the same.
export const C = {
  ground: '#121211',
  card: '#1a1a19',
  raised: '#222220',
  stroke: '#262523',
  edge: '#3a3936',
  text: '#eceae6',
  soft: '#c9c6c0',
  muted: '#9a9690',
  dim: '#5c5955',
  accent: '#fc5220',
  amber: '#f2a65a',
  ember: '#3a1a10',
} as const

// Kinds part by colour and by mark: filled for what was added or mended,
// an outline for what moved or went, a dashed outline for chores.
export const KIND_COLOR: Record<Kind, string> = { new: C.text, fix: C.amber, change: C.soft, removal: C.accent, chore: C.muted }
const KIND_MARK: Record<Kind, 'fill' | 'line' | 'dash'> = { new: 'fill', fix: 'fill', change: 'line', removal: 'line', chore: 'dash' }

const MONO = `font-family="'SF Mono', 'JetBrains Mono', Menlo, ui-monospace, monospace"`

export const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Text in an image cannot wrap or truncate itself: cut it to an estimated monospace width.
const chars = (px: number, size: number, spacing = 0) => Math.max(3, Math.floor(px / (size * 0.6 + spacing)))
export const fit = (t: string, px: number, size: number, spacing = 0) => {
  const max = chars(px, size, spacing)
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
  text(x, y, 10, fill, esc(fit(body.toUpperCase(), px, 10, 0.8)), `letter-spacing="0.8" ${extra}`)

// A 5×7 dot-matrix face for headings and big numbers, drawn as circles.
const GLYPHS: Record<string, string> = {
  A: '.###. #...# #...# ##### #...# #...# #...#',
  B: '####. #...# #...# ####. #...# #...# ####.',
  C: '.###. #...# #.... #.... #.... #...# .###.',
  D: '####. #...# #...# #...# #...# #...# ####.',
  E: '##### #.... #.... ####. #.... #.... #####',
  F: '##### #.... #.... ####. #.... #.... #....',
  G: '.###. #...# #.... #.### #...# #...# .####',
  H: '#...# #...# #...# ##### #...# #...# #...#',
  I: '.###. ..#.. ..#.. ..#.. ..#.. ..#.. .###.',
  J: '..### ...#. ...#. ...#. ...#. #..#. .##..',
  K: '#...# #..#. #.#.. ##... #.#.. #..#. #...#',
  L: '#.... #.... #.... #.... #.... #.... #####',
  M: '#...# ##.## #.#.# #.#.# #...# #...# #...#',
  N: '#...# #...# ##..# #.#.# #..## #...# #...#',
  O: '.###. #...# #...# #...# #...# #...# .###.',
  P: '####. #...# #...# ####. #.... #.... #....',
  Q: '.###. #...# #...# #...# #.#.# #..#. .##.#',
  R: '####. #...# #...# ####. #.#.. #..#. #...#',
  S: '.#### #.... #.... .###. ....# ....# ####.',
  T: '##### ..#.. ..#.. ..#.. ..#.. ..#.. ..#..',
  U: '#...# #...# #...# #...# #...# #...# .###.',
  V: '#...# #...# #...# #...# #...# .#.#. ..#..',
  W: '#...# #...# #...# #.#.# #.#.# #.#.# .#.#.',
  X: '#...# #...# .#.#. ..#.. .#.#. #...# #...#',
  Y: '#...# #...# .#.#. ..#.. ..#.. ..#.. ..#..',
  Z: '##### ....# ...#. ..#.. .#... #.... #####',
  '0': '.###. #...# #..## #.#.# ##..# #...# .###.',
  '1': '..#.. .##.. ..#.. ..#.. ..#.. ..#.. .###.',
  '2': '.###. #...# ....# ...#. ..#.. .#... #####',
  '3': '##### ...#. ..#.. ...#. ....# #...# .###.',
  '4': '...#. ..##. .#.#. #..#. ##### ...#. ...#.',
  '5': '##### #.... ####. ....# ....# #...# .###.',
  '6': '..##. .#... #.... ####. #...# #...# .###.',
  '7': '##### ....# ...#. ..#.. .#... .#... .#...',
  '8': '.###. #...# #...# .###. #...# #...# .###.',
  '9': '.###. #...# #...# .#### ....# ...#. .##..',
  '/': '....# ....# ...#. ..#.. .#... #.... #....',
  '-': '..... ..... ..... .###. ..... ..... .....',
  '.': '..... ..... ..... ..... ..... .##.. .##..',
  ':': '..... .##.. .##.. ..... .##.. .##.. .....',
  '?': '.###. #...# ....# ...#. ..#.. ..... ..#..',
}

/** Width of a dot-matrix string at a pitch (the distance between dot centres). */
export const dotsWidth = (s: string, pitch: number) => Math.max(0, s.length * 6 * pitch - pitch)

/** A dot-matrix string with its top-left at (x, y): 7 dots tall. */
export function dots(s: string, x: number, y: number, pitch: number, fill: string): string {
  const r = (pitch * 0.4).toFixed(2)
  const out: string[] = []
  ;[...s.toUpperCase()].forEach((ch, c) => {
    const rows = (GLYPHS[ch] ?? '').split(' ')
    rows.forEach((row, ry) => {
      ;[...row].forEach((bit, rx) => {
        if (bit !== '#') return
        const cx = x + (c * 6 + rx) * pitch + pitch / 2
        const cy = y + ry * pitch + pitch / 2
        out.push(`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r}"/>`)
      })
    })
  })
  return `<g fill="${fill}">${out.join('')}</g>`
}

const svg = (W: number, H: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" ${MONO}>${body}</svg>`
const panel = (y: number, W: number, h: number, stroke: string = C.stroke) =>
  `<rect x="0.5" y="${y + 0.5}" width="${W - 1}" height="${h - 1}" rx="16" fill="${C.card}" stroke="${stroke}"/>`

/** A change's kind as a 13px tile carrying its glyph, its top-left at (x, y). */
function kindTile(kind: Kind, x: number, y: number): string {
  const color = KIND_COLOR[kind]
  const mark = KIND_MARK[kind]
  const rect =
    mark === 'fill'
      ? `<rect x="${x}" y="${y}" width="13" height="13" rx="3" fill="${color}"/>`
      : `<rect x="${x + 0.5}" y="${y + 0.5}" width="12" height="12" rx="3" fill="none" stroke="${mark === 'dash' ? C.dim : color}"${mark === 'dash' ? ' stroke-dasharray="2 3"' : ''}/>`
  return rect + text(x + 6.5, y + 10, 10, mark === 'fill' ? C.card : color, esc(KIND_GLYPH[kind]), 'text-anchor="middle" font-weight="700"')
}

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
    parts.push(`<circle cx="23" cy="${y + 22}" r="7" fill="${C.ember}"/><circle cx="23" cy="${y + 22}" r="3.5" fill="${C.accent}"/>`)
    parts.push(text(38, y + 26.5, 13, C.accent, esc(fit(`${plural(moved.length, 'file')} changed since this card`, W - 54, 13)), 'font-weight="600"'))
    parts.push(text(16, y + 46, 11, C.muted, esc(fit(`${moved.slice(0, 4).map(shortPath).join(', ')}${moved.length > 4 ? ', …' : ''} · /changes to update`, W - 32, 11))))
    y += h + GAP
  }

  // ---- the hero: files changed in dot-matrix, the line counts beside it; then headline and gist
  const files = facts ? fileCount(facts) : Object.keys(card.facts).length
  const hero = String(files)
  const pitch = 4
  const head: string[] = [dots(hero, 16, y + 18, pitch, C.text)]
  const lx = 16 + dotsWidth(hero, pitch) + 14
  head.push(label(lx, y + 28, C.muted, files === 1 ? 'file changed' : 'files changed', W - lx - 16))
  if (facts) {
    head.push(
      `<text x="${lx}" y="${y + 45}" font-size="11" letter-spacing="0.4"><tspan fill="${C.text}">+${num(facts.added)}</tspan><tspan fill="${C.muted}"> −${num(facts.deleted)}</tspan></text>`,
    )
  }
  let ty = y + 76
  for (const l of wrap(card.title, W - 32, 14, 2)) {
    head.push(text(16, ty, 14, C.text, esc(l), 'font-weight="600"'))
    ty += 20
  }
  ty += 1
  for (const l of wrap(card.gist, W - 32, 12, 3)) {
    head.push(text(16, ty, 12, C.soft, esc(l)))
    ty += 17
  }
  if (facts) {
    head.push(label(16, ty + 7, C.muted, `since ${facts.since}`, W - 32))
    ty += 24
  }
  const headH = ty - y + 2
  parts.push(panel(y, W, headH), ...head)
  y += headH + GAP

  // ---- numbered rows: "01  [+] NEW … 3 FILES", the title under it, then before → after
  const rowH = card.changes.map(c => (c.before || c.after ? 62 : 44))
  const listH = 48 + rowH.reduce((a, b) => a + b, 0) + 2
  parts.push(panel(y, W, listH))
  parts.push(text(16, y + 28, 13, C.text, 'What changed', 'font-weight="600"'))
  parts.push(label(W - 16, y + 28, C.muted, plural(card.changes.length, 'change'), 120, 'text-anchor="end"'))
  ty = y + 46
  card.changes.forEach((c, i) => {
    if (i > 0) parts.push(`<line x1="16" y1="${ty - 6}" x2="${W - 16}" y2="${ty - 6}" stroke="${C.stroke}"/>`)
    const n = plural(changedFiles(c, card.facts).length, 'file')
    parts.push(text(16, ty + 11, 10, C.dim, String(i + 1).padStart(2, '0'), 'letter-spacing="0.8"'))
    parts.push(kindTile(c.kind, 38, ty + 1))
    parts.push(label(58, ty + 11, KIND_COLOR[c.kind], KIND_LABEL[c.kind], 80))
    parts.push(label(W - 16, ty + 11, C.muted, n, W - 58 - 80, 'text-anchor="end"'))
    parts.push(text(38, ty + 30, 12.5, C.text, esc(fit(c.title, W - 54, 12.5))))
    if (c.before || c.after) {
      const side = (W - 54 - 3 * 6.6) / 2
      parts.push(
        `<text x="38" y="${ty + 48}" font-size="11"><tspan fill="${C.muted}">${esc(fit(c.before ?? '…', side, 11))}</tspan>` +
          `<tspan fill="${C.dim}"> → </tspan><tspan fill="${C.soft}">${esc(fit(c.after ?? '…', side, 11))}</tspan></text>`,
      )
    }
    ty += rowH[i] ?? 44
  })
  y += listH + GAP

  // ---- where a reviewer looks first: needs a look, so orange
  if (card.look.length) {
    const h = 47 + card.look.length * 40
    parts.push(panel(y, W, h, C.accent))
    parts.push(text(16, y + 28, 13, C.text, 'Look here first', 'font-weight="600"'))
    parts.push(label(W - 16, y + 28, C.accent, `${card.look.length} to check`, 120, 'text-anchor="end"'))
    card.look.forEach((s, i) => {
      const sy = y + 52 + i * 40
      parts.push(`<rect x="16" y="${sy - 11}" width="3" height="31" rx="1.5" fill="${C.accent}"/>`)
      parts.push(text(28, sy, 12, C.text, esc(fit(`${shortPath(s.file)}${s.line ? `:${s.line}` : ''}`, W - 44, 12)), 'font-weight="600"'))
      parts.push(text(28, sy + 17, 11.5, C.soft, esc(fit(s.why, W - 44, 11.5))))
    })
    y += h + GAP
  }

  // ---- what nobody checked: hollow orange marks, nothing ticked off
  if (card.unchecked.length) {
    const h = 46 + card.unchecked.length * 20
    parts.push(panel(y, W, h, C.accent))
    parts.push(text(16, y + 28, 13, C.accent, 'Not checked', 'font-weight="600"'))
    card.unchecked.forEach((u, i) => {
      const uy = y + 50 + i * 20
      parts.push(`<circle cx="21" cy="${uy - 4}" r="3.5" fill="none" stroke="${C.accent}"/>`)
      parts.push(text(32, uy, 11.5, C.soft, esc(fit(u, W - 48, 11.5))))
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

/** No card yet: a dashed, dim outline with the way to get one. */
export function emptySvg(facts: Facts | null, width: number): { source: string; height: number } {
  const W = Math.max(300, Math.round(width))
  const pitch = Math.min(3, (W - 32) / (11 * 6))
  const how = wrap('Run /changes to have Claude explain what changed on this branch.', W - 32, 11.5, 2)
  const H = 62 + how.length * 16 + (facts ? 20 : 0)
  const p: string[] = [
    `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="16" fill="${C.card}" stroke="${C.dim}" stroke-dasharray="2 3"/>`,
    dots('NO CARD YET', 16, 18, pitch, C.dim),
  ]
  how.forEach((l, i) => p.push(text(16, 60 + i * 16, 11.5, C.muted, esc(l))))
  if (facts) p.push(label(16, 60 + how.length * 16 + 10, C.muted, statLine(facts), W - 32))
  return { source: svg(W, H, p.join('')), height: H }
}
