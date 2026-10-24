import type { Board, Task, Validation } from '../types'
import { needsYou, stageOf } from './hub'

// Dark only: square slate panels on a navy ground, hairline rules and light wide
// numerals. Amber marks what needs a look or runs now, periwinkle what is done,
// teal what merged, red what failed. An SVG is drawn as an image, so it takes
// real colours; the terminal uses the same.
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

// Text in an image cannot truncate itself: cut it to an estimated width, capitals
// running wider than mixed case.
const charW = (size: number, spacing = 0, caps = false) => size * (caps ? 0.68 : 0.55) + spacing
export const fit = (t: string, px: number, size: number, spacing = 0, caps = false) => {
  const max = Math.max(3, Math.floor(px / charW(size, spacing, caps)))
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}
const labelW = (t: string) => t.length * charW(10, 1.2, true)
const numW = (t: string, size: number) => t.length * size * 0.56

const text = (x: number, y: number, size: number, fill: string, body: string, extra = '') =>
  `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" ${extra}>${body}</text>`
const label = (x: number, y: number, fill: string, body: string, px: number, extra = '') =>
  text(x, y, 10, fill, esc(fit(body.toUpperCase(), px, 10, 1.2, true)), `letter-spacing="1.2" ${extra}`)
/** A big light numeral, the look's headline figure. */
const num = (x: number, y: number, size: number, fill: string, body: string, extra = '') =>
  text(x, y, size, fill, esc(body), `font-weight="300" letter-spacing="1" ${extra}`)
const square = (x: number, y: number, fill: string, s = 6) => `<rect x="${x}" y="${y}" width="${s}" height="${s}" fill="${fill}"/>`
/** A small meta line, its parts set apart by slashes in the track colour. */
const slashed = (x: number, y: number, fill: string, parts: string[], px: number) => {
  const whole = fit(parts.join(' / '), px, 11)
  const spans = whole
    .split(' / ')
    .map(s => `<tspan>${esc(s)}</tspan>`)
    .join(`<tspan fill="${C.edge}"> / </tspan>`)
  return `<text x="${x}" y="${y}" font-size="11" fill="${fill}">${spans}</text>`
}

const svg = (W: number, H: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" ${SANS}>${body}</svg>`
const card = (W: number, H: number, stroke: string = C.stroke) => `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" fill="${C.card}" stroke="${stroke}"/>`
const hollow = (W: number, H: number) => `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" fill="none" stroke="${C.edge}" stroke-dasharray="3 4"/>`

export function ago(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60_000))
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`
}
const short = (ms: number) => ago(ms).replace(' ago', '').replace('just now', '0m')

export type Stat = { value: string; label: string; isHot: boolean }

/** The big number on a task's card, and what it counts. */
export function statOf(t: Task, now: number): Stat {
  const pr = t.pr
  switch (stageOf(t)) {
    case 'implementing':
      return { value: String(t.ahead), label: t.ahead === 1 ? 'commit' : 'commits', isHot: false }
    case 'feedback':
      return { value: String(pr!.unresolved), label: 'unanswered', isHot: true }
    case 'merged':
      return { value: pr!.mergedAt ? short(now - Date.parse(pr!.mergedAt)) : 'OK', label: 'since merge', isHot: false }
    case 'closed':
      return { value: '--', label: 'pr closed', isHot: true }
    case 'pr':
      return pr!.checksTotal
        ? { value: `${pr!.checksPassed}/${pr!.checksTotal}`, label: pr!.checksFailed ? `${pr!.checksFailed} failing` : 'checks', isHot: pr!.checksFailed > 0 }
        : { value: '--', label: 'no checks', isHot: false }
  }
}

/** The line under a card's track: what the task is waiting on. */
export function metaOf(t: Task): string {
  const pr = t.pr
  const checks = pr && pr.checksTotal ? `checks ${pr.checksPassed}/${pr.checksTotal}` : ''
  switch (stageOf(t)) {
    case 'implementing':
      return [t.hasPlan ? 'plan' : 'no plan', t.isDirty ? 'uncommitted changes' : 'clean', `base ${t.base}`].join(' · ')
    case 'feedback':
      return [`pr #${pr!.number}`, `${pr!.unresolved} unresolved`, checks].filter(Boolean).join(' · ')
    case 'merged':
      return [`pr #${pr!.number} merged`, t.isDirty ? 'uncommitted changes' : 'worktree clean'].join(' · ')
    case 'closed':
      return `pr #${pr!.number} closed without merge`
    case 'pr':
      return [`${pr!.isDraft ? 'draft ' : ''}pr #${pr!.number}`, checks, 'waiting for review'].filter(Boolean).join(' · ')
  }
}

