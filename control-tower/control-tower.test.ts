import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { checkBash, checkWrite, commitPattern, parseShell } from './hooks/guards'
import type { GuardContext } from './hooks/guards'
import { parseClones, parseRepos, planTitle, worktreeIn } from './hooks/hub'

const HUB = '/hub'
const WORKTREE = `${HUB}/work/mobile-api/APP-45-validate-order-payload`

const REPOS_YAML = `# Committed registry
jira:
  cloud_id: example.atlassian.net

repos:
  platform-apps:
    commit_format: "[SCOPE][KEY] Subject"   # same scopes as platform-core
    finish_skills: []
    validate:   # one nag per CDK app
      - npm run build
      - npm run test:coverage
  mobile-api:
    commit_format: "[KEY] Subject"
    finish_skills: []
    validate:
      - npm run lint -w app
      - npm run format:check -w app
      - npm run test:coverage -w app
      - npm run test:coverage -w infrastructure
    pr_labels: [new-feature, feature-enhancement, bug, minor-change, technical-setup]   # CI fails without one
    pr_assignee: "@me"                                                                   # CI fails without one
`
const LOCAL_YAML = `repos:
  platform-apps: /code/platform-apps
  mobile-api: /code/Mobile-Api
  # platform-core: no clone found under /code
`

const registry = { repos: parseRepos(REPOS_YAML), clones: parseClones(LOCAL_YAML) }
const ctx = (active: string | null = WORKTREE): GuardContext => ({ hub: HUB, registry, active, keyPrefixes: ['APP', 'OPS'] })

test('the registry reads as the hub writes it', async () => {
  expect(registry.repos['mobile-api']).toEqual({
    commitFormat: '[KEY] Subject',
    validate: ['npm run lint -w app', 'npm run format:check -w app', 'npm run test:coverage -w app', 'npm run test:coverage -w infrastructure'],
    prLabels: ['new-feature', 'feature-enhancement', 'bug', 'minor-change', 'technical-setup'],
    prAssignee: '@me',
  })
  expect(registry.repos['platform-apps']?.validate).toEqual(['npm run build', 'npm run test:coverage'])
  expect(registry.clones).toEqual({ 'platform-apps': '/code/platform-apps', 'mobile-api': '/code/Mobile-Api' })
  expect(planTitle('# APP-45: Validate order payload schema\n\nCriteria…', 'APP-45')).toBe('Validate order payload schema')
  expect(worktreeIn('cd work/mobile-api/APP-45-validate-order-payload && npm ci', HUB)).toBe(WORKTREE)
  expect(worktreeIn('/elsewhere/work/mobile-api/APP-45-x/a.ts', HUB)).toBe(null)
})

test('the shell reader finds commands, words and heredoc bodies', async () => {
  const { segments, heredocs } = parseShell(`cd work/x && git commit -m "$(cat <<'EOF'\n[APP-45] Fix it (really)\n\nBody & more; text\nEOF\n)" && git push`)
  expect(segments.map(s => s[0])).toEqual(['cd', 'git', 'git'])
  expect(heredocs).toEqual(['[APP-45] Fix it (really)\n\nBody & more; text'])
})

