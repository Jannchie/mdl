import type {
  DownloadRequest,
  FetchDetailRequest,
  MusicSource,
  OpenTrackStreamRequest,
  ParsePlaylistRequest,
  SearchRequest,
  SourceContext,
} from './internal-types.js'
import type {
  DownloadOptions,
  DownloadResult,
  FetchDetailOptions,
  OpenedTrackStream,
  OpenTrackStreamOptions,
  ParsePlaylistOptions,
  SearchOptions,
  SourceCapabilities,
  TrackDetail,
  TrackLookup,
  TrackSummary,
} from './types.js'

import { DEFAULT_SOURCE_CAPABILITIES } from './types.js'

export class MusicService {
  private readonly sources = new Map<string, MusicSource>()

  constructor(sources: MusicSource[]) {
    for (const source of sources) {
      this.sources.set(source.name, source)
    }
  }

  listSources(): string[] {
    return [...this.sources.keys()].sort()
  }

  getCapabilities(name: string): SourceCapabilities {
    const source = this.sources.get(name)
    if (!source) {
      throw new Error(`Unknown source: ${name}`)
    }
    return source.capabilities ?? DEFAULT_SOURCE_CAPABILITIES
  }

  listCapabilities(): Record<string, SourceCapabilities> {
    const result: Record<string, SourceCapabilities> = {}
    for (const [name, source] of this.sources) {
      result[name] = source.capabilities ?? DEFAULT_SOURCE_CAPABILITIES
    }
    return result
  }

  async search(keyword: string, options: SearchOptions = {}): Promise<Record<string, TrackSummary[]>> {
    const request: SearchRequest = { ...options, keyword }
    const selected = this.resolveSources(request.sources)
    const entries = await Promise.all(
      selected.map(async (source) => {
        const context = this.buildContext(source.name, request)
        const tracks = await source.search(request, context)
        return [source.name, tracks] as const
      }),
    )

    return Object.fromEntries(entries)
  }

  async fetchDetail(track: TrackLookup, options: FetchDetailOptions = {}): Promise<TrackDetail> {
    const request: FetchDetailRequest = { ...options, track }
    const source = this.sources.get(request.track.source)
    if (!source) {
      throw new Error(`Unknown source: ${request.track.source}`)
    }

    const context: SourceContext = {
      sourceOptions: request.sourceOptions?.[source.name],
      requestOptions: request.requestOptions?.[source.name],
    }
    return await source.fetchDetail(request, context)
  }

  async download(tracks: TrackDetail[], options: DownloadOptions = {}): Promise<DownloadResult[]> {
    const request: DownloadRequest = { ...options, tracks }
    const grouped = new Map<string, TrackDetail[]>()
    for (const track of request.tracks) {
      const existing = grouped.get(track.source) ?? []
      existing.push(track)
      grouped.set(track.source, existing)
    }

    const results: DownloadResult[] = []
    for (const [sourceName, tracks] of grouped) {
      const source = this.sources.get(sourceName)
      if (!source) {
        throw new Error(`Unknown source: ${sourceName}`)
      }

      const context: SourceContext = {
        requestOptions: request.requestOptions?.[sourceName],
      }
      results.push(await source.download({ ...request, tracks }, context))
    }
    return results
  }

  async openTrackStream(track: TrackDetail, options: OpenTrackStreamOptions = {}): Promise<OpenedTrackStream> {
    const request: OpenTrackStreamRequest = { ...options, track }
    const source = this.sources.get(request.track.source)
    if (!source) {
      throw new Error(`Unknown source: ${request.track.source}`)
    }
    const context: SourceContext = {
      requestOptions: request.requestOptions?.[source.name],
    }
    return await source.openTrackStream(request, context)
  }

  async parsePlaylist(playlistUrl: string, options: ParsePlaylistOptions = {}): Promise<TrackSummary[]> {
    const request: ParsePlaylistRequest = { ...options, playlistUrl }
    const selected = this.resolveSources(request.sources)
    for (const source of selected) {
      if (!source.parsePlaylist) {
        continue
      }
      const context = this.buildContext(source.name, request)
      const tracks = await source.parsePlaylist(request, context)
      if (tracks.length > 0) {
        return tracks
      }
    }
    return []
  }

  private resolveSources(names?: string[]): MusicSource[] {
    if (!names || names.length === 0) {
      return [...this.sources.values()]
    }

    return names.map((name) => {
      const source = this.sources.get(name)
      if (!source) {
        throw new Error(`Unknown source: ${name}`)
      }
      return source
    })
  }

  private buildContext(
    sourceName: string,
    options: Pick<SearchRequest, 'sourceOptions' | 'requestOptions' | 'sourceSearchOptions'>,
  ): SourceContext {
    return {
      sourceOptions: options.sourceOptions?.[sourceName],
      requestOptions: options.requestOptions?.[sourceName],
      sourceSearchOptions: options.sourceSearchOptions?.[sourceName],
    }
  }
}
