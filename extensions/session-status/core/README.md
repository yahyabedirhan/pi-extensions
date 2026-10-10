# Copied core

These files are copied unchanged from the session-status mod in
[claude-mods](https://github.com/yahyabedirhan/claude-mods), MIT, same author:

- Source: `plugins/session-status/` at commit `ec4fd502ec244ad09ec49273e30a16b070189d05`.
- `hooks/` holds the pure modules: they take data and give data, and import only types.
- `types/index.d.ts` is the `SessionStatus` contract.
- `tests/` holds the source's tests that need no Claude Code engine. `vitest.config.ts` maps their `claude-code/testing` import to vitest.

`claude-code.d.ts` is the only file written here: it declares the few Claude Code types the modules import, which exist only at type-check time.

Keep the copies unchanged, so a later shared core can replace this folder. Put Pi-specific behaviour in the adapter one folder up. To update the copy, copy the same files from a newer commit and change the commit above.
