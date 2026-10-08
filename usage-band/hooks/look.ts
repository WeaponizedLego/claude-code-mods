import type { Snapshot, Tokens } from '../types'

// The palette: dark violet cards with a lilac accent, orange and red for the
// levels to watch. An SVG is drawn as an image, so it takes real colours, not
// theme keys; the terminal uses the same.
export const C = {
  card: '#23222b',
  stroke: '#363541',
  text: '#ececf1',
  soft: '#c9c7d3',
  muted: '#8e8c9a',
  dim: '#5f5d6b',
  accent: '#a98bff',
  glow: '#c4b2ff',
  track: '#3b3650',
  warn: '#ff8a4c',
  hot: '#ff5c7a',
} as const

// Lilac while there is room, orange from 70%, red past 80%.
export const level = (percent: number): string => (percent > 80 ? C.hot : percent >= 70 ? C.warn : C.accent)

export const compact = (n: number): string => {
  if (n < 1000) return `${n}`
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

export const dollars = (usd: number): string => `$${usd < 10 ? usd.toFixed(2) : usd.toFixed(1)}`

export const LIMIT_NAMES: Record<string, string> = { five_hour: '5h', seven_day: '7d', spend_limit: 'spend' }

const FONT = `font-family="Inter, 'Segoe UI', system-ui, -apple-system, sans-serif"`
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

type Tile = {
  priority: number
  label: string
  value: string
  valueColor: string
  aside?: string
  sub?: { lead?: string; rest?: string }
  pills?: { filled: number; color: string }
}

const PILLS = 10

// What a run of text measures at a font size, near enough to place the next one.
const measure = (t: string, size: number) =>
  [...t].reduce((w, ch) => w + (/[.,: ]/.test(ch) ? 0.3 : /[%$]/.test(ch) ? 0.8 : /[0-9]/.test(ch) ? 0.6 : 0.56), 0) * size

function tiles(snap: Snapshot | null, used: Tokens): Tile[] {
  const out: Tile[] = []
  const percent = snap?.percent
  out.push(
    percent == null
      ? { priority: 0, label: 'Context', value: '—', valueColor: C.muted, sub: { rest: 'waiting for first reply' } }
      : {
          priority: 0,
          label: 'Context',
          value: `${percent}%`,
          valueColor: level(percent),
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
      pills: { filled: Math.min(PILLS, Math.round(p / (100 / PILLS))), color: level(p) },
    })
  }
  return out
}

export const TILE_H = 60
const MIN_W = 118
const MAX_W = 200
const GAP = 8

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

  const parts = kept.map((t, i) => {
    const x = i * (tileW + GAP)
    const g: string[] = []
    g.push(`<rect x="${(x + 0.5).toFixed(1)}" y="0.5" width="${(tileW - 1).toFixed(1)}" height="${TILE_H - 1}" rx="12" fill="${i === 0 ? 'url(#glow)' : C.card}" stroke="${C.stroke}"/>`)
    g.push(`<text x="${x + 12}" y="17" font-size="10.5" fill="${C.muted}">${esc(t.label)}</text>`)
    g.push(`<text x="${x + 12}" y="38" font-size="19" font-weight="600" fill="${t.valueColor}" letter-spacing="-0.3">${esc(t.value)}</text>`)
    if (t.aside) {
      g.push(`<text x="${(x + 12 + measure(t.value, 19) + 5).toFixed(1)}" y="37" font-size="10.5" fill="${C.muted}">${esc(t.aside)}</text>`)
    }
    if (t.pills) {
      const pw = (tileW - 24 - (PILLS - 1) * 3) / PILLS
      for (let k = 0; k < PILLS; k++) {
        const fill = k < t.pills.filled ? t.pills.color : C.track
        g.push(`<rect x="${(x + 12 + k * (pw + 3)).toFixed(1)}" y="45" width="${pw.toFixed(1)}" height="6" rx="3" fill="${fill}"/>`)
      }
    } else if (t.sub) {
      const lead = t.sub.lead ? `<tspan fill="${C.accent}" font-weight="600">${esc(t.sub.lead)}</tspan>` : ''
      const rest = t.sub.rest ? `<tspan fill="${C.muted}">${esc(t.sub.rest)}</tspan>` : ''
      g.push(`<text x="${x + 12}" y="51" font-size="10">${lead}${rest}</text>`)
    }
    return g.join('')
  })

  const defs = `<defs><radialGradient id="glow" cx="0.15" cy="1" r="1.1"><stop offset="0" stop-color="#3d3260"/><stop offset="1" stop-color="${C.card}"/></radialGradient></defs>`
  const source = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${TILE_H}" viewBox="0 0 ${W} ${TILE_H}" ${FONT}>${defs}${parts.join('')}</svg>`
  const alt = kept.map(t => `${t.label} ${t.value}${t.aside ? ` ${t.aside}` : ''}`).join(', ')
  return { source, width: W, alt }
}
