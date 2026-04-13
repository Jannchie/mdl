import type { Track } from '@jannchie/mdl-sdk'

import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

import { cac } from 'cac'

const require = createRequire(import.meta.url)
interface AsciiTable {
  push: (...rows: string[][]) => number
  toString: () => string
}
type AsciiTableConstructor = new (options: {
  head: string[]
  chars: Record<string, string>
  style: {
    head: string[]
    border: string[]
    compact: boolean
  }
}) => AsciiTable
const Table = require('cli-table3') as AsciiTableConstructor

export interface CliClient {
  listSources: () => string[]
  search: (options: { keyword: string, sources?: string[] }) => Promise<Record<string, Track[]>>
  fetchDetail: (options: { track: Track }) => Promise<Track>
  parsePlaylist: (options: { playlistUrl: string, sources?: string[] }) => Promise<Track[]>
  download: (options: { tracks: Track[], outputDir?: string }) => Promise<unknown>
}

export function parseSources(value?: string): string[] | undefined {
  if (!value) {
    return undefined
  }

  return value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
}

export function parseIntegerOption(value: string | undefined, optionName: string, minimum: number): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < minimum) {
    throw new TypeError(`${optionName} must be an integer greater than or equal to ${minimum}`)
  }
  return parsed
}

function isTrack(value: unknown): value is Track {
  if (!value || typeof value !== 'object') {
    return false
  }

  const track = value as Record<string, unknown>
  return typeof track.source === 'string'
    && typeof track.identifier === 'string'
    && typeof track.songName === 'string'
}

export function parseTrack(content: string): Track {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  }
  catch (error) {
    throw new Error(`Invalid JSON in input file: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (!isTrack(parsed)) {
    throw new TypeError('Input file must contain a JSON track object')
  }
  return parsed
}

export function parseTrackList(content: string): Track[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  }
  catch (error) {
    throw new Error(`Invalid JSON in input file: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (!Array.isArray(parsed)) {
    throw new TypeError('Input file must contain a JSON array of tracks')
  }
  for (const [index, item] of parsed.entries()) {
    if (!isTrack(item)) {
      throw new TypeError(`Invalid track at index ${index}`)
    }
  }
  return parsed
}

function createAsciiTable(head: string[]) {
  return new Table({
    head,
    chars: {
      'top': '-',
      'top-mid': '+',
      'top-left': '+',
      'top-right': '+',
      'bottom': '-',
      'bottom-mid': '+',
      'bottom-left': '+',
      'bottom-right': '+',
      'left': '|',
      'left-mid': '+',
      'mid': '-',
      'mid-mid': '+',
      'right': '|',
      'right-mid': '+',
      'middle': '|',
    },
    style: {
      head: [],
      border: [],
      compact: true,
    },
  })
}

function renderSourcesTable(sources: string[]): string {
  const table = createAsciiTable(['Source'])
  for (const source of sources) {
    table.push([source])
  }
  return table.toString()
}

function renderTrackTable(tracks: Track[]): string {
  const table = createAsciiTable(['Song', 'Singers', 'Album'])
  for (const track of tracks) {
    table.push([
      track.songName,
      track.singers ?? 'NULL',
      track.album ?? 'NULL',
    ])
  }
  return table.toString()
}

function renderPlaylistTable(tracks: Track[]): string {
  const table = createAsciiTable(['Song', 'Singers', 'Source'])
  for (const track of tracks) {
    table.push([
      track.songName,
      track.singers ?? 'NULL',
      track.source,
    ])
  }
  return table.toString()
}

export function createCli(client: CliClient, version: string) {
  const cli = cac('mdl')

  cli.help()
  cli.version(version)

  cli
    .command('sources', 'List available sources')
    .action(() => {
      console.log(renderSourcesTable(client.listSources()))
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
        console.log(renderTrackTable(tracks))
      }
    })

  cli
    .command('fetch-detail', 'Fetch full detail for a track from a JSON file')
    .option('-i, --input <file>', 'path to a JSON file containing one Track')
    .action(async (options: { input?: string }) => {
      if (!options.input) {
        throw new Error('Missing required option --input')
      }

      const content = await readFile(options.input, 'utf8')
      const track = parseTrack(content)
      const result = await client.fetchDetail({ track })
      console.log(JSON.stringify(result, null, 2))
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

      console.log(renderPlaylistTable(result))
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
      const tracks = parseTrackList(content)
      const result = await client.download({
        tracks,
        outputDir: options.output,
      })
      console.log(JSON.stringify(result, null, 2))
    })

  return cli
}
