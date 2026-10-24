import type { Snapshot, Tokens } from '../types'

// Dark only: slate panels on a navy ground, hairline rules, light wide numerals.
// Periwinkle while there is room, amber from 70%, red past 90%. An SVG is drawn
// as an image, so it takes real colours, not theme keys; the terminal uses the same.
export const C = {
  ground: '#1f2433',
  card: '#282e40',
  stroke: '#353c50',
  edge: '#4a5168',
  text: '#e8eaf0',
  soft: '#c4c8d4',
  muted: '#9aa1b5',
  dim: '#6b7287',
  accent: '#f5a524',
  done: '#8b90d6',
  hot: '#f0605d',
} as const

// Ivory while there is room, amber from 70%, red past 90%.
export const level = (percent: number): string => (percent > 90 ? C.hot : percent >= 70 ? C.accent : C.text)
// A gauge or bar is periwinkle while there is room, then takes the level colour.
export const fill = (percent: number): string => (percent >= 70 ? level(percent) : C.done)

export const compact = (n: number): string => {
  if (n < 1000) return `${n}`
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

export const dollars = (usd: number): string => `$${usd < 10 ? usd.toFixed(2) : usd.toFixed(1)}`

export const LIMIT_NAMES: Record<string, string> = { five_hour: '5h', seven_day: '7d', spend_limit: 'spend' }

export const SANS = `font-family="Barlow, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif"`
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Text in an image cannot truncate itself: cut it to an estimated width. Labels
// are capitals, wider than the average letter.
const LABEL_CH = 10 * 0.68 + 1.2
const fit = (t: string, px: number, ch: number) => {
  const max = Math.max(3, Math.floor(px / ch))
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}
const label = (x: number, y: number, fill: string, body: string, px: number) =>
  `<text x="${x.toFixed(1)}" y="${y}" font-size="10" fill="${fill}" letter-spacing="1.2">${esc(fit(body.toUpperCase(), px, LABEL_CH))}</text>`
/** Estimated width of light numerals at a size. */
const numeralsWidth = (t: string, size: number) => t.length * size * 0.5

/** An open arc gauge, the gap at the bottom, with the number in the middle. */
function gauge(cx: number, cy: number, r: number, percent: number, color: string, value: string): string {
  const circ = 2 * Math.PI * r
  const arc = circ * 0.8
  const turn = `transform="rotate(126 ${cx} ${cy})"`
  const p = Math.max(0, Math.min(100, percent))
  return (
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${C.edge}" stroke-width="3" stroke-dasharray="${arc.toFixed(1)} ${circ.toFixed(1)}" ${turn}/>` +
    (p > 0 ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="3" stroke-dasharray="${((arc * p) / 100).toFixed(1)} ${circ.toFixed(1)}" ${turn}/>` : '') +
    `<text x="${cx}" y="${cy + 5}" text-anchor="middle" font-size="${value.length > 3 ? 12 : 15}" font-weight="300" letter-spacing="0.5" fill="${C.text}">${esc(value)}</text>`
  )
}

type Tile = {
  priority: number
  label: string
  value: string
  valueColor: string
  isHot?: boolean
  aside?: string
  sub?: { lead?: string; rest?: string }
  gauge?: { percent: number; color: string }
}

function tiles(snap: Snapshot | null, used: Tokens): Tile[] {
  const out: Tile[] = []
  const percent = snap?.percent
  out.push(
    percent == null
      ? { priority: 0, label: 'Context', value: '--', valueColor: C.muted, sub: { rest: 'waiting for first reply' } }
      : {
          priority: 0,
          label: 'Context',
          value: `${percent}%`,
          valueColor: level(percent),
          isHot: percent >= 70,
          aside: snap?.contextTokens != null ? `${compact(snap.contextTokens)} / ${compact(snap.window)}` : undefined,
          gauge: { percent, color: fill(percent) },
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
      sub: { lead: `${compact(used.input)} in`, rest: used.cacheRead > 0 ? ` / ${compact(used.cacheRead)} cached` : '' },
    })
  }
  for (const limit of snap?.limits ?? []) {
    const p = Math.round(limit.percentUsed)
    out.push({
      priority: 4,
      label: `${LIMIT_NAMES[limit.kind] ?? limit.kind} limit`,
      value: `${p}%`,
      valueColor: level(p),
      isHot: p >= 70,
      gauge: { percent: p, color: fill(p) },
    })
  }
  return out
}

export const TILE_H = 64
const MIN_W = 150
const MAX_W = 220
const GAP = 8
const PAD = 14
const R = 22

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
    g.push(`<rect x="${(x + 0.5).toFixed(1)}" y="0.5" width="${(tileW - 1).toFixed(1)}" height="${TILE_H - 1}" fill="${C.card}" stroke="${t.isHot ? t.valueColor : C.stroke}"/>`)

    if (t.gauge) {
      // A gauge at the left, its label and the aside beside it.
      g.push(gauge(lx + R, TILE_H / 2, R, t.gauge.percent, t.gauge.color, t.value.replace('%', '')))
      const tx = lx + 2 * R + 12
      const room = x + tileW - PAD - tx
      g.push(label(tx, 28, C.muted, `${t.label} %`, room))
      if (t.aside) g.push(`<text x="${tx.toFixed(1)}" y="46" font-size="13" fill="${C.soft}">${esc(fit(t.aside, room, 13 * 0.55))}</text>`)
      return g.join('')
    }

    // A marker and the label, then the value in light numerals, the sub line under.
    g.push(`<rect x="${lx}" y="9" width="2" height="10" fill="${C.text}"/>`)
    g.push(label(lx + 8, 18, C.muted, t.label, inner - 8))
    const size = Math.min(26, inner / Math.max(1, t.value.length * 0.56))
    g.push(`<text x="${lx}" y="44" font-size="${size.toFixed(1)}" font-weight="300" letter-spacing="1" fill="${t.valueColor}">${esc(t.value)}</text>`)
    if (t.aside) {
      const ax = lx + numeralsWidth(t.value, size) + 6
      // The aside shows whole or not at all.
      if (t.aside.length * 7 <= x + tileW - PAD - ax) g.push(`<text x="${ax.toFixed(1)}" y="44" font-size="12" fill="${C.muted}">${esc(t.aside)}</text>`)
    }
    if (t.sub) {
      const lead = t.sub.lead ?? ''
      const whole = fit(lead + (t.sub.rest ?? ''), inner, 11 * 0.55)
      const head = whole.slice(0, lead.length)
      const tail = whole.slice(lead.length)
      const spans = (head ? `<tspan fill="${C.done}">${esc(head)}</tspan>` : '') + (tail ? `<tspan fill="${C.muted}">${esc(tail)}</tspan>` : '')
      g.push(`<text x="${lx}" y="57" font-size="11">${spans}</text>`)
    }
    return g.join('')
  })

  const source = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${TILE_H}" viewBox="0 0 ${W} ${TILE_H}" ${SANS}>${parts.join('')}</svg>`
  const alt = kept.map(t => (t.value === '--' ? `${t.label} ${t.sub?.rest ?? 'not known yet'}` : `${t.label} ${t.value}${t.aside ? ` ${t.aside}` : ''}`)).join(', ')
  return { source, width: W, alt }
}
