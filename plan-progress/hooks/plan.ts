import type { Phase, Plan, Step, StepStatus } from '../types'

const MAX_PHASES = 20
const MAX_STEPS = 30
const MAX_TITLE = 90

// Headings that read as a phase of work: "Phase 2: ...", "Step 3 - ...", "2. ...".
const PHASE_HEADING = /^(phase|stage|step|part|milestone|sprint|iteration|wave)\b|^\d+[.):]?\s/i
// Sections a plan carries that are not work to do.
const NOT_WORK =
  /^(context|background|overview|summary|tl;?dr|goals?|non-goals?|motivation|problem|why|risks?|notes?|open questions|questions|assumptions|references|(critical |key |relevant )?files|out of scope|alternatives( considered)?|decisions|trade-?offs|approach|recommendation)\b/i

type Item = { indent: number; text: string }
type Section = { level: number; title: string; items: Item[] }

export function clean(text: string): string {
  const out = text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[:\s]+$/, '')
    .trim()
  return out.length > MAX_TITLE ? `${out.slice(0, MAX_TITLE - 1)}…` : out
}

// "Phase 2: Build the API" -> "Build the API"; "3. Tests" -> "Tests".
export function stripNumbering(title: string): string {
  const stripped = title
    .replace(/^(phase|stage|step|part|milestone|sprint|iteration|wave)\s*[\w.]*\s*[:.)\-–—]\s*/i, '')
    .replace(/^\d+[.):]\s*/, '')
    .trim()
  return stripped || title
}

function sections(markdown: string): Section[] {
  const out: Section[] = [{ level: 0, title: '', items: [] }]
  let fenced = false
  for (const raw of markdown.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(raw)) {
      fenced = !fenced
      continue
    }
    if (fenced) continue

    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(raw)
    if (heading) {
      out.push({ level: heading[1]!.length, title: clean(heading[2]!), items: [] })
      continue
    }
    // A line that is only bold text works as a heading in many plans: "**Phase 1: Setup**".
    const bold = /^\s*\*\*([^*]+)\*\*:?\s*$/.exec(raw)
    if (bold) {
      out.push({ level: 7, title: clean(bold[1]!), items: [] })
      continue
    }
    const item = /^(\s*)(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.+)$/.exec(raw)
    if (item) {
      const text = clean(item[2]!)
      if (text) out[out.length - 1]!.items.push({ indent: item[1]!.replace(/\t/g, '    ').length, text })
    }
  }
  return out
}

const topLevel = (items: Item[]): string[] => {
  const min = Math.min(...items.map(i => i.indent))
  return items.filter(i => i.indent === min).map(i => i.text)
}

const toPhase = (title: string, steps: string[]): Phase => {
  const name = stripNumbering(title)
  const list = steps.length > 0 ? steps : [name]
  return { title: name, steps: list.slice(0, MAX_STEPS).map(t => ({ title: t, status: 'pending' as const })) }
}

/**
 * Reads a markdown plan into phases of steps. Phase headings win; failing
 * those, every heading that holds a list and is not context; failing that,
 * one list whose nested items are the steps, or one flat list as one phase.
 */
export function parsePlan(markdown: string): { title: string; phases: Phase[] } {
  const all = sections(markdown)
  const h1 = all.find(s => s.level === 1)
  let title = h1 ? stripNumbering(h1.title.replace(/^plan\s*[:\-–—]\s*/i, '')) : ''
  if (!title || /^plan$/i.test(title)) title = 'Plan'

  const body = all.filter(s => s !== h1)
  const named = body.filter(s => s.level > 0 && PHASE_HEADING.test(s.title) && !NOT_WORK.test(stripNumbering(s.title)))

  let phases: Phase[] = []
  if (named.length > 0) {
    // A phase takes the items of the sections nested under it, up to the next phase.
    for (let i = 0; i < body.length; i++) {
      const s = body[i]!
      if (!named.includes(s)) continue
      const items = [...s.items]
      for (let j = i + 1; j < body.length; j++) {
        const sub = body[j]!
        if (named.includes(sub) || sub.level <= s.level) break
        if (sub.items.length === 0) items.push({ indent: 0, text: sub.title })
        else items.push(...sub.items)
      }
      phases.push(toPhase(s.title, items.length ? topLevel(items) : []))
    }
  } else {
    const work = body.filter(s => s.level > 0 && s.items.length > 0 && !NOT_WORK.test(s.title))
    if (work.length >= 2) {
      phases = work.map(s => toPhase(s.title, topLevel(s.items)))
    } else {
      const items = work[0]?.items ?? body.flatMap(s => s.items)
      if (items.length > 0) {
        const min = Math.min(...items.map(i => i.indent))
        const hasNesting = items.some(i => i.indent > min)
        if (hasNesting) {
          // Each top item is a phase, the items under it its steps.
          let current: { title: string; steps: Item[] } | null = null
          const groups: { title: string; steps: Item[] }[] = []
          for (const it of items) {
            if (it.indent === min) groups.push((current = { title: it.text, steps: [] }))
            else current?.steps.push(it)
          }
          phases = groups.map(g => toPhase(g.title, g.steps.length ? topLevel(g.steps) : []))
        } else {
          phases = [toPhase(work[0]?.title || title, items.map(i => i.text))]
        }
      }
    }
  }

  return { title, phases: phases.slice(0, MAX_PHASES) }
}

export function newPlan(title: string, phases: { title: string; steps: string[] }[], source: Plan['source'], now: number): Plan {
  return {
    title: clean(title) || 'Plan',
    source,
    createdAt: now,
    phases: phases.slice(0, MAX_PHASES).map(p => toPhase(clean(p.title), p.steps.map(clean).filter(Boolean))),
  }
}

