import { atom, read, update } from 'claude-code'
import type { Color, EngineInterface, Register } from 'claude-code'

import type { Plan, StepStatus } from '../types'
import {
  TASK_STATUS,
  bar,
  duration,
  findStep,
  mark,
  newPlan,
  outline,
  parsePlan,
  phaseDuration,
  phaseState,
  stats,
  statusLine,
} from './plan'

const PANE = 'plan-progress'
const TITLE = 'Plan progress'
const SET = 'mcp__plan-progress__plan_set'
const MARK = 'mcp__plan-progress__plan_mark'
const TICK_MS = 30_000

const planAtom = atom({ plugin: 'plan-progress', key: 'plan' } as const, null)
const nowAtom = atom({ plugin: 'plan-progress', key: 'now' } as const, 0)
const tasksAtom = atom({ plugin: 'plan-progress', key: 'tasks' } as const, {})

type PlanSetInput = { title?: string; phases?: { title?: string; steps?: string[] }[] }
type PlanMarkInput = { phase?: number; step?: number; status?: StepStatus }

// With nothing in progress, the first open step after the last one finished
// becomes the current one, so its time starts counting.
function advance(plan: Plan, now: number): Plan {
  const steps = plan.phases.flatMap((p, pi) => p.steps.map((s, si) => ({ s, pi, si })))
  if (steps.some(x => x.s.status === 'active')) return plan
  const next = steps.find(x => x.s.status === 'pending')
  return next ? mark(plan, next.pi, next.si, 'active', now) : plan
}

async function setPlan($: EngineInterface, plan: Plan | null) {
  await update($, planAtom, () => plan)
  const t = await $.clock.now()
  await update($, nowAtom, () => t)
  $.ui.status(plan ? statusLine(plan, t) : undefined)
}

async function change($: EngineInterface, fn: (plan: Plan, now: number) => Plan): Promise<Plan | null> {
  const now = await $.clock.now()
  const before = await read($, planAtom)
  if (!before) return null
  const after = advance(fn(before, now), now)
  await setPlan($, after)
  return after
}

const progressText = (plan: Plan, now: number) => {
  const s = stats(plan, now)
  if (s.isFinished) return `Plan finished: ${s.total} steps in ${duration(s.elapsedMs)}.`
  const parts = [`${s.closed}/${s.total} steps (${s.percent}%)`]
  if (s.currentPhase != null) parts.push(`phase ${s.currentPhase + 1}/${plan.phases.length}`)
  parts.push(`${duration(s.elapsedMs)} in`)
  if (s.remainingMs != null) parts.push(`~${duration(s.remainingMs)} left`)
  return parts.join(' · ')
}

const howToKeepIt = (plan: Plan) =>
  [
    `plan-progress: the user sees this plan as a progress tree (${plan.phases.length} phases, ${plan.phases.flatMap(p => p.steps).length} steps):`,
    outline(plan),
    `Keep it current as you work: call ${MARK} with { phase, step, status } as you finish each step ("done"; the next step becomes current by itself) or skip one. ` +
      `If you track the work with TaskCreate/TaskUpdate or TodoWrite instead, name the tasks exactly like the steps above and the tree follows them. ` +
      `If this tree misreads the plan, call ${SET} with the right phases and steps.`,
  ].join('\n\n')

