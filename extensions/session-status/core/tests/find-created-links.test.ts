import { expect, test } from 'claude-code/testing'

import { findCreatedLinks, linkLabel } from '../hooks/links'

test('gh pr create gives its pull request', () => {
  expect(
    findCreatedLinks(
      'git push -u origin feature && gh pr create --title "Add x" --body-file body.md',
      'Creating pull request for feature into main in octo/widgets\n\nhttps://github.com/octo/widgets/pull/12\n',
    ),
  ).toEqual([{ kind: 'pr', repo: 'octo/widgets', number: 12, url: 'https://github.com/octo/widgets/pull/12' }])
})

test('gh issue create gives each issue it created', () => {
  expect(
    findCreatedLinks(
      'for t in a b; do gh issue create --title "$t" --body x; done',
      'https://github.com/octo/widgets/issues/3\nhttps://github.com/octo/widgets/issues/4\n',
    ).map(link => link.number),
  ).toEqual([3, 4])
})

test('a pull request URL in the output of gh issue create is not taken', () => {
  expect(
    findCreatedLinks(
      'gh issue create --title x --body "after https://github.com/octo/widgets/pull/9"',
      'https://github.com/octo/widgets/issues/10\n',
    ).map(link => link.url),
  ).toEqual(['https://github.com/octo/widgets/issues/10'])
})

test('a GitHub Enterprise host is read too', () => {
  expect(findCreatedLinks('gh pr create --fill', 'https://git.example.com/team/app/pull/5\n')).toEqual([
    { kind: 'pr', repo: 'team/app', number: 5, url: 'https://git.example.com/team/app/pull/5' },
  ])
})

test('other commands give nothing', () => {
  expect(findCreatedLinks('gh pr view 12', 'https://github.com/octo/widgets/pull/12\n')).toEqual([])
  expect(findCreatedLinks('echo gh pr', 'https://github.com/octo/widgets/pull/12\n')).toEqual([])
})

test('a page of a pull request is not the pull request', () => {
  expect(findCreatedLinks('gh pr create --fill', 'https://github.com/octo/widgets/pull/12/files\n')).toEqual([])
})

test('a link shows as <repo>#<number>', () => {
  expect(linkLabel({ repo: 'octo/widgets', number: 12 })).toBe('widgets#12')
})
