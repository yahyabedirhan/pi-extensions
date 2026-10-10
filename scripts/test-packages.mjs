import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const scratch = join(root, '.scratch')
mkdirSync(scratch, { recursive: true })
const expectedPeers = {
  'session-status': ['@earendil-works/pi-coding-agent', '@earendil-works/pi-tui', 'typebox'],
  'subagent-guard': ['@earendil-works/pi-coding-agent'],
}
const packageDirectories = readdirSync(join(root, 'packages'), { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name)
assert.deepEqual(packageDirectories.sort(), Object.keys(expectedPeers).sort(), 'Every package needs an artifact smoke contract')
const rootManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
assert.equal(rootManifest.private, true)
assert.equal(rootManifest.pi, undefined, 'The development root must not declare a bundle')
for (const conventional of ['extensions', 'skills', 'prompts', 'themes']) {
  // Empty conventional directories also expose no resources.
  assert(!readdirSync(root).includes(conventional) || readdirSync(join(root, conventional)).length === 0)
}

const temporary = mkdtempSync(join(tmpdir(), 'pi-package-test-'))
try {
  for (const [name, peers] of Object.entries(expectedPeers)) {
    const isolation = join(temporary, name)
    for (const directory of ['home', 'agent', 'cwd', 'extracted']) {
      mkdirSync(join(isolation, directory), { recursive: true })
    }
    const [packed] = JSON.parse(execFileSync('npm', [
      'pack', '--workspace', `packages/${name}`, '--ignore-scripts', '--json',
      '--pack-destination', isolation,
    ], { cwd: root, encoding: 'utf8' }))
    const files = packed.files.map(file => file.path)
    assert(files.includes('LICENSE'))
    assert(files.includes('README.md'))
    assert(files.includes(`extensions/${name}/index.ts`))
    assert(files.every(path => !path.includes('/tests/') && !path.endsWith('.test.ts')))
    assert(files.every(path => !path.startsWith('node_modules/')))
    assert(files.every(path => !path.startsWith('extensions/') || path.startsWith(`extensions/${name}/`)))
    if (name === 'session-status') {
      assert(files.includes('extensions/session-status/core/README.md'))
      assert(files.includes('extensions/session-status/core/types/index.d.ts'))
    }
    execFileSync('tar', ['-xzf', join(isolation, packed.filename), '-C', join(isolation, 'extracted')])
    const packageRoot = join(isolation, 'extracted', 'package')
    const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
    assert.equal(manifest.private, true, 'Registry publication requires approval')
    assert.deepEqual(manifest.peerDependencies, Object.fromEntries(peers.map(peer => [peer, '*'])))
    assert.deepEqual(manifest.dependencies ?? {}, {})
    assert.equal(manifest.repository.url, 'git+https://github.com/yahyabedirhan/pi-packages.git')
    assert.equal(manifest.repository.directory, `packages/${name}`)
    execFileSync(process.execPath, [join(root, 'scripts/artifact-smoke.mjs'), packageRoot, name, isolation], {
      cwd: join(isolation, 'cwd'),
      stdio: 'inherit',
      // No personal settings, credentials, resources or inherited Node resolution flags.
      env: {
        PATH: process.env.PATH,
        HOME: join(isolation, 'home'),
        PI_CODING_AGENT_DIR: join(isolation, 'agent'),
        PI_OFFLINE: '1',
      },
    })
    console.log(`${name}: ${packed.entryCount} artifact files verified`)
  }
} finally {
  // Preserve evidence without leaving OS temporary directories or deleting recursively.
  renameSync(temporary, join(scratch, temporary.split(/[\\/]/).at(-1)))
}
