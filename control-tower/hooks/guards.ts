import type { Registry } from './hub'
import { taskOf, worktreeIn } from './hub'

export type GuardContext = {
  hub: string
  registry: Registry
  // The worktree most recently touched: where a bare `git commit` most likely runs.
  active: string | null
  // Jira project prefixes seen under work/ (OPS, APP), for the keys-in-code check.
  keyPrefixes: string[]
}

// The release scopes repos.yaml names for the platform repos' `[SCOPE][KEY] Subject`.
const SCOPES = ['BREAKING', 'FEATURE', 'BUGFIX', 'HOTFIX', 'SETUP', 'FIX']
const PREFIX = 'Control Tower:'

type Parsed = { segments: string[][]; heredocs: string[] }

/** Splits a shell command into simple commands and their words, quotes removed, heredoc bodies kept aside. */
export function parseShell(src: string): Parsed {
  const segments: string[][] = []
  const heredocs: string[] = []
  let words: string[] = []
  let word = ''
  let hasWord = false
  let pending: string[] = []
  let i = 0

  const endWord = () => {
    if (hasWord) words.push(word)
    word = ''
    hasWord = false
  }
  const endSegment = () => {
    endWord()
    if (words.length) segments.push(words)
    words = []
  }
  // At a newline: the bodies of the heredocs opened on the line just ended.
  const readBodies = () => {
    for (const delimiter of pending) {
      const lines: string[] = []
      while (i < src.length) {
        const end = src.indexOf('\n', i)
        const line = src.slice(i, end < 0 ? src.length : end)
        i = end < 0 ? src.length : end + 1
        if (line.trim() === delimiter) break
        lines.push(line)
      }
      heredocs.push(lines.join('\n'))
    }
    pending = []
  }
  const readDelimiter = () => {
    i += src[i] === '-' ? 1 : 0
    while (src[i] === ' ' || src[i] === '\t') i++
    const quote = src[i] === "'" || src[i] === '"' ? src[i] : ''
    if (quote) i++
    let d = ''
    while (i < src.length && !(quote ? src[i] === quote : /[\s;&|)]/.test(src[i]!))) d += src[i++]
    if (quote) i++
    if (d) pending.push(d)
  }
  // `$( ... )` kept whole as part of the word, heredocs inside it read as above.
  const readSubstitution = () => {
    let depth = 0
    let raw = ''
    while (i < src.length) {
      const c = src[i]!
      if (c === "'" || c === '"') {
        const close = src.indexOf(c, i + 1)
        const end = close < 0 ? src.length : close + 1
        raw += src.slice(i, end)
        i = end
        continue
      }
      if (c === '<' && src[i + 1] === '<') {
        raw += '<<'
        i += 2
        readDelimiter()
        continue
      }
      if (c === '\n' && pending.length) {
        raw += '\n'
        i++
        readBodies()
        continue
      }
      raw += c
      i++
      if (c === '(') depth++
      else if (c === ')' && --depth === 0) break
    }
    return raw
  }

  while (i < src.length) {
    const c = src[i]!
    if (c === '\\' && i + 1 < src.length) {
      word += src[i + 1]
      hasWord = true
      i += 2
    } else if (c === "'") {
      const close = src.indexOf("'", i + 1)
      word += src.slice(i + 1, close < 0 ? src.length : close)
      hasWord = true
      i = close < 0 ? src.length : close + 1
    } else if (c === '"') {
      i++
      while (i < src.length && src[i] !== '"') {
        if (src[i] === '\\' && i + 1 < src.length) {
          word += src[i + 1]
          i += 2
        } else if (src[i] === '$' && src[i + 1] === '(') {
          i++
          word += `$${readSubstitution()}`
        } else word += src[i++]
      }
      hasWord = true
      i++
    } else if (c === '$' && src[i + 1] === '(') {
      i++
      word += `$${readSubstitution()}`
      hasWord = true
    } else if (c === '<' && src[i + 1] === '<') {
      endWord()
      i += 2
      readDelimiter()
    } else if (c === '\n') {
      endSegment()
      i++
      readBodies()
    } else if (';&|()'.includes(c)) {
      endSegment()
      i++
    } else if (c === ' ' || c === '\t') {
      endWord()
      i++
    } else {
      word += c
      hasWord = true
      i++
    }
  }
  endSegment()
  return { segments, heredocs }
}

