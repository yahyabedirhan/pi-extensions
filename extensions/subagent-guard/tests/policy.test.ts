// The guard's rules, as pure functions: which calls it blocks, which paths
// it protects, and which agent files and settings it flags.

import { describe, expect, test } from 'vitest'

import { agentCallBlock, agentFileRisks, isProtectedPath, protectedNames, settingsRisks } from '../policy'

describe('agentCallBlock', () => {
  test('passes a plain call', () => {
    expect(agentCallBlock({ subagent_type: 'Explore', prompt: 'x' })).toBeUndefined()
  })

  test('blocks isolated: true with a reason the agent can act on', () => {
    const reason = agentCallBlock({ subagent_type: 'Explore', isolated: true })

    expect(reason).toContain('isolated')
    expect(reason).toContain('without')
  })

  test('passes isolated: false', () => {
    expect(agentCallBlock({ subagent_type: 'Explore', isolated: false })).toBeUndefined()
  })

  test('blocks a worktree and passes isolation off', () => {
    expect(agentCallBlock({ isolation: 'worktree' })).toContain('worktree')
    expect(agentCallBlock({ isolation: 'off' })).toBeUndefined()
  })

  test('blocks a schedule and passes the empty filler models send', () => {
    expect(agentCallBlock({ schedule: 'every monday' })).toContain('schedule')
    expect(agentCallBlock({ schedule: '' })).toBeUndefined()
  })
})

describe('isProtectedPath', () => {
  const cwd = '/work/repo'
  const agentDir = '/home/u/.pi/agent'

  test.each([
    '.pi/subagents.json',
    '.pi/agents/general-purpose.md',
    '.agents/agents/deep/x.md',
    '.pi/workflows/ship.js',
    '.agents/workflows/ship.js',
    '@.pi/agents/x.md',
    '/elsewhere/other/.pi/agents/x.md',
    './.PI/Agents/x.md',
    '/home/u/.pi/agent/agents/x.md',
    '/home/u/.pi/agent/workflows/x.js',
    '/home/u/.pi/agent/subagents.json',
  ])('protects %s', path => {
    expect(isProtectedPath(path, cwd, agentDir)).toBe(true)
  })

  test.each(['src/agents/x.md', '.pi/settings.json', 'docs/.pi-agents.md', 'README.md'])('leaves %s alone', path => {
    expect(isProtectedPath(path, cwd, agentDir)).toBe(false)
  })
})

describe('protectedNames', () => {
  test('is empty without the variable', () => {
    expect(protectedNames(undefined)).toEqual([])
  })

  test('reads a comma list, lowercased, and adds the guard itself', () => {
    expect(protectedNames(' Guardrail, other ')).toEqual(['guardrail', 'other', 'subagent-guard'])
  })
})

describe('agentFileRisks', () => {
  test('a plain file has none', () => {
    expect(agentFileRisks({ name: 'x', tools: 'read' }, [])).toEqual([])
  })

  test('flags isolated, no extensions and worktrees', () => {
    expect(agentFileRisks({ isolated: true }, [])).toEqual(['isolated: true'])
    expect(agentFileRisks({ extensions: false }, [])).toEqual(['extensions: false'])
    expect(agentFileRisks({ extensions: 'none' }, [])).toEqual(['extensions: none'])
    expect(agentFileRisks({ inherit_extensions: false }, [])).toEqual(['extensions: false'])
    expect(agentFileRisks({ isolation: 'worktree' }, [])).toEqual(['isolation: worktree'])
  })

  test('a disabled file has none', () => {
    expect(agentFileRisks({ isolated: true, enabled: false }, [])).toEqual([])
  })

  test('without protected names, any exclude or narrowed list counts', () => {
    expect(agentFileRisks({ exclude_extensions: 'foo' }, [])).toEqual(['exclude_extensions: foo'])
    expect(agentFileRisks({ extensions: 'foo, bar' }, [])).toEqual(['extensions: foo, bar'])
    expect(agentFileRisks({ extensions: ['*'] }, [])).toEqual([])
    expect(agentFileRisks({ extensions: true }, [])).toEqual([])
  })

  test('with protected names, only those count', () => {
    const names = ['guardrail', 'subagent-guard']

    expect(agentFileRisks({ exclude_extensions: 'foo' }, names)).toEqual([])
    expect(agentFileRisks({ exclude_extensions: ['Guardrail'] }, names)).toEqual(['exclude_extensions: Guardrail'])
    expect(agentFileRisks({ extensions: 'guardrail, subagent-guard, foo' }, names)).toEqual([])
    expect(agentFileRisks({ extensions: 'guardrail, foo' }, names)).toEqual(['extensions: guardrail, foo'])
  })
})

describe('settingsRisks', () => {
  test('flags each feature turned on', () => {
    expect(settingsRisks({ workflowsEnabled: true, worktreeIsolation: true, schedulingEnabled: true })).toEqual([
      'workflowsEnabled: true',
      'worktreeIsolation: true',
      'schedulingEnabled: true',
    ])
  })

  test('leaves features turned off or unset alone', () => {
    expect(settingsRisks({ workflowsEnabled: false, widgetMode: 'all' })).toEqual([])
    expect(settingsRisks(null)).toEqual([])
  })
})
