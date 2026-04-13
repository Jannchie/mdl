import type {
  DownloadOptions,
  DownloadResult,
  FetchDetailOptions,
  OpenedTrackStream,
  OpenTrackStreamOptions,
  ParsePlaylistOptions,
  SearchOptions,
  SourceContext,
  Track,
} from '@jannchie/mdl-core'
import { writeFile } from 'node:fs/promises'

import path from 'node:path'

import { AudioLinkTester } from '../shared/audio-link-tester.js'
import { HttpClient } from '../shared/http.js'
import { buildTrackOutputPath, cleanLyric, ensureDir, uniqueByIdentifier } from '../shared/utils.js'

interface SearchRequest {
  url: string
  query?: Record<string, string | number | boolean>
}

export abstract class BaseMusicSource {
  abstract readonly name: string
  protected abstract readonly searchHeaders: Record<string, string>
  protected abstract readonly parseHeaders: Record<string, string>
  protected abstract readonly downloadHeaders: Record<string, string>

  protected abstract buildSearchRequests(input: SearchOptions, context: SourceContext): SearchRequest[]
  protected abstract extractSearchItems(payload: unknown): unknown[]
  protected abstract buildSearchTrack(item: unknown, context: SourceContext): Promise<Track | null>
  protected abstract resolveTrackDetail(track: Track, context: SourceContext): Promise<Track>

  protected get searchClient(): HttpClient {
    return new HttpClient(this.searchHeaders)
  }

  protected get parseClient(): HttpClient {
    return new HttpClient(this.parseHeaders)
  }

  protected get downloadClient(): HttpClient {
    return new HttpClient(this.downloadHeaders)
  }

  protected get audioLinkTester(): AudioLinkTester {
    return new AudioLinkTester({ headers: this.downloadHeaders })
  }

  async search(input: SearchOptions, context: SourceContext): Promise<Track[]> {
    const limit = input.searchSizePerSource
    const results: Track[] = []
    const signal = context.requestOverrides?.signal as AbortSignal | undefined
    for (const request of this.buildSearchRequests(input, context)) {
      if (signal?.aborted) {
        return uniqueByIdentifier(results)
      }
      const payload = await this.searchClient.json<unknown>(request.url, {
        query: request.query,
        headers: context.requestOverrides?.headers as Record<string, string> | undefined,
        cookies: context.requestOverrides?.cookies as Record<string, unknown> | string | undefined,
        timeoutMs: context.requestOverrides?.timeoutMs as number | undefined,
        signal: context.requestOverrides?.signal as AbortSignal | undefined,
      })
      for (const item of this.extractSearchItems(payload)) {
        if (signal?.aborted) {
          return uniqueByIdentifier(results)
        }
        const track = await this.buildSearchTrack(item, context)
        if (!track) {
          continue
        }
        results.push(track)
        if (limit !== undefined && results.length >= limit) {
          return uniqueByIdentifier(results)
        }
      }
    }
    return uniqueByIdentifier(results)
  }

  async fetchDetail(input: FetchDetailOptions, context: SourceContext): Promise<Track> {
    return await this.resolveTrackDetail(input.track, context)
  }

  async download(input: DownloadOptions, context: SourceContext): Promise<DownloadResult> {
    const outputDir = input.outputDir ?? path.resolve(process.cwd(), 'downloads')
    const items = []
    for (const track of input.tracks) {
      if (!track.downloadUrl) {
        continue
      }
      const savePath = buildTrackOutputPath(outputDir, this.name, track.songName, track.identifier, track.ext ?? 'mp3')
      await this.downloadClient.downloadToFile(track.downloadUrl, savePath, {
        headers: {
          ...this.downloadHeaders,
          ...track.downloadHeaders,
          ...(context.requestOverrides?.headers as Record<string, string> | undefined),
        },
        cookies: context.requestOverrides?.cookies as Record<string, unknown> | string | undefined,
        timeoutMs: context.requestOverrides?.timeoutMs as number | undefined,
        signal: context.requestOverrides?.signal as AbortSignal | undefined,
      })
      if (track.lyric && track.lyric !== 'NULL') {
        await ensureDir(path.dirname(savePath))
        await writeFile(savePath.replace(/\.[^.]+$/, '.lrc'), cleanLyric(track.lyric), 'utf8')
      }
      items.push({
        source: this.name,
        identifier: track.identifier,
        savePath,
      })
    }
    return {
      source: this.name,
      requested: input.tracks.length,
      completed: items.length,
      items,
    }
  }

  async openTrackStream(input: OpenTrackStreamOptions, context: SourceContext): Promise<OpenedTrackStream> {
    const track = input.track
    if (!track.downloadUrl) {
      throw new Error(`Track ${track.identifier} from ${this.name} has no download url`)
    }

    const response = await this.downloadClient.openStream(track.downloadUrl, {
      headers: {
        ...this.downloadHeaders,
        ...track.downloadHeaders,
        ...(context.requestOverrides?.headers as Record<string, string> | undefined),
      },
      cookies: context.requestOverrides?.cookies as Record<string, unknown> | string | undefined,
      timeoutMs: context.requestOverrides?.timeoutMs as number | undefined,
      signal: context.requestOverrides?.signal as AbortSignal | undefined,
    })
    if (!response.ok || !response.body) {
      throw new Error(`Failed to open stream ${response.url}`)
    }
    const headers: Record<string, string> = {}
    for (const [key, value] of response.headers as unknown as Iterable<[string, string]>) {
      headers[key] = value
    }

    return {
      source: this.name,
      identifier: track.identifier,
      downloadUrl: track.downloadUrl,
      finalUrl: response.url,
      contentType: response.headers.get('content-type'),
      contentLength: Number(response.headers.get('content-length') ?? '') || null,
      ext: track.ext,
      headers,
      body: response.body,
    }
  }

  async parsePlaylist(_input: ParsePlaylistOptions, _context: SourceContext): Promise<Track[]> {
    return []
  }
}