const isGit = (w: string[]) => /(^|\/)git$/.test(w[0] ?? '')

/** A git command's subcommand and arguments, with `-C <dir>` read out of the global options. */
function gitCall(w: string[]): { dir?: string; sub: string; args: string[] } | null {
  let dir: string | undefined
  let i = 1
  while (i < w.length && w[i]!.startsWith('-')) {
    if (w[i] === '-C') dir = w[++i]
    else if (w[i] === '-c') i++
    i++
  }
  return i < w.length ? { dir, sub: w[i]!, args: w.slice(i + 1) } : null
}

/** The worktree a command runs in: its own -C or a `cd` before it, else the active one. */
function worktreeFor(dir: string | undefined, cdDir: string | undefined, ctx: GuardContext): string | null {
  for (const d of [dir, cdDir]) {
    if (!d) continue
    const abs = d.startsWith('/') ? d : `${ctx.hub}/${d.replace(/^\.\//, '')}`
    const t = taskOf(abs, ctx.hub) ?? (worktreeIn(abs, ctx.hub) ? taskOf(worktreeIn(abs, ctx.hub)!, ctx.hub) : null)
    if (t) return `${ctx.hub}/work/${t.repo}/${t.folder}`
    return null
  }
  return ctx.active
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The first-line pattern a repo's `commit_format` allows for one key. */
export function commitPattern(format: string, key: string): RegExp {
  const scope = `(?:\\[SKIP\\])?(?:\\[(?:${SCOPES.join('|')})\\])?`
  const body = escape(format)
    .replace(/^\\\[SCOPE\\\]/, scope)
    .replace(/\\\[SCOPE\\\]/, scope)
    .replace(/KEY/, escape(key))
    .replace(/ Subject$/, ' \\S')
  return new RegExp(`^${body}`)
}

function commitMessage(args: string[], heredocs: string[]): string | null {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    let value: string | undefined
    if (a === '-m' || a === '--message') value = args[i + 1]
    else if (a.startsWith('--message=')) value = a.slice(10)
    else if (/^-m./.test(a)) value = a.slice(2)
    else if (/^-[a-zA-Z]*m$/.test(a)) value = args[i + 1]
    if (value === undefined) continue
    // `-m "$(cat <<'EOF' ... EOF)"`: the message is the heredoc's body.
    return value.includes('<<') && heredocs.length ? heredocs[0]! : value
  }
  return null
}

const suggestion = (format: string, key: string, subject: string) => {
  const rest = subject.replace(/^(\[[^\]]*\])+\s*/, '').trim()
  const text = rest ? rest[0]!.toUpperCase() + rest.slice(1) : 'Subject'
  return format.includes('SCOPE')
    ? `[<SCOPE>][${key}] ${text}, SCOPE one of ${SCOPES.join(' ')}; or [SKIP][${key}] ${text} when it releases nothing`
    : format.replace('KEY', key).replace('Subject', text)
}

