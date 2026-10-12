import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Facts } from '../types'
import { FORK_REFS, factsOf, KIND_GLYPH, KINDS, LIMIT, cardText, changedFiles, check, factsText, isBig, movedSince, plural, shortPath, signature } from './card'
import type { CardInput, RepoDiff } from './card'
import { C, KIND_COLOR, cardSvg, emptySvg, statLine } from './look'

const PANE = 'change-card'
const TITLE = 'Changes'
const TOOL = 'mcp__change-card__change_card'
// Roughly one cell of the desktop's code font, in CSS pixels.
const CELL_PX = 8

const cardAtom = atom({ plugin: 'change-card', key: 'card' } as const, null)
const factsAtom = atom({ plugin: 'change-card', key: 'facts' } as const, null)
const baseAtom = atom({ plugin: 'change-card', key: 'baseRef' } as const, null)
const focusAtom = atom({ plugin: 'change-card', key: 'focus' } as const, null)
const nudgedAtom = atom({ plugin: 'change-card', key: 'nudged' } as const, null)

async function git($: EngineInterface, args: string[], cwd?: string) {
  const r = await $.process.run(['git', ...args], cwd ? { cwd } : undefined).catch(() => null)
  return r && r.exitCode === 0 ? r.stdout : null
}

/** The commit a repository is compared against: the ref asked for, else where `tip` forked. */
async function baseOf($: EngineInterface, dir: string, baseRef: string | null, tip = 'HEAD'): Promise<{ base: string; how: string } | null> {
  if (baseRef) {
    const base = (await git($, ['rev-parse', '--verify', '--quiet', `${baseRef}^{commit}`], dir))?.trim()
    return base ? { base, how: baseRef } : null
  }
  for (const ref of FORK_REFS) {
    const base = (await git($, ['merge-base', tip, ref], dir))?.trim()
    if (base) return { base, how: `fork point from ${ref}` }
  }
  const head = (await git($, ['rev-parse', tip], dir))?.trim()
  return head ? { base: head, how: 'uncommitted work only' } : null
}

const baseName = (path: string) => path.replace(/\/$/, '').split('/').pop() ?? path

type Checkout = { path: string; branch: string }

/** Every worktree of the repository at `dir`, its own checkout included. */
async function worktreesOf($: EngineInterface, dir: string): Promise<Checkout[]> {
  const out = (await git($, ['worktree', 'list', '--porcelain'], dir)) ?? ''
  return out
    .split('\n\n')
    .map(block => {
      const path = /^worktree (.+)$/m.exec(block)?.[1] ?? ''
      const branch = /^branch refs\/heads\/(.+)$/m.exec(block)?.[1] ?? ''
      return { path, branch }
    })
    .filter(w => w.path)
}

type Target = { name: string; dir: string; tip?: string; label?: string }

/** A worktree (by path, folder or branch, or a unique part of one) or a local branch of the session's repository. */
async function targetOf($: EngineInterface, top: string, focus: string): Promise<Target | null> {
  const all = await worktreesOf($, top)
  const want = focus.toLowerCase()
  const exact = all.find(w => w.path === focus || baseName(w.path) === focus || w.branch === focus)
  const loose = all.filter(w => `${w.branch} ${baseName(w.path)}`.toLowerCase().includes(want))
  const hit = exact ?? (loose.length === 1 ? loose[0] : undefined)
  if (hit) return { name: '', dir: hit.path, ...(hit.path !== top && { label: `worktree ${hit.branch || baseName(hit.path)}` }) }
  if (await git($, ['rev-parse', '--verify', '--quiet', `refs/heads/${focus}`], top)) return { name: '', dir: top, tip: focus, label: `branch ${focus}` }
  return null
}

/** The session's repository; else, in a folder of checkouts, each child with a .git (a clone or a worktree). */
async function reposHere($: EngineInterface): Promise<Target[]> {
  const top = (await git($, ['rev-parse', '--show-toplevel']))?.trim()
  if (top) return [{ name: '', dir: top }]
  const cwd = await $.session.cwd()
  const children = (await $.fs.list(cwd).catch(() => [])).filter(c => c.kind === 'dir' && !c.name.startsWith('.'))
  const found: Target[] = []
  for (const c of children) {
    const dir = `${cwd.replace(/\/$/, '')}/${c.name}`
    const inside = await $.fs.list(dir).catch(() => [])
    if (inside.some(e => e.name === '.git')) found.push({ name: c.name, dir })
  }
  return found
}

