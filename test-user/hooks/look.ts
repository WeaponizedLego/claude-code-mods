import type { Run, RunStatus, Severity, Task, TaskStatus } from '../types'
import { STATUS_LABEL, SEVERITIES, bySeverity, duration, historyLine, plural, stats } from './run'

// Dark only, as the other mods: square slate panels on a navy ground, hairline
// rules, light wide numerals. Amber marks what needs a look or is going on now,
// periwinkle what is done; teal passed, red a failure or a blocker. An SVG is
// drawn as an image, so it takes real colours; the terminal uses the same.
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
  // A major finding needs a look: the accent.
  warn: '#f5a524',
} as const

export const SEVERITY_COLOR: Record<Severity, string> = { blocker: C.hot, major: C.warn, minor: C.done, polish: C.muted }
export const STATUS_COLOR: Record<RunStatus, string> = { running: C.accent, passed: C.good, issues: C.accent, blocked: C.hot, failed: C.hot }
export const TASK_COLOR: Record<TaskStatus, string> = { pending: C.dim, active: C.accent, passed: C.done, failed: C.hot, skipped: C.dim }
export const TASK_GLYPH: Record<TaskStatus, string> = { pending: '○', active: '●', passed: '✓', failed: '✗', skipped: '–' }

const FONT = `font-family="Barlow, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif"`

export const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Text in an image cannot wrap or truncate itself: cut it to an estimated sans width.
const chars = (px: number, size: number, spacing = 0) => Math.max(3, Math.floor(px / (size * 0.55 + spacing)))
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
// Small labels: uppercase, 10px, spaced out; capitals run wider than lower case.
const LABEL_CH = 10 * 0.68 + 1.2
const labelW = (s: string) => s.length * LABEL_CH
const label = (x: number, y: number, fill: string, body: string, px: number, extra = '') => {
  const t = body.toUpperCase()
  const max = Math.max(3, Math.floor(px / LABEL_CH))
  return text(x, y, 10, fill, esc(t.length > max ? `${t.slice(0, max - 1)}…` : t), `letter-spacing="1.2" ${extra}`)
}
// A light wide numeral, and its estimated width.
const big = (x: number, y: number, size: number, fill: string, body: string, extra = '') =>
  text(x, y, size, fill, esc(body), `font-weight="300" letter-spacing="1" ${extra}`)
// A row of facts split by a slash in the rule colour, cut to fit as one string.
function meta(x: number, y: number, size: number, fill: string, parts: string[], px: number): string {
  const whole = fit(parts.filter(Boolean).join(' / '), px, size)
  const spans = whole.split(' / ').map(p => `<tspan fill="${fill}">${esc(p)}</tspan>`)
  return `<text x="${x}" y="${y}" font-size="${size}">${spans.join(`<tspan fill="${C.edge}"> / </tspan>`)}</text>`
}
// A card's title: a short bar in the text colour, then the title.
const titled = (y: number, body: string, px: number, size = 13.5) =>
  `<rect x="16" y="${y - 12}" width="2" height="14" fill="${C.text}"/>` + text(26, y, size, C.text, esc(fit(body, px - 10, size)), 'font-weight="500"')

