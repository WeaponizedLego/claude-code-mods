import type { Board, Task, Validation } from '../types'
import { needsYou, stageOf } from './hub'

// Dark only: near-black cards on a warm black, one orange for what needs a look.
// An SVG is drawn as an image, so it takes real colours; the terminal uses the same.
export const C = {
  ground: '#121211',
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

// Text in an image cannot truncate itself: cut it to an estimated monospace width.
export const fit = (t: string, px: number, size: number, spacing = 0) => {
  const max = Math.max(3, Math.floor(px / (size * 0.6 + spacing)))
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

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
const card = (W: number, H: number, stroke: string = C.stroke) => `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="16" fill="${C.card}" stroke="${stroke}"/>`

export function ago(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60_000))
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`
}
const short = (ms: number) => ago(ms).replace(' ago', '').replace('just now', '0m').toUpperCase()

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

/** One task as a card: number, key and repo; title; the big stat beside the five-stop track; what it waits on. */
export function taskSvg(t: Task, index: number, width: number, now: number): { source: string; height: number; alt: string } {
  const W = Math.max(300, Math.round(width))
  const H = CARD_H
  const hot = needsYou(t)
  const p: string[] = [card(W, H, hot ? C.accent : C.stroke)]

  const n = String(index + 1).padStart(2, '0')
  p.push(text(16, 26, 11, C.muted, n, 'letter-spacing="0.8"'))
  p.push(text(42, 26, 11, C.text, esc(t.key), 'font-weight="700" letter-spacing="0.8"'))
  const keyW = 42 + t.key.length * 7.4 + 14
  p.push(label(W - 16, 26, C.muted, t.repo, W - 16 - keyW, 'text-anchor="end"'))
  p.push(text(16, 50, 13.5, C.text, esc(fit(t.title, W - 32, 13.5)), 'font-weight="600"'))

  const stat = statOf(t, now)
  const pitch = 3.2
  p.push(dots(stat.value, 16, 64, pitch, stat.isHot ? C.accent : C.text))
  const statW = Math.max(88, dotsWidth(stat.value, pitch), stat.label.length * 6.8)
  p.push(label(16, 100, C.muted, stat.label, statW + 4))

  // The track: done stops filled, the current one orange with a halo, the rest hollow.
  const x0 = 16 + statW + 22
  const x1 = W - 22
  const at = STAGE_AT[stageOf(t)]
  if (x1 - x0 >= 90) {
    const step = (x1 - x0) / 4
    p.push(`<line x1="${x0}" y1="76" x2="${x1}" y2="76" stroke="${C.edge}" stroke-dasharray="2 4"/>`)
    TRACK.forEach((name, i) => {
      const cx = x0 + i * step
      if (i < at) p.push(`<circle cx="${cx.toFixed(1)}" cy="76" r="6" fill="${C.text}"/>`)
      else if (i === at) p.push(`<circle cx="${cx.toFixed(1)}" cy="76" r="9.5" fill="${C.ember}"/><circle cx="${cx.toFixed(1)}" cy="76" r="6" fill="${C.accent}"/>`)
      else p.push(`<circle cx="${cx.toFixed(1)}" cy="76" r="5.5" fill="${C.card}" stroke="${C.dim}"/>`)
      if (step >= 44) p.push(text(cx, 100, 8.5, i === at ? C.soft : C.dim, name.toUpperCase(), 'text-anchor="middle" letter-spacing="0.6"'))
    })
  }
  p.push(label(16, 120, hot ? C.soft : C.muted, metaOf(t), W - 32))

  const alt = `${t.key} ${t.repo}: ${t.title}. ${stat.value} ${stat.label}. ${metaOf(t)}`
  return { source: svg(W, H, p.join('')), height: H, alt }
}

/** The pane's heading: the dot-matrix name and how many tasks need the person. */
export function headerSvg(board: Board, isSyncing: boolean, width: number, now: number): { source: string; height: number; alt: string } {
  const W = Math.max(300, Math.round(width))
  const H = 62
  const pitch = Math.min(3, (W - 8) / (13 * 6))
  const need = board.tasks.filter(needsYou).length
  const line = [`${board.tasks.length} ${board.tasks.length === 1 ? 'task' : 'tasks'}`, need ? `${need} need you` : '', isSyncing ? 'syncing…' : `synced ${ago(now - board.syncedAt)}`]
    .filter(Boolean)
    .join(' · ')
  const body =
    dots('CONTROL TOWER', 2, 4, pitch, C.text) +
    `<circle cx="5" cy="${H - 12}" r="3" fill="${need ? C.accent : C.dim}"/>` +
    label(16, H - 8, C.muted, line, W - 20)
  return { source: svg(W, H, body), height: H, alt: `Control Tower: ${line}` }
}

/** No worktrees under work/ yet. */
export function emptySvg(width: number): { source: string; height: number } {
  const W = Math.max(300, Math.round(width))
  const H = 96
  const body =
    `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="16" fill="${C.card}" stroke="${C.edge}" stroke-dasharray="3 5"/>` +
    dots('NO TASKS', 16, 18, 3, C.dim) +
    label(16, 70, C.muted, 'Start a ticket below, or /task-start OPS-123', W - 32)
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
    p.push(`<circle cx="${x + 3}" cy="11" r="3" fill="${ok ? C.text : C.accent}"/>`)
    p.push(label(x + 11, 15, ok ? C.muted : C.accent, name, 160))
    x += 11 + name.length * 6.8 + 14
  }
  const right = `${blocked ? `guards ${blocked} blocked · ` : ''}${mode}`
  if (W - x > right.length * 6.8) p.push(label(W - 2, 15, blocked ? C.soft : C.muted, right, W - x, 'text-anchor="end"'))
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
    dots(`${done}/2`, 16, 18, 3, C.accent) +
    text(84, 26, 13, C.text, 'Hub not set up', 'font-weight="700"') +
    label(84, 44, C.soft, missing.join(' · '), W - 100)
  return { source: svg(W, H, body), height: H, alt: `Hub not set up: ${missing.join(', ')}` }
}

export const shortCommand = (c: string) => c.replace(/^npm run /, '').replace(/ -- --app .*?bin\/([\w-]+)\.ts"?$/, ' $1').replace(/ -w (\S+)$/, ' ($1)')

/** The band while validate runs: done out of total, one bar per command, what runs or failed. */
export function validationSvg(v: Validation, width: number): { source: string; height: number; alt: string } {
  const W = Math.max(300, Math.round(width))
  const H = 72
  const total = v.checks.length
  const done = v.checks.filter(c => c.status === 'passed').length
  const running = v.checks.find(c => c.status === 'running')
  const failed = v.checks.filter(c => c.status === 'failed')
  const value = `${done}/${total}`
  const p: string[] = [card(W, H, failed.length ? C.accent : C.stroke), dots(value, 16, 14, 3, failed.length ? C.accent : C.text)]
  const lx = 16 + dotsWidth(value, 3) + 16
  const state = failed.length ? `${failed.length} failed` : running ? 'running' : done === total ? 'all passed' : 'waiting'
  const now = failed[0] ?? running
  p.push(label(lx, 25, C.muted, `validate · ${v.repo}`, W - lx - 110))
  p.push(label(W - 16, 25, failed.length || running ? C.accent : C.text, state, 110, 'text-anchor="end"'))
  if (now) p.push(label(lx, 40, C.soft, shortCommand(now.command), W - lx - 16))

  const gap = 6
  const bar = (W - 32 - gap * (total - 1)) / total
  v.checks.forEach((c, i) => {
    const x = 16 + i * (bar + gap)
    const fill = c.status === 'passed' ? C.text : c.status === 'pending' ? 'none' : C.accent
    const stroke = c.status === 'pending' ? ` stroke="${C.dim}" stroke-dasharray="2 3"` : ''
    p.push(`<rect x="${x.toFixed(1)}" y="54" width="${bar.toFixed(1)}" height="6" rx="3" fill="${fill}"${stroke}/>`)
  })
  const alt = `Validate ${v.repo}: ${done} of ${total} passed, ${state}${now ? `: ${now.command}` : ''}`
  return { source: svg(W, H, p.join('')), height: H, alt }
}
