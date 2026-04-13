import type { DownloadResult, OpenedTrackStream, TrackDetail, TrackLookup, TrackSummary } from '@jannchie/mdl-core'
import type {
  DownloadRequest,
  FetchDetailRequest,
  OpenTrackStreamRequest,
  ParsePlaylistRequest,
  SearchRequest,
  SourceContext,
} from '@jannchie/mdl-core/internal'
import { writeFile } from 'node:fs/promises'

import path from 'node:path'

import { AudioLinkTester } from '../shared/audio-link-tester.js'
import { HttpClient } from '../shared/http.js'
import { buildTrackOutputPath, cleanLyric, ensureDir, uniqueByIdentifier } from '../shared/utils.js'

interface SearchEndpointRequest {
  url: string
  query?: Record<string, string | number | boolean>
}

export abstract class BaseMusicSource {
  abstract readonly name: string
  protected abstract readonly searchHeaders: Record<string, string>
  protected abstract readonly parseHeaders: Record<string, string>
  protected abstract readonly downloadHeaders: Record<string, string>

  protected buildSearchRequests(_input: SearchRequest, _context: SourceContext): SearchEndpointRequest[] {
    return []
  }

  protected extractSearchItems(_payload: unknown): unknown[] {
    return []
  }

  protected async buildSearchTrack(_item: unknown, _context: SourceContext): Promise<TrackSummary | null> {
    return null
  }

  protected abstract resolveTrackDetail(track: TrackLookup, context: SourceContext): Promise<TrackDetail>

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

  async search(input: SearchRequest, context: SourceContext): Promise<TrackSummary[]> {
    const limit = input.limit
    const results: TrackSummary[] = []
    const signal = context.requestOptions?.signal as AbortSignal | undefined
    for (const request of this.buildSearchRequests(input, context)) {
      if (signal?.aborted) {
        return uniqueByIdentifier(results)
      }
      const payload = await this.searchClient.json<unknown>(request.url, {
        query: request.query,
        headers: context.requestOptions?.headers as Record<string, string> | undefined,
        cookies: context.requestOptions?.cookies as Record<string, unknown> | string | undefined,
        timeoutMs: context.requestOptions?.timeoutMs as number | undefined,
        signal: context.requestOptions?.signal as AbortSignal | undefined,
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

  async fetchDetail(input: FetchDetailRequest, context: SourceContext): Promise<TrackDetail> {
    return await this.resolveTrackDetail(input.track, context)
  }

  protected isDetailedTrack(track: TrackLookup): track is TrackDetail {
    return typeof track.songName === 'string'
      && track.songName.length > 0
      && typeof track.downloadUrl === 'string'
      && track.downloadUrl.length > 0
  }

  async download(input: DownloadRequest, context: SourceContext): Promise<DownloadResult> {
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
          ...(context.requestOptions?.headers as Record<string, string> | undefined),
        },
        cookies: context.requestOptions?.cookies as Record<string, unknown> | string | undefined,
        timeoutMs: context.requestOptions?.timeoutMs as number | undefined,
        signal: context.requestOptions?.signal as AbortSignal | undefined,
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

  async openTrackStream(input: OpenTrackStreamRequest, context: SourceContext): Promise<OpenedTrackStream> {
    const track = input.track
    if (!track.downloadUrl) {
      throw new Error(`Track ${track.identifier} from ${this.name} has no download url`)
    }

    const response = await this.downloadClient.openStream(track.downloadUrl, {
      headers: {
        ...this.downloadHeaders,
        ...track.downloadHeaders,
        ...(context.requestOptions?.headers as Record<string, string> | undefined),
      },
      cookies: context.requestOptions?.cookies as Record<string, unknown> | string | undefined,
      timeoutMs: context.requestOptions?.timeoutMs as number | undefined,
      signal: context.requestOptions?.signal as AbortSignal | undefined,
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

  async parsePlaylist(_input: ParsePlaylistRequest, _context: SourceContext): Promise<TrackSummary[]> {
    return []
  }
}