// A pane that cannot open (refused, or no surface to draw on) never costs the plan.
async function openPane($: EngineInterface, isAsked: boolean) {
  const opened = await $.ui.open({ id: PANE, title: TITLE }).catch(() => ({ isPlaced: false }))
  if (!opened.isPlaced && !isAsked) $.ui.toast('plan-progress: run /plan-progress to see the phase tree')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)

    await $.tool.register({
      name: 'plan_set',
      description:
        'Show the user a progress tree for a long, multi-phase task: the phases in order, each with its steps. ' +
        'Use it when you start work that spans several phases and no plan-mode plan was approved, or to correct a tree that misread the plan. ' +
        'Replaces the current tree. Then report progress with plan_mark.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'A short name for the whole task' },
          phases: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                steps: { type: 'array', items: { type: 'string' }, description: 'Short step titles, in order' },
              },
              required: ['title', 'steps'],
            },
          },
        },
        required: ['phases'],
      },
      isDeferred: false,
    })
    await $.tool.register({
      name: 'plan_mark',
      description:
        "Update the user's plan progress tree. Mark a step done when you finish it (the next step becomes current by itself), " +
        'active when you start one out of order, skipped when you drop it, or leave out step to mark a whole phase. ' +
        'Phases and steps count from 1, as the outline shows them. Only use while a plan tree exists.',
      inputSchema: {
        type: 'object',
        properties: {
          phase: { type: 'integer', minimum: 1 },
          step: { type: 'integer', minimum: 1, description: 'Leave out to mark every open step of the phase' },
          status: { type: 'string', enum: ['done', 'active', 'skipped', 'pending'] },
        },
        required: ['phase', 'status'],
      },
      isDeferred: false,
    })
    await $.command.register({
      name: 'plan-progress',
      description: 'Show the phase tree of the current plan (clear: stop tracking it)',
      argumentHint: '[clear]',
      immediate: true,
    })

    // Elapsed times move while a plan runs: redraw them twice a minute.
    $.clock.every(TICK_MS, () => {
      void (async () => {
        const plan = await read($, planAtom)
        if (!plan || stats(plan, 0).isFinished) return
        const t = await $.clock.now()
        await update($, nowAtom, () => t)
        $.ui.status(statusLine(plan, t))
      })()
    })

    // After a reload the plan is still in the session's state.
    const plan = await read($, planAtom)
    if (plan) $.ui.status(statusLine(plan, await $.clock.now()))

    return result
  })

  // An approved plan-mode plan becomes the tree.
  on('tool.call', { tool: 'ExitPlanMode' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError) return ran

    const text = (ran.result as { plan?: string | null } | undefined)?.plan
    if (!text) return ran
    const parsed = parsePlan(text)
    if (parsed.phases.flatMap(p => p.steps).length < 2) return ran

    const now = await $.clock.now()
    const plan = advance(newPlan(parsed.title, parsed.phases.map(p => ({ title: p.title, steps: p.steps.map(s => s.title) })), 'plan-mode', now), now)
    await setPlan($, plan)
    await openPane($, false)

    return { ...ran, context: [...(ran.context ?? []), howToKeepIt(plan)] }
  })

  on('tool.call', { tool: SET }, async ($, e) => {
    const input = e as unknown as PlanSetInput
    const phases = (input.phases ?? [])
      .map(p => ({ title: String(p.title ?? ''), steps: (p.steps ?? []).map(String) }))
      .filter(p => p.title || p.steps.length)
    if (phases.length === 0) return { deny: 'plan_set needs at least one phase with a title and steps.' }

    const now = await $.clock.now()
    const plan = advance(newPlan(input.title ?? 'Plan', phases, 'model', now), now)
    await setPlan($, plan)
    await openPane($, false)
    return { result: `Tree shown to the user:\n${outline(plan)}\n\nReport progress with plan_mark.` }
  })

  on('tool.call', { tool: MARK }, async ($, e) => {
    const input = e as unknown as PlanMarkInput
    const plan = await read($, planAtom)
    if (!plan) return { deny: 'No plan is being tracked. Call plan_set first.' }

    const pi = Number(input.phase) - 1
    const phase = plan.phases[pi]
    if (!phase) return { deny: `There is no phase ${input.phase}; the plan has ${plan.phases.length}.\n${outline(plan)}` }
    const si = input.step == null ? undefined : Number(input.step) - 1
    if (si !== undefined && !phase.steps[si]) {
      return { deny: `Phase ${input.phase} has no step ${input.step}; it has ${phase.steps.length}.\n${outline(plan)}` }
    }
    const status = input.status ?? 'done'

    const after = (await change($, (p, now) => mark(p, pi, si, status, now)))!
    const now = await $.clock.now()
    const nextUp = after.phases.flatMap((p, i) => p.steps.map((s, j) => ({ s, at: `${i + 1}.${j + 1}` }))).find(x => x.s.status === 'active')
    const what = si === undefined ? `Phase ${pi + 1}` : `Step ${pi + 1}.${si + 1}`
    return { result: `${what} marked ${status}. ${progressText(after, now)}${nextUp ? `. Current: ${nextUp.at} ${nextUp.s.title}` : ''}` }
  })

  // Tasks and todos named like a step move that step.
  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError || !(await read($, planAtom))) return ran
    const todos = (e as unknown as { todos?: { content: string; status: string }[] }).todos ?? []
    await change($, (plan, now) =>
      todos.reduce((p, todo) => {
        const at = findStep(p, todo.content)
        const status = TASK_STATUS[todo.status]
        const current = at && p.phases[at.phase]!.steps[at.step]!.status
        return at && status && current !== status && current !== 'done' ? mark(p, at.phase, at.step, status, now) : p
      }, plan),
    )
    return ran
  })

  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const ran = await next(e)
    const id = (ran.result as { task?: { id?: string } } | undefined)?.task?.id
    const subject = (e as unknown as { subject?: string }).subject
    if (id && subject) await update($, tasksAtom, t => ({ ...t, [id]: subject }))
    return ran
  })

  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const ran = await next(e)
    const input = e as unknown as { taskId: string; subject?: string; status?: string }
    if (ran.deny !== undefined || ran.isError) return ran
    const tasks = await read($, tasksAtom)
    const subject = input.subject ?? tasks[input.taskId]
    if (input.subject) await update($, tasksAtom, t => ({ ...t, [input.taskId]: input.subject! }))
    const status = input.status ? TASK_STATUS[input.status] : undefined
    if (!subject || !status || !(await read($, planAtom))) return ran
    await change($, (plan, now) => {
      const at = findStep(plan, subject)
      return at && plan.phases[at.phase]!.steps[at.step]!.status !== 'done' ? mark(plan, at.phase, at.step, status, now) : plan
    })
    return ran
  })

  on('command.run', { command: 'plan-progress' }, async ($, e) => {
    if (e.args.trim() === 'clear') {
      await setPlan($, null)
      await $.ui.close({ id: PANE }).catch(() => {})
      return { text: 'Stopped tracking the plan.' }
    }
    const plan = await read($, planAtom)
    await openPane($, true)
    if (!plan) return { text: 'No plan yet: approve a plan in plan mode, or ask Claude to lay the task out in phases.' }
    return { text: `${plan.title}: ${progressText(plan, await $.clock.now())}` }
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') await setPlan($, null)
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const plan = await read($, planAtom)
    await read($, nowAtom)
    const now = await $.clock.now()

    if (!plan) {
      return (
        <Box flexDirection="column">
          <Text dimColor>No plan yet.</Text>
          <Text dimColor wrap="wrap">
            Approve a plan in plan mode, or ask Claude to lay a long task out in phases, and its progress shows here.
          </Text>
        </Box>
      )
    }

    const s = stats(plan, now)
    const room = Math.max(4, e.props.scroll.bodyRows)
    // Fold finished phases, then the ones after the next, until the tree fits.
    const isOpen = plan.phases.map(() => true)
    const rows = () => 3 + plan.phases.reduce((n, p, i) => n + 1 + (isOpen[i] ? p.steps.length : 0), 0)
    plan.phases.forEach((p, i) => {
      if (rows() > room && phaseState(p) === 'done') isOpen[i] = false
    })
    const firstPending = plan.phases.findIndex(p => phaseState(p) === 'pending')
    plan.phases.forEach((p, i) => {
      if (rows() > room && phaseState(p) === 'pending' && i !== firstPending) isOpen[i] = false
    })

    const cells = Math.max(6, Math.min(20, e.props.bodyColumns - 40))
    const { filled, track } = bar(s.percent, cells)
    const glyph: Record<string, [string, Color]> = {
      done: ['✓', 'success'],
      active: ['●', 'claude'],
      pending: ['○', 'inactive'],
      skipped: ['–', 'subtle'],
    }

    const timing = [`${duration(s.elapsedMs)} ${s.isFinished ? 'total' : 'in'}`]
    if (!s.isFinished && s.remainingMs != null) timing.push(`~${duration(s.remainingMs)} left`)

    return (
      <Box flexDirection="column" key="plan-progress">
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold wrap="truncate">
            {plan.title}
          </Text>
          <Text color="inactive"> {timing.join(' · ')}</Text>
        </Box>
        <Box flexDirection="row">
          <Text color={s.isFinished ? 'success' : 'claude'}>{filled}</Text>
          <Text color="subtle">{track}</Text>
          <Text bold color={s.isFinished ? 'success' : 'text'}>
            {` ${s.percent}%`}
          </Text>
          <Text color="inactive">{`  ${s.closed}/${s.total} steps · phase ${Math.min(plan.phases.length, (s.currentPhase ?? plan.phases.length - 1) + 1)}/${plan.phases.length}`}</Text>
        </Box>
        <Text> </Text>
        {plan.phases.flatMap((p, pi) => {
          const state = phaseState(p)
          const [g, color] = glyph[state]!
          const took = phaseDuration(plan, pi, now)
          const closed = p.steps.filter(x => x.status === 'done' || x.status === 'skipped').length
          const right = [isOpen[pi] ? '' : `${closed}/${p.steps.length}`, took != null ? duration(took) : ''].filter(Boolean).join(' · ')
          const head = (
            <Box flexDirection="row" justifyContent="space-between" key={`phase-${pi}`}>
              <Box flexDirection="row" flexShrink={1}>
                <Text color={color}>{`${g} `}</Text>
                <Text bold={state === 'active'} color={state === 'pending' ? 'inactive' : 'text'} wrap="truncate">
                  {`${pi + 1} ${p.title}`}
                </Text>
              </Box>
              <Text color="subtle">{right ? ` ${right}` : ''}</Text>
            </Box>
          )
          if (!isOpen[pi]) return [head]
          return [
            head,
            ...p.steps.map((step, si) => {
              const [sg, sc] = glyph[step.status]!
              const isLast = si === p.steps.length - 1
              const took = step.startedAt != null ? (step.endedAt ?? now) - step.startedAt : null
              return (
                <Box flexDirection="row" justifyContent="space-between" key={`step-${pi}-${si}`}>
                  <Box flexDirection="row" flexShrink={1}>
                    <Text color="subtle">{isLast ? '  └ ' : '  ├ '}</Text>
                    <Text color={sc}>{`${sg} `}</Text>
                    <Text
                      color={step.status === 'active' ? 'claude' : step.status === 'pending' ? 'inactive' : step.status === 'skipped' ? 'subtle' : 'text'}
                      strikethrough={step.status === 'skipped'}
                      wrap="truncate"
                    >
                      {step.title}
                    </Text>
                  </Box>
                  <Text color="subtle">{took != null && step.status !== 'skipped' ? ` ${duration(took)}` : ''}</Text>
                </Box>
              )
            }),
          ]
        })}
      </Box>
    )
  })
}
