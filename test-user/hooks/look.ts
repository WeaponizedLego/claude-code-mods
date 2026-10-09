import type { Run, RunStatus, Severity, Task, TaskStatus } from '../types'
import { STATUS_LABEL, SEVERITIES, bySeverity, duration, historyLine, plural, stats } from './run'

// The palette the other mods share: dark violet cards with a lilac accent,
// orange and red for what needs a look. An SVG is drawn as an image, so it
// takes real colours, not theme keys; the terminal uses the same.
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
  hot: '#ff5c7a',
} as const

export const SEVERITY_COLOR: Record<Severity, string> = { blocker: C.hot, major: C.warn, minor: C.accent, polish: C.muted }
export const STATUS_COLOR: Record<RunStatus, string> = { running: C.glow, passed: C.accent, issues: C.warn, blocked: C.hot, failed: C.hot }
export const TASK_COLOR: Record<TaskStatus, string> = { pending: C.dim, active: C.glow, passed: C.accent, failed: C.hot, skipped: C.dim }
export const TASK_GLYPH: Record<TaskStatus, string> = { pending: '○', active: '●', passed: '✓', failed: '✗', skipped: '–' }

const FONT = `font-family="Inter, 'Segoe UI', system-ui, -apple-system, sans-serif"`

export const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Text in an image cannot wrap or truncate itself: cut it to an estimated width.
const chars = (px: number, size: number) => Math.max(3, Math.floor(px / (size * 0.52)))
const fit = (t: string, px: number, size: number) => {
  const max = chars(px, size)
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

function taskDot(t: Task, cx: number, cy: number, r: number): string {
  if (t.status === 'passed') {
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${C.accent}"/><path d="M${cx - r * 0.45} ${cy}l${r * 0.32} ${r * 0.34} ${r * 0.6}-${r * 0.68}" fill="none" stroke="${C.card}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`
  }
  if (t.status === 'failed') {
    const d = r * 0.42
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${C.hot}"/><path d="M${cx - d} ${cy - d}l${2 * d} ${2 * d}M${cx + d} ${cy - d}l-${2 * d} ${2 * d}" stroke="${C.card}" stroke-width="1.5" stroke-linecap="round"/>`
  }
  if (t.status === 'active') return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${C.deep}" stroke="${C.glow}" stroke-width="1.2"/>`
  if (t.status === 'skipped') return `<circle cx="${cx}" cy="${cy}" r="${r - 1}" fill="${C.dim}"/>`
  return `<circle cx="${cx}" cy="${cy}" r="${r - 0.6}" fill="none" stroke="${C.dim}" stroke-width="1.2"/>`
}

// A person with a check: the test user.
const avatar = (cx: number, cy: number, color: string) =>
  `<circle cx="${cx}" cy="${cy}" r="14" fill="${C.text}"/>` +
  `<circle cx="${cx}" cy="${cy - 4}" r="3.6" fill="${C.card}"/>` +
  `<path d="M${cx - 7} ${cy + 8}a7 6 0 0 1 14 0z" fill="${C.card}"/>` +
  `<circle cx="${cx + 10}" cy="${cy + 9}" r="5" fill="${color}" stroke="${C.card}" stroke-width="1.5"/>`

const GAP = 10
const HEADER_H = 160
const TASK_H = 24

/** The whole pane as one SVG: a summary card, the tasks, then a card per finding. */
export function runSvg(runs: Run[], now: number, width: number): { source: string; height: number; alt: string } {
  const W = Math.max(300, Math.round(width))
  const run = runs[0]!
  const s = stats(run, now)
  const parts: string[] = []
  const tone = STATUS_COLOR[run.status]

  // ---- the summary card
  parts.push(`<rect x="0.5" y="0.5" width="${W - 1}" height="${HEADER_H - 1}" rx="16" fill="${C.card}" stroke="${C.stroke}"/>`)
  parts.push(avatar(32, 32, tone))
  const chip = STATUS_LABEL[run.status]
  const chipW = Math.round(chip.length * 6.4 + 24)
  parts.push(`<rect x="${W - 18 - chipW}" y="19" width="${chipW}" height="26" rx="13" fill="${C.raised}" stroke="${run.status === 'running' ? C.stroke : tone}"/>`)
  parts.push(text(W - 18 - chipW / 2, 36, 11.5, run.status === 'running' ? C.soft : tone, esc(chip), 'text-anchor="middle"'))
  parts.push(text(56, 30, 14.5, C.text, esc(fit(run.target ?? run.brief, W - 56 - chipW - 30, 14.5)), 'font-weight="600"'))
  parts.push(text(56, 46, 11, C.muted, esc(fit(`${run.scope === 'app' ? 'Whole app' : run.scope === 'feature' ? 'Feature' : 'Scope pending'} · by ${run.tester}`, W - 56 - chipW - 30, 11))))

  parts.push(
    `<text x="18" y="96" font-weight="500" letter-spacing="-0.5"><tspan font-size="34" fill="${C.text}">${s.passed}</tspan><tspan font-size="18" fill="${C.muted}">/${s.total || '–'}</tspan></text>`,
  )
  const lead = run.findings.length ? plural(run.findings.length, 'finding') : run.status === 'running' ? 'nothing found yet' : 'nothing found'
  const leadColor = s.counts.blocker ? C.hot : s.counts.major ? C.warn : C.accent
  const rest = ` · ${s.failed ? `${s.failed} failed · ` : ''}${duration(s.elapsedMs)}${run.status === 'running' ? ' in' : ''}`
  parts.push(`<text x="18" y="116" font-size="12"><tspan fill="${leadColor}" font-weight="600">${esc(lead)}</tspan><tspan fill="${C.muted}">${esc(rest)}</tspan></text>`)

  // Severity counters, right of the big number, where there is room for them.
  let sx = W - 18
  for (const sev of W >= 480 ? [...SEVERITIES].reverse() : []) {
    const n = s.counts[sev]
    const label = `${n} ${sev}`
    const w = Math.round(label.length * 6 + 22)
    sx -= w
    parts.push(`<rect x="${sx}" y="76" width="${w}" height="22" rx="11" fill="${n ? C.raised : 'none'}" stroke="${n ? SEVERITY_COLOR[sev] : C.stroke}"/>`)
    parts.push(`<circle cx="${sx + 11}" cy="87" r="3" fill="${n ? SEVERITY_COLOR[sev] : C.dim}"/>`)
    parts.push(text(sx + 18, 91, 10.5, n ? C.soft : C.dim, esc(label)))
    sx -= 6
  }

  // One cell per task, as in plan-progress: filled passed, red failed, glowing current, hatched to come.
  const cellsY = 130
  if (run.tasks.length) {
    const avail = W - 36
    const cell = Math.max(4, Math.min(56, (avail - (run.tasks.length - 1) * 5) / run.tasks.length))
    const gap = run.tasks.length > 1 ? Math.min(5, (avail - cell * run.tasks.length) / (run.tasks.length - 1)) : 0
    run.tasks.forEach((t, i) => {
      const x = 18 + i * (cell + gap)
      const fill = t.status === 'passed' ? C.accent : t.status === 'failed' ? C.hot : t.status === 'active' ? C.deep : t.status === 'skipped' ? C.dim : 'url(#hatch)'
      const stroke = t.status === 'active' ? ` stroke="${C.glow}" stroke-width="1.2"` : ''
      parts.push(`<rect x="${x.toFixed(1)}" y="${cellsY}" width="${cell.toFixed(1)}" height="18" rx="${Math.min(5, cell / 3).toFixed(1)}" fill="${fill}"${stroke}/>`)
    })
  } else {
    parts.push(`<rect x="18" y="${cellsY}" width="${W - 36}" height="18" rx="5" fill="url(#hatch)"/>`)
  }

  let y = HEADER_H + GAP

  // ---- why it could not test
  if (run.failure) {
    const lines = wrap(run.failure, W - 36, 12, 4)
    const h = 40 + lines.length * 17
    parts.push(`<rect x="0.5" y="${y + 0.5}" width="${W - 1}" height="${h - 1}" rx="14" fill="url(#hotwash)" stroke="${C.hot}"/>`)
    parts.push(text(18, y + 25, 13.5, C.text, run.status === 'blocked' ? 'Could not test' : 'The run failed', 'font-weight="600"'))
    lines.forEach((l, i) => parts.push(text(18, y + 46 + i * 17, 12, C.soft, esc(l))))
    y += h + GAP
  }

  // ---- the summary, once given
  if (run.summary) {
    const lines = wrap(run.summary, W - 36, 12, 5)
    const h = 40 + lines.length * 17
    parts.push(`<rect x="0.5" y="${y + 0.5}" width="${W - 1}" height="${h - 1}" rx="14" fill="${C.raised}" stroke="${C.stroke}"/>`)
    parts.push(text(18, y + 25, 13.5, C.text, 'Summary', 'font-weight="600"'))
    lines.forEach((l, i) => parts.push(text(18, y + 46 + i * 17, 12, C.soft, esc(l))))
    y += h + GAP
  }

  // ---- the task list
  if (run.tasks.length) {
    const rows = run.tasks.map(t => (t.note && (t.status === 'failed' || t.status === 'active') ? 2 : 1))
    const h = 42 + rows.reduce((a, b) => a + b, 0) * TASK_H - 4 - rows.filter(r => r === 2).length * 4
    const isNow = run.status === 'running'
    parts.push(
      `<rect x="0.5" y="${y + 0.5}" width="${W - 1}" height="${h - 1}" rx="14" fill="${isNow ? 'url(#now)' : C.raised}" stroke="${isNow ? C.deep : C.stroke}"/>`,
    )
    parts.push(text(16, y + 25, 13.5, C.text, 'Tasks', 'font-weight="600"'))
    parts.push(text(W - 18, y + 25, 11, C.muted, esc(`${s.closed} of ${s.total} done`), 'text-anchor="end"'))
    let ty = y + 50
    run.tasks.forEach((t, i) => {
      parts.push(taskDot(t, 24, ty - 4, 6))
      const color = t.status === 'active' ? C.text : t.status === 'passed' ? C.soft : t.status === 'failed' ? C.text : C.muted
      const weight = t.status === 'active' ? ' font-weight="600"' : ''
      const deco = t.status === 'skipped' ? ' text-decoration="line-through"' : ''
      const took = t.startedAt != null && t.status !== 'skipped' ? duration((t.endedAt ?? now) - t.startedAt) : ''
      parts.push(text(38, ty, 12, color, esc(fit(t.title, W - 100, 12)), `${weight}${deco}`))
      if (took) parts.push(text(W - 18, ty, 11, t.status === 'active' ? C.accent : C.muted, took, 'text-anchor="end"'))
      if (rows[i] === 2) {
        ty += TASK_H - 6
        parts.push(text(38, ty, 11, t.status === 'failed' ? C.hot : C.muted, esc(fit(t.note!, W - 60, 11))))
        ty += TASK_H + 2
      } else ty += TASK_H
    })
    y += h + GAP
  }

  // ---- the findings, worst first
  for (const f of bySeverity(run.findings)) {
    const color = SEVERITY_COLOR[f.severity]
    const detail = f.detail ? wrap(f.detail, W - 44, 11.5, 3) : []
    const h = 50 + (f.where ? 0 : -2) + detail.length * 16 + (detail.length ? 4 : 0)
    parts.push(`<rect x="0.5" y="${y + 0.5}" width="${W - 1}" height="${h - 1}" rx="14" fill="${C.raised}" stroke="${C.stroke}"/>`)
    parts.push(`<rect x="0.5" y="${y + 12}" width="3.5" height="${h - 24}" rx="1.75" fill="${color}"/>`)
    const tag = f.severity.toUpperCase()
    const tagW = Math.round(tag.length * 6.6 + 16)
    parts.push(`<rect x="${W - 16 - tagW}" y="${y + 12}" width="${tagW}" height="18" rx="9" fill="none" stroke="${color}"/>`)
    parts.push(text(W - 16 - tagW / 2, y + 24.5, 9.5, color, tag, 'text-anchor="middle" font-weight="600" letter-spacing="0.6"'))
    parts.push(text(18, y + 25, 13, C.text, esc(fit(f.title, W - 40 - tagW, 13)), 'font-weight="600"'))
    const meta = [f.task != null && run.tasks[f.task] ? `task ${f.task + 1}` : '', f.where ?? ''].filter(Boolean).join(' · ')
    parts.push(text(18, y + 42, 11, C.muted, esc(fit(meta || 'general', W - 40, 11))))
    detail.forEach((l, i) => parts.push(text(18, y + 62 + i * 16, 11.5, C.soft, esc(l))))
    y += h + GAP
  }

  // ---- earlier runs, folded
  for (const old of runs.slice(1)) {
    parts.push(`<rect x="0.5" y="${y + 0.5}" width="${W - 1}" height="32" rx="12" fill="none" stroke="${C.stroke}" stroke-dasharray="4 4"/>`)
    parts.push(`<circle cx="18" cy="${y + 16.5}" r="4" fill="${STATUS_COLOR[old.status]}"/>`)
    parts.push(text(30, y + 21, 11.5, C.muted, esc(fit(`Earlier: ${historyLine(old, now)}`, W - 50, 11.5))))
    y += 32 + GAP
  }

  const height = Math.round(y - GAP)
  const defs =
    `<defs>` +
    `<pattern id="hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" fill="${C.track}"/><rect width="2" height="5" fill="#4a4463"/></pattern>` +
    `<linearGradient id="now" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3d3260"/><stop offset="1" stop-color="${C.raised}"/></linearGradient>` +
    `<linearGradient id="hotwash" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4a2433"/><stop offset="1" stop-color="${C.raised}"/></linearGradient>` +
    `</defs>`
  const source = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${height}" viewBox="0 0 ${W} ${height}" ${FONT}>${defs}${parts.join('')}</svg>`

  const alt =
    `${run.target ?? run.brief}: ${STATUS_LABEL[run.status]}, ${s.passed} of ${s.total} tasks passed, ${s.failed} failed, ` +
    `${plural(run.findings.length, 'finding')}${run.failure ? `. ${run.failure}` : ''}`
  return { source, height, alt }
}

export function emptySvg(width: number): { source: string; height: number } {
  const W = Math.max(300, Math.round(width))
  const H = 92
  const source =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" ${FONT}>` +
    `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="16" fill="${C.card}" stroke="${C.stroke}" stroke-dasharray="4 4"/>` +
    text(20, 38, 14, C.text, 'No test run yet', 'font-weight="600"') +
    text(20, 60, 11.5, C.muted, esc(fit('Ask Claude to test the app, or run /test-user run [what to test].', W - 40, 11.5))) +
    `</svg>`
  return { source, height: H }
}
