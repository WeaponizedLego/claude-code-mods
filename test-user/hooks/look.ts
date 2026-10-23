import type { Run, RunStatus, Severity, Task, TaskStatus } from '../types'
import { STATUS_LABEL, SEVERITIES, bySeverity, duration, historyLine, plural, stats } from './run'

// Dark only, as control-tower: near-black cards on a warm black, one orange for
// what needs a look or is going on now; done is ivory, not a colour. An SVG is
// drawn as an image, so it takes real colours; the terminal uses the same.
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
  ember: '#3a1a10',
  // What needs a look is the accent; a major finding sits between it and ivory.
  hot: '#fc5220',
  warn: '#f2a65a',
} as const

export const SEVERITY_COLOR: Record<Severity, string> = { blocker: C.hot, major: C.warn, minor: C.text, polish: C.muted }
export const STATUS_COLOR: Record<RunStatus, string> = { running: C.accent, passed: C.text, issues: C.accent, blocked: C.hot, failed: C.hot }
export const TASK_COLOR: Record<TaskStatus, string> = { pending: C.dim, active: C.accent, passed: C.text, failed: C.hot, skipped: C.dim }
export const TASK_GLYPH: Record<TaskStatus, string> = { pending: '○', active: '●', passed: '✓', failed: '✗', skipped: '–' }

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
// Small labels: uppercase, 10px, spaced out.
const LABEL_CH = 10 * 0.6 + 0.8
const labelW = (s: string) => s.length * LABEL_CH
const label = (x: number, y: number, fill: string, body: string, px: number, extra = '') =>
  text(x, y, 10, fill, esc(fit(body.toUpperCase(), px, 10, 0.8)), `letter-spacing="0.8" ${extra}`)

// A 5×7 dot-matrix face for headings and big numbers, drawn as circles (as in control-tower).
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
const cardAt = (W: number, y: number, h: number, stroke: string = C.stroke) =>
  `<rect x="0.5" y="${y + 0.5}" width="${W - 1}" height="${h - 1}" rx="16" fill="${C.card}" stroke="${stroke}"/>`

// Done is ivory with a check, failed orange with a cross, current orange in an
// ember halo, to come a dashed ring; skipped a dim ring struck through.
function taskDot(t: Task, cx: number, cy: number, r: number): string {
  if (t.status === 'passed') {
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${C.text}"/><path d="M${cx - r * 0.45} ${cy}l${r * 0.32} ${r * 0.34} ${r * 0.6}-${r * 0.68}" fill="none" stroke="${C.card}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`
  }
  if (t.status === 'failed') {
    const d = r * 0.42
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${C.hot}"/><path d="M${cx - d} ${cy - d}l${2 * d} ${2 * d}M${cx + d} ${cy - d}l-${2 * d} ${2 * d}" stroke="${C.card}" stroke-width="1.5" stroke-linecap="round"/>`
  }
  if (t.status === 'active') return `<circle cx="${cx}" cy="${cy}" r="${r + 3.5}" fill="${C.ember}"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="${C.accent}"/>`
  if (t.status === 'skipped') {
    return `<circle cx="${cx}" cy="${cy}" r="${r - 0.6}" fill="none" stroke="${C.dim}"/><path d="M${cx - r * 0.5} ${cy}h${r}" stroke="${C.dim}" stroke-linecap="round"/>`
  }
  return `<circle cx="${cx}" cy="${cy}" r="${r - 0.6}" fill="none" stroke="${C.dim}" stroke-dasharray="2 3"/>`
}

const GAP = 10
const HEADER_H = 144
const TASK_H = 24

