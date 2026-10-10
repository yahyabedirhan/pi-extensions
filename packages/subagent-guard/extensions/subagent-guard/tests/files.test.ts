// Reading the agent files and project settings from disk, in a temporary
// project and agent dir.

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { beforeEach, expect, test } from 'vitest'

import { agentTypeRisks, projectWarnings } from '../files'

let cwd: string
let agentDir: string

function put(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}

const agent = (frontmatter: string) => `---\n${frontmatter}\n---\nDo the work.\n`

beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), 'subagent-guard-'))
  cwd = join(root, 'project')
  agentDir = join(root, 'agent')
  mkdirSync(cwd)
})

test('a project with nothing has no warnings', () => {
  expect(projectWarnings(cwd, [])).toEqual([])
})

test('warns about each project agent file and the settings', () => {
  put(join(cwd, '.pi/agents/general-purpose.md'), agent('name: general-purpose\nisolated: true'))
  put(join(cwd, '.agents/agents/helper.md'), agent('exclude_extensions: guardrail'))
  put(join(cwd, '.pi/agents/fine.md'), agent('name: fine\ntools: read'))
  put(join(cwd, '.pi/subagents.json'), JSON.stringify({ workflowsEnabled: true }))

  expect(projectWarnings(cwd, [])).toEqual([
    '.agents/agents/helper.md: exclude_extensions: guardrail',
    '.pi/agents/general-purpose.md: isolated: true',
    '.pi/subagents.json: workflowsEnabled: true',
  ])
})

test('skips a file it cannot parse, as pi-subagents does', () => {
  put(join(cwd, '.pi/agents/bad.md'), '---\nname: [unclosed\n---\n')
  put(join(cwd, '.pi/subagents.json'), '{ not json')

  expect(projectWarnings(cwd, [])).toEqual([])
})

test('an agent type resolves the way pi-subagents loads it: project over global, by name, any case', () => {
  put(join(agentDir, 'agents/reviewer.md'), agent('name: reviewer\nisolated: true'))
  put(join(cwd, '.agents/agents/x.md'), agent('name: Explore\nextensions: false'))
  put(join(cwd, '.pi/agents/y.md'), agent('name: explore\ntools: read'))

  expect(agentTypeRisks(cwd, agentDir, 'Reviewer', [])).toEqual({
    path: join(agentDir, 'agents/reviewer.md'),
    risks: ['isolated: true'],
  })
  expect(agentTypeRisks(cwd, agentDir, 'Explore', [])).toBeUndefined()
  expect(agentTypeRisks(cwd, agentDir, 'general-purpose', [])).toBeUndefined()
})

test('a type falls back to the file name', () => {
  put(join(cwd, '.pi/agents/scout.md'), agent('isolation: worktree'))

  expect(agentTypeRisks(cwd, agentDir, 'scout', [])?.risks).toEqual(['isolation: worktree'])
})
