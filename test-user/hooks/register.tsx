import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Run, RunStatus, Severity, TaskStatus } from '../types'
import { C, SEVERITY_COLOR, STATUS_COLOR, TASK_COLOR, TASK_GLYPH, emptySvg, runSvg } from './look'
import { AGENT_DESCRIPTION, TESTER_PROMPT } from './prompt'
import {
  MAX_RUNS,
  SEVERITIES,
  STATUS_LABEL,
  addFinding,
  advance,
  bySeverity,
  clean,
  cleanDetail,
  duration,
  finish,
  findingsLine,
  historyLine,
  newRun,
  plan,
  plural,
  report,
  setTask,
  stats,
  statusLine,
  verdictOf,
} from './run'

const PANE = 'test-user'
const TITLE = 'Test user'
const AGENT = 'test-user:tester'
const PLAN = 'mcp__test-user__test_plan'
const TASK = 'mcp__test-user__test_task'
const FINDING = 'mcp__test-user__test_finding'
const FINISH = 'mcp__test-user__test_finish'
const REPORT = 'mcp__test-user__test_report'
const TICK_MS = 30_000
// Roughly one cell of the desktop's code font, in CSS pixels.
const CELL_PX = 8
const MAIN = 'main'

const runsAtom = atom({ plugin: 'test-user', key: 'runs' } as const, [])
const nowAtom = atom({ plugin: 'test-user', key: 'now' } as const, 0)

type PlanInput = { tasks?: unknown[]; target?: string; scope?: 'feature' | 'app' }
type TaskInput = { task?: number; status?: TaskStatus; note?: string }
type FindingInput = { severity?: Severity; title?: string; detail?: string; where?: string; task?: number }
type FinishInput = { verdict?: 'passed' | 'issues' | 'blocked'; summary?: string; reason?: string }

// The loop a call came from: a tester subagent's id, or the main conversation.
const loopOf = (e: { agentId?: string }) => e.agentId ?? MAIN

async function save($: EngineInterface, fn: (runs: Run[], now: number) => Run[]): Promise<Run[]> {
  const now = await $.clock.now()
  const runs = await update($, runsAtom, r => fn(r, now).slice(0, MAX_RUNS))
  await update($, nowAtom, () => now)
  $.ui.status(runs[0] ? statusLine(runs[0], now) : undefined)
  return runs
}

/** Applies `fn` to the run in progress for this loop; null when there is none. */
async function changeRun($: EngineInterface, loop: string, fn: (run: Run, now: number) => Run): Promise<Run | null> {
  let changed: Run | null = null
  await save($, (runs, now) => {
    // `update` may run this again on a version miss: start each pass afresh.
    changed = null
    return runs.map(r => {
      if (changed || r.agentId !== loop || r.status !== 'running') return r
      return (changed = advance(fn(r, now), now))
    })
  })
  return changed
}

async function startRun($: EngineInterface, loop: string, tester: string, brief: string): Promise<Run> {
  const runs = await save($, (runs, now) => {
    // A loop has one run going at a time; an older one it left open is closed.
    const rest = runs.map(r => (r.agentId === loop && r.status === 'running' ? finish(r, verdictOf(r), now) : r))
    return [newRun(loop, tester, brief, now), ...rest]
  })
  await openPane($, false)
  return runs[0]!
}

// A pane that cannot open (refused, or no surface to draw on) never costs the run.
async function openPane($: EngineInterface, isAsked: boolean) {
  const opened = await $.ui.open({ id: PANE, title: TITLE }).catch(() => ({ isPlaced: false }))
  if (!opened.isPlaced && !isAsked) $.ui.toast('test-user: run /test-user to watch the test run')
}

const outcomeToast = (run: Run) => {
  const n = run.findings.length
  if (run.status === 'passed') return `test-user: all ${run.tasks.length} tasks passed`
  if (run.status === 'issues') return `test-user: done — ${plural(n, 'finding')}, ${run.tasks.filter(t => t.status === 'failed').length} failed`
  return `test-user: ${STATUS_LABEL[run.status].toLowerCase()}${run.failure ? ` — ${run.failure}` : ''}`
}

