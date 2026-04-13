import type { TrackDetail, TrackLookup, TrackSummary } from '@jannchie/mdl-core'
import type { ParsePlaylistRequest, SearchRequest, SourceContext } from '@jannchie/mdl-core/internal'

import { createHash } from 'node:crypto'

import { bytesToMb, cleanLyric, hostMatches, resolveRequestedSearchCount, resolveSearchPageSize, safeGet, sanitizeText, secondsToHms, uniqueByIdentifier } from '../shared/utils.js'
import { BaseMusicSource } from './base.js'

const QIANQIAN_HOSTS = ['music.91q.com', 'music.taihe.com']

export class QianqianMusicSource extends BaseMusicSource {
  readonly name = 'QianqianMusicClient'
  protected readonly searchHeaders = {
    'accept': '*/*',
    'accept-language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
    'referer': 'https://music.91q.com/player',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
    'from': 'web',
  }

  protected readonly parseHeaders = this.searchHeaders
  protected readonly downloadHeaders = {
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
  }

  private static readonly appId = '16073360'
  private static readonly qualities = ['3000', '320', '128', '64']
  private static readonly secret = '0b50b02fd0d73a9c4c8c3a781c30845f'

  protected buildSearchRequests(input: SearchRequest, context: SourceContext) {
    const pageSize = resolveSearchPageSize(input)
    const total = resolveRequestedSearchCount(input, pageSize)
    const searchRule = context.sourceSearchOptions ?? {}
    const requests = []
    for (let count = 0; count < total; count += pageSize) {
      const params = this.signParams({
        word: input.keyword,
        type: '1',
        pageNo: String(count / pageSize + 1),
        pageSize: String(pageSize),
        appid: QianqianMusicSource.appId,
        ...searchRule,
      })
      requests.push({
        url: 'https://music.91q.com/v1/search',
        query: params,
      })
    }
    return requests
  }

  protected extractSearchItems(payload: unknown): unknown[] {
    return safeGet(payload, ['data', 'typeTrack'], [])
  }

  protected async buildSearchTrack(item: unknown, _context: SourceContext): Promise<TrackSummary | null> {
    const searchResult = item as Record<string, unknown>
    const songId = String(searchResult.TSID ?? '')
    if (!songId) {
      return null
    }

    return {
      source: this.name,
      identifier: songId,
      songName: sanitizeText(String(searchResult.title ?? '')),
      singers: sanitizeText(
        (safeGet(searchResult, ['artist'], []) as Array<{ name?: string }>)
          .map(artist => artist.name)
          .filter(Boolean)
          .join(', '),
      ),
      album: sanitizeText(String(searchResult.albumTitle ?? '')),
      coverUrl: String(searchResult.pic ?? '') || undefined,
      rawData: {
        search: searchResult,
      },
    }
  }

