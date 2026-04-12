#!/usr/bin/env node
import type { Track } from '@jannchie/mdl-sdk'

import { readFile } from 'node:fs/promises'

import { createClient } from '@jannchie/mdl-sdk'
import { cac } from 'cac'

const cli = cac('mdl')
const client = createClient()

function parseSources(value?: string): string[] | undefined {
  if (!value) {
    return undefined
  }

  return value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
}

cli.help()
cli.version('0.1.0')

cli
  .command('sources', 'List available sources')
  .action(() => {
    for (const source of client.listSources()) {
      console.log(source)
    }
  })

cli
  .command('search <keyword>', 'Search music tracks')
  .option('-s, --sources <sources>', 'comma-separated source list')
  .option('--json', 'print full JSON')
  .action(async (keyword: string, options: { sources?: string, json?: boolean }) => {
    const result = await client.search({
      keyword,
      sources: parseSources(options.sources),
    })
    if (options.json) {
      console.log(JSON.stringify(result, null, 2))
      return
    }

    for (const [source, tracks] of Object.entries(result)) {
      console.log(`\n[${source}]`)
      for (const track of tracks) {
        console.log(`${track.songName} | ${track.singers ?? 'NULL'} | ${track.fileSize ?? 'NULL'}`)
      }
    }
  })

cli
  .command('search-merged <keyword>', 'Search music tracks and fuse rankings with RRF')
  .option('-s, --sources <sources>', 'comma-separated source list')
  .option('--rrf-k <number>', 'RRF rank constant', {
    default: '60',
  })
  .option('--timeout-ms <number>', 'overall timeout for merged search', {
    default: '0',
  })
  .option('--json', 'print full JSON')
  .action(async (keyword: string, options: { sources?: string, json?: boolean, rrfK?: string, timeoutMs?: string }) => {
    const result = await client.searchMerged({
      keyword,
      sources: parseSources(options.sources),
      rrfK: Number(options.rrfK ?? '60'),
      timeoutMs: Number(options.timeoutMs ?? '0'),
    })
    if (options.json) {
      console.log(JSON.stringify(result, null, 2))
      return
    }

    for (const track of result) {
      console.log(
        `${track.songName} | ${track.singers ?? 'NULL'} | score=${track.fusedScore ?? 0} | sources=${(track.matchedSources ?? [track.source]).join(',')}`,
      )
    }
  })

cli
  .command('parse-playlist <playlistUrl>', 'Parse a playlist URL')
  .option('-s, --sources <sources>', 'comma-separated source list')
  .option('--json', 'print full JSON')
  .action(async (playlistUrl: string, options: { sources?: string, json?: boolean }) => {
    const result = await client.parsePlaylist({
      playlistUrl,
      sources: parseSources(options.sources),
    })
    if (options.json) {
      console.log(JSON.stringify(result, null, 2))
      return
    }

    for (const track of result) {
      console.log(`${track.songName} | ${track.singers ?? 'NULL'} | ${track.source}`)
    }
  })

cli
  .command('download', 'Download tracks from a JSON file')
  .option('-i, --input <file>', 'path to a JSON file containing Track[]')
  .option('-o, --output <dir>', 'output directory')
  .action(async (options: { input?: string, output?: string }) => {
    if (!options.input) {
      throw new Error('Missing required option --input')
    }

    const content = await readFile(options.input, 'utf8')
    const tracks = JSON.parse(content) as Track[]
    const result = await client.download({
      tracks,
      outputDir: options.output,
    })
    console.log(JSON.stringify(result, null, 2))
  })

cli.parse()