// ---------------------------------------------------------------- progress

const isClosed = (s: Step) => s.status === 'done' || s.status === 'skipped'

export type PhaseState = 'done' | 'active' | 'pending'

export function phaseState(p: Phase): PhaseState {
  if (p.steps.every(isClosed)) return 'done'
  if (p.steps.some(s => s.status === 'active' || isClosed(s))) return 'active'
  return 'pending'
}

const lastEnd = (plan: Plan): number =>
  Math.max(plan.createdAt, ...plan.phases.flatMap(p => p.steps.map(s => s.endedAt ?? 0)))

/** Sets one step, or every open step of a phase, to `status`, stamping times. */
export function mark(plan: Plan, phase: number, step: number | undefined, status: StepStatus, now: number): Plan {
  const since = lastEnd(plan)
  const set = (s: Step): Step => {
    if (status === 'pending') return { title: s.title, status }
    if (status === 'active') return { ...s, status, startedAt: s.startedAt ?? now, endedAt: undefined }
    return { ...s, status, startedAt: s.startedAt ?? since, endedAt: s.endedAt ?? now }
  }
  return {
    ...plan,
    phases: plan.phases.map((p, pi) =>
      pi !== phase
        ? p
        : { ...p, steps: p.steps.map((s, si) => (step === undefined ? (isClosed(s) && status !== 'pending' ? s : set(s)) : si === step ? set(s) : s)) },
    ),
  }
}

export type Stats = {
  total: number
  closed: number
  percent: number
  elapsedMs: number
  remainingMs: number | null
  currentPhase: number | null
  isFinished: boolean
}

export function stats(plan: Plan, now: number): Stats {
  const steps = plan.phases.flatMap(p => p.steps)
  const closed = steps.filter(isClosed).length
  const isFinished = closed === steps.length
  const end = isFinished ? lastEnd(plan) : now
  const elapsedMs = Math.max(0, end - plan.createdAt)
  // The pace so far: the time up to the last finished step over the steps finished.
  const done = steps.filter(s => s.status === 'done').length
  const paceMs = done > 0 ? (lastEnd(plan) - plan.createdAt) / done : null
  const currentIdx = plan.phases.findIndex(p => phaseState(p) !== 'done')
  return {
    total: steps.length,
    closed,
    percent: steps.length ? Math.round((closed / steps.length) * 100) : 0,
    elapsedMs,
    remainingMs: isFinished ? 0 : paceMs == null ? null : Math.round(paceMs * (steps.length - closed)),
    currentPhase: currentIdx === -1 ? null : currentIdx,
    isFinished,
  }
}

export function phaseDuration(plan: Plan, index: number, now: number): number | null {
  const p = plan.phases[index]!
  const starts = p.steps.map(s => s.startedAt).filter((t): t is number => t != null)
  if (starts.length === 0) return null
  const ends = p.steps.map(s => s.endedAt).filter((t): t is number => t != null)
  const end = phaseState(p) === 'done' ? Math.max(...ends) : now
  return Math.max(0, end - Math.min(...starts))
}

export function duration(ms: number): string {
  const min = Math.round(ms / 60_000)
  if (min < 1) return `${Math.max(0, Math.round(ms / 1000))}s`
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  return `${h}h${String(min % 60).padStart(2, '0')}m`
}

export function bar(percent: number, cells: number): { filled: string; track: string } {
  const filled = Math.min(cells, Math.round((percent / 100) * cells))
  return { filled: '▰'.repeat(filled), track: '▱'.repeat(cells - filled) }
}

/** One line for the status bar. */
export function statusLine(plan: Plan, now: number): string {
  const s = stats(plan, now)
  const { filled, track } = bar(s.percent, 8)
  if (s.isFinished) return `✓ ${plan.title} · ${s.total} steps in ${duration(s.elapsedMs)}`
  const parts = [`${filled}${track} ${s.closed}/${s.total}`]
  if (s.currentPhase != null) {
    parts.push(`phase ${s.currentPhase + 1}/${plan.phases.length}: ${plan.phases[s.currentPhase]!.title}`)
  }
  parts.push(`${duration(s.elapsedMs)} in`)
  if (s.remainingMs != null) parts.push(`~${duration(s.remainingMs)} left`)
  return parts.join(' · ')
}

/** The tree as plain text, numbered as plan_mark takes it, for the model. */
export function outline(plan: Plan): string {
  return plan.phases
    .map((p, pi) => {
      const glyph = (st: StepStatus) => (st === 'done' ? '[x]' : st === 'active' ? '[>]' : st === 'skipped' ? '[-]' : '[ ]')
      const steps = p.steps.map((s, si) => `  ${pi + 1}.${si + 1} ${glyph(s.status)} ${s.title}`)
      return [`${pi + 1}. ${p.title}`, ...steps].join('\n')
    })
    .join('\n')
}

// ---------------------------------------------------------------- task sync

const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** The step a task or todo names: an exact match, or one containing the other. */
export function findStep(plan: Plan, text: string): { phase: number; step: number } | null {
  const want = norm(text)
  if (!want) return null
  let loose: { phase: number; step: number } | null = null
  for (let pi = 0; pi < plan.phases.length; pi++) {
    const steps = plan.phases[pi]!.steps
    for (let si = 0; si < steps.length; si++) {
      const have = norm(steps[si]!.title)
      if (have === want) return { phase: pi, step: si }
      const shorter = have.length < want.length ? have : want
      if (!loose && shorter.length >= 12 && (have.includes(want) || want.includes(have))) loose = { phase: pi, step: si }
    }
  }
  return loose
}

export const TASK_STATUS: Record<string, StepStatus | undefined> = {
  pending: undefined,
  in_progress: 'active',
  completed: 'done',
}