function checkCommit(args: string[], heredocs: string[], worktree: string | null, ctx: GuardContext): string | null {
  const message = commitMessage(args, heredocs)
  if (message === null) return null
  if (/co-authored-by:/i.test(message) || /generated with \[?claude/i.test(message)) {
    return `${PREFIX} no AI attribution in commits: drop the Co-Authored-By or "Generated with" line (AGENTS.md).`
  }
  const task = worktree ? taskOf(worktree, ctx.hub) : null
  const format = task ? ctx.registry.repos[task.repo]?.commitFormat : undefined
  if (!task || !format) return null
  const subject = message.split('\n')[0]!.trim()
  if (commitPattern(format, task.key).test(subject)) return null
  return `${PREFIX} ${task.repo} commits are "${format}" with the key from the branch (${task.key}). Try: ${suggestion(format, task.key, subject)}`
}

const hasFlag = (args: string[], long: string, short: string) => args.some(a => a === long || a === short || a.startsWith(`${long}=`))
const flagValues = (args: string[], long: string, short: string) =>
  args.flatMap((a, i) => (a === long || a === short ? [args[i + 1] ?? ''] : a.startsWith(`${long}=`) ? [a.slice(long.length + 1)] : []))

function checkPrCreate(args: string[], worktree: string | null, ctx: GuardContext): string | null {
  const body = flagValues(args, '--body', '-b').join('\n')
  if (/generated with \[?claude/i.test(body)) return `${PREFIX} no "Generated with" line in PR bodies (AGENTS.md).`
  // The draft, label and assignee rules are for a ticket's PR; a PR elsewhere is not the hub's.
  const task = worktree ? taskOf(worktree, ctx.hub) : null
  if (!task) return null
  const facts = ctx.registry.repos[task.repo]
  const missing: string[] = []
  if (!hasFlag(args, '--draft', '-d')) missing.push('--draft')
  const labels = flagValues(args, '--label', '-l').flatMap(l => l.split(','))
  if (facts?.prLabels.length && !labels.some(l => facts.prLabels.includes(l.trim()))) missing.push(`--label (one of ${facts.prLabels.join(', ')})`)
  if (facts?.prAssignee && !hasFlag(args, '--assignee', '-a')) missing.push(`--assignee ${facts.prAssignee}`)
  if (missing.length === 0) return null
  return `${PREFIX} ${task.repo} PRs need ${missing.join(', ')}${facts?.prLabels.length ? '; its CI fails without a label and an assignee' : ''}.`
}

/** Why a Bash command breaks the hub's steering, or null when it does not. */
export function checkBash(command: string, ctx: GuardContext): string | null {
  const { segments, heredocs } = parseShell(command)
  let cdDir: string | undefined
  for (const w of segments) {
    if (w[0] === 'cd') {
      cdDir = w[1]
      continue
    }
    if (isGit(w)) {
      const call = gitCall(w)
      if (!call) continue
      const worktree = worktreeFor(call.dir, cdDir, ctx)
      if (call.sub === 'add') {
        const wide = call.args.find(a => ['-A', '--all', '-u', '--update', '.', './', ':/', '*'].includes(a) || /^-[a-zA-Z]*[Au][a-zA-Z]*$/.test(a))
        if (wide) return `${PREFIX} add files by name, never \`git add ${wide}\` (steering/conventions.md). Nothing was staged.`
      }
      if (call.sub === 'commit') {
        const why = checkCommit(call.args, heredocs, worktree, ctx)
        if (why) return why
      }
      if (call.sub === 'merge') return `${PREFIX} never \`git merge\`; changes land through pull requests (steering/conventions.md).`
    }
    if (w[0] === 'gh' && w[1] === 'pr' && w[2] === 'create') {
      const why = checkPrCreate(w.slice(3), worktreeFor(undefined, cdDir, ctx), ctx)
      if (why) return why
    }
  }
  return null
}

const TEMP = /^\/(?:private\/)?(?:tmp|var\/folders)\//
const PROSE = /\.(md|mdx|markdown|txt|rst)$/i

/** Why writing `added` to `path` breaks the hub's steering, or null. `added` is the new text only. */
export function checkWrite(path: string, added: string, removed: string, ctx: GuardContext): string | null {
  if (TEMP.test(path)) return `${PREFIX} temporary files go in ${ctx.hub}/work/scratch/, not ${path.split('/').slice(0, 3).join('/')}/ (AGENTS.md).`

  for (const [repo, clone] of Object.entries(ctx.registry.clones)) {
    if (path !== clone && !path.startsWith(`${clone.replace(/\/$/, '')}/`)) continue
    const active = ctx.active ? taskOf(ctx.active, ctx.hub) : null
    const there = active?.repo === repo ? ` Write in ${ctx.active}${path.slice(clone.replace(/\/$/, '').length)} instead.` : ` Work in a worktree under work/${repo}/ instead.`
    return `${PREFIX} ${path} is in your original clone of ${repo}, which the hub never changes (AGENTS.md).${there}`
  }

  const task = taskOf(path, ctx.hub)
  if (!task || PROSE.test(path) || ctx.keyPrefixes.length === 0) return null
  const keys = new RegExp(`\\b(?:${ctx.keyPrefixes.map(escape).join('|')})-\\d+\\b`, 'g')
  const before = new Set(removed.match(keys) ?? [])
  const fresh = [...new Set(added.match(keys) ?? [])].filter(k => !before.has(k))
  if (fresh.length === 0) return null
  return `${PREFIX} no Jira keys in code or comments (steering/conventions.md): found ${fresh.join(', ')}. Keys belong in the branch, the commits and the PR.`
}
