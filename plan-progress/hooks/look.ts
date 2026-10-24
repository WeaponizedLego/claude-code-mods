import type { Plan, Step } from '../types'
import { duration, phaseDuration, phaseState, stats } from './plan'

// Dark only: square slate panels on a navy ground, hairline rules, light wide
// numerals. Periwinkle for what is done, one amber for the step under way. An
// SVG is drawn as an image, so it takes real colours, not theme keys; the
// terminal uses the same.
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
  ember: '#3d3220',
  done: '#8b90d6',
  good: '#3fc9b4',
  hot: '#f0605d',
} as const

const SANS = `font-family="Barlow, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif"`

export const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Text in an image cannot wrap or truncate itself: cut it to an estimated width.
const fit = (t: string, px: number, size: number, spacing = 0, upper = false) => {
  const max = Math.max(3, Math.floor(px / (size * (upper ? 0.68 : 0.55) + spacing)))
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}
/** Estimated width of a small uppercase label. */
const labelWidth = (t: string) => t.length * (10 * 0.68 + 1.2)

const text = (x: number, y: number, size: number, fill: string, body: string, extra = '') =>
  `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" ${extra}>${body}</text>`
const label = (x: number, y: number, fill: string, body: string, px: number, extra = '') =>
  text(x, y, 10, fill, esc(fit(body.toUpperCase(), px, 10, 1.2, true)), `letter-spacing="1.2" ${extra}`)
/** A big light numeral, shrunk to fit its room. */
const big = (x: number, y: number, size: number, fill: string, body: string, px: number, extra = '') => {
  const s = Math.max(14, Math.min(size, px / Math.max(1, body.length * 0.56)))
  return text(x, y, Math.round(s), fill, esc(body), `font-weight="300" letter-spacing="1" ${extra}`)
}

