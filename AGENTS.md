# Agent instructions

Independent packages for the [Pi coding agent](https://pi.dev), with root npm workspace tooling. Each `packages/<name>/package.json` declares its own Pi resources. Pi loads TypeScript through jiti, so the repo has no build step.

- Each extension lives in `packages/<name>/extensions/<name>/`, with `index.ts` as its entry and a package-root `README.md` for its users.
- Keep package identities private until publication is approved. The repository root is development tooling, not an installable bundle.
- Pi supplies `@earendil-works/pi-*` and `typebox` at run time. List them in `peerDependencies` with `"*"`, and in `devDependencies` for type checks and tests.
- Try a package for one run with `pi -e ./packages/<name>`. Leave the personal Pi config (`~/.pi`) unchanged.
- Run `npm test` (vitest), `npm run check` (tsc) and `npm run test:packages` (isolated packed artifacts) before each commit.
- The repo is public. Keep personal details out: home paths, emails, machine names and private repository names.
- Say "extension" for a Pi add-on, as Pi's docs do.
- Write commit messages in lowercase: a subject line, a blank line, then one `- ` line per detail.

## Agent skills

### Issue tracker

GitHub issues in `yahyabedirhan/pi-packages`, via `gh`. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default labels, each named after its role. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context. See `docs/agents/domain.md`.