test('the guards refuse what the steering forbids and let the rest through', async () => {
  expect(checkBash('git add -A', ctx())).toContain('add files by name')
  expect(checkBash('git -C work/mobile-api/APP-45-validate-order-payload add .', ctx())).toContain('git add .')
  expect(checkBash('git add app/src/a.ts app/test/a.test.ts', ctx())).toBe(null)
  expect(checkBash('git merge origin/develop', ctx())).toContain('never `git merge`')

  // The commit format of the active worktree's repo, with the branch's key.
  expect(checkBash('git commit -m "fix the schema"', ctx())).toContain('Try: [APP-45] Fix the schema')
  expect(checkBash('git commit -m "[APP-46] Fix the schema"', ctx())).toContain('"[KEY] Subject"')
  expect(checkBash('git commit -m "[APP-45] Fix the schema"', ctx())).toBe(null)
  expect(checkBash(`git commit -m "$(cat <<'EOF'\n[APP-45] Fix the schema\n\nCo-Authored-By: Claude <noreply@anthropic.com>\nEOF\n)"`, ctx())).toContain('no AI attribution')
  const apps = `${HUB}/work/platform-apps/OPS-8450-add-dlq-alarm`
  expect(checkBash('git commit -m "[BUGFIX][OPS-8450] Fix alarm threshold"', ctx(apps))).toBe(null)
  expect(checkBash('git commit -m "[SKIP][OPS-8450] Update the README"', ctx(apps))).toBe(null)
  expect(checkBash('git commit -m "[OPS-8450] Fix alarm threshold"', ctx(apps))).toBe(null)
  expect(checkBash('git commit -m "[OOPS][OPS-8450] Fix alarm threshold"', ctx(apps))).toContain('SCOPE one of')
  expect(commitPattern('[SCOPE][KEY] Subject', 'OPS-1').test('[SKIP][FIX][OPS-1] Tidy')).toBe(true)

  // Draft, label and assignee for mobile-api.
  expect(checkBash('gh pr create --base develop --title "[APP-45] Validate order payload schema" --body-file x.md', ctx())).toContain('--draft, --label (one of')
  expect(checkBash('gh pr create --draft --label bug --assignee @me --base develop --title t --body-file x.md', ctx())).toBe(null)
  // A PR outside the hub's worktrees is not the hub's to shape.
  expect(checkBash('gh pr create --repo someone/else --title t --body b', ctx(null))).toBe(null)

  // Writes: temp, the original clone, Jira keys in code.
  expect(checkWrite('/tmp/payload.json', '{}', '', ctx())).toContain('/hub/work/scratch/')
  expect(checkWrite('/code/Mobile-Api/app/src/a.ts', 'x', '', ctx())).toContain(`Write in ${WORKTREE}/app/src/a.ts instead`)
  expect(checkWrite(`${WORKTREE}/app/src/a.ts`, '// APP-45: tighten', '', ctx())).toContain('found APP-45')
  expect(checkWrite(`${WORKTREE}/app/src/a.ts`, 'const iso = "ISO-8601"', '', ctx())).toBe(null)
  expect(checkWrite(`${WORKTREE}/README.md`, 'See APP-45', '', ctx())).toBe(null)
  expect(checkWrite(`${WORKTREE}/app/src/a.ts`, '// APP-12 stays', '// APP-12 stays', ctx())).toBe(null)
})

// A hub on a fake disk, and git and gh answering for one worktree with an open PR.
const FILES: Record<string, string> = {
  [`${HUB}/repos.yaml`]: REPOS_YAML,
  [`${HUB}/repos.local.yaml`]: LOCAL_YAML,
  [`${HUB}/scripts/worktree.sh`]: '#!/usr/bin/env bash',
  [`${HUB}/work/mobile-api/APP-45-validate-order-payload.plan.md`]: '# APP-45: Validate order payload schema\n',
  [`${WORKTREE}/.git`]: 'gitdir: /code/Mobile-Api/.git/worktrees/x',
}
const dir = (name: string) => ({ name, kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false })
const DIRS: Record<string, ReturnType<typeof dir>[]> = {
  [`${HUB}/work`]: [dir('mobile-api'), dir('scratch')],
  [`${HUB}/work/mobile-api`]: [dir('APP-45-validate-order-payload')],
}
const PR = {
  number: 1288,
  url: 'https://github.com/example/Mobile-Api/pull/1288',
  state: 'OPEN',
  isDraft: false,
  title: '[APP-45] Validate order payload schema',
  mergedAt: null,
  statusCheckRollup: [{ conclusion: 'SUCCESS' }, { conclusion: 'SUCCESS' }, { conclusion: 'FAILURE' }],
}

