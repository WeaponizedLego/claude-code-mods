import type { Snapshot, Tokens } from '../types'

// Dark only: near-black cards on a warm black. Ivory while there is room, a warm
// amber from 70%, the one orange past 80%. An SVG is drawn as an image, so it
// takes real colours, not theme keys; the terminal uses the same.
export const C = {
  ground: '#121211',
  card: '#1a1a19',
  stroke: '#262523',
  edge: '#3a3936',
  text: '#eceae6',
  soft: '#c9c6c0',
  muted: '#9a9690',
  dim: '#5c5955',
  warn: '#f2a65a',
  accent: '#fc5220',
  ember: '#3a1a10',
} as const

// Ivory while there is room, amber from 70%, orange past 80%.
export const level = (percent: number): string => (percent > 80 ? C.accent : percent >= 70 ? C.warn : C.text)

export const compact = (n: number): string => {
  if (n < 1000) return `${n}`
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

export const dollars = (usd: number): string => `$${usd < 10 ? usd.toFixed(2) : usd.toFixed(1)}`

export const LIMIT_NAMES: Record<string, string> = { five_hour: '5h', seven_day: '7d', spend_limit: 'spend' }

const MONO = `font-family="'SF Mono', 'JetBrains Mono', Menlo, ui-monospace, monospace"`
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Text in an image cannot truncate itself: cut it to an estimated monospace width.
const fit = (t: string, px: number, size: number, spacing = 0) => {
  const max = Math.max(3, Math.floor(px / (size * 0.6 + spacing)))
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}
const label = (x: number, y: number, fill: string, body: string, px: number) =>
  `<text x="${x.toFixed(1)}" y="${y}" font-size="10" fill="${fill}" letter-spacing="0.8">${esc(fit(body.toUpperCase(), px, 10, 0.8))}</text>`

// A 5×7 dot-matrix face for the big numbers, drawn as circles.
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
  '%': '##..# ##..# ...#. ..#.. .#... #..## #..##',
  $: '..#.. .#### #.#.. .###. ..#.# ####. ..#..',
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

type Tile = {
  priority: number
  label: string
  value: string
  valueColor: string
  isHot?: boolean
  aside?: string
  sub?: { lead?: string; rest?: string }
  pills?: { filled: number; color: string }
}

const PILLS = 10

function tiles(snap: Snapshot | null, used: Tokens): Tile[] {
  const out: Tile[] = []
  const percent = snap?.percent
  out.push(
    percent == null
      ? { priority: 0, label: 'Context', value: '--', valueColor: C.dim, sub: { rest: 'waiting for first reply' } }
      : {
          priority: 0,
          label: 'Context',
          value: `${percent}%`,
          valueColor: level(percent),
          isHot: percent > 80,
          aside: snap?.contextTokens != null ? `${compact(snap.contextTokens)} / ${compact(snap.window)}` : undefined,
          pills: { filled: Math.min(PILLS, Math.round(percent / (100 / PILLS))), color: level(percent) },
        },
  )
  if (snap?.costUsd != null) {
    out.push({ priority: 1, label: 'Cost', value: dollars(snap.costUsd), valueColor: C.text, sub: { rest: 'this session' } })
  }
  if (used.input + used.output > 0) {
    out.push({
      priority: 2,
      label: 'Tokens',
      value: compact(used.output),
      valueColor: C.text,
      aside: 'out',
      sub: { lead: `${compact(used.input)} in`, rest: used.cacheRead > 0 ? ` · ${compact(used.cacheRead)} cached` : '' },
    })
  }
  for (const limit of snap?.limits ?? []) {
    const p = Math.round(limit.percentUsed)
    out.push({
      priority: 4,
      label: `${LIMIT_NAMES[limit.kind] ?? limit.kind} limit`,
      value: `${p}%`,
      valueColor: level(p),
      isHot: p > 80,
      pills: { filled: Math.min(PILLS, Math.round(p / (100 / PILLS))), color: level(p) },
    })
  }
  return out
}

export const TILE_H = 60
const MIN_W = 118
const MAX_W = 200
const GAP = 8
const PAD = 14

/** The band as one strip of stat tiles, the least important dropped to fit. */
export function bandSvg(snap: Snapshot | null, used: Tokens, width: number): { source: string; width: number; alt: string } {
  let kept = tiles(snap, used)
  const fits = (n: number) => n * MIN_W + (n - 1) * GAP <= width
  while (kept.length > 1 && !fits(kept.length)) {
    const worst = Math.max(...kept.map(t => t.priority))
    const at = kept.map(t => t.priority).lastIndexOf(worst)
    kept = kept.filter((_, i) => i !== at)
  }
  const n = kept.length
  const tileW = Math.max(MIN_W, Math.min(MAX_W, (width - (n - 1) * GAP) / n))
  const W = Math.round(n * tileW + (n - 1) * GAP)
  const inner = tileW - 2 * PAD

  const parts = kept.map((t, i) => {
    const x = i * (tileW + GAP)
    const lx = x + PAD
    const g: string[] = []
    g.push(`<rect x="${(x + 0.5).toFixed(1)}" y="0.5" width="${(tileW - 1).toFixed(1)}" height="${TILE_H - 1}" rx="16" fill="${C.card}" stroke="${t.isHot ? C.accent : C.stroke}"/>`)
    g.push(label(lx, 17, C.muted, t.label, inner))

    // The tile's value in the dot-matrix face, shrunk if a long one would overflow.
    const pitch = Math.min(2.4, inner / Math.max(1, t.value.length * 6 - 1))
    g.push(dots(t.value, lx, 23, pitch, t.valueColor))
    if (t.aside) {
      const ax = lx + dotsWidth(t.value, pitch) + 7
      const room = x + tileW - PAD - ax
      // The aside shows whole or not at all.
      if (t.aside.length * 6.8 <= room) g.push(label(ax, 39, C.muted, t.aside, room))
    }

    if (t.pills) {
      // Filled cells in the level colour, the rest hollow.
      const pw = (inner - (PILLS - 1) * 3) / PILLS
      for (let k = 0; k < PILLS; k++) {
        const px = (lx + k * (pw + 3)).toFixed(1)
        g.push(
          k < t.pills.filled
            ? `<rect x="${px}" y="46" width="${pw.toFixed(1)}" height="6" rx="3" fill="${t.pills.color}"/>`
            : `<rect x="${px}" y="46.5" width="${(pw - 1).toFixed(1)}" height="5" rx="2.5" fill="none" stroke="${C.dim}"/>`,
        )
      }
    } else if (t.sub) {
      const lead = (t.sub.lead ?? '').toUpperCase()
      const whole = fit(lead + (t.sub.rest ?? '').toUpperCase(), inner, 10, 0.8)
      const head = whole.slice(0, lead.length)
      const tail = whole.slice(lead.length)
      const spans = (head ? `<tspan fill="${C.soft}">${esc(head)}</tspan>` : '') + (tail ? `<tspan fill="${C.muted}">${esc(tail)}</tspan>` : '')
      g.push(`<text x="${lx}" y="53" font-size="10" letter-spacing="0.8">${spans}</text>`)
    }
    return g.join('')
  })

  const source = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${TILE_H}" viewBox="0 0 ${W} ${TILE_H}" ${MONO}>${parts.join('')}</svg>`
  const alt = kept.map(t => (t.value === '--' ? `${t.label} ${t.sub?.rest ?? 'not known yet'}` : `${t.label} ${t.value}${t.aside ? ` ${t.aside}` : ''}`)).join(', ')
  return { source, width: W, alt }
}
