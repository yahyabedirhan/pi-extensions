# pi-extensions

Extensions for the [Pi coding agent](https://pi.dev), as one Pi package.

| Extension | What it does |
|---|---|
| [session-status](extensions/session-status/README.md) | Shows what the session needs from you: decisions, blockers, surprises, progress and links. You answer from an overlay. |

## Install

```sh
pi install git:github.com/yahyabedirhan/pi-extensions@v0.1.0
```

To try it for one run without installing, use `pi -e` with the same source.

## Develop

```sh
npm install
npm test        # vitest
npm run check   # tsc
pi -e ./extensions/session-status/index.ts
```

Pi loads the TypeScript directly, so there is no build step.

## License

MIT. See [LICENSE](LICENSE). `extensions/session-status/core/` is copied from [claude-mods](https://github.com/yahyabedirhan/claude-mods), MIT, same author; its README names the source commit.
