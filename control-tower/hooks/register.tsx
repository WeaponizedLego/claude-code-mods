import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Board, Mode, Task, Validation } from '../types'
import { checkBash, checkWrite } from './guards'
import type { GuardContext } from './guards'
import { findHub, loadRegistry, needsYou, scan, stageOf, taskOf, worktreeIn } from './hub'
import type { Io, Registry } from './hub'
import { C, emptySvg, footerSvg, headerSvg, metaOf, setupSvg, shortCommand, statOf, taskSvg, validationSvg } from './look'

const PANE = 'control-tower'
const TITLE = 'Control Tower'
const SYNC_MS = 180_000
const TICK_MS = 60_000
// Roughly one cell of the desktop's code font, in CSS pixels.
const CELL_PX = 8
const KEY = /^[A-Z][A-Z0-9]+-\d+$/

const boardAtom = atom({ plugin: 'control-tower', key: 'board' } as const, null)
const syncingAtom = atom({ plugin: 'control-tower', key: 'isSyncing' } as const, false)
const validationAtom = atom({ plugin: 'control-tower', key: 'validation' } as const, null)
const modeAtom = atom({ plugin: 'control-tower', key: 'mode' } as const, 'unattended')
const activeAtom = atom({ plugin: 'control-tower', key: 'active' } as const, null)
const blockedAtom = atom({ plugin: 'control-tower', key: 'blocked' } as const, 0)
const nowAtom = atom({ plugin: 'control-tower', key: 'now' } as const, 0)
const draftAtom = atom({ plugin: 'control-tower', key: 'draft' } as const, '')

// The engine calls the hub's scan needs, every failure read as "not there".
const ioOf = ($: EngineInterface): Io => ({
  cwd: () => $.session.cwd(),
  now: () => $.clock.now(),
  exists: path => $.fs.exists(path).catch(() => false),
  read: path => $.fs.read(path).catch(() => ''),
  list: path => $.fs.list(path).catch(() => []),
  run: (argv, cwd, timeoutMs = 20_000) => $.process.run(argv, { cwd, timeoutMs }).catch(() => ({ exitCode: 1, stdout: '', stderr: '' })),
})

// The registry files, read once per load and again at each sync.
let registry: Registry | null = null
async function registryOf($: EngineInterface, hub: string): Promise<Registry> {
  return (registry ??= await loadRegistry(ioOf($), hub))
}

async function setStatus($: EngineInterface) {
  const board = await read($, boardAtom)
  if (!board) return $.ui.status(undefined)
  const [active, mode] = await Promise.all([read($, activeAtom), read($, modeAtom)])
  const task = board.tasks.find(t => t.path === active)
  const where = active ? taskOf(active, board.hub) : null
  if (where) {
    $.ui.status(`● ${where.key} · ${where.repo} · base ${task?.base ?? '…'} · ${mode}`)
    return
  }
  const need = board.tasks.filter(needsYou).length
  const setup = !board.setup.hasLocalRepos || board.setup.hasPackagesScope === false ? ' · setup incomplete' : ''
  $.ui.status(`control tower · ${board.tasks.length} tasks${need ? ` · ${need} need you` : ''}${setup}`)
}

// What changed between two syncs that is worth a toast: new review threads, a merge.
function news(before: Task[], after: Task[]): string[] {
  const out: string[] = []
  for (const t of after) {
    const old = before.find(b => b.path === t.path)
    if (!old || !t.pr) continue
    if (t.pr.unresolved > (old.pr?.unresolved ?? 0)) out.push(`${t.key} has ${t.pr.unresolved} unresolved review ${t.pr.unresolved === 1 ? 'thread' : 'threads'}`)
    if (old.pr?.state === 'OPEN' && t.pr.state === 'MERGED') out.push(`${t.key} merged: close the task to remove its worktree`)
  }
  return out
}

