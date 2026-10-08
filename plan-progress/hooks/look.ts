import type { Plan, Step } from '../types'
import { duration, phaseDuration, phaseState, stats } from './plan'

// The palette: dark violet cards with a lilac accent. An SVG is drawn as an
// image, so it takes real colours, not theme keys; the terminal uses the same.
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
} as const

const FONT = `font-family="Inter, 'Segoe UI', system-ui, -apple-system, sans-serif"`

export const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Text in an image cannot wrap or truncate itself: cut it to an estimated width.
const fit = (t: string, px: number, size: number) => {
  const max = Math.max(3, Math.floor(px / (size * 0.52)))
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

const text = (x: number, y: number, size: number, fill: string, body: string, extra = '') =>
  `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" ${extra}>${body}</text>`

const clock = (x: number, y: number) =>
  `<g transform="translate(${x} ${y})" fill="none" stroke="${C.soft}" stroke-width="1.2"><circle cx="5" cy="5" r="4.5"/><path d="M5 2.6V5l1.7 1.1"/></g>`

const check = (cx: number, cy: number, r: number) =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${C.accent}"/><path d="M${cx - r * 0.45} ${cy}l${r * 0.32} ${r * 0.34} ${r * 0.6}-${r * 0.68}" fill="none" stroke="${C.card}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`

function stepDot(s: Step, cx: number, cy: number, r: number): string {
  if (s.status === 'done') return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${C.accent}"/>`
  if (s.status === 'active') return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${C.deep}" stroke="${C.glow}" stroke-width="1.2"/>`
  if (s.status === 'skipped') return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${C.dim}"/>`
  return `<circle cx="${cx}" cy="${cy}" r="${r - 0.6}" fill="none" stroke="${C.dim}" stroke-width="1.2"/>`
}

const HEADER_H = 162
const CARD_H = 60
const STEP_H = 22
const GAP = 10

