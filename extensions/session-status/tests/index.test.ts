// The extension's wiring, driven through a fake Pi: the handlers it
// registers, the entries it appends and the prompts it sends.

import { expect, test } from 'vitest'

import sessionStatus, { INSTRUCTIONS_TEXT } from '../index'
import { ENTRY_TYPE } from '../state'

type Handler = (event: any, ctx: any) => unknown

function fakePi(sessionId = 'abcdef12', branch: unknown[] = []) {
  const handlers = new Map<string, Handler[]>()
  const tools = new Map<string, any>()
  const commands = new Map<string, any>()
  const entries: { customType: string; data: any }[] = []
  const sent: { text: string; options?: unknown }[] = []
  const widgets = new Map<string, unknown>()
  const statuses = new Map<string, string | undefined>()
  const pi = {
    on: (name: string, handler: Handler) => handlers.set(name, [...(handlers.get(name) ?? []), handler]),
    registerTool: (tool: any) => tools.set(tool.name, tool),
    registerCommand: (name: string, command: any) => commands.set(name, command),
    registerShortcut: () => undefined,
    appendEntry: (customType: string, data: any) => entries.push({ customType, data }),
    sendUserMessage: (text: string, options?: unknown) => sent.push({ text, options }),
    exec: async () => ({ code: 1, stdout: '', stderr: '', killed: false }),
  }
  let idle = true
  const ctx = {
    hasUI: true,
    mode: 'tui',
    isIdle: () => idle,
    sessionManager: { getSessionId: () => sessionId, getBranch: () => branch },
    ui: {
      setWidget: (key: string, value: unknown) => widgets.set(key, value),
      setStatus: (key: string, value: string | undefined) => statuses.set(key, value),
      notify: () => undefined,
    },
  }
  sessionStatus(pi as any)
  const emit = async (name: string, event: any = {}) => {
    for (const handler of handlers.get(name) ?? []) {
      await handler({ type: name, ...event }, ctx)
    }
  }
  const call = (params: Record<string, unknown>) => tools.get('status').execute('id', params, undefined, undefined, ctx)

  return { emit, call, tools, commands, entries, sent, widgets, statuses, setIdle: (value: boolean) => (idle = value) }
}

test('the status tool takes the mod JSON Schema', () => {
  const { tools } = fakePi()
  const tool = tools.get('status')

  expect(tool.parameters.required).toEqual(['action'])
  expect(tool.parameters.properties.action.enum).toContain('record_decision')
})

test('before_agent_start adds the instructions as a prompt section', async () => {
  const { emit } = fakePi()
  const systemPromptOptions = { sections: {} as Record<string, string> }
  await emit('session_start', { reason: 'startup' })
  await emit('before_agent_start', { prompt: 'hi', systemPrompt: '', systemPromptOptions })

  expect(systemPromptOptions.sections.session_status).toBe(INSTRUCTIONS_TEXT)
  expect(INSTRUCTIONS_TEXT).toContain('`status` tool')
  expect(INSTRUCTIONS_TEXT).not.toContain('mcp__')
})

test('a tool call saves the status as a custom entry and draws the widget and band', async () => {
  const { emit, call, entries, widgets, statuses } = fakePi()
  await emit('session_start', { reason: 'startup' })
  const result = await call({ action: 'record_surprise', occurred: 'x', changed: 'y' })

  expect(result.content[0].text).toBe('Recorded surprise S1.')
  expect(entries.at(-1)?.customType).toBe(ENTRY_TYPE)
  expect(typeof widgets.get('session-status')).toBe('function')
  expect(statuses.get('session-status')).toBe('0 blocked · 0 decide · 1 surprise')
})

test('a refused call throws, so Pi marks the result as an error', async () => {
  const { emit, call } = fakePi()
  await emit('session_start', { reason: 'startup' })

  await expect(call({ action: 'resolve', id: 'D9' })).rejects.toThrow('No decision D9.')
})

test('gh pr create output adds a link', async () => {
  const { emit, entries } = fakePi()
  await emit('session_start', { reason: 'startup' })
  await emit('tool_result', {
    toolName: 'bash',
    input: { command: 'gh pr create --fill' },
    content: [{ type: 'text', text: 'https://github.com/octo/widgets/pull/7\n' }],
    isError: false,
  })

  expect(entries.at(-1)?.data.links.map((link: any) => link.url)).toEqual(['https://github.com/octo/widgets/pull/7'])
})

test('a plain echo of a URL adds no link', async () => {
  const { emit, entries } = fakePi()
  await emit('session_start', { reason: 'startup' })
  await emit('tool_result', {
    toolName: 'bash',
    input: { command: 'echo https://github.com/octo/widgets/pull/1' },
    content: [{ type: 'text', text: 'https://github.com/octo/widgets/pull/1\n' }],
    isError: false,
  })

  expect(entries).toEqual([])
})

test('a resume restores the saved status; a fork of it starts empty', async () => {
  const first = fakePi('abcdef12')
  await first.emit('session_start', { reason: 'startup' })
  await first.call({ action: 'record_surprise', occurred: 'x', changed: 'y' })
  const branch = first.entries.map(entry => ({ type: 'custom', ...entry }))

  const resumed = fakePi('abcdef12', branch)
  await resumed.emit('session_start', { reason: 'resume' })
  expect((await resumed.call({ action: 'list' })).content[0].text).toContain('S1')

  const forked = fakePi('99999999', branch)
  await forked.emit('session_start', { reason: 'fork' })
  expect((await forked.call({ action: 'list' })).content[0].text).not.toContain('S1')
})

test('the turn events move the state line', async () => {
  const { emit, call, entries } = fakePi()
  await emit('session_start', { reason: 'startup' })
  await call({ action: 'record_surprise', occurred: 'x', changed: 'y' })
  await emit('agent_start')
  await emit('agent_end', { messages: [] })

  expect(entries.at(-1)?.data.activity).toBe('waiting')
})
