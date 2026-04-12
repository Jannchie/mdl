# mdl

`mdl` is a TypeScript monorepo for a pure TypeScript reimplementation of `musicdl`.

## Architecture

- `@jannchie/mdl-core`: shared domain types and orchestration
- `@jannchie/mdl-sdk`: source implementations and the programmatic client
- `@jannchie/mdl-cli`: command-line entrypoint
- `@mdl/api`: HTTP API entrypoint (internal package, not published)

## Current Status

This repository is being migrated from the original Python project into a pure TypeScript architecture.

The current implementation includes:

- shared orchestration in `core`
- a reusable HTTP source base in `sdk`
- migrated `JamendoMusicClient`
- migrated `QianqianMusicClient`
- migrated `MiguMusicClient`
- `cli` and `api` entrypoints

The remaining sources still need to be ported.

## Install

```bash
pnpm install
pnpm build
```

## CLI

```bash
pnpm --filter @jannchie/mdl-cli exec mdl sources
pnpm --filter @jannchie/mdl-cli exec mdl search "Jay Chou"
pnpm --filter @jannchie/mdl-cli exec mdl parse-playlist "https://music.91q.com/songlist/123.html"
```

## API

```bash
pnpm --filter @mdl/api exec mdl-api
```
