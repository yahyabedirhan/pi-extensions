import assert from 'node:assert/strict'
import { readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { DefaultResourceLoader, SettingsManager } from '@earendil-works/pi-coding-agent'

const [packageRoot, name, isolationRoot] = process.argv.slice(2)
assert(packageRoot && name && isolationRoot, 'Expected package root, extension name and isolation root')
const entry = `./extensions/${name}/index.ts`
const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
assert.deepEqual(manifest.pi, { extensions: [entry] })

// No session, model or settings files: exercise Pi's package discovery and factory loading only.
const loader = new DefaultResourceLoader({
  cwd: join(isolationRoot, 'cwd'),
  agentDir: join(isolationRoot, 'agent'),
  settingsManager: SettingsManager.inMemory(),
  additionalExtensionPaths: [packageRoot],
  noExtensions: true, // Disables autoloading, not the explicit package above.
  noSkills: true,
  noPromptTemplates: true,
  noThemes: true,
  noContextFiles: true,
})
await loader.reload()
const result = loader.getExtensions()
assert.deepEqual(result.errors, [])
assert.deepEqual(result.warnings ?? [], [])
assert.equal(result.extensions.length, 1)
const extension = result.extensions[0]
assert.equal(realpathSync(extension.resolvedPath), realpathSync(join(packageRoot, entry)))
if (name === 'session-status') {
  assert.deepEqual([...extension.tools.keys()], ['status'])
  assert(extension.commands.has('session-status'))
  assert(extension.shortcuts.has('alt+s'))
} else {
  assert.equal(name, 'subagent-guard')
  assert.equal(extension.tools.size, 0)
  assert(extension.handlers.has('tool_call'))
}
assert.equal(loader.getSkills().skills.length, 0)
assert.equal(loader.getPrompts().prompts.length, 0)
assert.equal(loader.getThemes().themes.length, 0)
assert.equal(loader.getAgentsFiles().agentsFiles.length, 0)
console.log(`${name}: isolated artifact loads exactly its own extension`)