  protected async resolveTrackDetail(track: TrackLookup, context: SourceContext): Promise<TrackDetail> {
    if (this.isDetailedTrack(track)) {
      return track
    }

    const searchResult: Record<string, unknown> = (track.rawData?.search as Record<string, unknown> | undefined) ?? {
      TSID: track.identifier,
      title: track.songName,
      albumTitle: track.album,
      artist: (track.singers ?? '')
        .split(',')
        .map((name: string) => ({ name: name.trim() }))
        .filter((item: { name: string }) => item.name),
      pic: track.coverUrl,
    }
    const songId = String(searchResult.TSID ?? track.identifier)
    for (const rate of QianqianMusicSource.qualities) {
      const payload = await this.parseClient.json<unknown>('https://music.91q.com/v1/song/tracklink', {
        query: this.signParams({
          TSID: songId,
          appid: QianqianMusicSource.appId,
          rate,
        }),
        headers: context.requestOptions?.headers as Record<string, string> | undefined,
        cookies: context.requestOptions?.cookies as Record<string, unknown> | string | undefined,
        timeoutMs: context.requestOptions?.timeoutMs as number | undefined,
        signal: context.requestOptions?.signal as AbortSignal | undefined,
      })
      const downloadUrl
        = String(safeGet(payload, ['data', 'path'], '')) || String(safeGet(payload, ['data', 'trail_audio_info', 'path'], ''))
      if (!downloadUrl || !downloadUrl.startsWith('http')) {
        continue
      }

      const lyricUrl = String(searchResult.lyric ?? '')
      let lyric = 'NULL'
      if (lyricUrl.startsWith('http')) {
        try {
          lyric = cleanLyric(
            await this.parseClient.text(lyricUrl, {
              headers: context.requestOptions?.headers as Record<string, string> | undefined,
              cookies: context.requestOptions?.cookies as Record<string, unknown> | string | undefined,
              timeoutMs: context.requestOptions?.timeoutMs as number | undefined,
              signal: context.requestOptions?.signal as AbortSignal | undefined,
            }),
          )
        }
        catch {
          lyric = 'NULL'
        }
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
      return {
        source: this.name,
        identifier: songId,
        songName: sanitizeText(String(searchResult.title ?? '')),
        singers: sanitizeText(
          (safeGet(searchResult, ['artist'], []) as Array<{ name?: string }>)
            .map(artist => artist.name)
            .filter(Boolean)
            .join(', '),
        ),
        album: sanitizeText(String(searchResult.albumTitle ?? '')),
        ext: probe.ext ?? String(downloadUrl).split('?')[0]?.split('.').pop() ?? 'mp3',
        fileSizeBytes: safeGet(payload, ['data', 'size'], 0),
        fileSize: probe.fileSize === 'NULL' ? bytesToMb(safeGet(payload, ['data', 'size'], 0)) : probe.fileSize,
        durationS: safeGet(payload, ['data', 'duration'], 0),
        duration: secondsToHms(safeGet(payload, ['data', 'duration'], 0)),
        lyric,
        coverUrl: String(searchResult.pic ?? ''),
        downloadUrl,
        protocol: 'http',
        rawData: {
          search: searchResult,
          download: payload,
        },
      }
    }

    throw new Error(`Failed to fetch detail for ${track.identifier} from ${this.name}`)
  }

  override async parsePlaylist(input: ParsePlaylistRequest, context: SourceContext): Promise<TrackSummary[]> {
    if (!hostMatches(input.playlistUrl, QIANQIAN_HOSTS)) {
      return []
    }

    const resolvedUrl = await this.parseClient.resolveUrl(input.playlistUrl, {
      headers: context.requestOptions?.headers as Record<string, string> | undefined,
      cookies: context.requestOptions?.cookies as Record<string, unknown> | string | undefined,
      timeoutMs: context.requestOptions?.timeoutMs as number | undefined,
      signal: context.requestOptions?.signal as AbortSignal | undefined,
    })
    const playlistId = new URL(resolvedUrl).pathname.split('/').pop()?.replace(/\.html?$/, '') ?? ''
    if (!playlistId) {
      return []
    }

    const tracksInPlaylist: unknown[] = []
    for (let page = 1; ; page += 1) {
      const payload = await this.parseClient.json<unknown>('https://music.91q.com/v1/tracklist/info', {
        query: this.signParams({
          pageNo: page,
          pageSize: 50,
          appid: QianqianMusicSource.appId,
          id: playlistId,
        }),
        headers: context.requestOptions?.headers as Record<string, string> | undefined,
        cookies: context.requestOptions?.cookies as Record<string, unknown> | string | undefined,
        timeoutMs: context.requestOptions?.timeoutMs as number | undefined,
        signal: context.requestOptions?.signal as AbortSignal | undefined,
      })
      const items = safeGet(payload, ['data', 'trackList'], [])
      if (!Array.isArray(items) || items.length === 0) {
        break
      }
      tracksInPlaylist.push(...items)
      const total = Number(safeGet(payload, ['data', 'trackCount'], 0))
      if (tracksInPlaylist.length >= total) {
        break
      }
    }

    const parsed = await Promise.all(tracksInPlaylist.map(item => this.buildSearchTrack(item, context)))
    return uniqueByIdentifier(parsed.filter((track): track is TrackSummary => track !== null))
  }

  private signParams(params: Record<string, string | number | boolean>): Record<string, string> {
    const target: Record<string, string> = {}
    for (const [key, value] of Object.entries(params)) {
      target[key] = String(value)
    }
    target.timestamp = String(Math.floor(Date.now() / 1000))
    const keys = Object.keys(target).sort()
    const joined = keys.map(key => `${key}=${target[key]}`).join('&')
    const sign = this.md5(`${joined}${QianqianMusicSource.secret}`)
    return {
      ...target,
      sign,
    }
  }

  private md5(value: string): string {
    return createHash('md5').update(value).digest('hex')
  }
}
