import type { TrackDetail, TrackLookup, TrackSummary } from '@jannchie/mdl-core'
import type { SearchRequest, SourceContext } from '@jannchie/mdl-core/internal'

import { cleanLyric, resolveRequestedSearchCount, resolveSearchPageSize, safeGet, sanitizeText, secondsToHms } from '../shared/utils.js'
import { BaseMusicSource } from './base.js'

interface NeteaseResolver {
  endpoint: string
  body: 'query' | 'form'
  params: (songId: string, level: string) => Record<string, string>
  urlPath: string[]
}

/**
 * Third-party resolvers tried in order, most reliable first.
 */
const NETEASE_RESOLVERS: NeteaseResolver[] = [
  ...['https://dm.jfjt.cc/Song_V1', 'https://ncm.kangqiovo.com/Song_V1'].map(endpoint => ({
    endpoint,
    body: 'form' as const,
    params: (url: string, level: string) => ({ url, level, type: 'json' }),
    urlPath: ['data', 'url'],
  })),
  {
    endpoint: 'https://music.tmetu.cn/api/',
    body: 'query',
    params: (id, level) => ({ miss: 'songAll', id, level, withLyric: 'false' }),
    urlPath: ['data', 'audioUrl'],
  },
  {
    endpoint: 'https://api.bugpk.com/api/163_music',
    body: 'query',
    params: (ids, level) => ({ ids, level, type: 'json' }),
    urlPath: ['url'],
  },
  {
    endpoint: 'https://music.qinglvai.top/api/index.php',
    body: 'query',
    params: (id, level) => ({ route: '/music/url', id, level, use: 'play', source: 'netease' }),
    urlPath: ['data', 'song', 'url'],
  },
  {
    endpoint: 'https://musicapi.haitangw.net/music/wy.php',
    body: 'query',
    params: (id, level) => ({ id, level, type: 'json' }),
    urlPath: ['data', 'url'],
  },
  {
    endpoint: 'https://metings.qjqq.cn/Song_V1',
    body: 'form',
    params: (url, level) => ({ url, level, type: 'json' }),
    urlPath: ['data', 'url'],
  },
]

export class NeteaseMusicSource extends BaseMusicSource {
  readonly name = 'NeteaseMusicClient'
  protected readonly searchHeaders = {
    'content-type': 'application/x-www-form-urlencoded',
    'referer': 'https://music.163.com/',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
  }

  protected readonly parseHeaders = {
    'referer': 'https://music.163.com/',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
  }

  protected readonly downloadHeaders = {
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
  }

  private static readonly qualityLevels = ['lossless', 'exhigh', 'higher', 'standard']

  override async search(input: SearchRequest, context: SourceContext): Promise<TrackSummary[]> {
    const pageSize = resolveSearchPageSize(input)
    const total = resolveRequestedSearchCount(input, pageSize)
    const limit = input.limit
    const results: TrackSummary[] = []
    const signal = context.requestOptions?.signal as AbortSignal | undefined

    for (let offset = 0; offset < total; offset += pageSize) {
      if (signal?.aborted) {
        return results
      }
      const payload = await this.searchClient.json<unknown>('https://music.163.com/api/cloudsearch/pc', {
        ...this.requestOverrides(context),
        form: {
          s: input.keyword,
          type: '1',
          limit: String(pageSize),
          offset: String(offset),
        },
      })
      const items = safeGet(payload, ['result', 'songs'], [])
      if (!Array.isArray(items) || items.length === 0) {
        break
      }
      for (const item of items) {
        const track = this.buildTrackFromSearchItem(item)
        if (!track) {
          continue
        }
        results.push(track)
        if (limit !== undefined && results.length >= limit) {
          return results
        }
      }
    }

    return results
  }