async function diffOf($: EngineInterface, t: Target, baseRef: string | null): Promise<RepoDiff | null> {
  const b = await baseOf($, t.dir, baseRef, t.tip)
  if (!b) return null
  const numstat = (await git($, ['diff', '--numstat', '--no-renames', b.base, ...(t.tip ? [t.tip] : [])], t.dir)) ?? ''
  // A branch away from its checkout has no working files to add.
  const untracked = t.tip ? '' : ((await git($, ['ls-files', '--others', '--exclude-standard'], t.dir)) ?? '')
  return { ...t, ...b, numstat, untracked }
}

/** What changed since the base, read from git; null when no repository is here, or the focus or ref matches nothing. */
async function collect($: EngineInterface, baseRef: string | null, focus: string | null): Promise<Facts | null> {
  let targets: Target[]
  if (focus) {
    const top = (await git($, ['rev-parse', '--show-toplevel']))?.trim()
    const t = top ? await targetOf($, top, focus) : null
    if (!t) return null
    targets = [t]
  } else targets = await reposHere($)
  const diffs: RepoDiff[] = []
  for (const t of targets) {
    const d = await diffOf($, t, baseRef)
    if (d) diffs.push(d)
  }
  return diffs.length ? factsOf(diffs) : null
}

/** The other worktrees of the session's repository that have changes, for when its own checkout has none. */
async function busyWorktrees($: EngineInterface): Promise<string[]> {
  const top = (await git($, ['rev-parse', '--show-toplevel']))?.trim()
  if (!top) return []
  const lines: string[] = []
  for (const w of await worktreesOf($, top)) {
    if (w.path === top) continue
    const d = await diffOf($, { name: '', dir: w.path }, null)
    const n = d ? Object.keys(factsOf([d]).files).length : 0
    if (n) lines.push(`  ${baseName(w.path)}${w.branch && w.branch !== baseName(w.path) ? ` (${w.branch})` : ''}: ${plural(n, 'file')}`)
  }
  return lines
}

async function refresh($: EngineInterface): Promise<Facts | null> {
  const facts = await collect($, await read($, baseAtom), await read($, focusAtom))
  await update($, factsAtom, () => facts)
  return facts
}

// A pane that cannot open (refused, or no surface to draw on) never costs the card.
async function openPane($: EngineInterface) {
  await $.ui.open({ id: PANE, title: TITLE }).catch(() => ({ isPlaced: false }))
}

