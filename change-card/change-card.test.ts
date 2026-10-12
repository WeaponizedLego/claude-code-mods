import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { C as LOOK } from './hooks/look'

const TOOL = 'mcp__change-card__change_card'

const pane = (bodyColumns = 80) => ({
  component: 'Pane' as const,
  requestId: 'change-card',
  props: { title: 'Changes', isFocused: false, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
})

// Stands in for git and the surface; `repo.numstat` is the diff the next git call sees.
const world = (on: On) => {
  const repo = {
    numstat: ['120\t4\tsrc/auth/sessionStore.ts', '80\t0\tsrc/auth/store/sessionTable.ts', '40\t2\tsrc/routes/login.ts', '3\t1\tREADME.md'].join('\n'),
    untracked: 'src/auth/sessionStore.test.ts\n',
  }
  const prompts: string[] = []
  const toasts: string[] = []
  on('process.run', (_$, e) => {
    const [, cmd, ...rest] = e.argv
    const out = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '' } }) as never
    if (cmd === 'rev-parse' && rest[0] === '--show-toplevel') return out('/repo\n')
    if (cmd === 'merge-base') return rest[1] === 'origin/HEAD' ? out('58e19863fa5697819c5b3805b1239de901a6c049\n') : ({ value: { exitCode: 1, stdout: '', stderr: '' } } as never)
    if (cmd === 'rev-parse' && rest[0] === '--verify') return rest[2] === 'v1^{commit}' ? out('aaaaaaa1111\n') : ({ value: { exitCode: 1, stdout: '', stderr: '' } } as never)
    if (cmd === 'diff') return out(repo.numstat)
    if (cmd === 'ls-files') return out(repo.untracked)
    return { value: { exitCode: 1, stdout: '', stderr: 'unexpected' } } as never
  })
  on('ui.open', () => ({ value: { isPlaced: true as const } }) as never)
  on('ui.close', () => ({ value: undefined }) as never)
  on('ui.toast', (_$, e) => {
    toasts.push(String((e as { text?: string }).text ?? e))
    return { value: undefined } as never
  })
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('prompt.submit', (_$, e) => {
    prompts.push(e.text)
    return { text: e.text }
  })
  return { repo, prompts, toasts }
}

const good = {
  title: 'Move auth from bearer tokens to server sessions',
  gist: 'Logins create a server-side session; logout revokes at once.',
  changes: [
    { kind: 'new', title: 'Session store backed by a table', before: 'stateless JWT until expiry', after: 'session lookup, revoked on logout', files: ['src/auth/'] },
    { kind: 'new', title: 'Login route creates a session', files: ['src/routes/login.ts'] },
    { kind: 'chore', title: 'README', files: ['README.md'] },
  ],
  look: [{ file: 'src/auth/store/sessionTable.ts', line: 40, why: 'no index on expires_at yet' }],
  unchecked: ['not tried against staging', 'load under many concurrent logins'],
}

const call = ($: any, args: Record<string, unknown>) => $.tool.call({ tool: TOOL, ...args } as never)

test('the card is refused until it is short and covers every changed file, then drawn', async ($, on) => {
  mock.clock(on, { now: 0 })
  world(on)

  const long = await call($, { ...good, gist: 'x '.repeat(120), changes: [good.changes[0], good.changes[1]] })
  expect(long.deny).toContain('gist is 239 characters; the limit is 160')
  expect(long.deny).toContain('No change covers 1 file: README.md')

  const wrongPath = await call($, { ...good, changes: [...good.changes, { kind: 'fix', title: 'x', files: ['src/nope.ts'] }] })
  expect(wrongPath.deny).toContain('Not among the changed files: src/nope.ts')

  const shown = await call($, good)
  expect(shown.deny).toBeUndefined()
  expect(String(shown.result)).toContain('[+] Session store backed by a table (3 files)')

  const term = await $.ui.mount({ plugin: 'change-card', surface: 'terminal', ...pane() })
  expect(await term.find({ type: 'Text', text: 'Move auth from bearer tokens to server sessions' })).toBeDefined()
  expect((await term.find({ type: 'Text', text: '[+] ' }))?.props.color).toBe(LOOK.accent)
  expect(await term.find({ type: 'Text', text: ' 3 files' })).toBeDefined()
  expect(await term.find({ type: 'Text', text: '  …/store/sessionTable.ts:40' })).toBeDefined()
  expect(await term.find({ type: 'Text', text: '  • load under many concurrent logins' })).toBeDefined()
  expect(await term.find({ type: 'Text', text: '5 files · +243 −7 · since 58e1986 (fork point from origin/HEAD)' })).toBeDefined()
  await term.unmount()

  const desk = await $.ui.mount({ plugin: 'change-card', surface: 'desktop', ...pane() })
  const svg = String((await desk.find({ type: 'Svg' }))?.props.source)
  expect(svg).toContain('What changed')
  expect(svg).toContain('Session store backed by a table')
  expect(svg).toContain('Look here first')
  expect(svg).toContain('Not checked')
  await desk.unmount()
})

