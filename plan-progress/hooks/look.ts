import type { Plan, Step } from '../types'
import { duration, phaseDuration, phaseState, stats } from './plan'

// Dark only: near-black cards on a warm black, ivory for what is done, one
// orange for the step under way. An SVG is drawn as an image, so it takes real
// colours, not theme keys; the terminal uses the same.
export const C = {
  card: '#1a1a19',
  stroke: '#262523',
  edge: '#3a3936',
  text: '#eceae6',
  soft: '#c9c6c0',
  muted: '#9a9690',
  dim: '#5c5955',
  accent: '#fc5220',
  ember: '#3a1a10',
} as const

const MONO = `font-family="'SF Mono', 'JetBrains Mono', Menlo, ui-monospace, monospace"`

export const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Text in an image cannot wrap or truncate itself: cut it to an estimated monospace width.
const fit = (t: string, px: number, size: number, spacing = 0) => {
  const max = Math.max(3, Math.floor(px / (size * 0.6 + spacing)))
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}
/** Estimated width of a small uppercase label. */
const labelWidth = (t: string) => t.length * 6.8

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
  '%': '##..# ##..# ...#. ..#.. .#... #..## #..##',
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
const card = (y: number, W: number, H: number, stroke: string = C.stroke) =>
  `<rect x="0.5" y="${y + 0.5}" width="${W - 1}" height="${H - 1}" rx="16" fill="${C.card}" stroke="${stroke}"/>`
const hollow = (y: number, W: number, H: number) =>
  `<rect x="0.5" y="${y + 0.5}" width="${W - 1}" height="${H - 1}" rx="16" fill="none" stroke="${C.edge}" stroke-dasharray="3 5"/>`

const check = (cx: number, cy: number, r: number) =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${C.text}"/><path d="M${cx - r * 0.45} ${cy}l${r * 0.32} ${r * 0.34} ${r * 0.6}-${r * 0.68}" fill="none" stroke="${C.card}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`

/** A stop on a track: done ivory, current orange on an ember halo, skipped a small dim dot, to come hollow. */
function stop(s: Step, cx: number, cy: number, r: number): string {
  const at = `cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}"`
  if (s.status === 'done') return `<circle ${at} r="${r}" fill="${C.text}"/>`
  if (s.status === 'active') return `<circle ${at} r="${(r * 1.7).toFixed(1)}" fill="${C.ember}"/><circle ${at} r="${r}" fill="${C.accent}"/>`
  if (s.status === 'skipped') return `<circle ${at} r="${(r * 0.6).toFixed(1)}" fill="${C.dim}"/>`
  return `<circle ${at} r="${(r * 0.9).toFixed(1)}" fill="${C.card}" stroke="${C.dim}"/>`
}

const plural = (n: number) => `${n} step${n === 1 ? '' : 's'}`

const HEAD_H = 140
const CARD_H = 58
const STEP_H = 24
const GAP = 10

