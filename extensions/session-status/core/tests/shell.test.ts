import { expect, test } from 'claude-code/testing'

import { effortSighting } from '../hooks/effort'
import { findCreatedLinks, findStateChanges } from '../hooks/links'
import { simpleCommands } from '../hooks/shell'

test('a command splits on &&, ||, ;, | and newlines', () => {
  expect(simpleCommands('git push && gh pr create --fill || echo no; ls | wc -l\npwd')).toEqual([
    'git push',
    'gh pr create --fill',
    'echo no',
    'ls',
    'wc -l',
    'pwd',
  ])
})

test('a separator inside quotes does not split', () => {
  expect(simpleCommands(`gh issue create --title 'a && b' --body "a; b | c"`)).toEqual([
    `gh issue create --title 'a && b' --body "a; b | c"`,
  ])
})

test('a heredoc body is dropped, in each of its forms', () => {
  expect(simpleCommands("python3 - <<'EOF'\ngh pr create --fill; x = 'effort:a'\nEOF\necho done")).toEqual([
    "python3 - <<'EOF'",
    'echo done',
  ])
  expect(simpleCommands('cat <<"END" > f\ngh pr create\nEND')).toEqual(['cat <<"END" > f'])
  expect(simpleCommands('cat <<EOF\ngh pr create\nEOF\nls')).toEqual(['cat <<EOF', 'ls'])
  expect(simpleCommands('cat <<-EOF\n\tgh pr create\n\tEOF\nls')).toEqual(['cat <<-EOF', 'ls'])
})

test('a heredoc in a command substitution keeps the command whole', () => {
  const command = `gh pr create --title x --body "$(cat <<'EOF'\nFix the "quoted" bug; don't split\nEOF\n)"\necho ok`
  const parts = simpleCommands(command)
  expect(parts).toHaveLength(2)
  expect(parts[0]?.startsWith('gh pr create --title x --body')).toBe(true)
  expect(parts[0]).not.toContain('quoted')
  expect(parts[1]).toBe('echo ok')
})

test('leading keywords and variable assignments are not the command', () => {
  expect(simpleCommands('for t in a b; do GH_REPO=octo/x gh issue create --title "$t"; done')).toEqual([
    'for t in a b',
    'gh issue create --title "$t"',
    'done',
  ])
})

test('an effort label in a heredoc is no effort run', () => {
  const command = "python3 - <<'EOF'\nassert effort_of('--label effort:session-status')\nEOF"
  expect(effortSighting({ tool: 'Bash', command } as { tool: string })).toBeNull()
})

test('an effort label in a command that is not gh is no effort run', () => {
  expect(effortSighting({ tool: 'Bash', command: 'echo effort:session-status' } as { tool: string })).toBeNull()
})

test('an effort label in a gh command is an effort run', () => {
  const sighting = (command: string) => effortSighting({ tool: 'Bash', command } as { tool: string })
  expect(sighting('gh issue list --label effort:x')).toEqual({ name: 'x' })
  expect(sighting('cd repo && gh issue create --title t --label "effort:y"')).toEqual({ name: 'y' })
  expect(sighting('gh search issues label:effort:z')).toEqual({ name: 'z' })
})

test('gh pr create in a heredoc creates no link', () => {
  const command = "python3 - <<'EOF'\nrun('gh pr create --repo octo/skills --fill')\nEOF"
  expect(findCreatedLinks(command, 'https://github.com/octo/skills/pull/88\n')).toEqual([])
})

test('gh pr create after another command still creates its link', () => {
  expect(findCreatedLinks('git push && gh pr create --fill', 'https://github.com/octo/skills/pull/88\n')).toEqual([
    { kind: 'pr', repo: 'octo/skills', number: 88, url: 'https://github.com/octo/skills/pull/88' },
  ])
})

test('gh pr create inside another command body creates no link', () => {
  expect(
    findCreatedLinks('gh issue comment 3 --body "run gh pr create"', 'https://github.com/octo/skills/pull/88\n'),
  ).toEqual([])
})

test('a gh pr merge in a heredoc changes no state', () => {
  expect(findStateChanges("cat <<'EOF' > notes.md\ngh pr merge 27\nEOF", '')).toEqual([])
})
