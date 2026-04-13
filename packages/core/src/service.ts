import type {
  DownloadOptions,
  DownloadResult,
  FetchDetailOptions,
  MusicSource,
  OpenedTrackStream,
  OpenTrackStreamOptions,
  ParsePlaylistOptions,
  SearchOptions,
  SourceContext,
  Track,
} from './types.js'

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

  async search(options: SearchOptions): Promise<Record<string, Track[]>> {
    const selected = this.resolveSources(options.sources)
    const entries = await Promise.all(
      selected.map(async (source) => {
        const context = this.buildContext(source.name, options)
        const tracks = await source.search(options, context)
        return [source.name, tracks] as const
      }),
    )

    return Object.fromEntries(entries)
  }

  async fetchDetail(options: FetchDetailOptions): Promise<Track> {
    const source = this.sources.get(options.track.source)
    if (!source) {
      throw new Error(`Unknown source: ${options.track.source}`)
    }

    const context: SourceContext = {
      initConfig: options.initSourceConfig?.[source.name],
      requestOverrides: options.requestOverrides?.[source.name],
    }
    return await source.fetchDetail(options, context)
  }

  async download(options: DownloadOptions): Promise<DownloadResult[]> {
    const grouped = new Map<string, Track[]>()
    for (const track of options.tracks) {
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
        requestOverrides: options.requestOverrides?.[sourceName],
      }
      results.push(await source.download({ ...options, tracks }, context))
    }
    return results
  }

  async openTrackStream(options: OpenTrackStreamOptions): Promise<OpenedTrackStream> {
    const source = this.sources.get(options.track.source)
    if (!source) {
      throw new Error(`Unknown source: ${options.track.source}`)
    }
    const context: SourceContext = {
      requestOverrides: options.requestOverrides?.[source.name],
    }
    return await source.openTrackStream(options, context)
  }

  async parsePlaylist(options: ParsePlaylistOptions): Promise<Track[]> {
    const selected = this.resolveSources(options.sources)
    for (const source of selected) {
      if (!source.parsePlaylist) {
        continue
      }
      const context = this.buildContext(source.name, options)
      const tracks = await source.parsePlaylist(options, context)
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
    options: Pick<SearchOptions, 'initSourceConfig' | 'requestOverrides' | 'searchRules'>,
  ): SourceContext {
    return {
      initConfig: options.initSourceConfig?.[sourceName],
      requestOverrides: options.requestOverrides?.[sourceName],
      searchRule: options.searchRules?.[sourceName],
    }
  }
}
