// The extension's wiring, driven through a fake Pi: what its tool_call
// handler returns and what it asks and tells the user.

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { beforeEach, expect, test } from 'vitest'

import { createSubagentGuard } from '../index'

type Handler = (event: any, ctx: any) => unknown

let cwd: string
let agentDir: string

function put(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}

beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), 'subagent-guard-'))
  cwd = join(root, 'project')
  agentDir = join(root, 'agent')
  mkdirSync(cwd)
})

function fakePi(options: { hasUI?: boolean; answer?: string; protect?: string } = {}) {
  const handlers = new Map<string, Handler[]>()
  const notices: { message: string; type?: string }[] = []
  const asked: { title: string; choices: string[] }[] = []
  const pi = { on: (name: string, handler: Handler) => handlers.set(name, [...(handlers.get(name) ?? []), handler]) }
  const ctx = {
    cwd,
    hasUI: options.hasUI ?? true,
    ui: {
      notify: (message: string, type?: string) => notices.push({ message, type }),
      select: async (title: string, choices: string[]) => {
        asked.push({ title, choices })
        return options.answer
      },
    },
  }
  createSubagentGuard({ agentDir, protect: options.protect })(pi as any)
  const emit = async (name: string, event: any = {}) => {
    let result: unknown
    for (const handler of handlers.get(name) ?? []) {
      result = (await handler({ type: name, ...event }, ctx)) ?? result
    }
    return result as any
  }
  const call = (toolName: string, input: Record<string, unknown>) =>
    emit('tool_call', { toolCallId: 't1', toolName, input })

  return { emit, call, notices, asked }
}

test('an isolated Agent call is blocked', async () => {
  const { call } = fakePi()
  const result = await call('Agent', { subagent_type: 'Explore', prompt: 'x', description: 'x', isolated: true })

  expect(result.block).toBe(true)
  expect(result.reason).toContain('isolated')
})

test('a worktree or a schedule is blocked', async () => {
  const { call } = fakePi()

  expect((await call('Agent', { subagent_type: 'Explore', isolation: 'worktree' })).block).toBe(true)
  expect((await call('Agent', { subagent_type: 'Explore', schedule: '1h' })).block).toBe(true)
})

test('a plain Agent call runs', async () => {
  const { call } = fakePi()

  expect(await call('Agent', { subagent_type: 'Explore', prompt: 'x', description: 'x' })).toBeUndefined()
})

test('an Agent call whose type file drops extensions is blocked and names the file', async () => {
  put(join(cwd, '.pi/agents/general-purpose.md'), '---\nname: general-purpose\nextensions: false\n---\nx\n')
  const { call } = fakePi()
  const result = await call('Agent', { subagent_type: 'general-purpose', prompt: 'x' })

  expect(result.block).toBe(true)
  expect(result.reason).toContain('general-purpose.md')
  expect(result.reason).toContain('extensions: false')
})

test('protected names narrow what counts', async () => {
  put(join(cwd, '.pi/agents/helper.md'), '---\nexclude_extensions: other\n---\nx\n')
  const loose = fakePi()
  const strict = fakePi({ protect: 'guardrail' })

  expect((await loose.call('Agent', { subagent_type: 'helper' })).block).toBe(true)
  expect(await strict.call('Agent', { subagent_type: 'helper' })).toBeUndefined()
})

test('SubagentWorkflow is blocked', async () => {
  const { call } = fakePi()

  expect((await call('SubagentWorkflow', { name: 'ship' })).block).toBe(true)
})

test('unknown tools and ordinary files pass untouched', async () => {
  const { call, asked } = fakePi()

  expect(await call('some_tool', { isolated: true })).toBeUndefined()
  expect(await call('write', { path: 'src/a.ts', content: 'x' })).toBeUndefined()
  expect(await call('bash', { command: 'echo hi > .pi/subagents.json' })).toBeUndefined()
  expect(asked).toEqual([])
})

test('a write to an agent file asks with No first, and No blocks', async () => {
  const { call, asked } = fakePi({ answer: 'No' })
  const result = await call('write', { path: '.pi/agents/x.md', content: 'x' })

  expect(asked[0]?.choices[0]).toBe('No')
  expect(asked[0]?.title).toContain('.pi/agents/x.md')
  expect(result.block).toBe(true)
})

test('a dismissed question blocks', async () => {
  const { call } = fakePi({ answer: undefined })

  expect((await call('edit', { path: '.pi/subagents.json', edits: [] })).block).toBe(true)
})

test('Yes lets the edit run', async () => {
  const { call } = fakePi({ answer: 'Yes' })

  expect(await call('edit', { path: '.agents/workflows/ship.js', edits: [] })).toBeUndefined()
})

test('without a UI, the write is blocked', async () => {
  const { call, asked } = fakePi({ hasUI: false, answer: 'Yes' })

  expect((await call('write', { path: join(agentDir, 'agents/x.md'), content: 'x' })).block).toBe(true)
  expect(asked).toEqual([])
})

test('session_start warns about risky project files and stays quiet otherwise', async () => {
  const quiet = fakePi()
  await quiet.emit('session_start', { reason: 'startup' })
  expect(quiet.notices).toEqual([])

  put(join(cwd, '.pi/subagents.json'), JSON.stringify({ schedulingEnabled: true }))
  const { emit, notices } = fakePi()
  await emit('session_start', { reason: 'startup' })

  expect(notices).toHaveLength(1)
  expect(notices[0]?.type).toBe('warning')
  expect(notices[0]?.message).toContain('.pi/subagents.json: schedulingEnabled: true')
})
