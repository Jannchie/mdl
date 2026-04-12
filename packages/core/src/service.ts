import type {
  DownloadOptions,
  DownloadResult,
  MusicSource,
  OpenedTrackStream,
  OpenTrackStreamOptions,
  ParsePlaylistOptions,
  SearchFusionOptions,
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

  async searchMerged(options: SearchFusionOptions): Promise<Track[]> {
    const grouped = await this.searchWithOptionalTimeout(options)
    return this.fuseWithRrf(grouped, options.rrfK ?? 60)
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

  private async searchWithOptionalTimeout(options: SearchFusionOptions): Promise<Record<string, Track[]>> {
    if (!(options.timeoutMs && options.timeoutMs > 0)) {
      return this.search(options)
    }

    const selected = this.resolveSources(options.sources)
    const results = new Map<string, Track[]>()
    const timers: NodeJS.Timeout[] = []
    const tasks = selected.map(async (source) => {
      const controller = new AbortController()
      timers.push(setTimeout(() => controller.abort(), options.timeoutMs))
      const context = this.buildContext(source.name, options)
      const requestOverrides = {
        ...context.requestOverrides,
        timeoutMs: options.timeoutMs,
        signal: controller.signal,
      }
      try {
        const tracks = await source.search(options, { ...context, requestOverrides })
        results.set(source.name, tracks)
      }
      catch {
        results.set(source.name, [])
      }
      finally {
        controller.abort()
      }
    })

    await Promise.allSettled(tasks)
    for (const timer of timers) {
      clearTimeout(timer)
    }

    for (const source of selected) {
      if (!results.has(source.name)) {
        results.set(source.name, [])
      }
    }
    return Object.fromEntries(results)
  }

  private fuseWithRrf(grouped: Record<string, Track[]>, rrfK: number): Track[] {
    const fused = new Map<string, { score: number, bestRank: number, representative: Track, alternatives: Track[], sources: Set<string> }>()

    for (const [source, tracks] of Object.entries(grouped)) {
      for (const [index, track] of tracks.entries()) {
        const rank = index + 1
        const key = this.buildFusionKey(track)
        const existing = fused.get(key)
        const score = 1 / (rrfK + rank)
        if (!existing) {
          fused.set(key, {
            score,
            bestRank: rank,
            representative: track,
            alternatives: [track],
            sources: new Set([source]),
          })
          continue
        }
        existing.score += score
        existing.alternatives.push(track)
        existing.sources.add(source)
        if (rank < existing.bestRank || (rank === existing.bestRank && this.compareTracks(track, existing.representative) > 0)) {
          existing.bestRank = rank
          existing.representative = track
        }
      }
    }

    return [...fused.values()]
      .sort((left, right) => right.score - left.score || left.bestRank - right.bestRank)
      .map(item => ({
        ...item.representative,
        fusedScore: Number(item.score.toFixed(6)),
        matchedSources: [...item.sources].sort(),
        alternatives: item.alternatives,
      }))
  }

  private buildFusionKey(track: Track): string {
    const songName = this.normalizeFusionText(track.songName)
    const singers = this.normalizeFusionText(track.singers ?? '')
    return `${songName}::${singers}`
  }

  private normalizeFusionText(value: string): string {
    return value
      .toLowerCase()
      .normalize('NFKC')
      .replaceAll(/\([^)]*\)|（[^）]*）|\[[^\]]*\]/g, '')
      .replaceAll(/[^a-z0-9\u4E00-\u9FA5]+/g, '')
  }

  private compareTracks(left: Track, right: Track): number {
    const leftSize = Number(left.fileSizeBytes ?? 0)
    const rightSize = Number(right.fileSizeBytes ?? 0)
    if (leftSize !== rightSize) {
      return leftSize - rightSize
    }
    return Number(left.durationS ?? 0) - Number(right.durationS ?? 0)
  }
}