async function sync($: EngineInterface) {
  const board = await read($, boardAtom)
  if (!board || (await read($, syncingAtom))) return
  await update($, syncingAtom, () => true)
  try {
    registry = await loadRegistry(ioOf($), board.hub)
    const next = await scan(ioOf($), board.hub, registry)
    const before = (await read($, boardAtom))?.tasks ?? []
    await update($, boardAtom, () => next)
    if (board.syncedAt > 0) for (const line of news(before, next.tasks)) $.ui.toast(`Control Tower: ${line}`)
  } finally {
    await update($, syncingAtom, () => false)
    const t = await $.clock.now()
    await update($, nowAtom, () => t)
    await setStatus($)
  }
}

async function openPane($: EngineInterface) {
  await $.ui.open({ id: PANE, title: TITLE }).catch(() => ({ isPlaced: false }))
}

// A hub skill by its slash command; a plain prompt where the command cannot run.
async function runSkill($: EngineInterface, name: string, args: string) {
  try {
    await $.command.run({ command: name, args })
  } catch {
    await $.prompt.submit({ text: `/${name} ${args}`.trim(), asUser: true })
  }
}

async function startTicket($: EngineInterface, skill: 'task-start' | 'implement-ticket') {
  const key = (await read($, draftAtom)).trim().toUpperCase()
  if (!KEY.test(key)) {
    $.ui.toast('Control Tower: type a ticket key like OPS-123 first')
    return
  }
  await update($, draftAtom, () => '')
  await runSkill($, skill, key)
}

async function setMode($: EngineInterface, mode: Mode) {
  await update($, modeAtom, () => mode)
  await setStatus($)
}

const SETUP_PROMPT =
  'Set up this sentinel-hill hub. Ask me which folder holds my clones of the repos in repos.yaml, run scripts/setup-local-repos.sh with it, ' +
  'then run scripts/setup-github-auth.sh. If gh lacks the read:packages scope, tell me to run `gh auth refresh -s read:packages` myself.'

async function guardContext($: EngineInterface, board: Board): Promise<GuardContext> {
  const prefixes = new Set(board.tasks.map(t => t.key.split('-')[0]!))
  const active = await read($, activeAtom)
  if (active) prefixes.add(taskOf(active, board.hub)?.key.split('-')[0] ?? '')
  prefixes.delete('')
  return { hub: board.hub, registry: await registryOf($, board.hub), active, keyPrefixes: [...prefixes] }
}

async function refuse($: EngineInterface, why: string) {
  await update($, blockedAtom, n => n + 1)
  return { deny: why }
}

// Remembers the worktree a tool call names, for the status line and a bare `git commit`.
async function touch($: EngineInterface, board: Board, text: string) {
  const path = worktreeIn(text, board.hub) ?? (text.startsWith(`${board.hub}/work/`) ? text : null)
  const where = path ? taskOf(path, board.hub) : null
  if (!where) return
  const worktree = `${board.hub}/work/${where.repo}/${where.folder}`
  if ((await read($, activeAtom)) === worktree) return
  await update($, activeAtom, () => worktree)
  await setStatus($)
}

const collapse = (s: string) => s.trim().replace(/\s+/g, ' ')

/** The validate commands a Bash call runs, and the repo whose list they belong to. */
function validateRun(command: string, reg: Registry, activeRepo: string | undefined): { repo: string; commands: string[] } | null {
  const parts = command.split(/&&|;|\n/).map(collapse)
  const repos = Object.entries(reg.repos).sort(([a], [b]) => Number(b === activeRepo) - Number(a === activeRepo))
  for (const [repo, facts] of repos) {
    const list = facts.validate.map(collapse)
    const commands = parts.filter(p => list.includes(p))
    if (commands.length) return { repo, commands }
  }
  return null
}

async function markChecks($: EngineInterface, repo: string, commands: string[], status: Validation['checks'][number]['status']) {
  const reg = registry
  if (!reg) return
  await update($, validationAtom, v => {
    const base: Validation =
      v && v.repo === repo ? v : { repo, checks: (reg.repos[repo]?.validate ?? []).map(command => ({ command: collapse(command), status: 'pending' as const })) }
    return { ...base, checks: base.checks.map(c => (commands.includes(c.command) ? { ...c, status } : c)) }
  })
}