function answer(argv: readonly string[]): { exitCode: number; stdout: string } {
  const line = argv.join(' ')
  if (line === 'git rev-parse --abbrev-ref HEAD') return { exitCode: 0, stdout: 'feature/APP-45_validate-order-payload\n' }
  if (line.startsWith('git rev-parse -q --verify origin/develop')) return { exitCode: 0, stdout: 'abc\n' }
  if (line === 'git status --porcelain') return { exitCode: 0, stdout: '' }
  if (line.startsWith('git rev-list --count')) return { exitCode: 0, stdout: '2\n' }
  if (line.startsWith('gh pr view')) return { exitCode: 0, stdout: JSON.stringify(PR) }
  if (line.startsWith('gh api graphql')) {
    return { exitCode: 0, stdout: JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { nodes: [{ isResolved: false }, { isResolved: false }, { isResolved: true }] } } } } }) }
  }
  if (line === 'gh auth status') return { exitCode: 0, stdout: "Token scopes: 'gist', 'read:org', 'read:packages', 'repo'" }
  return { exitCode: 1, stdout: '' }
}

const world = (on: On) => {
  mock.clock(on, { now: 1_800_000_000_000 })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: undefined }) as never)
  on('session.cwd', () => ({ value: HUB }) as never)
  on('fs.exists', (_$, e) => ({ value: e.path in FILES || e.path in DIRS }) as never)
  on('fs.read', (_$, e) => (e.path in FILES ? { value: FILES[e.path] } : { deny: 'no such file' }) as never)
  on('fs.list', (_$, e) => ({ value: DIRS[e.path] ?? [] }) as never)
  on('process.run', (_$, e) => ({ value: { ...answer(e.argv), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }) as never)
  on('ui.open', () => ({ value: { isPlaced: true as const } }) as never)
  on('ui.status', () => ({ value: undefined }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false } }) as never)
}

const pane = (bodyColumns = 60) => ({
  component: 'Pane' as const,
  requestId: 'control-tower',
  props: { title: 'Control Tower', isFocused: false, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
})
const band = (bodyColumns = 120) => ({
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns, scroll: { offset: 0, bodyRows: 9 }, view: {} },
})

test('the board shows each worktree with its PR, and the next step as a button', async ($, on) => {
  world(on)
  await $.session.start({ cwd: HUB, surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'tower', args: 'refresh' } as never)

  const desk = await $.ui.mount({ plugin: 'control-tower', surface: 'desktop', ...pane() })
  const svgs = (await desk.findAll({ type: 'Svg' })).map(s => String(s.props.alt))
  expect(svgs.some(a => a.includes('APP-45 mobile-api: Validate order payload schema. 2 unanswered'))).toBe(true)
  expect(await desk.find({ key: 'APP-45-feedback' })).toBeDefined()
  expect(await desk.find({ key: 'ticket' })).toBeDefined()

  const term = await $.ui.mount({ plugin: 'control-tower', surface: 'terminal', ...pane() })
  expect(await term.find({ type: 'Text', text: '2 unanswered' })).toBeDefined()

  // The mobile app has no text field: the board draws without one.
  const phone = await $.ui.mount({ plugin: 'control-tower', surface: 'mobile', ...pane() })
  expect(await phone.find({ key: 'ticket' })).toBeUndefined()
  expect(await phone.find({ key: 'APP-45-feedback' })).toBeDefined()
})

test('guards refuse through the engine and validate runs fill the band', async ($, on) => {
  world(on)
  await $.session.start({ cwd: HUB, surface: 'desktop', isInteractive: true })

  const added = await $.tool.call({ tool: 'Bash', command: 'git add -A' } as never)
  expect(String(added.deny)).toContain('add files by name')

  await $.tool.call({ tool: 'Bash', command: `cd ${WORKTREE} && npm run lint -w app` } as never)
  const desk = await $.ui.mount({ plugin: 'control-tower', surface: 'desktop', ...band() })
  expect(String((await desk.find({ type: 'Svg' }))?.props.alt)).toContain('Validate mobile-api: 1 of 4 passed')

  const term = await $.ui.mount({ plugin: 'control-tower', surface: 'terminal', ...band() })
  expect(await term.find({ type: 'Text', text: 'validate 1/4' })).toBeDefined()
})