/** The whole pane as one SVG: a summary card, then a card per phase. */
export function planSvg(plan: Plan, now: number, width: number): { source: string; height: number; alt: string } {
  const W = Math.max(300, Math.round(width))
  const s = stats(plan, now)
  const parts: string[] = []
  const steps = plan.phases.flatMap(p => p.steps)
  const phaseNo = Math.min(plan.phases.length, (s.currentPhase ?? plan.phases.length - 1) + 1)

  // ---- the summary card
  parts.push(`<rect x="0.5" y="0.5" width="${W - 1}" height="${HEADER_H - 1}" rx="16" fill="${C.card}" stroke="${C.stroke}"/>`)
  parts.push(`<circle cx="32" cy="32" r="14" fill="${C.text}"/>`)
  parts.push(`<g fill="${C.card}"><rect x="25" y="32" width="3" height="6" rx="1.5"/><rect x="30.5" y="27" width="3" height="11" rx="1.5"/><rect x="36" y="29.5" width="3" height="8.5" rx="1.5"/></g>`)
  const chip = s.isFinished ? 'Finished' : `Phase ${phaseNo}/${plan.phases.length}`
  const chipW = Math.round(chip.length * 6.4 + 24)
  parts.push(`<rect x="${W - 18 - chipW}" y="19" width="${chipW}" height="26" rx="13" fill="${C.raised}" stroke="${C.stroke}"/>`)
  parts.push(text(W - 18 - chipW / 2, 36, 11.5, C.soft, esc(chip), 'text-anchor="middle"'))
  parts.push(text(56, 37, 14.5, C.text, esc(fit(plan.title, W - 56 - chipW - 30, 14.5)), 'font-weight="600"'))

  parts.push(text(18, 94, 36, C.text, `${s.percent}%`, 'font-weight="500" letter-spacing="-0.5"'))
  const lead = s.isFinished ? `in ${duration(s.elapsedMs)}` : s.remainingMs != null ? `~${duration(s.remainingMs)} left` : 'pace after the first step'
  const rest = s.isFinished ? ` · ${s.total} steps` : ` · ${duration(s.elapsedMs)} in · ${s.closed}/${s.total} steps`
  parts.push(`<text x="18" y="118" font-size="12"><tspan fill="${C.accent}" font-weight="600">${esc(lead)}</tspan><tspan fill="${C.muted}">${esc(rest)}</tspan></text>`)

  // One rounded cell per step, as a heat map row: filled done, glowing current, hatched to come.
  const avail = W - 36
  const cell = Math.max(4, Math.min(56, (avail - (steps.length - 1) * 5) / Math.max(1, steps.length)))
  const gap = steps.length > 1 ? Math.min(5, (avail - cell * steps.length) / (steps.length - 1)) : 0
  steps.forEach((st, i) => {
    const x = 18 + i * (cell + gap)
    const fill = st.status === 'done' ? C.accent : st.status === 'active' ? C.deep : st.status === 'skipped' ? C.dim : 'url(#hatch)'
    const stroke = st.status === 'active' ? ` stroke="${C.glow}" stroke-width="1.2"` : ''
    parts.push(`<rect x="${x.toFixed(1)}" y="130" width="${cell.toFixed(1)}" height="18" rx="${Math.min(5, cell / 3).toFixed(1)}" fill="${fill}"${stroke}/>`)
  })

  // ---- the phase cards; long plans fold the old and the far
  let y = HEADER_H + GAP
  const current = s.currentPhase ?? -1
  const shown = plan.phases.map((_, i) => current < 0 || (i >= current - 2 && i <= current + 3))
  const before = shown.indexOf(true)
  const after = plan.phases.length - 1 - shown.lastIndexOf(true)
  const fold = (label: string) => {
    parts.push(`<rect x="0.5" y="${y + 0.5}" width="${W - 1}" height="34" rx="12" fill="none" stroke="${C.stroke}" stroke-dasharray="4 4"/>`)
    parts.push(text(W / 2, y + 22, 11.5, C.muted, esc(label), 'text-anchor="middle"'))
    y += 34 + GAP
  }
  if (before > 0) fold(`${before} earlier phase${before > 1 ? 's' : ''} done`)

  plan.phases.forEach((p, pi) => {
    if (!shown[pi]) return
    const state = phaseState(p)
    const isNow = state === 'active' || (state === 'pending' && pi === current)
    const h = isNow ? 50 + p.steps.length * STEP_H + 8 : CARD_H
    const closed = p.steps.filter(x => x.status === 'done' || x.status === 'skipped').length
    const took = phaseDuration(plan, pi, now)

    parts.push(
      isNow
        ? `<rect x="0.5" y="${y + 0.5}" width="${W - 1}" height="${h - 1}" rx="14" fill="url(#now)" stroke="${C.deep}"/>`
        : `<rect x="0.5" y="${y + 0.5}" width="${W - 1}" height="${h - 1}" rx="14" fill="${C.raised}" stroke="${C.stroke}"/>`,
    )
    if (state === 'done') parts.push(check(W - 24, y + 20, 8))
    else {
      // Step dots, right to left, like the avatars on an event card.
      const dots = p.steps.slice(0, 12)
      dots.forEach((st, i) => parts.push(stepDot(st, W - 20 - (dots.length - 1 - i) * 13, y + 20, 4)))
    }

    const titleColor = state === 'pending' && !isNow ? C.soft : C.text
    parts.push(
      `<text x="16" y="${y + 25}" font-size="13.5" font-weight="600"><tspan fill="${C.muted}">${pi + 1}  </tspan><tspan fill="${titleColor}">${esc(fit(p.title, W - 60 - Math.min(12, p.steps.length) * 13, 13.5))}</tspan></text>`,
    )
    const sub = state === 'done' ? `${p.steps.length} step${p.steps.length > 1 ? 's' : ''} done` : state === 'pending' && !isNow ? `${p.steps.length} step${p.steps.length > 1 ? 's' : ''} to go` : `${closed} of ${p.steps.length} steps`
    parts.push(text(16, y + 43, 11, C.muted, esc(sub)))
    if (took != null) {
      const label = duration(took)
      parts.push(clock(W - 22 - label.length * 6.2 - 14, y + 34))
      parts.push(text(W - 18, y + 43, 11, C.soft, esc(label), 'text-anchor="end"'))
    }

    if (isNow) {
      p.steps.forEach((st, si) => {
        const sy = y + 50 + si * STEP_H + 14
        parts.push(stepDot(st, 22, sy - 4, 4.5))
        const color = st.status === 'active' ? C.text : st.status === 'done' ? C.soft : C.muted
        const deco = st.status === 'skipped' ? ' text-decoration="line-through"' : ''
        const weight = st.status === 'active' ? ' font-weight="600"' : ''
        parts.push(text(36, sy, 12, color, esc(fit(st.title, W - 100, 12)), `${weight}${deco}`))
        if (st.startedAt != null && st.status !== 'skipped') {
          parts.push(text(W - 18, sy, 11, st.status === 'active' ? C.accent : C.muted, duration((st.endedAt ?? now) - st.startedAt), 'text-anchor="end"'))
        }
      })
    }
    y += h + GAP
  })
  if (after > 0) fold(`${after} more phase${after > 1 ? 's' : ''} after this`)

  const height = Math.round(y - GAP)
  const defs =
    `<defs>` +
    `<pattern id="hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" fill="${C.track}"/><rect width="2" height="5" fill="#4a4463"/></pattern>` +
    `<linearGradient id="now" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3d3260"/><stop offset="1" stop-color="${C.raised}"/></linearGradient>` +
    `</defs>`
  const source = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${height}" viewBox="0 0 ${W} ${height}" ${FONT}>${defs}${parts.join('')}</svg>`

  const alt = `${plan.title}: ${s.percent}% done, ${s.closed} of ${s.total} steps, ${s.isFinished ? `finished in ${duration(s.elapsedMs)}` : `phase ${phaseNo} of ${plan.phases.length}, ${duration(s.elapsedMs)} in${s.remainingMs != null ? `, about ${duration(s.remainingMs)} left` : ''}`}`
  return { source, height, alt }
}

export function emptySvg(width: number): { source: string; height: number } {
  const W = Math.max(300, Math.round(width))
  const H = 92
  const source =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" ${FONT}>` +
    `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="16" fill="${C.card}" stroke="${C.stroke}" stroke-dasharray="4 4"/>` +
    text(20, 38, 14, C.text, 'No plan yet', 'font-weight="600"') +
    text(20, 60, 11.5, C.muted, esc(fit('Approve a plan in plan mode, or ask Claude to lay a long task out in phases.', W - 40, 11.5))) +
    `</svg>`
  return { source, height: H }
}