const isHub = async ($: EngineInterface) => (await read($, boardAtom)) !== null

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    const hub = await findHub(ioOf($))
    if (!hub) {
      await update($, boardAtom, () => null)
      return result
    }

    await $.command.register({
      name: 'tower',
      description: 'Show the Control Tower board (refresh: sync now; interactive or unattended: set the mode)',
      argumentHint: '[refresh | interactive | unattended]',
      immediate: true,
    })

    // After a reload the board is still in the session's state; a new session starts from disk.
    const kept = await read($, boardAtom)
    if (!kept || kept.hub !== hub) {
      await update($, boardAtom, () => ({ hub, tasks: [], setup: { hasLocalRepos: true, hasPackagesScope: null }, syncedAt: 0 }))
    }
    registry = null
    void sync($)
    $.clock.every(SYNC_MS, () => void sync($))
    $.clock.every(TICK_MS, () => void $.clock.now().then(t => update($, nowAtom, () => t)))
    if (!kept) await openPane($)
    await setStatus($)
    return result
  })

  on('command.run', { command: 'tower' }, async ($, e) => {
    if (!(await isHub($))) return { text: 'Control Tower works in a sentinel-hill hub: start the session in the folder that holds repos.yaml.' }
    const arg = e.args.trim().toLowerCase()
    if (arg === 'interactive' || arg === 'unattended') {
      await setMode($, arg)
      return { text: `Mode: ${arg}.` }
    }
    await openPane($)
    void sync($)
    return { text: arg === 'refresh' ? 'Syncing the board.' : 'Control Tower is open.' }
  })

  // Interactive mode adds the approval gates AGENTS.md describes for "interactive".
  on('prompt.submit', async ($, e, next) => {
    const board = await read($, boardAtom)
    if (!board) return next(e)
    await update($, validationAtom, () => null)
    if ((await read($, modeAtom)) !== 'interactive') return next(e)
    const note = 'Control Tower: interactive mode is on. After writing a task plan, show it and stop for approval before implementing (the hub\'s "interactive" mode).'
    return next({ ...e, context: [...(e.context ?? []), note] })
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const board = await read($, boardAtom)
    const input = e as unknown as { file_path?: string; path?: string; command?: string }
    const text = input.file_path ?? input.path ?? input.command
    if (board && typeof text === 'string') await touch($, board, text)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const board = await read($, boardAtom)
    if (!board) return next(e)
    const why = checkBash(e.command, await guardContext($, board))
    if (why) return refuse($, why)

    const active = await read($, activeAtom)
    const run = validateRun(e.command, await registryOf($, board.hub), active ? taskOf(active, board.hub)?.repo : undefined)
    if (run) await markChecks($, run.repo, run.commands, 'running')
    const ran = await next(e)
    if (run) await markChecks($, run.repo, run.commands, ran.deny !== undefined ? 'pending' : ran.isError ? 'failed' : 'passed')
    if (/\bgh pr (create|ready|edit)\b|\bgit push\b|worktree\.sh (add|remove)/.test(e.command)) void sync($)
    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const board = await read($, boardAtom)
    if (!board) return next(e)
    const why = checkWrite(e.file_path, e.content, '', await guardContext($, board))
    return why ? refuse($, why) : next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const board = await read($, boardAtom)
    if (!board) return next(e)
    const why = checkWrite(e.file_path, e.new_string, e.old_string, await guardContext($, board))
    return why ? refuse($, why) : next(e)
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await update($, validationAtom, () => null)
      await update($, blockedAtom, () => 0)
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const [board, isSyncing, mode, blocked] = await Promise.all([read($, boardAtom), read($, syncingAtom), read($, modeAtom), read($, blockedAtom)])
    await read($, nowAtom)
    const now = await $.clock.now()
    const table = $.ui.resolve(e)
    const { Box, Text, Button, Link } = table
    // The mobile app draws no text field: there a ticket is started from the prompt.
    const Input = 'Input' in table ? table.Input : null

    if (!board) {
      return (
        <Box flexDirection="column" key="control-tower">
          <Text color={C.muted}>Control Tower works in a sentinel-hill hub: start the session in the folder that holds repos.yaml.</Text>
        </Box>
      )
    }

    const actions = (t: Task) => {
      const stage = stageOf(t)
      const pr = t.pr ? <Link key={`${t.key}-pr`} href={t.pr.url} label={`PR #${t.pr.number}`} /> : null
      if (stage === 'feedback') {
        return [<Button key={`${t.key}-feedback`} label="Handle feedback" variant="primary" onPress={() => runSkill($, 'handle-pr-feedback', t.key)} />, pr]
      }
      if (stage === 'merged' || stage === 'closed') {
        return [<Button key={`${t.key}-close`} label="Close task" variant="primary" onPress={() => runSkill($, 'task-close', t.key)} />, pr]
      }
      if (stage === 'implementing') {
        return [
          <Button key={`${t.key}-review`} label="Review" onPress={() => runSkill($, 'review', t.path)} />,
          <Button key={`${t.key}-finish`} label="Finish" onPress={() => runSkill($, 'task-finish', t.path)} />,
        ]
      }
      const fix = t.pr?.checksFailed ? (
        <Button
          key={`${t.key}-checks`}
          label="Fix checks"
          variant="primary"
          onPress={() => $.prompt.submit({ text: `The checks on ${t.key}'s PR are failing. Read them with gh pr checks in ${t.path}, fix the cause there, validate, commit and push.` })}
        />
      ) : null
      return [fix, pr]
    }

    const controls = [
      <Button key="refresh" label={isSyncing ? 'Syncing…' : 'Refresh'} onPress={() => sync($)} />,
      <Button key="unattended" label="Unattended" variant={mode === 'unattended' ? 'primary' : 'secondary'} onPress={() => setMode($, 'unattended')} />,
      <Button key="interactive" label="Interactive" variant={mode === 'interactive' ? 'primary' : 'secondary'} onPress={() => setMode($, 'interactive')} />,
    ]
    const ticket = !Input ? [] : [
      <Input
        key="ticket"
        label="Start a ticket"
        placeholder="OPS-123"
        onInput={(v: string) => void update($, draftAtom, () => v)}
        onSubmit={(v: string) => void update($, draftAtom, () => v).then(() => startTicket($, 'task-start'))}
      />,
      <Button key="start" label="Start" onPress={() => startTicket($, 'task-start')} />,
      <Button key="implement" label="Implement" onPress={() => startTicket($, 'implement-ticket')} />,
    ]

    if (e.surface !== 'terminal') {
      const { Svg } = $.ui.resolve(e)
      const width = Math.max(300, e.props.bodyColumns * CELL_PX)
      const head = headerSvg(board, isSyncing, width, now)
      const foot = footerSvg(board, blocked, mode, width)
      const empty = emptySvg(width)
      return (
        <Box flexDirection="column" gap={1} key="control-tower">
          <Svg source={head.source} alt={head.alt} width={width} height={head.height} />
          <Box flexDirection="row" flexWrap="wrap" gap={1}>
            {controls}
          </Box>
          {board.tasks.length === 0 && <Svg source={empty.source} alt="No tasks under work/ yet" width={width} height={empty.height} />}
          {board.tasks.map((t, i) => {
            const drawn = taskSvg(t, i, width, now)
            return (
              <Box flexDirection="column" gap={1} key={t.path}>
                <Svg source={drawn.source} alt={drawn.alt} width={width} height={drawn.height} />
                <Box flexDirection="row" flexWrap="wrap" gap={1} alignItems="center">
                  {actions(t)}
                </Box>
              </Box>
            )
          })}
          <Box flexDirection="row" flexWrap="wrap" gap={1} alignItems="flex-end">
            {ticket}
          </Box>
          <Svg source={foot.source} alt={foot.alt} width={width} height={foot.height} />
        </Box>
      )
    }

    const need = board.tasks.filter(needsYou).length
    return (
      <Box flexDirection="column" key="control-tower">
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold color={C.text}>
            CONTROL TOWER
          </Text>
          <Text color={C.muted}>{`${board.tasks.length} tasks${need ? ` · ${need} need you` : ''}${isSyncing ? ' · syncing…' : ''}`}</Text>
        </Box>
        <Box flexDirection="row" gap={1}>
          {controls}
        </Box>
        {board.tasks.length === 0 && <Text color={C.muted}>No tasks under work/ yet. Start a ticket below.</Text>}
        {board.tasks.map((t, i) => {
          const stat = statOf(t, now)
          return (
            <Box flexDirection="column" borderStyle="round" borderColor={needsYou(t) ? C.accent : C.stroke} paddingX={1} key={t.path}>
              <Box flexDirection="row" justifyContent="space-between">
                <Text bold color={C.text} wrap="truncate">{`${String(i + 1).padStart(2, '0')} ${t.key}  ${t.title}`}</Text>
                <Text color={C.muted}>{` ${t.repo}`}</Text>
              </Box>
              <Box flexDirection="row">
                <Text bold color={stat.isHot ? C.accent : C.text}>{`${stat.value} ${stat.label}`}</Text>
                <Text color={C.muted} wrap="truncate">{` · ${metaOf(t)}`}</Text>
              </Box>
              <Box flexDirection="row" gap={1}>
                {actions(t)}
              </Box>
            </Box>
          )
        })}
        <Box flexDirection="row" gap={1}>
          {ticket}
        </Box>
        <Text color={C.muted}>{`${board.setup.hasLocalRepos ? '✓' : '✗'} repos.local.yaml · ${board.setup.hasPackagesScope === false ? '✗' : '✓'} gh read:packages · ${blocked} blocked · ${mode}`}</Text>
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const board = await read($, boardAtom)
    if (!board) return next(e)
    const validation = await read($, validationAtom)
    const isSetUp = board.setup.hasLocalRepos && board.setup.hasPackagesScope !== false
    if (isSetUp && !validation) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const setUp = <Button key="setup" label="Set up hub" variant="primary" onPress={() => $.prompt.submit({ text: SETUP_PROMPT })} />
    const hide = <Button key="hide" label="Hide" onPress={() => update($, validationAtom, () => null)} />

    if (e.surface !== 'terminal') {
      const { Svg } = $.ui.resolve(e)
      const width = Math.max(300, e.props.bodyColumns * CELL_PX - 120)
      const drawn = !isSetUp ? setupSvg(board, width) : validationSvg(validation!, width)
      return (
        <Box flexDirection="row" gap={1} alignItems="center" key="control-tower-band">
          <Svg source={drawn.source} alt={drawn.alt} width={width} height={drawn.height} />
          {!isSetUp ? setUp : hide}
        </Box>
      )
    }

    if (!isSetUp) {
      return (
        <Box flexDirection="row" gap={1}>
          <Text color={C.accent}>● Hub not set up</Text>
          <Text color={C.muted}>{[!board.setup.hasLocalRepos && 'repos.local.yaml missing', board.setup.hasPackagesScope === false && 'gh lacks read:packages'].filter(Boolean).join(' · ')}</Text>
          {setUp}
        </Box>
      )
    }
    const v = validation!
    return (
      <Box flexDirection="row" gap={1}>
        <Text bold color={C.text}>{`validate ${v.checks.filter(c => c.status === 'passed').length}/${v.checks.length}`}</Text>
        {v.checks.map((c, i) => (
          <Text key={`check-${i}`} color={c.status === 'passed' ? C.text : c.status === 'pending' ? C.dim : C.accent}>
            {`${c.status === 'passed' ? '●' : c.status === 'failed' ? '✗' : c.status === 'running' ? '◐' : '○'} ${shortCommand(c.command)}`}
          </Text>
        ))}
        {hide}
      </Box>
    )
  })
}
