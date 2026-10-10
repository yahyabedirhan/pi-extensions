# pi-packages

Independently installable packages for the [Pi coding agent](https://pi.dev), maintained in one repository. Each package contains one extension; installing one does not load the other.

| Package | What it does |
|---|---|
| [Session Status](packages/session-status/README.md) | Shows decisions, blockers, surprises, progress and links. You answer from a persistent right sidebar. |
| [Subagent Guard](packages/subagent-guard/README.md) | Keeps the subagents of `@tintinweb/pi-subagents` inside your `tool_call` guardrail. |

## Install from a clone

Clone this repository, then run the commands from its root:

```sh
git clone https://github.com/yahyabedirhan/pi-packages.git
cd pi-packages

# Install either package independently:
pi install ./packages/session-status
pi install ./packages/subagent-guard
```

Local packages load from the clone without copying. Keep the clone in place; use Git to update it to an approved commit or release tag. `pi update --extensions` does not pull local clones. Pi resolves relative package paths from the settings file that records them. For automated machine setup, use a stable clone location and pass each package's absolute directory path to `pi install`.

To try either package for one run without changing settings:

```sh
pi -e ./packages/session-status
pi -e ./packages/subagent-guard
```

The root is development tooling, **not a Pi package**. Do not install the root Git URL: Pi's Git source selects a repository, not a workspace subdirectory. Resource filters on a root bundle are not independent package installs.

### Migrate an existing bundle installation

Run `pi list` to find the old root-repository declaration. Install the desired package directories, then remove the exact old declaration with `pi remove <old-source>` to avoid loading both versions. Do not remove unrelated packages. In an existing interactive session, run `/reload` after changing installations; Session Status's `/session-status on` opens the sidebar.

No npm packages are published by this change. The workspace names `pi-session-status-local` and `pi-subagent-guard-local`, version `0.0.0`, are private placeholders, not approved registry identities. Registry names, release versions and publication require a separate decision.

## Develop and verify

```sh
npm ci
npm test                 # extension and copied core tests
npm run check            # TypeScript
npm run test:packages    # pack, extract and load each artifact in isolation
```

Root npm workspaces share development dependencies. Each package declares its own host-provided peers and Pi manifest; neither depends on the other. Pi loads TypeScript directly, so there is no build step. Artifact checks exclude tests and include source, declarations, documentation and licenses.

For a local tarball (not a registry release):

```sh
mkdir -p .scratch/artifacts
npm pack --workspace packages/session-status --pack-destination .scratch/artifacts
npm pack --workspace packages/subagent-guard --pack-destination .scratch/artifacts
```

Extract a tarball into its own directory and point `pi -e` or `pi install` at the extracted `package` directory. Pi does not document tarball paths as package sources.

## License

MIT. See [LICENSE](LICENSE). Each package carries its own license. Session Status's [core](packages/session-status/extensions/session-status/core/README.md) is copied from [claude-mods](https://github.com/yahyabedirhan/claude-mods), MIT; its README names the source commit.