const svg = (W: number, H: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" ${FONT}>${body}</svg>`
const cardAt = (W: number, y: number, h: number, stroke: string = C.stroke) =>
  `<rect x="0.5" y="${y + 0.5}" width="${W - 1}" height="${h - 1}" fill="${C.card}" stroke="${stroke}"/>`

// A square mark: done periwinkle, failed red, current amber; to come a hollow
// square, skipped a short dash.
function taskMark(t: Task, x: number, cy: number): string {
  if (t.status === 'pending') return `<rect x="${x + 0.5}" y="${cy - 2.5}" width="5" height="5" fill="none" stroke="${C.muted}"/>`
  if (t.status === 'skipped') return `<path d="M${x} ${cy}h6" stroke="${C.dim}" stroke-width="1.5"/>`
  return `<rect x="${x}" y="${cy - 3}" width="6" height="6" fill="${TASK_COLOR[t.status]}"/>`
}

// A square tag: the worst two filled, with ground-coloured text, the rest outlined.
function tag(xRight: number, y: number, sev: Severity): { svg: string; w: number } {
  const body = sev.toUpperCase()
  const w = Math.round(labelW(body) + 12)
  const x = xRight - w
  const color = SEVERITY_COLOR[sev]
  const filled = sev === 'blocker' || sev === 'major'
  const box = filled
    ? `<rect x="${x}" y="${y}" width="${w}" height="18" fill="${color}"/>`
    : `<rect x="${x + 0.5}" y="${y + 0.5}" width="${w - 1}" height="17" fill="none" stroke="${sev === 'polish' ? C.edge : color}"/>`
  const fill = filled ? C.ground : sev === 'polish' ? C.text : color
  return { svg: box + text(x + w / 2, y + 13, 10, fill, body, 'text-anchor="middle" font-weight="600" letter-spacing="1.2"'), w }
}

const GAP = 10
const HEADER_H = 184
const TASK_H = 24

/** The whole pane as one SVG: a summary card, the tasks, then a card per finding. */
export function runSvg(runs: Run[], now: number, width: number): { source: string; height: number; alt: string } {
  const W = Math.max(300, Math.round(width))
  const run = runs[0]!
  const s = stats(run, now)
  const parts: string[] = []
  const tone = STATUS_COLOR[run.status]
  const isRunning = run.status === 'running'

  // ---- the summary card: red edged when the run failed or found a blocker, amber while testing
  parts.push(cardAt(W, 0, HEADER_H, run.failure || s.counts.blocker ? C.hot : isRunning ? C.accent : C.stroke))
  const chip = STATUS_LABEL[run.status]
  const chipW = labelW(chip)
  parts.push(`<rect x="${(W - 16 - chipW - 14).toFixed(1)}" y="19" width="6" height="6" fill="${tone}"/>`)
  parts.push(label(W - 16, 26, tone, chip, chipW + 4, 'text-anchor="end" font-weight="600"'))
  parts.push(titled(28, run.target ?? run.brief, W - 16 - 16 - chipW - 28))
  const scope = run.scope === 'app' ? 'Whole app' : run.scope === 'feature' ? 'Feature' : 'Scope pending'
  parts.push(meta(26, 46, 12, C.muted, [scope, `by ${run.tester}`, `${duration(s.elapsedMs)}${isRunning ? ' in' : ''}`], W - 26 - 16))

  // The hero: tasks passed out of all in a hexagon badge.
  const hx = 48
  const hy = 62
  const hex = (r: number, dy: number) => {
    const w = r * 0.866
    return [
      [hx, hy + dy],
      [hx + w, hy + dy + r / 2],
      [hx + w, hy + dy + r * 1.5],
      [hx, hy + dy + r * 2],
      [hx - w, hy + dy + r * 1.5],
      [hx - w, hy + dy + r / 2],
    ]
      .map(([x, y]) => `${x!.toFixed(1)},${y!.toFixed(1)}`)
      .join(' ')
  }
  parts.push(`<polygon points="${hex(36, 0)}" fill="${C.stroke}" stroke="${C.edge}"/>`)
  parts.push(`<polygon points="${hex(28, 8)}" fill="none" stroke="${C.done}" opacity="0.6"/>`)
  const hero = `${s.passed}/${s.total || '–'}`
  const heroSize = Math.min(22, 44 / (hero.length * 0.56))
  parts.push(big(hx, hy + 40, heroSize, s.failed ? C.hot : C.text, hero, 'text-anchor="middle"'))
  parts.push(text(hx, hy + 52, 7, C.muted, 'PASSED', 'text-anchor="middle" letter-spacing="1.2"'))

  // The severity counts beside it: a table where there is room, else two short rows.
  const tx = 100
  const tw = W - 16 - tx
  const col = tw / 4
  if (col >= labelW('blocker') + 12) {
    parts.push(`<rect x="${tx}" y="66" width="${tw}" height="20" fill="${C.stroke}"/>`)
    SEVERITIES.forEach((sev, i) => {
      const n = s.counts[sev]
      parts.push(label(tx + 10 + i * col, 80, C.muted, sev, col - 12))
      parts.push(big(tx + 10 + i * col, 120, 30, n ? SEVERITY_COLOR[sev] : C.muted, String(n)))
    })
  } else {
    const pair = (y: number, a: Severity, b: Severity) =>
      `<text x="${tx}" y="${y}" font-size="12">` +
      [a, b].map(sev => `<tspan fill="${s.counts[sev] ? SEVERITY_COLOR[sev] : C.muted}">${s.counts[sev]} ${sev}</tspan>`).join(`<tspan fill="${C.edge}"> / </tspan>`) +
      `</text>`
    parts.push(pair(92, 'blocker', 'major'), pair(112, 'minor', 'polish'))
  }

  const lead = (run.findings.length ? plural(run.findings.length, 'finding') : isRunning ? 'nothing found yet' : 'nothing found').toUpperCase()
  const leadColor = s.counts.blocker ? C.hot : s.counts.major ? C.warn : C.text
  const rest = s.failed ? ` · ${s.failed} failed` : ''
  const leadFit = fit(lead, W - 32, 10, 1.2)
  parts.push(
    `<text x="16" y="154" font-size="10" letter-spacing="1.2"><tspan fill="${leadColor}" font-weight="600">${esc(leadFit)}</tspan><tspan fill="${C.muted}">${esc(rest.toUpperCase())}</tspan></text>`,
  )

  // One square segment per task: periwinkle passed, red failed, amber current, the rest to go.
  const cellsY = 166
  if (run.tasks.length) {
    const n = run.tasks.length
    const gap = 4
    const cell = Math.max(3, (W - 32 - gap * (n - 1)) / n)
    run.tasks.forEach((t, i) => {
      const fill = t.status === 'passed' ? C.done : t.status === 'failed' ? C.hot : t.status === 'active' ? C.accent : t.status === 'skipped' ? C.stroke : C.edge
      parts.push(`<rect x="${(16 + i * (cell + gap)).toFixed(1)}" y="${cellsY}" width="${cell.toFixed(1)}" height="6" fill="${fill}"/>`)
    })
  } else {
    parts.push(`<rect x="16" y="${cellsY}" width="${W - 32}" height="6" fill="${C.edge}"/>`)
  }

  let y = HEADER_H + GAP

  // ---- why it could not test
  if (run.failure) {
    const lines = wrap(run.failure, W - 32, 12.5, 4)
    const h = 48 + (lines.length - 1) * 17 + 18
    parts.push(cardAt(W, y, h, C.hot))
    parts.push(titled(y + 27, run.status === 'blocked' ? 'Could not test' : 'The run failed', W - 32 - 100))
    parts.push(label(W - 16, y + 27, C.hot, STATUS_LABEL[run.status], 120, 'text-anchor="end" font-weight="600"'))
    lines.forEach((l, i) => parts.push(text(16, y + 50 + i * 17, 12.5, C.soft, esc(l))))
    y += h + GAP
  }

  // ---- the summary, once given
  if (run.summary) {
    const lines = wrap(run.summary, W - 32, 12.5, 5)
    const h = 48 + (lines.length - 1) * 17 + 18
    parts.push(cardAt(W, y, h))
    parts.push(titled(y + 27, 'Summary', W - 32))
    lines.forEach((l, i) => parts.push(text(16, y + 50 + i * 17, 12.5, C.soft, esc(l))))
    y += h + GAP
  }

  // ---- the task list
  if (run.tasks.length) {
    const rows = run.tasks.map(t => (t.note && (t.status === 'failed' || t.status === 'active') ? 2 : 1))
    const h = 56 + rows.reduce((a, b) => a + b, 0) * TASK_H - 4 - rows.filter(r => r === 2).length * 4
    parts.push(cardAt(W, y, h))
    parts.push(label(16, y + 24, C.muted, 'Tasks', 100))
    parts.push(label(W - 16, y + 24, C.muted, `${s.closed} of ${s.total} done`, W - 100, 'text-anchor="end"'))
    parts.push(`<rect x="16" y="${y + 34}" width="${W - 32}" height="1" fill="${C.stroke}"/>`)
    let ty = y + 60
    run.tasks.forEach((t, i) => {
      parts.push(taskMark(t, 16, ty - 4.5))
      const color = t.status === 'active' || t.status === 'failed' ? C.text : C.muted
      const weight = t.status === 'active' ? ' font-weight="600"' : ''
      const deco = t.status === 'skipped' ? ' text-decoration="line-through"' : ''
      const took = t.startedAt != null && t.status !== 'skipped' ? duration((t.endedAt ?? now) - t.startedAt) : ''
      parts.push(text(34, ty, 13, color, esc(fit(t.title, W - 34 - 64, 13)), `${weight}${deco}`))
      if (took) parts.push(text(W - 16, ty, 12, t.status === 'active' ? C.accent : C.muted, took, 'text-anchor="end"'))
      if (rows[i] === 2) {
        ty += TASK_H - 6
        parts.push(text(34, ty, 12, t.status === 'failed' ? C.hot : C.muted, esc(fit(t.note!, W - 34 - 16, 12))))
        ty += TASK_H + 2
      } else ty += TASK_H
    })
    y += h + GAP
  }

  // ---- the findings, worst first: the title and its tag, where, what happened
  bySeverity(run.findings).forEach(f => {
    const detail = f.detail ? wrap(f.detail, W - 32, 12.5, 3) : []
    const where = [f.task != null && run.tasks[f.task] ? `task ${f.task + 1}` : '', f.where ?? ''].filter(Boolean)
    const titleY = 28
    const whereY = where.length ? titleY + 18 : titleY
    const detailY = whereY + 20
    const last = detail.length ? detailY + (detail.length - 1) * 17 : whereY
    const h = last + 18
    parts.push(cardAt(W, y, h, f.severity === 'blocker' ? C.hot : C.stroke))
    const t = tag(W - 16, y + 15, f.severity)
    parts.push(t.svg)
    parts.push(text(16, y + titleY, 14, C.text, esc(fit(f.title, W - 32 - t.w - 12, 14)), 'font-weight="500"'))
    if (where.length) parts.push(meta(16, y + whereY, 12, C.muted, where, W - 32))
    detail.forEach((l, j) => parts.push(text(16, y + detailY + j * 17, 12.5, C.soft, esc(l))))
    y += h + GAP
  })

  // ---- earlier runs, folded under a dashed rule
  for (const old of runs.slice(1)) {
    parts.push(`<path d="M0 ${y + 0.5}H${W}" stroke="${C.edge}" stroke-dasharray="3 4"/>`)
    parts.push(`<rect x="16" y="${y + 13}" width="6" height="6" fill="${STATUS_COLOR[old.status]}"/>`)
    parts.push(text(32, y + 20, 12, C.muted, esc(fit(`Earlier: ${historyLine(old, now)}`, W - 48, 12))))
    y += 30 + GAP
  }

  const height = Math.round(y - GAP)
  const alt =
    `${run.target ?? run.brief}: ${STATUS_LABEL[run.status]}, ${s.passed} of ${s.total} tasks passed, ${s.failed} failed, ` +
    `${plural(run.findings.length, 'finding')}${run.failure ? `. ${run.failure}` : ''}`
  return { source: svg(W, height, parts.join('')), height, alt }
}

/** No run yet: a dashed card with a light heading and how to start one. */
export function emptySvg(width: number): { source: string; height: number } {
  const W = Math.max(300, Math.round(width))
  const H = 96
  const body =
    `<title>No test run yet</title>` +
    `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" fill="none" stroke="${C.edge}" stroke-dasharray="3 5"/>` +
    big(16, 46, 26, C.soft, 'No run yet') +
    label(16, 72, C.muted, 'Ask Claude to test the app, or /test-user run [what]', W - 32)
  return { source: svg(W, H, body), height: H }
}