const HOW_TO_WRITE =
  'Read the diffs that matter (biggest churn and public surfaces first) and use what you know from this session about why. ' +
  'Group by intent, not by file: one change is one thing a person would say out loud. Lead with what matters most. ' +
  'Every changed file must sit under a change; a path ending in "/" covers a folder, and small leftovers go in one "chore". ' +
  'look: at most 3 places a reviewer must check first (data that could be lost, a trust boundary, a contract that changed, anything you were unsure of); none is fine. ' +
  'unchecked: what nobody ran or tested, plainly. The tool refuses long text: say less, not more. ' +
  'After the card is shown, reply with one line pointing at the Changes pane; do not repeat the card in chat.'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)

    await $.tool.register({
      name: 'change_card',
      description:
        'Show the developer a short card explaining what changed on this branch: a headline, one-line changes grouped by intent, where to look first, and what was not checked. ' +
        'Use it when they run /changes or ask what you (or another agent) changed. ' +
        HOW_TO_WRITE,
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', maxLength: LIMIT.title, description: 'The whole change as a headline' },
          gist: { type: 'string', maxLength: LIMIT.gist, description: 'One plain sentence: what is different for someone using or maintaining this' },
          changes: {
            type: 'array',
            minItems: 1,
            maxItems: LIMIT.changes,
            items: {
              type: 'object',
              properties: {
                kind: { type: 'string', enum: KINDS },
                title: { type: 'string', maxLength: LIMIT.changeTitle, description: 'What changed, as you would say it out loud' },
                before: { type: 'string', maxLength: LIMIT.side, description: 'Optional: how it was, in a few words' },
                after: { type: 'string', maxLength: LIMIT.side, description: 'Optional: how it is now, in a few words' },
                files: { type: 'array', minItems: 1, items: { type: 'string' }, description: 'Paths from the repository root as git prints them; "dir/" covers a folder' },
              },
              required: ['kind', 'title', 'files'],
            },
          },
          look: {
            type: 'array',
            maxItems: LIMIT.look,
            items: {
              type: 'object',
              properties: {
                file: { type: 'string' },
                line: { type: 'integer', minimum: 1 },
                why: { type: 'string', maxLength: LIMIT.why, description: 'What to check there' },
              },
              required: ['file', 'why'],
            },
          },
          unchecked: { type: 'array', maxItems: LIMIT.unchecked, items: { type: 'string', maxLength: LIMIT.uncheckedItem } },
        },
        required: ['title', 'gist', 'changes'],
      },
      isDeferred: false,
    })
    await $.command.register({
      name: 'changes',
      description: 'Show the change card for this branch; Claude writes or updates it when needed ([worktree | branch]: explain that one; [ref]: compare against it; clear: forget it)',
      argumentHint: '[worktree | branch | ref | clear]',
      immediate: true,
    })

    await refresh($).catch(() => null)
    return result
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const facts = await refresh($)
    if (!facts) return { deny: 'No git repository here or in the folders directly under it, or the base ref is gone: there is nothing to compare against.' }
    if (Object.keys(facts.files).length === 0) return { deny: `Nothing changed since ${facts.since}.` }
    const checked = check(e as unknown as CardInput, facts, await $.clock.now())
    if ('errors' in checked) return { deny: `The card was not shown. Fix all of these and call ${TOOL} again:\n- ${checked.errors.join('\n- ')}` }
    await update($, cardAtom, () => checked.card)
    await update($, nudgedAtom, () => null)
    await openPane($)
    return { result: `Shown to the developer in the Changes pane:\n\n${cardText(checked.card)}\n\nReply with one line pointing there; do not repeat the card.` }
  })

  on('command.run', { command: 'changes' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === 'clear') {
      await update($, cardAtom, () => null)
      await update($, baseAtom, () => null)
      await update($, focusAtom, () => null)
      await $.ui.close({ id: PANE }).catch(() => {})
      return { text: 'Forgot the change card.' }
    }

    // An argument names a worktree or branch to explain, else a commit to compare against.
    let facts: Facts | null
    if (arg) {
      const before = { base: await read($, baseAtom), focus: await read($, focusAtom) }
      await update($, baseAtom, () => null)
      await update($, focusAtom, () => arg)
      facts = await refresh($)
      if (!facts) {
        await update($, focusAtom, () => null)
        await update($, baseAtom, () => arg)
        facts = await refresh($)
      }
      if (!facts) {
        await update($, baseAtom, () => before.base)
        await update($, focusAtom, () => before.focus)
        await refresh($)
        return { text: `No worktree, branch or commit here matches "${arg}".` }
      }
      // A new target is a new card.
      await update($, cardAtom, () => null)
    } else {
      facts = await refresh($)
      if (!facts) return { text: 'No git repository here, nor in the folders directly under it.' }
    }
    await openPane($)

    if (Object.keys(facts.files).length === 0) {
      const busy = arg ? [] : await busyWorktrees($)
      return {
        text: busy.length
          ? `Nothing changed in this checkout since ${facts.since}. Worktrees with changes:\n${busy.join('\n')}\nRun /changes <name> to explain one.`
          : `Nothing changed since ${facts.since}.`,
      }
    }

    const card = await read($, cardAtom)
    const moved = card ? movedSince(card, facts) : []
    if (card && !arg && moved.length === 0) return { text: 'The change card is up to date.' }

    const ask =
      card && !arg
        ? `Update the change card with ${TOOL}. ${plural(moved.length, 'file')} changed since it was written: ${moved.join(', ')}. ` +
          `Read what moved and rewrite only what it affects; keep what is still true.\n\nThe card now:\n${cardText(card)}`
        : `Write a change card with ${TOOL} for ${facts.repos.length === 1 && facts.repos[0]!.label ? `the ${facts.repos[0]!.label}` : 'this branch'}.`
    // Submitted once this command has returned: a prompt from inside it would wait on itself.
    const text = `${ask}\n\n${factsText(facts)}`
    $.clock.after(0, () => void $.prompt.submit({ text }).catch(() => $.ui.toast('change-card: could not ask Claude; ask for a change card yourself')))
    return { text: card && !arg ? 'Asking Claude to update the change card.' : 'Asking Claude for a change card.' }
  })

  // Past a sizeable change, suggest a card once, until one is written.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId || e.reason !== 'answer') return result
    const before = await read($, factsAtom)
    const facts = await refresh($).catch(() => null)
    if (!facts || !isBig(facts) || (before && signature(before) === signature(facts))) return result
    if (await read($, nudgedAtom)) return result
    const card = await read($, cardAtom)
    if (card && movedSince(card, facts).length === 0) return result
    await update($, nudgedAtom, () => signature(facts))
    $.ui.toast(`${plural(Object.keys(facts.files).length, 'file')} changed · /changes ${card ? 'updates the card' : 'explains them'}`)
    return result
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await update($, cardAtom, () => null)
      await update($, nudgedAtom, () => null)
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const card = await read($, cardAtom)
    const facts = await read($, factsAtom)
    const moved = card && facts ? movedSince(card, facts) : []

    if (e.surface !== 'terminal') {
      const { Svg } = $.ui.resolve(e)
      const width = Math.max(300, e.props.bodyColumns * CELL_PX)
      if (!card) {
        const empty = emptySvg(facts, width)
        return <Svg source={empty.source} alt="No change card yet" width={width} height={empty.height} />
      }
      const drawn = cardSvg(card, facts, moved, width)
      return <Svg source={drawn.source} alt={drawn.alt} width={width} height={drawn.height} />
    }

    const { Box, Text } = $.ui.resolve(e)
    if (!card) {
      return (
        <Box flexDirection="column" borderStyle="round" borderColor={C.stroke} paddingX={1}>
          <Text bold color={C.text}>
            No change card yet
          </Text>
          <Text color={C.muted} wrap="wrap">
            Run /changes to have Claude explain what changed on this branch.
          </Text>
          {facts && <Text color={C.dim} wrap="truncate">{statLine(facts)}</Text>}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" key="change-card">
        {moved.length > 0 && (
          <Box flexDirection="column" borderStyle="round" borderColor={C.warn} paddingX={1} key="moved">
            <Text bold color={C.warn}>{`${plural(moved.length, 'file')} changed since this card`}</Text>
            <Text color={C.muted} wrap="truncate">{`${moved.slice(0, 4).map(shortPath).join(', ')}${moved.length > 4 ? ', …' : ''} · /changes to update`}</Text>
          </Box>
        )}

        <Text bold color={C.text} wrap="wrap">
          {card.title}
        </Text>
        <Text color={C.soft} wrap="wrap">
          {card.gist}
        </Text>
        {facts && <Text color={C.muted} wrap="truncate">{statLine(facts)}</Text>}

        <Text> </Text>
        {card.changes.flatMap((c, i) => {
          const n = plural(changedFiles(c, card.facts).length, 'file')
          const row = (
            <Box flexDirection="row" justifyContent="space-between" key={`change-${i}`}>
              <Box flexDirection="row" flexShrink={1}>
                <Text color={KIND_COLOR[c.kind]} bold>{`[${KIND_GLYPH[c.kind]}] `}</Text>
                <Text color={C.text} wrap="truncate">
                  {c.title}
                </Text>
              </Box>
              <Text color={C.muted}>{` ${n}`}</Text>
            </Box>
          )
          if (!c.before && !c.after) return [row]
          return [
            row,
            <Box flexDirection="row" key={`shift-${i}`}>
              <Text color={C.muted} wrap="truncate">{`    ${c.before ?? '…'}`}</Text>
              <Text color={C.accent}>{' → '}</Text>
              <Text color={C.soft} wrap="truncate">
                {c.after ?? '…'}
              </Text>
            </Box>,
          ]
        })}

        {card.look.length > 0 && (
          <Box flexDirection="column" key="look">
            <Text> </Text>
            <Text bold color={C.text}>
              Look here first
            </Text>
            {card.look.flatMap((s, i) => [
              <Text color={C.glow} wrap="truncate" key={`look-${i}`}>{`  ${shortPath(s.file)}${s.line ? `:${s.line}` : ''}`}</Text>,
              <Text color={C.soft} wrap="wrap" key={`why-${i}`}>{`    ${s.why}`}</Text>,
            ])}
          </Box>
        )}

        {card.unchecked.length > 0 && (
          <Box flexDirection="column" key="unchecked">
            <Text> </Text>
            <Text bold color={C.warn}>
              Not checked
            </Text>
            {card.unchecked.map((u, i) => (
              <Text color={C.soft} wrap="wrap" key={`u-${i}`}>{`  • ${u}`}</Text>
            ))}
          </Box>
        )}
      </Box>
    )
  })
}

