import type { ParsePlaylistOptions, SearchOptions, SourceContext, Track } from '@jannchie/mdl-core'

import { bytesToMb, cleanLyric, hostMatches, safeGet, sanitizeText, secondsToHms, uniqueByIdentifier } from '../shared/utils.js'
import { BaseMusicSource } from './base.js'

const KUWO_HOSTS = ['kuwo.cn']

export class KuwoMusicSource extends BaseMusicSource {
  readonly name = 'KuwoMusicClient'
  protected readonly searchHeaders = {
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
  }

  protected readonly parseHeaders = this.searchHeaders
  protected readonly downloadHeaders = this.searchHeaders

  private static readonly qualityLevels = ['lossless', 'exhigh', 'standard']

  protected buildSearchRequests(input: SearchOptions) {
    const pageSize = input.searchSizePerPage ?? 10
    const total = input.searchSizePerSource ?? 5
    const requests = []
    for (let count = 0; count < total; count += pageSize) {
      requests.push({
        url: 'http://www.kuwo.cn/search/searchMusicBykeyWord',
        query: {
          vipver: '1',
          client: 'kt',
          ft: 'music',
          cluster: '0',
          strategy: '2012',
          encoding: 'utf8',
          rformat: 'json',
          mobi: '1',
          issubtitle: '1',
          show_copyright_off: '1',
          pn: String(count / pageSize),
          rn: String(pageSize),
          all: input.keyword,
        },
      })
    }
    return requests
  }

  protected extractSearchItems(payload: unknown): unknown[] {
    return safeGet(payload, ['abslist'], [])
  }

  protected async parseSearchItem(item: unknown, context: SourceContext): Promise<Track | null> {
    const signal = context.requestOverrides?.signal as AbortSignal | undefined
    if (signal?.aborted) {
      return null
    }
    const searchResult = item as Record<string, unknown>
    const songId = String(searchResult.MUSICRID ?? searchResult.musicrid ?? '').replace(/^MUSIC_/, '')
    if (!songId) {
      return null
    }

    for (const level of KuwoMusicSource.qualityLevels) {
      if (signal?.aborted) {
        return null
      }
      const payload = await this.parseClient.json<unknown>('https://kw-api.cenguigui.cn/', {
        query: {
          id: songId,
          type: 'song',
          level,
          format: 'json',
        },
        headers: context.requestOverrides?.headers as Record<string, string> | undefined,
        cookies: context.requestOverrides?.cookies as Record<string, unknown> | string | undefined,
        timeoutMs: context.requestOverrides?.timeoutMs as number | undefined,
        signal: context.requestOverrides?.signal as AbortSignal | undefined,
      })
      const downloadUrl = String(safeGet(payload, ['data', 'url'], ''))
      if (!downloadUrl.startsWith('http')) {
        continue
      }

      const downloadUrlStatus = await this.audioLinkTester.test(downloadUrl, {
        headers: context.requestOverrides?.headers as Record<string, string> | undefined,
        cookies: context.requestOverrides?.cookies as Record<string, unknown> | string | undefined,
        timeoutMs: context.requestOverrides?.timeoutMs as number | undefined,
        signal: context.requestOverrides?.signal as AbortSignal | undefined,
      })
      if (!downloadUrlStatus.ok) {
        continue
      }

      const probe = await this.audioLinkTester.probe(downloadUrl, {
        headers: context.requestOverrides?.headers as Record<string, string> | undefined,
        cookies: context.requestOverrides?.cookies as Record<string, unknown> | string | undefined,
        timeoutMs: context.requestOverrides?.timeoutMs as number | undefined,
        signal: context.requestOverrides?.signal as AbortSignal | undefined,
      })
      if (!(probe.ext && probe.ext !== 'NULL')) {
        continue
      }

      const payloadSize = this.parseSizeMb(String(safeGet(payload, ['data', 'size'], '')))
      const durationS = Number(safeGet(payload, ['data', 'duration'], searchResult.DURATION ?? searchResult.duration ?? 0))
      return {
        source: this.name,
        identifier: songId,
        songName: sanitizeText(String(safeGet(payload, ['data', 'name'], searchResult.SONGNAME ?? searchResult.name ?? ''))),
        singers: sanitizeText(String(safeGet(payload, ['data', 'artist'], searchResult.ARTIST ?? searchResult.artist ?? ''))),
        album: sanitizeText(String(safeGet(payload, ['data', 'album'], searchResult.ALBUM ?? searchResult.album ?? ''))),
        ext: probe.ext,
        fileSizeBytes: payloadSize > 0 ? payloadSize : undefined,
        fileSize: probe.fileSize === 'NULL' ? bytesToMb(payloadSize) : probe.fileSize,
        durationS,
        duration: secondsToHms(durationS),
        lyric: cleanLyric(String(safeGet(payload, ['data', 'lyric'], 'NULL'))),
        coverUrl: String(safeGet(payload, ['data', 'pic'], searchResult.hts_MVPIC ?? searchResult.albumpic ?? '')) || undefined,
        downloadUrl,
        protocol: 'http',
        rawData: {
          search: searchResult,
          download: payload,
        },
      }
    }

    return null
  }

  override async parsePlaylist(input: ParsePlaylistOptions, context: SourceContext): Promise<Track[]> {
    const signal = context.requestOverrides?.signal as AbortSignal | undefined
    if (signal?.aborted) {
      return []
    }
    if (!hostMatches(input.playlistUrl, KUWO_HOSTS)) {
      return []
    }

    const resolvedUrl = await this.parseClient.resolveUrl(input.playlistUrl, {
      headers: context.requestOverrides?.headers as Record<string, string> | undefined,
      cookies: context.requestOverrides?.cookies as Record<string, unknown> | string | undefined,
    })
    const url = new URL(resolvedUrl)
    const playlistId = url.searchParams.get('id') ?? url.pathname.split('/').pop()?.replace(/\.html?$/, '') ?? ''
    if (!playlistId) {
      return []
    }

    const tracks: unknown[] = []
    for (let page = 1; ; page += 1) {
      if (signal?.aborted) {
        break
      }
      const payload = await this.parseClient.json<unknown>('https://m.kuwo.cn/newh5app/wapi/api/www/playlist/playListInfo', {
        query: {
          pid: playlistId,
          pn: page,
          rn: 100,
        },
        headers: context.requestOverrides?.headers as Record<string, string> | undefined,
        cookies: context.requestOverrides?.cookies as Record<string, unknown> | string | undefined,
        timeoutMs: context.requestOverrides?.timeoutMs as number | undefined,
        signal: context.requestOverrides?.signal as AbortSignal | undefined,
      })
      const items = safeGet(payload, ['data', 'musicList'], [])
      if (!Array.isArray(items) || items.length === 0) {
        break
      }
      tracks.push(...items)
      const total = Number(safeGet(payload, ['data', 'total'], 0))
      if (tracks.length >= total) {
        break
      }
    }

    const deduped = [...new Map(tracks.map(track => [String((track as Record<string, unknown>).musicrid ?? ''), track])).values()]
    const parsed = await Promise.all(deduped.map(track => this.parseSearchItem(track, context)))
    return uniqueByIdentifier(parsed.filter((track): track is Track => track !== null))
  }

  private parseSizeMb(value: string): number {
    const matched = value.match(/([\d.]+)\s*MB/i)
    return matched ? Number(matched[1]) * 1024 * 1024 : 0
  }
}