  protected async resolveTrackDetail(track: TrackLookup, context: SourceContext): Promise<TrackDetail> {
    if (this.isDetailedTrack(track)) {
      return track
    }

    const searchResult: Record<string, unknown> = (track.rawData?.search as Record<string, unknown> | undefined) ?? {
      id: track.identifier,
      name: track.songName,
      ar: (track.singers ?? '')
        .split(',')
        .map((name: string) => ({ name: name.trim() }))
        .filter((item: { name: string }) => item.name),
      al: {
        name: track.album,
        picUrl: track.coverUrl,
      },
    }
    const detailed = await this.resolveTrackFromSearchItem(searchResult, context)
    if (!detailed) {
      throw new Error(`Failed to fetch detail for ${track.identifier} from ${this.name}`)
    }
    return detailed
  }

  private buildTrackFromSearchItem(item: unknown): TrackSummary | null {
    const searchResult = item as Record<string, unknown>
    const songId = String(searchResult.id ?? '')
    if (!songId) {
      return null
    }

    const artists = (safeGet(searchResult, ['ar'], []) as Array<{ name?: string }>)
      .map(artist => artist.name)
      .filter(Boolean)
      .join(', ')
    return {
      source: this.name,
      identifier: songId,
      songName: sanitizeText(String(searchResult.name ?? '')),
      singers: sanitizeText(artists),
      album: sanitizeText(String(safeGet(searchResult, ['al', 'name'], ''))),
      coverUrl: String(safeGet(searchResult, ['al', 'picUrl'], '')) || undefined,
      durationS: Number(searchResult.dt ?? 0) > 1000 ? Number(searchResult.dt ?? 0) / 1000 : Number(searchResult.dt ?? 0) || undefined,
      duration: Number(searchResult.dt ?? 0) ? secondsToHms(Number(searchResult.dt ?? 0) > 1000 ? Number(searchResult.dt ?? 0) / 1000 : Number(searchResult.dt ?? 0)) : undefined,
      rawData: {
        search: searchResult,
      },
    }
  }

  private async resolveTrackFromSearchItem(searchResult: Record<string, unknown>, context: SourceContext): Promise<TrackDetail | null> {
    const songId = String(searchResult.id ?? '')
    if (!songId) {
      return null
    }

    const durationMs = Number(searchResult.dt ?? 0)
    const durationS = durationMs > 1000 ? durationMs / 1000 : durationMs
    const lyric = this.fetchLyric(songId, context)
    const resolved = await this.resolveFirstPlayable(NETEASE_RESOLVERS, NeteaseMusicSource.qualityLevels, async (resolver, level) => {
      const overrides = this.resolverOverrides(context)
      const params = resolver.params(songId, level)
      const payload = await this.parseClient.json<unknown>(resolver.endpoint, {
        ...overrides,
        headers: { referer: new URL('/', resolver.endpoint).toString(), ...overrides.headers },
        ...(resolver.body === 'form' ? { form: params } : { query: params }),
      })
      return { urls: [String(safeGet(payload, resolver.urlPath, ''))], payload }
    }, context, durationS)
    if (!resolved) {
      return null
    }

    const artists = (safeGet(searchResult, ['ar'], []) as Array<{ name?: string }>)
      .map(artist => artist.name)
      .filter(Boolean)
      .join(', ')
    return {
      source: this.name,
      identifier: songId,
      songName: sanitizeText(String(searchResult.name ?? '')),
      singers: sanitizeText(artists),
      album: sanitizeText(String(safeGet(searchResult, ['al', 'name'], ''))),
      ext: resolved.link.ext,
      fileSize: resolved.link.fileSize,
      durationS: durationS || undefined,
      duration: secondsToHms(durationS),
      lyric: await lyric,
      coverUrl: String(safeGet(searchResult, ['al', 'picUrl'], '')) || undefined,
      downloadUrl: resolved.url,
      protocol: 'http',
      rawData: {
        search: searchResult,
        download: resolved.candidates.payload,
      },
    }
  }

  private async fetchLyric(songId: string, context: SourceContext): Promise<string> {
    try {
      const payload = await this.parseClient.json<unknown>('https://music.163.com/api/song/lyric', {
        ...this.resolverOverrides(context),
        query: { id: songId, lv: -1, tv: -1 },
      })
      return cleanLyric(String(safeGet(payload, ['lrc', 'lyric'], '') || 'NULL'))
    }
    catch {
      return 'NULL'
    }
  }
}
