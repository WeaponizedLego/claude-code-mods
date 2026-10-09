import type { Finding, Run, RunStatus, Severity, Task, TaskStatus } from '../types'

export const MAX_TASKS = 15
export const MAX_FINDINGS = 40
export const MAX_RUNS = 5
const MAX_TITLE = 90
const MAX_DETAIL = 400

export const SEVERITIES: Severity[] = ['blocker', 'major', 'minor', 'polish']

export function clean(text: unknown, max = MAX_TITLE): string {
  const out = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  return out.length > max ? `${out.slice(0, max - 1)}…` : out
}

export const cleanDetail = (text: unknown) => clean(text, MAX_DETAIL)

export function newRun(agentId: string, tester: string, brief: string, now: number): Run {
  return { agentId, tester, brief: clean(brief, 160) || 'Test the application', status: 'running', startedAt: now, tasks: [], findings: [] }
}

const isClosed = (t: Task) => t.status === 'passed' || t.status === 'failed' || t.status === 'skipped'

/** A new task list; tasks already closed under the same title keep their outcome. */
export function plan(run: Run, titles: string[], now: number): Run {
  const before = new Map(run.tasks.map(t => [t.title.toLowerCase(), t]))
  const tasks = titles
    .map(t => clean(t))
    .filter(Boolean)
    .slice(0, MAX_TASKS)
    .map(title => before.get(title.toLowerCase()) ?? { title, status: 'pending' as const })
  return advance({ ...run, tasks }, now)
}

/** With nothing in progress, the first pending task becomes the current one. */
export function advance(run: Run, now: number): Run {
  if (run.status !== 'running' || run.tasks.some(t => t.status === 'active')) return run
  const i = run.tasks.findIndex(t => t.status === 'pending')
  return i < 0 ? run : setTask(run, i, 'active', undefined, now)
}

export function setTask(run: Run, index: number, status: TaskStatus, note: string | undefined, now: number): Run {
  const tasks = run.tasks.map((t, i): Task => {
    if (i === index) {
      if (status === 'pending') return { title: t.title, status }
      if (status === 'active') return { ...t, status, note: note ?? t.note, startedAt: t.startedAt ?? now, endedAt: undefined }
      return { ...t, status, note: note ?? t.note, startedAt: t.startedAt ?? now, endedAt: now }
    }
    // Starting one task puts any other in progress back in the queue.
    if (status === 'active' && t.status === 'active') return { ...t, status: 'pending' }
    return t
  })
  return { ...run, tasks }
}

export function addFinding(run: Run, f: Omit<Finding, 'at'>, now: number): Run {
  if (run.findings.length >= MAX_FINDINGS) return run
  return { ...run, findings: [...run.findings, { ...f, at: now }] }
}

const RANK: Record<Severity, number> = { blocker: 0, major: 1, minor: 2, polish: 3 }
export const bySeverity = (fs: Finding[]) => [...fs].sort((a, b) => RANK[a.severity] - RANK[b.severity] || a.at - b.at)

/** The outcome the run's own record supports, for a tester that did not say. */
export function verdictOf(run: Run): RunStatus {
  if (run.tasks.some(t => t.status === 'failed') || run.findings.length > 0) return 'issues'
  if (run.tasks.length === 0) return 'blocked'
  return 'passed'
}

export function finish(run: Run, status: RunStatus, now: number, summary?: string, failure?: string): Run {
  // Tasks left open when the run ends were never tried.
  const tasks = run.tasks.map((t): Task => (isClosed(t) ? t : { ...t, status: 'skipped', endedAt: t.startedAt != null ? now : undefined }))
  return { ...run, tasks, status, endedAt: now, summary: summary ?? run.summary, failure: failure ?? run.failure }
}

export type Stats = {
  total: number
  closed: number
  passed: number
  failed: number
  counts: Record<Severity, number>
  elapsedMs: number
  current: number | null
}