/** The whole pane as one SVG: a summary card, then a card per phase. */
export function planSvg(plan: Plan, now: number, width: number): { source: string; height: number; alt: string } {
  const W = Math.max(300, Math.round(width))
  const s = stats(plan, now)
  const parts: string[] = []
  const steps = plan.phases.flatMap(p => p.steps)
  const phaseNo = Math.min(plan.phases.length, (s.currentPhase ?? plan.phases.length - 1) + 1)

  // ---- the summary card: where the plan is, its name, the big numbers, a cell per step
  parts.push(card(0, W, HEAD_H))
  const where = s.isFinished ? 'finished' : `phase ${phaseNo}/${plan.phases.length}`
  parts.push(label(16, 26, C.muted, where, W - 32))
  if (!s.isFinished) {
    const lead = s.remainingMs != null ? `~${duration(s.remainingMs)} left` : 'pace after the first step'
    parts.push(label(W - 16, 26, C.soft, lead, W - 32 - labelWidth(where) - 16, 'text-anchor="end"'))
  }
  parts.push(text(16, 50, 14, C.text, esc(fit(plan.title, W - 32, 14)), 'font-weight="600"'))

  const percent = `${s.percent}%`
  parts.push(dots(percent, 16, 62, 4, C.text))
  const sx = 16 + Math.max(dotsWidth(percent, 4), labelWidth('done')) + 22
  const count = `${s.closed}/${s.total}`
  parts.push(dots(count, sx, 69, 3, C.soft))
  parts.push(label(16, 106, C.muted, 'done', 80))
  parts.push(label(sx, 106, C.muted, 'steps', 80))
  const rx = sx + Math.max(dotsWidth(count, 3), labelWidth('steps')) + 16
  parts.push(label(W - 16, 106, C.muted, `${duration(s.elapsedMs)} ${s.isFinished ? 'total' : 'in'}`, W - 16 - rx, 'text-anchor="end"'))

  const avail = W - 32
  const n = Math.max(1, steps.length)
  const cell = Math.max(2, Math.min(56, (avail - (n - 1) * 6) / n))
  const gap = n > 1 ? Math.max(0, Math.min(6, (avail - cell * n) / (n - 1))) : 0
  steps.forEach((st, i) => {
    const x = 16 + i * (cell + gap)
    const box = (dx: number, fill: string, extra = '') =>
      `<rect x="${(x - dx).toFixed(1)}" y="${120 - dx}" width="${(cell + dx * 2).toFixed(1)}" height="${6 + dx * 2}" rx="${3 + dx}" fill="${fill}"${extra}/>`
    if (st.status === 'done') parts.push(box(0, C.text))
    else if (st.status === 'active') parts.push(box(3, C.ember) + box(0, C.accent))
    else if (st.status === 'skipped') parts.push(box(0, C.dim))
    else parts.push(box(0, 'none', ` stroke="${C.dim}" stroke-dasharray="2 3"`))
  })

  // ---- the phase cards; long plans fold the old and the far
  let y = HEAD_H + GAP
  const current = s.currentPhase ?? -1
  const shown = plan.phases.map((_, i) => current < 0 || (i >= current - 2 && i <= current + 3))
  const before = shown.indexOf(true)
  const after = plan.phases.length - 1 - shown.lastIndexOf(true)
  const fold = (what: string) => {
    parts.push(hollow(y, W, 34))
    parts.push(label(W / 2, y + 21, C.muted, what, W - 32, 'text-anchor="middle"'))
    y += 34 + GAP
  }
  if (before > 0) fold(`${before} earlier phase${before > 1 ? 's' : ''} done`)

  plan.phases.forEach((p, pi) => {
    if (!shown[pi]) return
    const state = phaseState(p)
    const isNow = state === 'active' || (state === 'pending' && pi === current)
    const h = isNow ? 60 + p.steps.length * STEP_H : CARD_H
    const closed = p.steps.filter(x => x.status === 'done' || x.status === 'skipped').length
    const took = phaseDuration(plan, pi, now)

    parts.push(card(y, W, h, isNow ? C.accent : C.stroke))

    // Top right: a check when the phase is done, else a stop per step.
    const mini = p.steps.slice(0, 12)
    const miniW = state === 'done' ? 24 : mini.length * 14
    if (state === 'done') parts.push(check(W - 24, y + 22, 8))
    else mini.forEach((st, i) => parts.push(stop(st, W - 22 - (mini.length - 1 - i) * 14, y + 22, 4)))

    // "01  SETUP": the number, orange on the phase under way, then its name.
    parts.push(text(16, y + 26, 11, isNow ? C.accent : C.muted, String(pi + 1).padStart(2, '0'), 'letter-spacing="0.8"'))
    const titleColor = state === 'pending' && !isNow ? C.soft : C.text
    parts.push(text(42, y + 26, 11, titleColor, esc(fit(p.title.toUpperCase(), W - 42 - 16 - miniW - 12, 11, 0.8)), 'font-weight="700" letter-spacing="0.8"'))

    const sub = state === 'done' ? `${plural(p.steps.length)} done` : state === 'pending' && !isNow ? `${plural(p.steps.length)} to go` : `${closed} of ${plural(p.steps.length)}`
    const tookText = took != null ? duration(took) : ''
    parts.push(label(16, y + 44, C.muted, sub, W - 32 - labelWidth(tookText) - 12))
    if (tookText) parts.push(label(W - 16, y + 44, C.soft, tookText, 120, 'text-anchor="end"'))

    // The phase under way lists its steps on a vertical track.
    if (isNow) {
      const cy = (si: number) => y + 66 + si * STEP_H
      if (p.steps.length > 1) parts.push(`<line x1="24" y1="${cy(0)}" x2="24" y2="${cy(p.steps.length - 1)}" stroke="${C.edge}" stroke-dasharray="2 4"/>`)
      p.steps.forEach((st, si) => {
        parts.push(stop(st, 24, cy(si), 5))
        const color = st.status === 'active' ? C.text : st.status === 'done' ? C.soft : st.status === 'skipped' ? C.dim : C.muted
        const deco = st.status === 'skipped' ? ' text-decoration="line-through"' : ''
        const weight = st.status === 'active' ? ' font-weight="600"' : ''
        parts.push(text(42, cy(si) + 4, 12, color, esc(fit(st.title, W - 42 - 72, 12)), `${weight}${deco}`.trim()))
        if (st.startedAt != null && st.status !== 'skipped') {
          parts.push(text(W - 16, cy(si) + 4, 11, st.status === 'active' ? C.accent : C.muted, duration((st.endedAt ?? now) - st.startedAt), 'text-anchor="end"'))
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
    dots('NO PLAN', 16, 18, 3, C.dim) +
    label(16, 64, C.muted, 'Approve a plan in plan mode,', W - 32) +
    label(16, 80, C.muted, 'or ask Claude to lay it out in phases', W - 32)
  return { source: svg(W, H, body), height: H }
}
