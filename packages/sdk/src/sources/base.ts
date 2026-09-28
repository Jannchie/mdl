import type { DownloadResult, OpenedTrackStream, SourceCapabilities, TrackDetail, TrackLookup, TrackSummary } from '@jannchie/mdl-core'
import type {
  DownloadRequest,
  FetchDetailRequest,
  OpenTrackStreamRequest,
  ParsePlaylistRequest,
  SearchRequest,
  SourceContext,
} from '@jannchie/mdl-core/internal'
import type { RequestOverrides } from '../shared/http.js'

import { writeFile } from 'node:fs/promises'

import path from 'node:path'
import { DEFAULT_SOURCE_CAPABILITIES } from '@jannchie/mdl-core'
import { AudioLinkTester } from '../shared/audio-link-tester.js'
import { HttpClient } from '../shared/http.js'
import { buildTrackOutputPath, cleanLyric, ensureDir, uniqueByIdentifier } from '../shared/utils.js'

const MIN_FULL_TRACK_BITRATE = 64_000
const RESOLVER_TIMEOUT_MS = 8000

export interface PlayableLink {
  ext: string
  fileSize: string
}

export interface ResolvedCandidates {
  /** Candidate audio urls, best quality first. */
  urls: string[]
  /** Duration reported by the resolver, used when the caller does not know it. */
  durationS?: number
}

interface SearchEndpointRequest {
  url: string
  query?: Record<string, string | number | boolean>
}

export abstract class BaseMusicSource {
  abstract readonly name: string
  readonly capabilities: SourceCapabilities = DEFAULT_SOURCE_CAPABILITIES
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

  protected requestOverrides(context: SourceContext): RequestOverrides {
    return {
      headers: context.requestOptions?.headers as Record<string, string> | undefined,
      cookies: context.requestOptions?.cookies as Record<string, unknown> | string | undefined,
      timeoutMs: context.requestOptions?.timeoutMs as number | undefined,
      signal: context.requestOptions?.signal as AbortSignal | undefined,
    }
  }

  /**
   * Overrides for third-party resolver calls: sources chain several resolvers, so a hanging one must fail fast.
   */
  protected resolverOverrides(context: SourceContext): RequestOverrides {
    const overrides = this.requestOverrides(context)
    return { ...overrides, timeoutMs: Math.min(overrides.timeoutMs ?? RESOLVER_TIMEOUT_MS, RESOLVER_TIMEOUT_MS) }
  }

  /**
   * Returns the playable link info of a url, or null when the url is unreachable, not audio,
   * or too small for the track duration (resolvers hand out ~30s preview clips for tracks they cannot unlock).
   */
  protected async probeDownloadUrl(url: string, context: SourceContext, durationS?: number): Promise<PlayableLink | null> {
    if (!url.startsWith('http')) {
      return null
    }
    const status = await this.audioLinkTester.test(url, this.resolverOverrides(context))
    if (!status.ok || !status.ext || status.ext === 'NULL') {
      return null
    }
    if (durationS && status.clen && (status.clen * 8) / durationS < MIN_FULL_TRACK_BITRATE) {
      return null
    }
    return {
      ext: status.ext,
      fileSize: status.clen ? `${(status.clen / 1024 / 1024).toFixed(2)} MB` : 'NULL',
    }
  }

  /**
   * Walks resolvers × quality levels and returns the first candidate url that is playable full-length audio.
   * A resolver that throws is skipped entirely rather than retried for lower levels.
   */
  protected async resolveFirstPlayable<R, C extends ResolvedCandidates>(
    resolvers: readonly R[],
    levels: readonly string[],
    resolve: (resolver: R, level: string) => Promise<C>,
    context: SourceContext,
    durationS?: number,
  ): Promise<{ url: string, link: PlayableLink, candidates: C } | null> {
    const signal = context.requestOptions?.signal as AbortSignal | undefined
    for (const resolver of resolvers) {
      for (const level of levels) {
        if (signal?.aborted) {
          return null
        }
        let candidates: C
        try {
          candidates = await resolve(resolver, level)
        }
        catch {
          break
        }
        for (const url of candidates.urls) {
          const link = await this.probeDownloadUrl(url, context, durationS || candidates.durationS)
          if (link) {
            return { url, link, candidates }
          }
        }
      }
    }
    return null
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
        ...this.requestOverrides(context),
        query: request.query,
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
      await this.downloadClient.downloadToFile(track.downloadUrl, savePath, this.downloadOverrides(track, context))
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

  private downloadOverrides(track: TrackDetail, context: SourceContext): RequestOverrides {
    const overrides = this.requestOverrides(context)
    return {
      ...overrides,
      headers: { ...this.downloadHeaders, ...track.downloadHeaders, ...overrides.headers },
    }
  }

  async openTrackStream(input: OpenTrackStreamRequest, context: SourceContext): Promise<OpenedTrackStream> {
    const track = input.track
    if (!track.downloadUrl) {
      throw new Error(`Track ${track.identifier} from ${this.name} has no download url`)
    }

    const response = await this.downloadClient.openStream(track.downloadUrl, this.downloadOverrides(track, context))
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
      // CDNs mislabel audio (FLAC as text/html or audio/mpeg), so the probed extension wins over the header.
      contentType: AudioLinkTester.contentTypeForExt(track.ext) ?? response.headers.get('content-type'),
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