test('/changes asks for a card, says when it is current, and asks for an update when the code moved', async ($, on) => {
  const w = world(on)

  const clock = mock.clock(on, { now: 0 })
  const first = await $.command.run({ command: 'changes', args: '' } as never)
  await clock.advance(1)
  expect(first.text).toContain('Asking Claude for a change card')
  expect(w.prompts[0]).toContain(`Write a change card for this branch with ${TOOL}`)
  expect(w.prompts[0]).toContain('5 files changed since 58e1986 (fork point from origin/HEAD), +243 -7')
  expect(w.prompts[0]).toContain('new\tsrc/auth/sessionStore.test.ts')

  await call($, good)
  expect((await $.command.run({ command: 'changes', args: '' } as never)).text).toBe('The change card is up to date.')

  w.repo.numstat += '\n5\t0\tREADME.md'.replace('README.md', 'src/auth/sessionStore.ts')
  w.repo.numstat = w.repo.numstat.replace('120\t4\t', '130\t4\t')
  const again = await $.command.run({ command: 'changes', args: '' } as never)
  await clock.advance(1)
  expect(again.text).toContain('update the change card')
  expect(w.prompts[1]).toContain('changed since it was written: src/auth/sessionStore.ts')
  expect(w.prompts[1]).toContain('The card now:')

  const term = await $.ui.mount({ plugin: 'change-card', surface: 'terminal', ...pane() })
  expect((await term.find({ type: 'Text', text: '1 file changed since this card' }))?.props.color).toBe(LOOK.warn)
  await term.unmount()

  expect((await $.command.run({ command: 'changes', args: 'nope' } as never)).text).toBe('Not a commit here: nope')
  expect((await $.command.run({ command: 'changes', args: 'clear' } as never)).text).toBe('Forgot the change card.')
})

test('a turn that grows a big diff nudges once, until a card is written', async ($, on) => {
  mock.clock(on, { now: 0 })
  const w = world(on)
  w.repo.numstat = '3\t1\tREADME.md'
  w.repo.untracked = ''
  const end = () => ($ as any).turn.complete({ answer: 'Done.', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })

  await end()
  expect(w.toasts).toHaveLength(0)

  w.repo.numstat = Array.from({ length: 8 }, (_, i) => `30\t0\tsrc/f${i}.ts`).join('\n')
  await end()
  expect(w.toasts).toEqual(['8 files changed · /changes explains them'])

  w.repo.numstat += '\n1\t0\tsrc/g.ts'
  await end()
  expect(w.toasts).toHaveLength(1)
})

test('a folder of worktrees reads every repository in it, paths prefixed by its name', async ($, on) => {
  const prompts: string[] = []
  const dir = (name: string) => ({ name, kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false })
  const file = (name: string) => ({ name, kind: 'file' as const, size: 89, mtimeMs: 0, isLink: false })
  on('session.cwd', () => ({ value: '/task' }) as never)
  on('fs.list', (_$, e) => {
    const listing: Record<string, unknown[]> = {
      '/task': [dir('.claude'), dir('api'), dir('web'), dir('notes')],
      '/task/api': [file('.git'), dir('src')],
      '/task/web': [dir('.git'), dir('src')],
      '/task/notes': [file('todo.md')],
    }
    return { value: listing[e.path] ?? [] } as never
  })
  on('process.run', (_$, e) => {
    const cwd = e.init?.cwd
    const [, cmd, ...rest] = e.argv
    const out = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '' } }) as never
    const fail = { value: { exitCode: 128, stdout: '', stderr: 'not a git repository' } } as never
    if (!cwd) return fail
    if (cmd === 'merge-base') return rest[1] === 'origin/HEAD' ? out(cwd === '/task/api' ? 'aaaaaaa111\n' : 'bbbbbbb222\n') : fail
    if (cmd === 'diff') return out(cwd === '/task/api' ? '10\t2\tsrc/server.ts' : '4\t0\tsrc/app.tsx')
    if (cmd === 'ls-files') return out('')
    return fail
  })
  on('ui.open', () => ({ value: { isPlaced: true as const } }) as never)
  on('prompt.submit', (_$, e) => {
    prompts.push(e.text)
    return { text: e.text }
  })
  const clock = mock.clock(on, { now: 0 })

  await $.command.run({ command: 'changes', args: '' } as never)
  await clock.advance(1)
  expect(prompts[0]).toContain('2 files changed since api aaaaaaa, web bbbbbbb, +14 -2')
  expect(prompts[0]).toContain('+10 -2\tapi/src/server.ts')
  expect(prompts[0]).toContain('api/…: git -C /task/api diff aaaaaaa -- <path inside api>')

  const shown = await call($, {
    title: 'Health endpoint and its status badge',
    gist: 'The API answers /health and the web app shows it.',
    changes: [{ kind: 'new', title: 'Health endpoint', files: ['api/'] }, { kind: 'new', title: 'Status badge', files: ['web/src/app.tsx'] }],
  })
  expect(shown.deny).toBeUndefined()
})
