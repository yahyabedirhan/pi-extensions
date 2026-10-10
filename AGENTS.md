# Agent instructions

Extensions for the [Pi coding agent](https://pi.dev). The repo is one Pi package: `package.json` lists each extension under `pi.extensions`. Pi loads TypeScript through jiti, so the repo has no build step.

- Each extension lives in `extensions/<name>/`, with `index.ts` as its entry and a `README.md` for its users.
- Pi supplies `@earendil-works/pi-*` and `typebox` at run time. List them in `peerDependencies` with `"*"`, and in `devDependencies` for type checks and tests.
- Try an extension for one run with `pi -e ./extensions/<name>/index.ts`. Leave the personal Pi config (`~/.pi`) unchanged.
- Run `npm test` (vitest) and `npm run check` (tsc) before each commit.
- The repo is public. Keep personal details out: home paths, emails, machine names and private repository names.
- Say "extension" for a Pi add-on, as Pi's docs do.
- Write commit messages in lowercase: a subject line, a blank line, then one `- ` line per detail.

## Agent skills

### Issue tracker

GitHub issues in `yahyabedirhan/pi-extensions`, via `gh`. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default labels, each named after its role. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context. See `docs/agents/domain.md`.