const svg = (W: number, H: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" ${SANS}>${body}</svg>`
const card = (y: number, W: number, H: number, stroke: string = C.stroke) =>
  `<rect x="0.5" y="${y + 0.5}" width="${W - 1}" height="${H - 1}" fill="${C.card}" stroke="${stroke}"/>`
const hollow = (y: number, W: number, H: number) =>
  `<rect x="0.5" y="${y + 0.5}" width="${W - 1}" height="${H - 1}" fill="none" stroke="${C.edge}" stroke-dasharray="3 5"/>`
/** The title marker: a short bar in the text colour left of a card's title. */
const marker = (x: number, y: number) => `<rect x="${x}" y="${y}" width="2" height="14" fill="${C.text}"/>`

/** An open arc gauge: a track over 80% of the circle, the value along it, the number inside. */
function gauge(cx: number, cy: number, r: number, percent: number, color: string, under: string): string {
  const circ = 2 * Math.PI * r
  const arc = 0.8 * circ
  const value = (arc * Math.max(0, Math.min(100, percent))) / 100
  const at = `cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke-width="3" transform="rotate(126 ${cx} ${cy})"`
  return (
    `<circle ${at} stroke="${C.edge}" stroke-dasharray="${arc.toFixed(1)} ${circ.toFixed(1)}"/>` +
    (value > 0 ? `<circle ${at} stroke="${color}" stroke-dasharray="${value.toFixed(1)} ${circ.toFixed(1)}"/>` : '') +
    text(cx, cy + 8, 26, C.text, `${Math.round(percent)}`, 'font-weight="300" letter-spacing="1" text-anchor="middle"') +
    text(cx, cy + 24, 8, C.muted, under, 'letter-spacing="1.2" text-anchor="middle"')
  )
}

/** A step's mark: done a periwinkle square, current amber, skipped a dim dash, to come a hollow square. */
function mark(s: Step, x: number, cy: number): string {
  if (s.status === 'done') return `<rect x="${x}" y="${cy - 3}" width="6" height="6" fill="${C.done}"/>`
  if (s.status === 'active') return `<rect x="${x}" y="${cy - 3}" width="6" height="6" fill="${C.accent}"/>`
  if (s.status === 'skipped') return `<rect x="${x}" y="${cy - 0.5}" width="6" height="1" fill="${C.dim}"/>`
  return `<rect x="${x + 0.5}" y="${cy - 2.5}" width="5" height="5" fill="none" stroke="${C.muted}"/>`
}

const plural = (n: number) => `${n} step${n === 1 ? '' : 's'}`

const HEAD_H = 172
const CARD_H = 62
const STEP_H = 24
const GAP = 10

/** The whole pane as one SVG: a summary card, then a card per phase. */
export function planSvg(plan: Plan, now: number, width: number): { source: string; height: number; alt: string } {
  const W = Math.max(300, Math.round(width))
  const s = stats(plan, now)
  const parts: string[] = []
  const steps = plan.phases.flatMap(p => p.steps)
  const phaseNo = Math.min(plan.phases.length, (s.currentPhase ?? plan.phases.length - 1) + 1)

  // ---- the summary card: its name and where the plan is, a gauge, the big numbers, a cell per step
  parts.push(card(0, W, HEAD_H))
  const where = s.isFinished ? 'finished' : `phase ${phaseNo} / ${plan.phases.length}`
  parts.push(label(W - 16, 29, s.isFinished ? C.done : C.muted, where, 120, 'text-anchor="end"'))
  parts.push(marker(16, 17))
  parts.push(text(26, 29, 15, C.text, esc(fit(plan.title, W - 26 - 16 - labelWidth(where) - 16, 15)), 'font-weight="500"'))

  parts.push(gauge(60, 92, 34, s.percent, s.isFinished ? C.done : C.accent, 'DONE %'))

  // Elapsed, what is left (amber: it is the estimate to watch) and the steps closed.
  const cols: { head: string; value: string; color: string }[] = [
    { head: s.isFinished ? 'total' : 'elapsed', value: duration(s.elapsedMs), color: C.text },
    ...(s.isFinished ? [] : [{ head: 'left ~', value: s.remainingMs != null ? `~${duration(s.remainingMs)}` : '--', color: s.remainingMs != null ? C.accent : C.muted }]),
    { head: 'steps', value: `${s.closed}/${s.total}`, color: C.text },
  ]
  const colX = 122
  const colW = (W - colX - 16) / cols.length
  cols.forEach((c, i) => {
    const x = Math.round(colX + i * colW)
    parts.push(label(x, 76, C.muted, c.head, colW - 8))
    parts.push(big(x, 110, 30, c.color, c.value, colW - 10))
  })
  if (!s.isFinished && s.remainingMs == null) parts.push(label(colX, 132, C.muted, 'pace after the first step', W - colX - 16))

  const avail = W - 32
  const n = Math.max(1, steps.length)
  const cell = Math.max(2, Math.min(56, (avail - (n - 1) * 4) / n))
  const gap = n > 1 ? Math.max(0, Math.min(4, (avail - cell * n) / (n - 1))) : 0
  steps.forEach((st, i) => {
    const x = (16 + i * (cell + gap)).toFixed(1)
    const fill = st.status === 'done' ? C.done : st.status === 'active' ? C.accent : st.status === 'skipped' ? C.stroke : C.edge
    parts.push(`<rect x="${x}" y="148" width="${cell.toFixed(1)}" height="6" fill="${fill}"/>`)
  })

  // ---- the phase cards; long plans fold the old and the far
  let y = HEAD_H + GAP
  const current = s.currentPhase ?? -1
  const shown = plan.phases.map((_, i) => current < 0 || (i >= current - 2 && i <= current + 3))
  const before = shown.indexOf(true)
  const after = plan.phases.length - 1 - shown.lastIndexOf(true)
  const fold = (what: string) => {
    parts.push(hollow(y, W, 34))
    parts.push(text(W / 2, y + 21, 12, C.muted, esc(fit(what, W - 32, 12)), 'text-anchor="middle"'))
    y += 34 + GAP
  }
  if (before > 0) fold(`${before} earlier phase${before > 1 ? 's' : ''} done`)

  plan.phases.forEach((p, pi) => {
    if (!shown[pi]) return
    const state = phaseState(p)
    const isNow = state === 'active' || (state === 'pending' && pi === current)
    const h = isNow ? 74 + p.steps.length * STEP_H : CARD_H
    const closed = p.steps.filter(x => x.status === 'done' || x.status === 'skipped').length
    const took = phaseDuration(plan, pi, now)

    parts.push(card(y, W, h, isNow ? C.accent : C.stroke))

    // Top right: a periwinkle square when done, ACTIVE under way, a dash per step to come.
    let rightW = 0
    if (state === 'done') {
      parts.push(`<rect x="${W - 24}" y="${y + 21}" width="8" height="8" fill="${C.done}"/>`)
      rightW = 16
    } else if (isNow) {
      parts.push(label(W - 16, y + 29, C.accent, 'active', 80, 'text-anchor="end"'))
      rightW = labelWidth('active')
    } else {
      const k = Math.min(8, p.steps.length)
      for (let i = 0; i < k; i++) parts.push(`<rect x="${W - 16 - (k - i) * 26 + 4}" y="${y + 23}" width="22" height="4" fill="${C.edge}"/>`)
      rightW = k * 26
    }

    // "01 Setup": the number in the phase's colour, then its name.
    const numColor = state === 'done' ? C.done : isNow ? C.accent : C.muted
    parts.push(text(16, y + 29, 15, numColor, String(pi + 1).padStart(2, '0'), 'font-weight="500"'))
    parts.push(text(42, y + 29, 15, C.text, esc(fit(p.title, W - 42 - 16 - rightW - 12, 15)), 'font-weight="500"'))

    const sub = state === 'done' ? `${plural(p.steps.length)} done` : state === 'pending' && !isNow ? `${plural(p.steps.length)} to go` : `${closed} of ${plural(p.steps.length)}`
    const tookText = took != null ? duration(took) : ''
    parts.push(text(16, y + 48, 12, C.muted, esc(fit(sub, W - 32 - tookText.length * 7 - 12, 12))))
    if (tookText) parts.push(text(W - 16, y + 48, 12, C.muted, tookText, 'text-anchor="end"'))

    // The phase under way lists its steps under a rule, each with its mark.
    if (isNow) {
      parts.push(`<line x1="16" y1="${y + 62.5}" x2="${W - 16}" y2="${y + 62.5}" stroke="${C.stroke}"/>`)
      p.steps.forEach((st, si) => {
        const cy = y + 82 + si * STEP_H
        parts.push(mark(st, 16, cy))
        const color = st.status === 'active' ? C.text : st.status === 'skipped' ? C.dim : C.muted
        const deco = st.status === 'skipped' ? ' text-decoration="line-through"' : ''
        const weight = st.status === 'active' ? ' font-weight="500"' : ''
        parts.push(text(34, cy + 4.5, 13, color, esc(fit(st.title, W - 34 - 72, 13)), `${weight}${deco}`.trim()))
        if (st.startedAt != null && st.status !== 'skipped') {
          parts.push(text(W - 16, cy + 4.5, 12, st.status === 'active' ? C.accent : C.muted, duration((st.endedAt ?? now) - st.startedAt), 'text-anchor="end"'))
        }
      })
    }
    y += h + GAP
  })
  if (after > 0) fold(`${after} more phase${after > 1 ? 's' : ''} after this`)

  const height = Math.round(y - GAP)
  const active = steps.find(x => x.status === 'active')
  const alt =
    `${plan.title}: ${s.percent}% done, ${s.closed} of ${s.total} steps, ` +
    (s.isFinished
      ? `finished in ${duration(s.elapsedMs)}`
      : `phase ${phaseNo} of ${plan.phases.length}, ${duration(s.elapsedMs)} in${s.remainingMs != null ? `, about ${duration(s.remainingMs)} left` : ''}${active ? `. Current step: ${active.title}` : ''}`)
  return { source: svg(W, height, parts.join('')), height, alt }
}

export function emptySvg(width: number): { source: string; height: number } {
  const W = Math.max(300, Math.round(width))
  const H = 100
  const body =
    hollow(0, W, H) +
    big(16, 44, 26, C.muted, 'No plan', W - 32) +
    text(16, 66, 12, C.muted, esc(fit('Approve a plan in plan mode,', W - 32, 12))) +
    text(16, 83, 12, C.muted, esc(fit('or ask Claude to lay it out in phases', W - 32, 12)))
  return { source: svg(W, H, body), height: H }
}