export function stats(run: Run, now: number): Stats {
  const counts = { blocker: 0, major: 0, minor: 0, polish: 0 }
  for (const f of run.findings) counts[f.severity]++
  const current = run.tasks.findIndex(t => t.status === 'active')
  return {
    total: run.tasks.length,
    closed: run.tasks.filter(isClosed).length,
    passed: run.tasks.filter(t => t.status === 'passed').length,
    failed: run.tasks.filter(t => t.status === 'failed').length,
    counts,
    elapsedMs: Math.max(0, (run.endedAt ?? now) - run.startedAt),
    current: current < 0 ? null : current,
  }
}

export function duration(ms: number): string {
  const min = Math.round(ms / 60_000)
  if (min < 1) return `${Math.max(0, Math.round(ms / 1000))}s`
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  return `${h}h${String(min % 60).padStart(2, '0')}m`
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

export const STATUS_LABEL: Record<RunStatus, string> = {
  running: 'Testing',
  passed: 'Passed',
  issues: 'Issues found',
  blocked: 'Blocked',
  failed: 'Failed',
}

export function findingsLine(s: Stats): string {
  const n = SEVERITIES.reduce((sum, k) => sum + s.counts[k], 0)
  if (n === 0) return 'no findings'
  const parts = SEVERITIES.filter(k => s.counts[k] > 0).map(k => `${s.counts[k]} ${k}`)
  return `${plural(n, 'finding')} (${parts.join(', ')})`
}

/** One line for the status bar. */
export function statusLine(run: Run, now: number): string {
  const s = stats(run, now)
  const n = run.findings.length
  if (run.status === 'running') {
    const at = s.current != null ? ` · ${run.tasks[s.current]!.title}` : ''
    return `test-user ● ${s.closed}/${s.total || '?'} tasks · ${plural(n, 'finding')} · ${duration(s.elapsedMs)}${at}`
  }
  if (run.status === 'passed') return `test-user ✓ ${s.passed}/${s.total} passed · ${duration(s.elapsedMs)}`
  if (run.status === 'issues') return `test-user ! ${s.failed} failed · ${plural(n, 'finding')} · ${duration(s.elapsedMs)}`
  return `test-user × ${STATUS_LABEL[run.status].toLowerCase()}${run.failure ? `: ${run.failure}` : ''}`
}

const GLYPH: Record<TaskStatus, string> = { pending: '[ ]', active: '[>]', passed: '[x]', failed: '[!]', skipped: '[-]' }

/** The run as plain text, numbered as the tools take it, for the model. */
export function report(run: Run, now: number): string {
  const s = stats(run, now)
  const lines = [
    `${STATUS_LABEL[run.status]}: ${run.target ?? run.brief} (${run.scope === 'app' ? 'whole app' : run.scope === 'feature' ? 'feature' : 'scope not set'}, by ${run.tester}, ${duration(s.elapsedMs)})`,
  ]
  if (run.failure) lines.push(`Failure: ${run.failure}`)
  if (run.summary) lines.push(`Summary: ${run.summary}`)
  lines.push('', `Tasks (${s.passed} passed, ${s.failed} failed, ${s.total} total):`)
  if (run.tasks.length === 0) lines.push('  (none planned)')
  run.tasks.forEach((t, i) => lines.push(`  ${i + 1}. ${GLYPH[t.status]} ${t.title}${t.note ? ` — ${t.note}` : ''}`))
  lines.push('', `Findings: ${findingsLine(s)}`)
  for (const f of bySeverity(run.findings)) {
    const task = f.task != null && run.tasks[f.task] ? ` [task ${f.task + 1}]` : ''
    lines.push(`  - ${f.severity.toUpperCase()}${task}: ${f.title}${f.where ? ` @ ${f.where}` : ''}${f.detail ? `\n    ${f.detail}` : ''}`)
  }
  return lines.join('\n')
}

/** The earlier runs, one line each. */
export function historyLine(run: Run, now: number): string {
  const s = stats(run, now)
  const what = run.status === 'passed' ? `${s.passed}/${s.total} passed` : run.status === 'running' ? 'running' : run.findings.length ? plural(run.findings.length, 'finding') : STATUS_LABEL[run.status].toLowerCase()
  return `${run.target ?? run.brief} · ${what}`
}
