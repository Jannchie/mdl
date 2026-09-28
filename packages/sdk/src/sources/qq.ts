import type { TrackDetail, TrackLookup, TrackSummary } from '@jannchie/mdl-core'
import type { SearchRequest, SourceContext } from '@jannchie/mdl-core/internal'

import type { ResolvedCandidates } from './base.js'
import { cleanLyric, resolveRequestedSearchCount, resolveSearchPageSize, safeGet, sanitizeText, secondsToHms, uniqueByIdentifier } from '../shared/utils.js'
import { BaseMusicSource } from './base.js'

interface QQSearchItem {
  mid?: string
  name?: string
  title?: string
  interval?: number
  singer?: Array<{ name?: string }>
  album?: { mid?: string, name?: string, title?: string }
}

interface ParsedTrack extends ResolvedCandidates {
  songName?: string
  singers?: string
  album?: string
  coverUrl?: string
  lyric?: string
  payload: unknown
}

const QQ_ENDPOINT = 'https://u.y.qq.com/cgi-bin/musicu.fcg'

export class QQMusicSource extends BaseMusicSource {
  readonly name = 'QQMusicClient'
  protected readonly searchHeaders = {
    'referer': 'https://y.qq.com/',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
  }

  protected readonly parseHeaders = {
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
  }

  protected readonly downloadHeaders = {
    'referer': 'https://y.qq.com/',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
  }