/** The whole pane as one SVG: a summary card, the tasks, then a card per finding. */
export function runSvg(runs: Run[], now: number, width: number): { source: string; height: number; alt: string } {
  const W = Math.max(300, Math.round(width))
  const run = runs[0]!
  const s = stats(run, now)
  const parts: string[] = []
  const tone = STATUS_COLOR[run.status]
  const isRunning = run.status === 'running'

  // ---- the summary card: orange edged when the run failed or found a blocker
  parts.push(cardAt(W, 0, HEADER_H, run.failure || s.counts.blocker ? C.accent : C.stroke))
  if (isRunning) parts.push(`<circle cx="22" cy="24" r="8.5" fill="${C.ember}"/>`)
  parts.push(`<circle cx="22" cy="24" r="5" fill="${tone}"/>`)
  const chip = STATUS_LABEL[run.status]
  const chipW = labelW(chip)
  parts.push(label(W - 16, 28, tone, chip, chipW + 4, 'text-anchor="end" font-weight="700"'))
  parts.push(text(38, 28, 13.5, C.text, esc(fit(run.target ?? run.brief, W - 38 - 16 - chipW - 14, 13.5)), 'font-weight="600"'))
  const scope = run.scope === 'app' ? 'Whole app' : run.scope === 'feature' ? 'Feature' : 'Scope pending'
  parts.push(label(38, 46, C.muted, `${scope} · by ${run.tester}`, W - 38 - 16))

  // The hero: tasks passed out of all, in dot-matrix; orange once one failed.
  const hero = `${s.passed}/${s.total || '-'}`
  const pitch = 3.6
  parts.push(dots(hero, 16, 62, pitch, s.failed ? C.accent : C.text))
  const unitX = 16 + dotsWidth(hero, pitch) + 10

  // Severity counters, right of the hero, where there is room for them: a blocker
  // is a filled tag, the rest outlined in their colour, none a dashed ring.
  let sx = W - 16
  for (const sev of W >= 480 ? [...SEVERITIES].reverse() : []) {
    const n = s.counts[sev]
    const tag = `${n} ${sev}`.toUpperCase()
    const w = Math.round(labelW(tag) + 16)
    sx -= w
    const color = SEVERITY_COLOR[sev]
    if (n && sev === 'blocker') parts.push(`<rect x="${sx}" y="64" width="${w}" height="20" rx="10" fill="${color}"/>`)
    else if (n) parts.push(`<rect x="${sx + 0.5}" y="64.5" width="${w - 1}" height="19" rx="9.5" fill="none" stroke="${color}"/>`)
    else parts.push(`<rect x="${sx + 0.5}" y="64.5" width="${w - 1}" height="19" rx="9.5" fill="none" stroke="${C.dim}" stroke-dasharray="2 3"/>`)
    const fill = !n ? C.dim : sev === 'blocker' ? C.ground : color
    parts.push(text(sx + w / 2, 78, 10, fill, esc(tag), `text-anchor="middle" letter-spacing="0.8"${n ? ' font-weight="700"' : ''}`))
    sx -= 6
  }
  if (sx - unitX >= labelW('passed') + 8) parts.push(label(unitX, 87, C.muted, 'passed', labelW('passed') + 4))

  const lead = (run.findings.length ? plural(run.findings.length, 'finding') : isRunning ? 'nothing found yet' : 'nothing found').toUpperCase()
  const leadColor = s.counts.blocker ? C.hot : s.counts.major ? C.warn : C.text
  const rest = ` · ${s.failed ? `${s.failed} failed · ` : ''}${duration(s.elapsedMs)}${isRunning ? ' in' : ''}`.toUpperCase()
  const room = chars(W - 32, 10, 0.8)
  const leadFit = fit(lead, W - 32, 10, 0.8)
  const restFit = room - leadFit.length >= 6 ? fit(rest, (room - leadFit.length) * LABEL_CH, 10, 0.8) : ''
  parts.push(
    `<text x="16" y="106" font-size="10" letter-spacing="0.8"><tspan fill="${leadColor}" font-weight="700">${esc(leadFit)}</tspan><tspan fill="${C.muted}">${esc(restFit)}</tspan></text>`,
  )

  // One bar per task: ivory passed, orange failed, orange in a halo current, dashed to come.
  const cellsY = 122
  if (run.tasks.length) {
    const n = run.tasks.length
    const gap = 6
    const cell = Math.max(3, (W - 32 - gap * (n - 1)) / n)
    run.tasks.forEach((t, i) => {
      const x = (16 + i * (cell + gap)).toFixed(1)
      const w = cell.toFixed(1)
      if (t.status === 'active') {
        parts.push(`<rect x="${(16 + i * (cell + gap) - 3).toFixed(1)}" y="${cellsY - 3}" width="${(cell + 6).toFixed(1)}" height="12" rx="6" fill="${C.ember}"/>`)
      }
      if (t.status === 'pending') parts.push(`<rect x="${x}" y="${cellsY}" width="${w}" height="6" rx="3" fill="none" stroke="${C.dim}" stroke-dasharray="2 3"/>`)
      else {
        const fill = t.status === 'passed' ? C.text : t.status === 'skipped' ? C.edge : C.accent
        parts.push(`<rect x="${x}" y="${cellsY}" width="${w}" height="6" rx="3" fill="${fill}"/>`)
      }
    })
  } else {
    parts.push(`<rect x="16" y="${cellsY}" width="${W - 32}" height="6" rx="3" fill="none" stroke="${C.dim}" stroke-dasharray="2 3"/>`)
  }

  let y = HEADER_H + GAP

  // ---- why it could not test
  if (run.failure) {
    const lines = wrap(run.failure, W - 32, 12, 4)
    const h = 48 + (lines.length - 1) * 17 + 18
    parts.push(cardAt(W, y, h, C.accent))
    parts.push(text(16, y + 27, 13.5, C.text, run.status === 'blocked' ? 'Could not test' : 'The run failed', 'font-weight="600"'))
    parts.push(label(W - 16, y + 27, C.accent, STATUS_LABEL[run.status], 120, 'text-anchor="end" font-weight="700"'))
    lines.forEach((l, i) => parts.push(text(16, y + 48 + i * 17, 12, C.soft, esc(l))))
    y += h + GAP
  }

  // ---- the summary, once given
  if (run.summary) {
    const lines = wrap(run.summary, W - 32, 12, 5)
    const h = 48 + (lines.length - 1) * 17 + 18
    parts.push(cardAt(W, y, h))
    parts.push(text(16, y + 27, 13.5, C.text, 'Summary', 'font-weight="600"'))
    lines.forEach((l, i) => parts.push(text(16, y + 48 + i * 17, 12, C.soft, esc(l))))
    y += h + GAP
  }

  // ---- the task list
  if (run.tasks.length) {
    const rows = run.tasks.map(t => (t.note && (t.status === 'failed' || t.status === 'active') ? 2 : 1))
    const h = 46 + rows.reduce((a, b) => a + b, 0) * TASK_H - 4 - rows.filter(r => r === 2).length * 4
    parts.push(cardAt(W, y, h, isRunning ? C.edge : C.stroke))
    parts.push(text(16, y + 27, 13.5, C.text, 'Tasks', 'font-weight="600"'))
    parts.push(label(W - 16, y + 27, C.muted, `${s.closed} of ${s.total} done`, W - 100, 'text-anchor="end"'))
    let ty = y + 54
    run.tasks.forEach((t, i) => {
      parts.push(taskDot(t, 24, ty - 4, 6))
      const color = t.status === 'active' ? C.text : t.status === 'passed' ? C.soft : t.status === 'failed' ? C.text : C.muted
      const weight = t.status === 'active' ? ' font-weight="600"' : ''
      const deco = t.status === 'skipped' ? ' text-decoration="line-through"' : ''
      const took = t.startedAt != null && t.status !== 'skipped' ? duration((t.endedAt ?? now) - t.startedAt) : ''
      parts.push(text(40, ty, 12, color, esc(fit(t.title, W - 40 - 64, 12)), `${weight}${deco}`))
      if (took) parts.push(text(W - 16, ty, 11, t.status === 'active' ? C.accent : C.muted, took, 'text-anchor="end"'))
      if (rows[i] === 2) {
        ty += TASK_H - 6
        parts.push(text(40, ty, 11, t.status === 'failed' ? C.hot : C.muted, esc(fit(t.note!, W - 40 - 16, 11))))
        ty += TASK_H + 2
      } else ty += TASK_H
    })
    y += h + GAP
  }

  // ---- the findings, worst first: "01  MAJOR", the title, where, what happened
  bySeverity(run.findings).forEach((f, i) => {
    const color = SEVERITY_COLOR[f.severity]
    const detail = f.detail ? wrap(f.detail, W - 32, 11.5, 3) : []
    const titleY = 48
    const whereY = f.where ? titleY + 18 : titleY
    const detailY = whereY + 21
    const last = detail.length ? detailY + (detail.length - 1) * 16 : whereY
    const h = last + 18
    parts.push(cardAt(W, y, h, f.severity === 'blocker' ? C.accent : C.stroke))
    parts.push(text(16, y + 26, 11, C.muted, String(i + 1).padStart(2, '0'), 'letter-spacing="0.8"'))
    const tag = f.severity.toUpperCase()
    if (f.severity === 'blocker') {
      parts.push(`<rect x="38" y="${y + 14}" width="${Math.round(labelW(tag) + 8)}" height="17" rx="3" fill="${color}"/>`)
      parts.push(text(42, y + 26, 10, C.ground, tag, 'font-weight="700" letter-spacing="0.8"'))
    } else parts.push(text(42, y + 26, 10, color, tag, 'font-weight="700" letter-spacing="0.8"'))
    const tagEnd = 42 + labelW(tag) + 16
    if (f.task != null && run.tasks[f.task]) parts.push(label(W - 16, y + 26, C.muted, `task ${f.task + 1}`, W - 16 - tagEnd, 'text-anchor="end"'))
    parts.push(text(16, y + titleY, 13, C.text, esc(fit(f.title, W - 32, 13)), 'font-weight="600"'))
    if (f.where) parts.push(text(16, y + whereY, 11, C.muted, esc(fit(f.where, W - 32, 11))))
    detail.forEach((l, j) => parts.push(text(16, y + detailY + j * 16, 11.5, C.soft, esc(l))))
    y += h + GAP
  })

  // ---- earlier runs, folded
  for (const old of runs.slice(1)) {
    parts.push(`<rect x="0.5" y="${y + 0.5}" width="${W - 1}" height="32" rx="12" fill="none" stroke="${C.edge}" stroke-dasharray="3 5"/>`)
    parts.push(`<circle cx="18" cy="${y + 16.5}" r="3.5" fill="${STATUS_COLOR[old.status]}"/>`)
    parts.push(text(30, y + 20.5, 11, C.muted, esc(fit(`Earlier: ${historyLine(old, now)}`, W - 46, 11))))
    y += 32 + GAP
  }

  const height = Math.round(y - GAP)
  const alt =
    `${run.target ?? run.brief}: ${STATUS_LABEL[run.status]}, ${s.passed} of ${s.total} tasks passed, ${s.failed} failed, ` +
    `${plural(run.findings.length, 'finding')}${run.failure ? `. ${run.failure}` : ''}`
  return { source: svg(W, height, parts.join('')), height, alt }
}

/** No run yet: a dashed card with the dot-matrix heading and how to start one. */
export function emptySvg(width: number): { source: string; height: number } {
  const W = Math.max(300, Math.round(width))
  const H = 96
  const body =
    `<title>No test run yet</title>` +
    `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="16" fill="${C.card}" stroke="${C.edge}" stroke-dasharray="3 5"/>` +
    dots('NO RUN YET', 16, 18, 3, C.dim) +
    label(16, 70, C.muted, 'Ask Claude to test the app, or /test-user run [what]', W - 32)
  return { source: svg(W, H, body), height: H }
}