const STAGE_AT = { implementing: 1, pr: 2, feedback: 3, merged: 4, closed: 4 } as const
const TRACK = ['start', 'build', 'pr', 'feedback', 'close']
export const CARD_H = 134

/** The key's colour: amber when it needs the person, teal once merged, periwinkle while it moves. */
const keyColor = (t: Task) => (needsYou(t) ? C.accent : stageOf(t) === 'merged' ? C.good : C.done)

/** One task as a card: number, key and repo; title; the big stat beside the five-stop track; what it waits on. */
export function taskSvg(t: Task, index: number, width: number, now: number): { source: string; height: number; alt: string } {
  const W = Math.max(300, Math.round(width))
  const H = CARD_H
  const hot = needsYou(t)
  const stage = stageOf(t)
  const p: string[] = [card(W, H, hot ? C.accent : C.stroke)]

  const n = String(index + 1).padStart(2, '0')
  p.push(text(16, 26, 11, C.muted, n, 'letter-spacing="1"'))
  p.push(text(40, 26, 12, keyColor(t), esc(t.key), 'font-weight="600" letter-spacing="1"'))
  const keyW = 40 + t.key.length * charW(12, 1, true) + 14
  p.push(label(W - 16, 26, C.muted, t.repo, W - 16 - keyW, 'text-anchor="end"'))
  p.push(`<rect x="16" y="38" width="2" height="14" fill="${C.text}"/>`)
  p.push(text(26, 50, 14, C.text, esc(fit(t.title, W - 42, 14)), 'font-weight="500"'))

  // The big number: amber when it needs the person, muted once merged.
  const stat = statOf(t, now)
  const size = 38
  p.push(num(16, 94, size, stat.isHot ? C.accent : stage === 'merged' ? C.muted : C.text, stat.value))
  const statW = Math.max(88, numW(stat.value, size), labelW(stat.label))
  p.push(label(16, 110, C.muted, stat.label, statW + 4))

  // The track: five square segments, done periwinkle, the current one amber, the rest to come.
  const x0 = 16 + statW + 22
  const x1 = W - 16
  const at = STAGE_AT[stage]
  if (x1 - x0 >= 120) {
    const gap = 4
    const seg = (x1 - x0 - gap * 4) / 5
    TRACK.forEach((name, i) => {
      const x = x0 + i * (seg + gap)
      const fill = i < at ? C.done : i === at ? C.accent : C.edge
      p.push(`<rect x="${x.toFixed(1)}" y="70" width="${seg.toFixed(1)}" height="4" fill="${fill}"/>`)
      if (seg >= 40) p.push(text(x, 90, 9, i === at ? C.accent : C.muted, esc(fit(name.toUpperCase(), seg, 9, 1, true)), 'letter-spacing="1"'))
    })
  }
  p.push(slashed(16, 124, hot ? C.soft : C.muted, metaOf(t).split(' · '), W - 32))

  const alt = `${t.key} ${t.repo}: ${t.title}. ${stat.value} ${stat.label}. ${metaOf(t)}`
  return { source: svg(W, H, p.join('')), height: H, alt }
}

/** The pane's heading: the hub over the tower's name, and how many tasks need the person. */
export function headerSvg(board: Board, isSyncing: boolean, width: number, now: number): { source: string; height: number; alt: string } {
  const W = Math.max(300, Math.round(width))
  const H = 62
  const need = board.tasks.filter(needsYou).length
  const line = [`${board.tasks.length} ${board.tasks.length === 1 ? 'task' : 'tasks'}`, need ? `${need} need you` : '', isSyncing ? 'syncing…' : `synced ${ago(now - board.syncedAt)}`]
    .filter(Boolean)
    .join(' · ')
  const body =
    label(2, 12, C.muted, 'sentinel-hill hub', W - 4) +
    num(1, 38, 24, C.text, 'Control tower') +
    square(2, H - 13, need ? C.accent : C.edge) +
    label(16, H - 6, C.muted, line, W - 20)
  return { source: svg(W, H, body), height: H, alt: `Control Tower: ${line}` }
}

/** No worktrees under work/ yet. */
export function emptySvg(width: number): { source: string; height: number } {
  const W = Math.max(300, Math.round(width))
  const H = 96
  const body = hollow(W, H) + num(16, 46, 26, C.muted, 'No tasks') + label(16, 72, C.muted, 'Start a ticket below, or /task-start OPS-123', W - 32)
  return { source: svg(W, H, body), height: H }
}

