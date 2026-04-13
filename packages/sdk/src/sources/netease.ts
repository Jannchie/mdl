import type { TrackDetail, TrackLookup, TrackSummary } from '@jannchie/mdl-core'
import type { SearchRequest, SourceContext } from '@jannchie/mdl-core/internal'

import { bytesToMb, cleanLyric, resolveRequestedSearchCount, resolveSearchPageSize, safeGet, sanitizeText, secondsToHms } from '../shared/utils.js'
import { BaseMusicSource } from './base.js'

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
      const response = await fetch('https://music.163.com/api/cloudsearch/pc', {
        method: 'POST',
        headers: {
          ...this.searchHeaders,
          ...(context.requestOptions?.headers as Record<string, string> | undefined),
        },
        body: new URLSearchParams({
          s: input.keyword,
          type: '1',
          limit: String(pageSize),
          offset: String(offset),
        }),
        signal,
      })
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} for ${response.url}`)
      }
      const payload = (await response.json()) as unknown
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

  private async resolveTrackFromSearchItem(item: Record<string, unknown>, context: SourceContext): Promise<TrackDetail | null> {
    const signal = context.requestOptions?.signal as AbortSignal | undefined
    if (signal?.aborted) {
      return null
    }
    const searchResult = item
    const songId = String(searchResult.id ?? '')
    if (!songId) {
      return null
    }

    let detailPayload: unknown = { data: searchResult }
    try {
      detailPayload = await this.parseClient.json<unknown>('https://music.xuanluoge.top/api.php', {
        query: {
          miss: 'songDetail',
          id: songId,
        },
        headers: context.requestOptions?.headers as Record<string, string> | undefined,
        cookies: context.requestOptions?.cookies as Record<string, unknown> | string | undefined,
        timeoutMs: context.requestOptions?.timeoutMs as number | undefined,
        signal: context.requestOptions?.signal as AbortSignal | undefined,
      })
    }
    catch {
      detailPayload = { data: searchResult }
    }

    let lyric = 'NULL'
    try {
      const lyricPayload = await this.parseClient.json<unknown>('https://music.xuanluoge.top/api.php', {
        query: {
          miss: 'lyric',
          id: songId,
        },
        headers: context.requestOptions?.headers as Record<string, string> | undefined,
        cookies: context.requestOptions?.cookies as Record<string, unknown> | string | undefined,
        timeoutMs: context.requestOptions?.timeoutMs as number | undefined,
        signal: context.requestOptions?.signal as AbortSignal | undefined,
      })
      lyric = cleanLyric(String(safeGet(lyricPayload, ['data', 'lrc'], 'NULL')))
    }
    catch {
      lyric = 'NULL'
    }

    for (const level of NeteaseMusicSource.qualityLevels) {
      if (signal?.aborted) {
        return null
      }
      const payload = await this.parseClient.json<unknown>('https://music.xuanluoge.top/api.php', {
        query: {
          miss: 'getMusicUrl',
          id: songId,
          level,
        },
        headers: context.requestOptions?.headers as Record<string, string> | undefined,
        cookies: context.requestOptions?.cookies as Record<string, unknown> | string | undefined,
        timeoutMs: context.requestOptions?.timeoutMs as number | undefined,
        signal: context.requestOptions?.signal as AbortSignal | undefined,
      })
      const item = safeGet(payload, ['data', 0], {}) as Record<string, unknown>
      const downloadUrl = String(item.url ?? '')
      if (!downloadUrl.startsWith('http')) {
        continue
      }

      const downloadUrlStatus = await this.audioLinkTester.test(downloadUrl, {
        headers: context.requestOptions?.headers as Record<string, string> | undefined,
        cookies: context.requestOptions?.cookies as Record<string, unknown> | string | undefined,
        timeoutMs: context.requestOptions?.timeoutMs as number | undefined,
        signal: context.requestOptions?.signal as AbortSignal | undefined,
      })
      if (!downloadUrlStatus.ok) {
        continue
      }

      const probe = await this.audioLinkTester.probe(downloadUrl, {
        headers: context.requestOptions?.headers as Record<string, string> | undefined,
        cookies: context.requestOptions?.cookies as Record<string, unknown> | string | undefined,
        timeoutMs: context.requestOptions?.timeoutMs as number | undefined,
        signal: context.requestOptions?.signal as AbortSignal | undefined,
      })
      if (!(probe.ext && probe.ext !== 'NULL')) {
        continue
      }

      const detail = safeGet(detailPayload, ['data'], searchResult) as Record<string, unknown>
      const artists = (safeGet(detail, ['ar'], safeGet(searchResult, ['ar'], [])) as Array<{ name?: string }>)
        .map(artist => artist.name)
        .filter(Boolean)
        .join(', ')
      const album = safeGet(detail, ['al', 'name'], safeGet(searchResult, ['al', 'name'], ''))
      const durationMs = Number(safeGet(detail, ['dt'], searchResult.dt ?? item.time ?? 0))
      const durationS = durationMs > 1000 ? durationMs / 1000 : durationMs

      return {
        source: this.name,
        identifier: songId,
        songName: sanitizeText(String(safeGet(detail, ['name'], searchResult.name ?? ''))),
        singers: sanitizeText(artists),
        album: sanitizeText(String(album ?? '')),
        ext: probe.ext,
        fileSizeBytes: Number(item.size ?? 0) || undefined,
        fileSize: probe.fileSize === 'NULL' ? bytesToMb(Number(item.size ?? 0)) : probe.fileSize,
        durationS,
        duration: secondsToHms(durationS),
        lyric,
        coverUrl: String(safeGet(detail, ['al', 'picUrl'], '')) || undefined,
        downloadUrl,
        protocol: 'http',
        rawData: {
          search: searchResult,
          detail: detailPayload,
          download: payload,
        },
      }
    }

    return null
  }
}
