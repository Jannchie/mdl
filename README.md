# mdl

`mdl` is a pure TypeScript music search and download toolkit that reimplements the feature set of `musicdl`, but is implemented independently.

It is organized as a monorepo with a shared core layer, a programmatic SDK, a CLI, and an internal Hono API package.

## Packages

Published packages:

- `@jannchie/mdl-core`: shared types and orchestration
- `@jannchie/mdl-sdk`: source implementations and the programmatic client
- `@jannchie/mdl-cli`: command-line interface

Internal package:

- `@mdl/api`: Hono API app with OpenAPI and Scalar documentation

## Features

- Multi-source search
- Playlist parsing
- Local file download
- Stream opening for external services such as S3 ingestion pipelines
- Hono API with OpenAPI JSON and Scalar reference page

## Architecture

The dependency graph is intentionally simple:

- `api -> sdk -> core`
- `cli -> sdk -> core`

This keeps source logic inside the SDK and leaves transport concerns to the CLI or API layer.

## Installation

### SDK

```bash
pnpm add @jannchie/mdl-sdk
```

### CLI

```bash
pnpm add -g @jannchie/mdl-cli
```

Or run it without a global install:

```bash
pnpm dlx @jannchie/mdl-cli --help
```

## Quick Start

### CLI

List enabled sources:

```bash
mdl sources
```

Search grouped by source:

```bash
mdl search "Jay Chou"
mdl search --sources QQMusicClient,MiguMusicClient "稻香"
mdl search --json --sources MiguMusicClient "槐花落"
```

Parse a playlist:

```bash
mdl parse-playlist "https://music.163.com/#/playlist?id=123456"
```

Download from a JSON file containing `TrackDetail[]`:

```bash
mdl download --input ./tracks.json --output ./downloads
```

### SDK

```ts
import { createClient } from '@jannchie/mdl-sdk'

const client = createClient()

const grouped = await client.search('稻香', {
  sources: ['QQMusicClient', 'MiguMusicClient'],
})

const playlist = await client.parsePlaylist('https://music.163.com/#/playlist?id=123456')

const qqTrack = grouped.QQMusicClient?.[0]
if (!qqTrack) {
  throw new Error('No QQ track found')
}

const detail = await client.fetchDetail(qqTrack)

const downloads = await client.download([detail], {
  outputDir: './downloads',
})
```

All SDK operations are asynchronous. `createClient()` is synchronous, but the actual work is done through async methods such as `search()`, `fetchDetail()`, `parsePlaylist()`, `download()`, and `openTrackStream()`.

## Default Sources

The default client created by `createClient()` enables these sources:

- `MiguMusicClient`
- `NeteaseMusicClient`
- `QQMusicClient`
- `KuwoMusicClient`
- `KugouMusicClient`
- `JamendoMusicClient`

`JBSouMusicClient` is implemented in the SDK, but it is not enabled by default. It aggregates multiple upstream sites and is intended to remain opt-in rather than part of the default source set.

You can limit requests to a smaller subset by passing `sources` to `search()` or `parsePlaylist()`, and `/sources` returns the default enabled list exposed by the current API process.

### Open a Track Stream

This is useful when your own backend wants to ingest audio directly into S3 or another object store without going through the HTTP API package.

```ts
import { createClient } from '@jannchie/mdl-sdk'

const client = createClient()

const grouped = await client.search('槐花落', {
  sources: ['MiguMusicClient'],
  limit: 1,
})

const track = grouped.MiguMusicClient?.[0]
if (!track) {
  throw new Error('No track found')
}

const stream = await client.openTrackStream(track)

console.log(stream.contentType)
console.log(stream.contentLength)
console.log(stream.finalUrl)
```

The returned object includes:

- `body`: `ReadableStream<Uint8Array>`
- `contentType`
- `contentLength`
- `finalUrl`
- `downloadUrl`
- `ext`
- response `headers`

## Internal API

The internal API package uses Hono and exposes:

- `GET /`
- `GET /health`
- `GET /sources`
- `POST /search`
- `POST /fetch-detail`
- `POST /parse-playlist`
- `POST /download`
- `GET /openapi.json`
- `GET /scalar`

Run it from the monorepo:

```bash
pnpm --filter @mdl/api exec mdl-api
```

Specify a fixed port when needed:

```bash
pnpm --filter @mdl/api exec mdl-api --port 8787
# or
PORT=8787 pnpm --filter @mdl/api exec mdl-api
```

Default behavior:

- The API listens on `127.0.0.1:3653` by default.
- The startup log prints the actual address.
- OpenAPI: `http://127.0.0.1:3653/openapi.json`
- Scalar: `http://127.0.0.1:3653/scalar`

## Development

Install dependencies:

```bash
pnpm install
```

Validate the workspace:

```bash
pnpm lint
pnpm typecheck
pnpm build
pnpm test
```

Useful local commands:

```bash
pnpm --filter @jannchie/mdl-cli exec mdl --help
pnpm --filter @mdl/api exec mdl-api
pnpm mdl -- --help
pnpm api
```

Run directly from source without building `dist` first:

```bash
pnpm mdl -- search "Jay Chou" --sources QQMusicClient,MiguMusicClient
pnpm api
```

## Publishing

Public packages:

- `@jannchie/mdl-core`
- `@jannchie/mdl-sdk`
- `@jannchie/mdl-cli`

Typical publish order:

```bash
pnpm --filter @jannchie/mdl-core run build && pnpm --filter @jannchie/mdl-core publish --access public
pnpm --filter @jannchie/mdl-sdk run build && pnpm --filter @jannchie/mdl-sdk publish --access public
pnpm --filter @jannchie/mdl-cli run build && pnpm --filter @jannchie/mdl-cli publish --access public
```

## Notes

- This project is a TypeScript reimplementation of the `musicdl` feature set.
- Some music sources are more stable than others. Source availability depends on upstream providers, region restrictions, and anti-bot behavior.
- The default enabled source list intentionally excludes currently unreliable providers.
- The project does not depend on the original Python `musicdl` implementation.