  override async search(input: SearchRequest, context: SourceContext): Promise<TrackSummary[]> {
    const pageSize = resolveSearchPageSize(input)
    const total = resolveRequestedSearchCount(input, pageSize)
    const limit = input.limit
    const signal = context.requestOptions?.signal as AbortSignal | undefined
    const results: TrackSummary[] = []

    for (let count = 0; count < total; count += pageSize) {
      if (signal?.aborted) {
        break
      }
      const items = await this.searchPage(input.keyword, pageSize, count / pageSize + 1, context)
      if (items.length === 0) {
        break
      }
      for (const item of items) {
        const track = this.buildTrackFromSearchItem(item)
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

  /**
   * QQ throttles anonymous search per method and answers with an empty list instead of an error,
   * so each page walks through several equivalent endpoints until one returns songs.
   */
  private async searchPage(keyword: string, pageSize: number, pageNum: number, context: SourceContext): Promise<QQSearchItem[]> {
    for (const method of ['DoSearchForQQMusicDesktop', 'DoSearchForQQMusicLite']) {
      try {
        const payload = await this.searchClient.json<unknown>(QQ_ENDPOINT, {
          ...this.requestOverrides(context),
          json: {
            comm: { ct: 19, cv: 1859, uin: '0' },
            req: {
              module: 'music.search.SearchCgiService',
              method,
              param: { query: keyword, search_type: 0, num_per_page: pageSize, page_num: pageNum },
            },
          },
        })
        const body = safeGet<Record<string, unknown>>(payload, ['req', 'data', 'body'], {})
        const items = safeGet<unknown>(body, ['song', 'list'], null) ?? body.item_song
        if (Array.isArray(items) && items.length > 0) {
          return items as QQSearchItem[]
        }
      }
      catch {}
    }

    const payload = await this.searchClient.json<unknown>('https://c.y.qq.com/soso/fcgi-bin/search_for_qq_cp', {
      ...this.requestOverrides(context),
      query: { format: 'json', w: keyword, n: pageSize, p: pageNum, cr: 1, t: 0 },
    })
    const items = safeGet<Array<Record<string, unknown>>>(payload, ['data', 'song', 'list'], [])
    return (Array.isArray(items) ? items : []).map(item => ({
      mid: item.songmid as string | undefined,
      name: item.songname as string | undefined,
      interval: item.interval as number | undefined,
      singer: item.singer as QQSearchItem['singer'],
      album: { mid: item.albummid as string | undefined, name: item.albumname as string | undefined },
    }))
  }

  protected async resolveTrackDetail(track: TrackLookup, context: SourceContext): Promise<TrackDetail> {
    if (this.isDetailedTrack(track)) {
      return track
    }

    const resolved = await this.resolveFirstPlayable(this.parseProviders, [''], provider => provider(track.identifier, context), context, track.durationS)
    if (resolved) {
      const parsed = resolved.candidates
      const durationS = track.durationS || parsed.durationS
      return {
        source: this.name,
        identifier: track.identifier,
        songName: sanitizeText(track.songName || parsed.songName || ''),
        singers: sanitizeText(track.singers || parsed.singers || ''),
        album: sanitizeText(track.album || parsed.album || ''),
        ext: resolved.link.ext,
        fileSize: resolved.link.fileSize,
        durationS: durationS || undefined,
        duration: durationS ? secondsToHms(durationS) : 'NULL',
        lyric: cleanLyric(parsed.lyric || 'NULL'),
        coverUrl: track.coverUrl || parsed.coverUrl,
        downloadUrl: resolved.url,
        protocol: 'http',
        rawData: {
          ...track.rawData,
          download: parsed.payload,
        },
      }
    }

    throw new Error(`Failed to fetch detail for ${track.identifier} from ${this.name}`)
  }

  private buildTrackFromSearchItem(item: QQSearchItem): TrackSummary | null {
    const songId = String(item.mid ?? '')
    if (!songId) {
      return null
    }

    const durationS = Number(item.interval ?? 0)
    return {
      source: this.name,
      identifier: songId,
      songName: sanitizeText(item.name ?? item.title ?? ''),
      singers: sanitizeText((item.singer ?? []).map(singer => singer.name).filter(Boolean).join(', ')),
      album: sanitizeText(item.album?.name ?? item.album?.title ?? ''),
      coverUrl: item.album?.mid ? `https://y.gtimg.cn/music/photo_new/T002R800x800M000${item.album.mid}.jpg` : undefined,
      durationS: durationS || undefined,
      duration: durationS ? secondsToHms(durationS) : undefined,
      rawData: {
        search: item,
      },
    }
  }

  /**
   * Third-party resolvers tried in order. Candidate urls are listed best quality first and verified as playable audio.
   */
  private readonly parseProviders: Array<(songId: string, context: SourceContext) => Promise<ParsedTrack>> = [
    ...['https://tang.api.s01s.cn/music_open_api.php', 'https://api.hk0.cc/api/qqmusic'].map(endpoint =>
      async (songId: string, context: SourceContext): Promise<ParsedTrack> => {
        const payload = await this.parseClient.json<Record<string, unknown>>(endpoint, {
          ...this.resolverOverrides(context),
          query: { mid: songId },
        })
        return {
          urls: ['song_play_url_sq', 'song_play_url_hq', 'song_play_url', 'song_play_url_standard']
            .map(key => String(payload[key] ?? ''))
            .filter(Boolean),
          songName: payload.song_name ? String(payload.song_name) : undefined,
          singers: payload.singer_name ? String(payload.singer_name) : undefined,
          album: payload.album_name ? String(payload.album_name) : undefined,
          durationS: Number(payload.song_play_time ?? 0) || undefined,
          coverUrl: payload.album_pic ? String(payload.album_pic) : undefined,
          lyric: payload.song_lyric ? String(payload.song_lyric) : undefined,
          payload,
        }
      }),
    async (songId, context) => {
      const payload = await this.parseClient.json<Record<string, unknown>>('https://api.xunhuisi.store/API/QQMusic/Song.php', {
        ...this.resolverOverrides(context),
        query: { mid: songId, type: 'json' },
      })
      return {
        urls: [String(payload.music_url ?? '')],
        songName: payload.title ? String(payload.title) : undefined,
        singers: payload.singer ? String(payload.singer) : undefined,
        coverUrl: payload.cover ? String(payload.cover) : undefined,
        lyric: payload.lyric ? String(payload.lyric) : undefined,
        payload,
      }
    },
    async (songId, context) => {
      const overrides = this.resolverOverrides(context)
      const payload = await this.parseClient.json<Record<string, unknown>>('https://music.lzmhhh.com/api/music/url', {
        ...overrides,
        headers: { referer: 'https://music.lzmhhh.com/', origin: 'https://music.lzmhhh.com', ...overrides.headers },
        form: { id: songId, type: 'qq' },
      })
      return { urls: [String(payload.data ?? '')], payload }
    },
  ]
}