const firstLine = (t: string) => t.split(/\r?\n/).find(l => l.trim()) ?? ''

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)

    await $.agent.register({
      name: 'tester',
      description: AGENT_DESCRIPTION,
      prompt: TESTER_PROMPT,
      model: 'haiku',
      disallowedTools: ['Edit', 'Write', 'NotebookEdit', 'Agent', 'Workflow', 'Artifact', REPORT],
      maxTurns: 120,
    })

    await $.tool.register({
      name: 'test_plan',
      description:
        'Start (or replace) the task list of a UI/UX test run, shown live to the developer. Call once you know what you are testing. ' +
        'Used by the test-user:tester agent; Claude may also use it to record a test it runs by hand.',
      inputSchema: {
        type: 'object',
        properties: {
          tasks: { type: 'array', minItems: 1, maxItems: 15, items: { type: 'string' }, description: 'Things a user does, in order' },
          target: { type: 'string', description: 'Short name of what is tested, e.g. "Checkout · localhost:5173"' },
          scope: { type: 'string', enum: ['feature', 'app'], description: 'A recent feature, or the whole application' },
        },
        required: ['tasks'],
      },
      isDeferred: false,
    })
    await $.tool.register({
      name: 'test_task',
      description: 'Mark a task of the current test run active, passed, failed or skipped. Tasks count from 1. The next task becomes active by itself.',
      inputSchema: {
        type: 'object',
        properties: {
          task: { type: 'integer', minimum: 1 },
          status: { type: 'string', enum: ['active', 'passed', 'failed', 'skipped'] },
          note: { type: 'string', description: 'One line: what happened' },
        },
        required: ['task', 'status'],
      },
      isDeferred: false,
    })
    await $.tool.register({
      name: 'test_finding',
      description: 'Report one UI/UX problem seen during the current test run. One call per problem.',
      inputSchema: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: SEVERITIES, description: 'blocker: cannot complete; major: works badly; minor: friction or visual defect; polish: nit' },
          title: { type: 'string', description: 'The problem in a few words' },
          detail: { type: 'string', description: 'What you did, what happened, what you expected' },
          where: { type: 'string', description: 'The screen, URL or element' },
          task: { type: 'integer', minimum: 1, description: 'The task it came up in' },
        },
        required: ['severity', 'title'],
      },
      isDeferred: false,
    })
    await $.tool.register({
      name: 'test_finish',
      description: 'End the current test run with a verdict. "blocked" when the app could not be tested at all (give the reason).',
      inputSchema: {
        type: 'object',
        properties: {
          verdict: { type: 'string', enum: ['passed', 'issues', 'blocked'] },
          summary: { type: 'string', description: 'Two to four sentences for the developer' },
          reason: { type: 'string', description: 'Why it was blocked' },
        },
        required: ['verdict', 'summary'],
      },
      isDeferred: false,
    })
    await $.tool.register({
      name: 'test_report',
      description: 'Read the latest test-user run (or one in progress): its tasks, findings and failures, as text.',
      inputSchema: { type: 'object', properties: {} },
      isDeferred: true,
    })
    await $.command.register({
      name: 'test-user',
      description: 'Show the test user pane (run [what]: start a test run; clear: forget the runs)',
      argumentHint: '[run [what to test] | clear]',
      immediate: true,
    })

    $.clock.every(TICK_MS, () => {
      void (async () => {
        const runs = await read($, runsAtom)
        if (runs[0]?.status !== 'running') return
        const t = await $.clock.now()
        await update($, nowAtom, () => t)
        $.ui.status(statusLine(runs[0], t))
      })()
    })

    // After a reload the runs are still in the session's state.
    const runs = await read($, runsAtom)
    if (runs[0]) $.ui.status(statusLine(runs[0], await $.clock.now()))
    return result
  })

  // A tester subagent starting is a run starting.
  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (e.subagentType !== AGENT || !('agentId' in started) || !started.agentId) return started
    await startRun($, started.agentId, 'Haiku test user', e.description || firstLine(e.prompt))
    return started
  })

  // Its turn ending is the run ending, whatever the tester remembered to say.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const loop = e.agentId
    if (!loop) return result
    const runs = await read($, runsAtom)
    if (!runs.some(r => r.agentId === loop && r.status === 'running')) return result

    const ended = await save($, (runs, now) =>
      runs.map(r => {
        if (r.agentId !== loop || r.status !== 'running') return r
        if (e.reason === 'aborted') return finish(r, 'failed', now, undefined, 'The run was interrupted.')
        if (e.reason !== 'answer') return finish(r, 'failed', now, undefined, `The tester stopped: ${e.reason === 'refusal' ? 'the model refused' : 'an API error'}.`)
        return finish(r, verdictOf(r), now, r.summary ?? (clean(e.answer, 300) || undefined))
      }),
    )
    const run = ended.find(r => r.agentId === loop)
    if (run) $.ui.toast(outcomeToast(run))
    return result
  })

  on('tool.call', { tool: PLAN }, async ($, e) => {
    const input = e as unknown as PlanInput
    const tasks = (input.tasks ?? []).map(t => clean(t)).filter(Boolean)
    if (tasks.length === 0) return { deny: 'test_plan needs at least one task.' }
    const loop = loopOf(e)
    const runs = await read($, runsAtom)
    if (!runs.some(r => r.agentId === loop && r.status === 'running')) {
      await startRun($, loop, loop === MAIN ? 'Claude' : 'Haiku test user', input.target ?? 'Test run')
    }
    const run = (await changeRun($, loop, (r, now) => ({
      ...plan(r, tasks, now),
      target: input.target ? clean(input.target, 80) : r.target,
      scope: input.scope ?? r.scope,
    })))!
    return { result: `Task list shown to the developer:\n${run.tasks.map((t, i) => `${i + 1}. ${t.title}`).join('\n')}\n\nTask 1 is active. Mark each with test_task; report problems with test_finding.` }
  })

  on('tool.call', { tool: TASK }, async ($, e) => {
    const input = e as unknown as TaskInput
    const loop = loopOf(e)
    const status = input.status ?? 'passed'
    let error = ''
    const run = await changeRun($, loop, (r, now) => {
      const i = Number(input.task) - 1
      if (!r.tasks[i]) {
        error = `There is no task ${input.task}; the run has ${r.tasks.length}.`
        return r
      }
      return setTask(r, i, status, input.note ? clean(input.note, 160) : undefined, now)
    })
    if (!run) return { deny: 'No test run in progress here. Call test_plan first.' }
    if (error) return { deny: error }
    const s = stats(run, await $.clock.now())
    const cur = s.current != null ? ` Now on task ${s.current + 1}: ${run.tasks[s.current]!.title}.` : s.closed === s.total ? ' All tasks done: call test_finish.' : ''
    return { result: `Task ${input.task} ${status}. ${s.closed}/${s.total} done, ${plural(run.findings.length, 'finding')}.${cur}` }
  })

  on('tool.call', { tool: FINDING }, async ($, e) => {
    const input = e as unknown as FindingInput
    const title = clean(input.title)
    if (!title) return { deny: 'A finding needs a title.' }
    const severity: Severity = SEVERITIES.includes(input.severity as Severity) ? (input.severity as Severity) : 'minor'
    const run = await changeRun($, loopOf(e), (r, now) => {
      const active = r.tasks.findIndex(t => t.status === 'active')
      const task = input.task != null && r.tasks[Number(input.task) - 1] ? Number(input.task) - 1 : active >= 0 ? active : undefined
      return addFinding(
        r,
        { severity, title, detail: input.detail ? cleanDetail(input.detail) : undefined, where: input.where ? clean(input.where, 80) : undefined, task },
        now,
      )
    })
    if (!run) return { deny: 'No test run in progress here. Call test_plan first.' }
    return { result: `Recorded (${severity}). ${findingsLine(stats(run, 0))} so far.` }
  })

  on('tool.call', { tool: FINISH }, async ($, e) => {
    const input = e as unknown as FinishInput
    const loop = loopOf(e)
    const runs = await read($, runsAtom)
    let run = runs.find(r => r.agentId === loop && r.status === 'running')
    // Blocked before it planned anything: still a run the developer should see.
    if (!run && input.verdict === 'blocked') run = await startRun($, loop, loop === MAIN ? 'Claude' : 'Haiku test user', 'Test run')
    if (!run) return { deny: 'No test run in progress here. Call test_plan first.' }

    const summary = input.summary ? cleanDetail(input.summary) : undefined
    const ended = await save($, (all, now) =>
      all.map(r => {
        if (r !== all.find(x => x.agentId === loop && x.status === 'running')) return r
        // The record wins over a verdict it contradicts: failed tasks or findings are issues.
        const verdict: RunStatus = input.verdict === 'blocked' ? 'blocked' : verdictOf(r) === 'issues' ? 'issues' : input.verdict === 'issues' ? 'issues' : 'passed'
        return finish(r, verdict, now, summary, verdict === 'blocked' ? clean(input.reason ?? input.summary ?? 'No reason given', 300) : undefined)
      }),
    )
    const done = ended.find(r => r.agentId === loop)!
    $.ui.toast(outcomeToast(done))
    return { result: `Run ended: ${STATUS_LABEL[done.status]}. Now give your final report.` }
  })

  on('tool.call', { tool: REPORT }, async ($, e) => {
    const runs = await read($, runsAtom)
    if (!runs[0]) return { result: 'No test run yet. Spawn the test-user:tester agent to run one.' }
    const now = await $.clock.now()
    const earlier = runs.slice(1).map(r => `- ${historyLine(r, now)}`)
    return { result: report(runs[0], now) + (earlier.length ? `\n\nEarlier runs:\n${earlier.join('\n')}` : '') }
  })

  on('command.run', { command: 'test-user' }, async ($, e) => {
    const args = e.args.trim()
    if (args === 'clear') {
      await save($, () => [])
      await $.ui.close({ id: PANE }).catch(() => {})
      return { text: 'Cleared the test runs.' }
    }
    await openPane($, true)
    const run = /^run\b\s*(.*)$/is.exec(args)
    if (run) {
      const what = run[1]!.trim()
      void $.prompt.submit({
        text: what
          ? `Use the ${AGENT} agent to UI/UX test: ${what}`
          : `Use the ${AGENT} agent to UI/UX test the application. Focus on the feature most recently developed in this session; if nothing was built in this session, test the entire application.`,
      })
      return { text: `Starting a test run${what ? `: ${what}` : ''}.` }
    }
    const runs = await read($, runsAtom)
    if (!runs[0]) return { text: 'No test run yet: ask Claude to test the app, or run /test-user run [what to test].' }
    return { text: statusLine(runs[0], await $.clock.now()) }
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') await save($, () => [])
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const runs = await read($, runsAtom)
    await read($, nowAtom)
    const now = await $.clock.now()

    // Where the surface draws images, the pane is a stack of cards.
    if (e.surface !== 'terminal') {
      const { Box, Svg } = $.ui.resolve(e)
      const width = e.props.bodyColumns * CELL_PX
      if (!runs[0]) {
        const empty = emptySvg(width)
        return <Svg source={empty.source} alt="No test run yet" width={Math.max(300, width)} height={empty.height} />
      }
      const drawn = runSvg(runs, now, width)
      return (
        <Box flexDirection="column" key="test-user">
          <Svg source={drawn.source} alt={drawn.alt} width={Math.max(300, width)} height={drawn.height} />
        </Box>
      )
    }

    const { Box, Text } = $.ui.resolve(e)
    const run = runs[0]
    if (!run) {
      return (
        <Box flexDirection="column" borderStyle="round" borderColor={C.stroke} paddingX={1}>
          <Text bold color={C.text}>
            No test run yet
          </Text>
          <Text color={C.muted} wrap="wrap">
            Ask Claude to test the app, or run /test-user run [what to test].
          </Text>
        </Box>
      )
    }

    const s = stats(run, now)
    const tone = STATUS_COLOR[run.status]
    return (
      <Box flexDirection="column" key="test-user">
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold color={C.text} wrap="truncate">
            {run.target ?? run.brief}
          </Text>
          <Text color={tone} bold>{` ${STATUS_LABEL[run.status]}`}</Text>
        </Box>
        <Box flexDirection="row">
          <Text bold color={C.text}>{`${s.passed}/${s.total || '–'}`}</Text>
          <Text color={C.muted}>{` passed · ${s.failed} failed · `}</Text>
          <Text color={s.counts.blocker ? C.hot : s.counts.major ? C.warn : C.accent}>{plural(run.findings.length, 'finding')}</Text>
          <Text color={C.muted}>{` · ${duration(s.elapsedMs)} · ${run.tester}`}</Text>
        </Box>

        {run.failure && (
          <Box flexDirection="column" borderStyle="round" borderColor={C.hot} paddingX={1} key="failure">
            <Text bold color={C.hot}>
              {run.status === 'blocked' ? 'Could not test' : 'The run failed'}
            </Text>
            <Text color={C.soft} wrap="wrap">
              {run.failure}
            </Text>
          </Box>
        )}

        <Text> </Text>
        <Box flexDirection="column" borderStyle="round" borderColor={run.status === 'running' ? C.deep : C.stroke} paddingX={1} key="tasks">
          <Box flexDirection="row" justifyContent="space-between">
            <Text bold color={C.text}>
              Tasks
            </Text>
            <Text color={C.muted}>{`${s.closed}/${s.total}`}</Text>
          </Box>
          {run.tasks.length === 0 && <Text color={C.muted}>Working out what to test…</Text>}
          {run.tasks.flatMap((t, i) => {
            const took = t.startedAt != null && t.status !== 'skipped' ? duration((t.endedAt ?? now) - t.startedAt) : ''
            const row = (
              <Box flexDirection="row" justifyContent="space-between" key={`task-${i}`}>
                <Box flexDirection="row" flexShrink={1}>
                  <Text color={TASK_COLOR[t.status]}>{`${TASK_GLYPH[t.status]} `}</Text>
                  <Text
                    color={t.status === 'active' || t.status === 'failed' ? C.text : t.status === 'passed' ? C.soft : C.muted}
                    bold={t.status === 'active'}
                    strikethrough={t.status === 'skipped'}
                    wrap="truncate"
                  >
                    {t.title}
                  </Text>
                </Box>
                <Text color={t.status === 'active' ? C.accent : C.muted}>{took ? ` ${took}` : ''}</Text>
              </Box>
            )
            if (!t.note || (t.status !== 'failed' && t.status !== 'active')) return [row]
            return [
              row,
              <Text color={t.status === 'failed' ? C.hot : C.muted} wrap="truncate" key={`note-${i}`}>
                {`  ${t.note}`}
              </Text>,
            ]
          })}
        </Box>

        {bySeverity(run.findings).map((f, i) => (
          <Box flexDirection="column" borderStyle="round" borderColor={SEVERITY_COLOR[f.severity]} paddingX={1} key={`finding-${i}`}>
            <Box flexDirection="row" justifyContent="space-between">
              <Text bold color={C.text} wrap="truncate">
                {f.title}
              </Text>
              <Text color={SEVERITY_COLOR[f.severity]} bold>{` ${f.severity.toUpperCase()}`}</Text>
            </Box>
            {(f.where || f.task != null) && (
              <Text color={C.muted} wrap="truncate">
                {[f.task != null && run.tasks[f.task] ? `task ${f.task + 1}` : '', f.where ?? ''].filter(Boolean).join(' · ')}
              </Text>
            )}
            {f.detail && (
              <Text color={C.soft} wrap="wrap">
                {f.detail}
              </Text>
            )}
          </Box>
        ))}

        {run.summary && (
          <Box flexDirection="column" paddingX={1} key="summary">
            <Text bold color={C.text}>
              Summary
            </Text>
            <Text color={C.soft} wrap="wrap">
              {run.summary}
            </Text>
          </Box>
        )}

        {runs.slice(1).map((old, i) => (
          <Box flexDirection="row" key={`old-${i}`}>
            <Text color={STATUS_COLOR[old.status]}>{'● '}</Text>
            <Text color={C.muted} wrap="truncate">{`Earlier: ${historyLine(old, now)}`}</Text>
          </Box>
        ))}
      </Box>
    )
  })
}
