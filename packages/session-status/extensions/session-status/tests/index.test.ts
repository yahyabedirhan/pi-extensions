// The extension's wiring, driven through a fake Pi: the handlers it
// registers, the entries it appends and the prompts it sends.

import { expect, test } from 'vitest'
import { type TUI, TuiMainScreen } from '@earendil-works/pi-tui'

import sessionStatus, { INSTRUCTIONS_TEXT } from '../index'
import { ENTRY_TYPE } from '../state'

type Handler = (event: any, ctx: any) => unknown

function fakePi(sessionId = 'abcdef12', branch: unknown[] = [], realTui?: TUI) {
  const handlers = new Map<string, Handler[]>()
  const tools = new Map<string, any>()
  const commands = new Map<string, any>()
  const entries: { customType: string; data: any }[] = []
  const sent: { text: string; options?: unknown }[] = []
  const widgets = new Map<string, unknown>()
  const statuses = new Map<string, string | undefined>()
  const notifications: { text: string; level: string }[] = []
  const pi = {
    on: (name: string, handler: Handler) => handlers.set(name, [...(handlers.get(name) ?? []), handler]),
    registerTool: (tool: any) => tools.set(tool.name, tool),
    registerCommand: (name: string, command: any) => commands.set(name, command),
    registerShortcut: () => undefined,
    appendEntry: (customType: string, data: any) => entries.push({ customType, data }),
    sendUserMessage: (text: string, options?: unknown) => sent.push({ text, options }),
    exec: async () => ({ code: 1, stdout: '', stderr: '', killed: false }),
  }
  const overlays: any[] = []
  let renders = 0
  let host: any
  const theme = { fg: (_tone: string, text: string) => text, bold: (text: string) => text }
  const tui = {
    terminal: { rows: 24, columns: 100 }, requestRender: () => { renders++ },
    showOverlay: (component: any, options: any) => {
      let focused = false
      let hidden = false
      const record: any = { options, component, completed: false }
      record.handle = {
        hide: () => { record.completed = true },
        focus: () => { focused = true }, unfocus: () => { focused = false },
        isFocused: () => focused, setHidden: (value: boolean) => { hidden = value }, isHidden: () => hidden,
      }
      overlays.push(record)
      return record.handle
    },
  }
  let idle = true
  const ctx = {
    hasUI: true,
    mode: 'tui',
    isIdle: () => idle,
    sessionManager: { getSessionId: () => sessionId, getBranch: () => branch },
    ui: {
      setWidget: (key: string, value: unknown) => {
        if (key === 'session-status-sidebar-host') {
          host?.dispose?.()
          host = typeof value === 'function' ? value(realTui ?? tui, theme) : undefined
        }
        widgets.set(key, value)
      },
      setStatus: (key: string, value: string | undefined) => statuses.set(key, value),
      notify: (text: string, level: string) => notifications.push({ text, level }),
      custom: () => { throw new Error('The sidebar must not use custom UI') },
    },
  }
  sessionStatus(pi as any)
  const emit = async (name: string, event: any = {}) => {
    for (const handler of handlers.get(name) ?? []) {
      await handler({ type: name, ...event }, ctx)
    }
  }
  const call = (params: Record<string, unknown>) => tools.get('status').execute('id', params, undefined, undefined, ctx)

  return { emit, call, tools, commands, entries, sent, widgets, statuses, notifications, ctx, overlays, renderCount: () => renders, setIdle: (value: boolean) => (idle = value) }
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

test('sidebar retains interaction across focus, visibility, resize and answers', async () => {
  const f = fakePi()
  const command = (arg: string) => f.commands.get('session-status').handler(arg, f.ctx)
  await f.emit('session_start')
  await f.call({ action: 'record_decision', question: 'Ship?', options: ['Yes', 'No'], default: 'Yes', unblocks: 'Answer', urgency: 'blocked' })
  await command('sidebar show')
  const panel = f.overlays[0]
  const retainedOptions = panel.options
  expect(retainedOptions).toMatchObject({ anchor: 'top-right', maxHeight: '100%', nonCapturing: true, width: 64 })
  expect(panel.handle.isFocused()).toBe(false)
  expect(f.widgets.get('session-status')).toBeUndefined()
  await command('sidebar focus')
  expect(panel.handle.isFocused()).toBe(true)
  panel.component.handleInput('>')
  expect(panel.options.width).toBe(68)
  panel.component.handleInput('\u001b[1;2D') // Shift+Left moves the left edge outward
  expect(panel.options.width).toBe(72)
  panel.component.handleInput('\u001b[1;2C') // Shift+Right moves the left edge inward
  expect(panel.options.width).toBe(68)
  await command('sidebar width 52')
  expect(retainedOptions.width).toBe(52)
  await command('sidebar focus')
  expect(panel.handle.isFocused()).toBe(false)
  await command('sidebar focus')
  panel.component.handleInput('\t')
  expect(panel.handle.isFocused()).toBe(false)
  panel.component.handleInput('\r')
  f.setIdle(false)
  panel.component.handleInput('1')
  expect(f.sent).toEqual([{ text: 'D1: Yes', options: { deliverAs: 'followUp' } }])
  expect(panel.completed).toBe(false)
  const before = f.renderCount()
  await f.call({ action: 'record_surprise', occurred: 'Updated live', changed: 'Changed' })
  expect(f.renderCount()).toBeGreaterThan(before)
  await command('sidebar hide')
  expect(panel.handle.isHidden()).toBe(true)
  expect(typeof f.widgets.get('session-status')).toBe('function')
  await command('')
  expect(panel.handle.isHidden()).toBe(false)
  expect(f.overlays).toHaveLength(1)
  const hostFactory = f.widgets.get('session-status-sidebar-host') as any
  const inertHost = hostFactory({ showOverlay: () => { throw new Error('Duplicate mount') } }, {})
  expect(inertHost.render()).toEqual([])
  await f.emit('session_tree')
  expect(panel.completed).toBe(true)
  expect(f.widgets.get('session-status-sidebar-host')).toBeUndefined()
  await command('sidebar show')
  await Promise.resolve()
  expect(f.overlays[1].completed).toBe(false)
  await f.emit('session_shutdown')
  expect(f.overlays[1].completed).toBe(true)
})

test('owned sidebar cleanup preserves another overlay in the real TUI stack', async () => {
  const terminal = { columns: 100, rows: 24, hideCursor: () => undefined, write: () => undefined }
  const tui = new TuiMainScreen(terminal as any)
  // Test overlay ownership without starting terminal rendering or timers.
  tui.requestRender = () => undefined
  const f = fakePi('s', [], tui)
  await f.commands.get('session-status').handler('sidebar show', f.ctx)
  const other = tui.showOverlay({ render: () => ['another overlay'], invalidate: () => undefined })
  expect(other.isFocused()).toBe(true)
  await f.emit('session_tree')
  expect(other.isFocused()).toBe(true)
  await f.commands.get('session-status').handler('sidebar show', f.ctx)
  await f.emit('session_shutdown')
  expect(other.isFocused()).toBe(true)
  other.hide()
  expect(tui.hasOverlay()).toBe(false)
})

test('explicit widget commands do not toggle the sidebar and reset clears status', async () => {
  const f = fakePi()
  const command = (arg: string) => f.commands.get('session-status').handler(arg, f.ctx)
  await f.emit('session_start')
  await f.call({ action: 'item', state: 'added', title: 'Work' })
  await command('widget hide')
  expect(f.widgets.get('session-status')).toBeUndefined()
  expect(f.overlays).toHaveLength(0)
  await command('widget show')
  expect(typeof f.widgets.get('session-status')).toBe('function')
  await command('')
  expect(f.overlays[0].handle.isHidden()).toBe(false)
  await command('widget hide')
  await command('widget show')
  expect(f.widgets.get('session-status')).toBeUndefined()
  expect(f.overlays[0].handle.isHidden()).toBe(false)
  await command('')
  expect(f.overlays[0].handle.isHidden()).toBe(true)
  expect(typeof f.widgets.get('session-status')).toBe('function')
  await command('reset')
  expect((await f.call({ action: 'list' })).content[0].text).not.toContain('I1 Work')
})

test('command completions expose explicit sidebar and widget actions only', () => {
  const command = fakePi().commands.get('session-status')
  expect(command.getArgumentCompletions('').map((entry: any) => entry.value)).toEqual([
    'sidebar show', 'sidebar hide', 'sidebar focus', 'sidebar width ', 'widget show', 'widget hide', 'reset',
  ])
  expect(command.getArgumentCompletions('widget ').map((entry: any) => entry.value)).toEqual(['widget show', 'widget hide'])
})

test.each(['on', 'off', 'focus', 'width 64', 'hide', 'show', 'sidebar width 11', 'widget reset'])(
  'ambiguous or invalid command %s warns without opening the sidebar', async arg => {
    const f = fakePi()
    await f.commands.get('session-status').handler(arg, f.ctx)
    expect(f.overlays).toHaveLength(0)
    expect(f.notifications.at(-1)).toMatchObject({ level: 'warning' })
    expect(f.notifications.at(-1)?.text).toContain('sidebar show')
  },
)

test('non-tui mode never starts a custom sidebar', async () => {
  const f = fakePi()
  f.ctx.mode = 'rpc'
  await f.commands.get('session-status').handler('sidebar show', f.ctx)
  expect(f.overlays).toHaveLength(0)
})
