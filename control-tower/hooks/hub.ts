import type { FsEntry } from 'claude-code'

import type { Board, Pr, Setup, Stage, Task } from '../types'

export type RepoFacts = {
  commitFormat?: string
  validate: string[]
  prLabels: string[]
  prAssignee?: string
}

// What the hub's two registry files say: repos.yaml (committed) and
// repos.local.yaml (each person's clone paths).
export type Registry = {
  repos: Record<string, RepoFacts>
  clones: Record<string, string>
}

// What the hub's scan needs from the engine, handed in by the hooks module.
export type Io = {
  cwd: () => Promise<string>
  now: () => Promise<number>
  exists: (path: string) => Promise<boolean>
  read: (path: string) => Promise<string>
  list: (path: string) => Promise<FsEntry[]>
  run: (argv: string[], cwd: string, timeoutMs?: number) => Promise<{ exitCode: number; stdout: string; stderr: string }>
}

const WORKTREE = /^([A-Z][A-Z0-9]+-\d+)-([a-z0-9-]+)$/

const unquote = (v: string) => v.replace(/^(['"])(.*)\1$/, '$2')
// A trailing `# comment`, but not a `#` inside quotes.
const uncomment = (v: string) => v.replace(/(?:^|\s+)#(?=(?:[^"']|"[^"]*"|'[^']*')*$).*$/, '').trim()
const inlineList = (v: string) =>
  v
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map(s => unquote(s.trim()))
    .filter(Boolean)

/** Reads the `repos:` block of repos.yaml: just the shape the hub writes, not YAML at large. */
export function parseRepos(text: string): Record<string, RepoFacts> {
  const repos: Record<string, RepoFacts> = {}
  let inRepos = false
  let repo: RepoFacts | undefined
  let list: string[] | undefined
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue
    if (/^\S/.test(raw)) {
      inRepos = /^repos:\s*$/.test(raw)
      repo = list = undefined
      continue
    }
    if (!inRepos) continue
    const name = /^ {2}([a-z0-9][a-z0-9-]*):\s*$/i.exec(raw)
    if (name) {
      repo = repos[name[1]!] = { validate: [], prLabels: [] }
      list = undefined
      continue
    }
    if (!repo) continue
    const item = /^\s+-\s+(.*)$/.exec(raw)
    if (item && list) {
      list.push(unquote(uncomment(item[1]!)))
      continue
    }
    const field = /^ {4}([a-z_]+):\s*(.*)$/.exec(raw)
    if (!field) continue
    const value = uncomment(field[2]!)
    list = undefined
    if (field[1] === 'commit_format') repo.commitFormat = unquote(value)
    else if (field[1] === 'pr_assignee') repo.prAssignee = unquote(value)
    else if (field[1] === 'validate') list = value ? (repo.validate = inlineList(value)) : (repo.validate = [])
    else if (field[1] === 'pr_labels') list = value ? (repo.prLabels = inlineList(value)) : (repo.prLabels = [])
  }
  return repos
}

/** Reads repos.local.yaml: `  name: /path/to/clone` lines, commented ones skipped. */
export function parseClones(text: string): Record<string, string> {
  const clones: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const m = /^ {2}([a-z0-9][a-z0-9-]*):\s*(\S.*)$/i.exec(line)
    if (m) clones[m[1]!] = unquote(uncomment(m[2]!))
  }
  return clones
}


/** The hub this session works from: the folder holding repos.yaml and scripts/worktree.sh, at or above the session's folder. */
export async function findHub(io: Io): Promise<string | null> {
  const cwd = await io.cwd()
  // A session started inside a worktree belongs to the hub above work/.
  const start = cwd.includes('/work/') ? cwd.slice(0, cwd.indexOf('/work/')) : cwd
  for (let dir = start; dir && dir !== '/'; dir = dir.slice(0, dir.lastIndexOf('/')) || '/') {
    if ((await io.exists(`${dir}/repos.yaml`)) && (await io.exists(`${dir}/scripts/worktree.sh`))) return dir
  }
  return null
}

export async function loadRegistry(io: Io, hub: string): Promise<Registry> {
  const [repos, local] = await Promise.all([io.read(`${hub}/repos.yaml`), io.read(`${hub}/repos.local.yaml`)])
  return { repos: parseRepos(repos), clones: parseClones(local) }
}

type Rollup = { status?: string; conclusion?: string; state?: string }

export function countChecks(rollup: Rollup[]): Pick<Pr, 'checksPassed' | 'checksFailed' | 'checksTotal'> {
  let passed = 0
  let failed = 0
  for (const c of rollup) {
    const verdict = (c.conclusion || c.state || '').toUpperCase()
    if (['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(verdict)) passed++
    else if (['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE'].includes(verdict)) failed++
  }
  return { checksPassed: passed, checksFailed: failed, checksTotal: rollup.length }
}

const THREADS =
  'query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100){nodes{isResolved}}}}}'

async function fetchPr(io: Io, path: string): Promise<Pr | undefined> {
  const view = await io.run(['gh', 'pr', 'view', '--json', 'number,url,state,isDraft,title,mergedAt,statusCheckRollup'], path)
  if (view.exitCode !== 0) return undefined
  let raw: { number: number; url: string; state: Pr['state']; isDraft: boolean; title: string; mergedAt?: string | null; statusCheckRollup?: Rollup[] }
  try {
    raw = JSON.parse(view.stdout)
  } catch {
    return undefined
  }
  let unresolved = 0
  if (raw.state === 'OPEN') {
    // gh fills {owner} and {repo} from the worktree's remote.
    const threads = await io.run(['gh', 'api', 'graphql', '-F', 'owner={owner}', '-F', 'name={repo}', '-F', `number=${raw.number}`, '-f', `query=${THREADS}`], path)
    try {
      const nodes: { isResolved: boolean }[] = JSON.parse(threads.stdout).data.repository.pullRequest.reviewThreads.nodes
      unresolved = nodes.filter(n => !n.isResolved).length
    } catch {
      unresolved = 0
    }
  }
  return {
    number: raw.number,
    url: raw.url,
    state: raw.state,
    isDraft: raw.isDraft,
    title: raw.title,
    mergedAt: raw.mergedAt ?? undefined,
    unresolved,
    ...countChecks(raw.statusCheckRollup ?? []),
  }
}

/** The plan's first heading, without a leading ticket key. */
export function planTitle(plan: string, key: string): string | undefined {
  const heading = /^#+\s+(.+)$/m.exec(plan)?.[1]?.trim()
  if (!heading) return undefined
  return heading.replace(new RegExp(`^\\[?${key}\\]?\\s*[:·—-]?\\s*`), '').trim() || undefined
}

/** A PR title without its `[SCOPE][KEY]` prefix. */
export const prTitle = (title: string) => title.replace(/^(\[[^\]]+\]\s*)+/, '').trim()

async function readTask(io: Io, hub: string, repo: string, folder: string, withPr: boolean): Promise<Task | null> {
  const m = WORKTREE.exec(folder)
  if (!m) return null
  const path = `${hub}/work/${repo}/${folder}`
  if (!(await io.exists(`${path}/.git`))) return null
  const [key, slug] = [m[1]!, m[2]!]
  const plan = await io.read(`${hub}/work/${repo}/${folder}.plan.md`)
  const [branch, develop, status] = await Promise.all([
    io.run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], path),
    io.run(['git', 'rev-parse', '-q', '--verify', 'origin/develop'], path),
    io.run(['git', 'status', '--porcelain'], path),
  ])
  const base = develop.exitCode === 0 ? 'develop' : 'main'
  const ahead = await io.run(['git', 'rev-list', '--count', `origin/${base}..HEAD`], path)
  const pr = withPr ? await fetchPr(io, path) : undefined
  return {
    path,
    repo,
    key,
    slug,
    title: planTitle(plan, key) ?? (pr ? prTitle(pr.title) : slug.replace(/-/g, ' ')),
    branch: branch.stdout.trim(),
    base,
    hasPlan: plan !== '',
    ahead: Number(ahead.stdout.trim()) || 0,
    isDirty: status.stdout.trim() !== '',
    pr,
  }
}

async function readSetup(io: Io, hub: string): Promise<Setup> {
  const auth = await io.run(['gh', 'auth', 'status'], hub, 10_000)
  const said = `${auth.stdout}\n${auth.stderr}`
  return {
    hasLocalRepos: await io.exists(`${hub}/repos.local.yaml`),
    hasPackagesScope: auth.exitCode === 0 ? said.includes('read:packages') : null,
  }
}

/** Every ticket worktree under <hub>/work/, read from disk, with its PR from gh. */
export async function scan(io: Io, hub: string, registry: Registry, withPr = true): Promise<Board> {
  const repos = (await io.list(`${hub}/work`).catch(() => [])).filter(e => e.kind === 'dir' && e.name in registry.repos)
  const found = await Promise.all(
    repos.map(async r => {
      const entries = await io.list(`${hub}/work/${r.name}`).catch(() => [])
      return Promise.all(entries.filter(e => e.kind === 'dir').map(e => readTask(io, hub, r.name, e.name, withPr)))
    }),
  )
  const tasks = found.flat().filter((t): t is Task => t !== null)
  return { hub, tasks: sortTasks(tasks), setup: await readSetup(io, hub), syncedAt: await io.now() }
}

export function stageOf(t: Task): Stage {
  if (!t.pr) return 'implementing'
  if (t.pr.state === 'MERGED') return 'merged'
  if (t.pr.state === 'CLOSED') return 'closed'
  return t.pr.unresolved > 0 ? 'feedback' : 'pr'
}

/** Whether the next move is the person's: comments to answer, a merged PR to close, red checks. */
export const needsYou = (t: Task) => {
  const s = stageOf(t)
  return s === 'feedback' || s === 'merged' || s === 'closed' || (s === 'pr' && (t.pr?.checksFailed ?? 0) > 0)
}

const ORDER: Record<Stage, number> = { feedback: 0, merged: 1, closed: 2, implementing: 3, pr: 4 }
export const sortTasks = (tasks: Task[]) =>
  [...tasks].sort((a, b) => Number(needsYou(b)) - Number(needsYou(a)) || ORDER[stageOf(a)] - ORDER[stageOf(b)] || a.key.localeCompare(b.key))

/** The worktree a path or command names, as an absolute path, or null. */
export function worktreeIn(text: string, hub: string): string | null {
  const m = /(?:^|[\s"'=])((?:\/[^\s"']*)?work\/([a-z0-9-]+)\/([A-Z][A-Z0-9]+-\d+-[a-z0-9-]+))(?=$|[\s"'/;&|)])/.exec(text)
  if (!m) return null
  const [, whole, repo, folder] = m
  if (whole!.startsWith('/') && !whole!.startsWith(`${hub}/work/`)) return null
  return `${hub}/work/${repo}/${folder}`
}

/** What a worktree path says about its task: repo and key. */
export function taskOf(path: string, hub: string): { repo: string; key: string; folder: string } | null {
  const rest = path.startsWith(`${hub}/work/`) ? path.slice(hub.length + 6) : null
  const m = rest ? /^([a-z0-9-]+)\/(([A-Z][A-Z0-9]+-\d+)-[a-z0-9-]+)(?:\/|$)/.exec(rest) : null
  return m ? { repo: m[1]!, folder: m[2]!, key: m[3]! } : null
}