/** The pane's last line: setup, guards and mode. */
export function footerSvg(board: Board, blocked: number, mode: string, width: number): { source: string; height: number; alt: string } {
  const W = Math.max(300, Math.round(width))
  const H = 22
  const items: [string, boolean][] = [
    ['repos.local.yaml', board.setup.hasLocalRepos],
    ['gh read:packages', board.setup.hasPackagesScope !== false],
  ]
  let x = 2
  const p: string[] = []
  for (const [name, ok] of items) {
    p.push(square(x, 8, ok ? C.done : C.accent))
    p.push(label(x + 12, 15, ok ? C.muted : C.accent, name, 180))
    x += 12 + labelW(name) + 14
  }
  const right = `${blocked ? `guards ${blocked} blocked · ` : ''}${mode}`
  if (W - x > labelW(right)) p.push(label(W - 2, 15, blocked ? C.soft : C.muted, right, W - x, 'text-anchor="end"'))
  const alt = `Setup: repos.local.yaml ${items[0]![1] ? 'present' : 'missing'}, gh read:packages ${items[1]![1] ? 'ok' : 'missing'}. ${right}`
  return { source: svg(W, H, p.join('')), height: H, alt }
}

/** The band while the hub is not set up. */
export function setupSvg(board: Board, width: number): { source: string; height: number; alt: string } {
  const W = Math.max(300, Math.round(width))
  const H = 58
  const missing = [!board.setup.hasLocalRepos && 'repos.local.yaml missing', board.setup.hasPackagesScope === false && 'gh token lacks read:packages'].filter(Boolean) as string[]
  const done = 2 - missing.length
  const body =
    card(W, H, C.accent) +
    num(16, 40, 30, C.accent, `${done}/2`) +
    text(84, 25, 14, C.text, 'Hub not set up', 'font-weight="500"') +
    label(84, 43, C.soft, missing.join(' · '), W - 100)
  return { source: svg(W, H, body), height: H, alt: `Hub not set up: ${missing.join(', ')}` }
}

export const shortCommand = (c: string) => c.replace(/^npm run /, '').replace(/ -- --app .*?bin\/([\w-]+)\.ts"?$/, ' $1').replace(/ -w (\S+)$/, ' ($1)')

/** The band while validate runs: done out of total, one thin bar per command with its name under it. */
export function validationSvg(v: Validation, width: number): { source: string; height: number; alt: string } {
  const W = Math.max(300, Math.round(width))
  const H = 72
  const total = v.checks.length
  const done = v.checks.filter(c => c.status === 'passed').length
  const running = v.checks.find(c => c.status === 'running')
  const failed = v.checks.filter(c => c.status === 'failed')
  const p: string[] = [card(W, H, failed.length ? C.hot : C.stroke)]

  // done / total in light numerals, the slash in the track colour
  const size = 32
  const lead = String(done)
  p.push(
    `<text x="16" y="50" font-size="${size}" font-weight="300" letter-spacing="1"><tspan fill="${failed.length ? C.hot : C.text}">${lead}</tspan>` +
      `<tspan fill="${C.edge}" font-size="22"> / </tspan><tspan fill="${C.muted}">${total}</tspan></text>`,
  )
  const lx = 16 + numW(lead, size) + numW(' / ', 22) + numW(String(total), size) + 18

  const state = failed.length ? `${failed.length} failed` : running ? 'running' : done === total ? 'all passed' : 'waiting'
  const now = failed[0] ?? running
  p.push(label(lx, 22, C.muted, `validate · ${v.repo}`, W - lx - 120))
  p.push(label(W - 16, 22, failed.length ? C.hot : running ? C.accent : done === total ? C.good : C.muted, state, 110, 'text-anchor="end"'))

  // Done periwinkle, running half amber, failed red, waiting on the track.
  const gap = 10
  const bar = (W - 16 - lx - gap * (total - 1)) / total
  v.checks.forEach((c, i) => {
    const x = lx + i * (bar + gap)
    const at = `x="${x.toFixed(1)}" y="36" height="3"`
    if (c.status === 'running') p.push(`<rect ${at} width="${bar.toFixed(1)}" fill="${C.stroke}"/><rect ${at} width="${(bar * 0.5).toFixed(1)}" fill="${C.accent}"/>`)
    else p.push(`<rect ${at} width="${bar.toFixed(1)}" fill="${c.status === 'passed' ? C.done : c.status === 'failed' ? C.hot : C.edge}"/>`)
    const color = c.status === 'failed' ? C.hot : c.status === 'running' ? C.accent : C.muted
    if (bar >= 30) p.push(text(x, 56, 11, color, esc(fit(shortCommand(c.command), bar, 11))))
  })
  const alt = `Validate ${v.repo}: ${done} of ${total} passed, ${state}${now ? `: ${now.command}` : ''}`
  return { source: svg(W, H, p.join('')), height: H, alt }
}
