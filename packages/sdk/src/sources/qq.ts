import type { TrackDetail, TrackLookup, TrackSummary } from '@jannchie/mdl-core'
import type { SearchRequest, SourceContext } from '@jannchie/mdl-core/internal'

import { extractAlbumFromLyric, refreshJbsouSearchItem } from '../shared/jbsou.js'
import { getQQSongDetail } from '../shared/qq.js'
import { cleanLyric, sanitizeText, secondsToHms } from '../shared/utils.js'
import { BaseMusicSource } from './base.js'

interface JbsouSearchItem {
  songid?: string
  name?: string
  artist?: string
  album?: string
  lrc?: string
  url?: string
  cover?: string
}

export class QQMusicSource extends BaseMusicSource {
  readonly name = 'QQMusicClient'
  protected readonly searchHeaders = {
    'accept': 'application/json, text/javascript, */*; q=0.01',
    'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'origin': 'https://www.jbsou.cn',
    'referer': 'https://www.jbsou.cn/',
    'x-requested-with': 'XMLHttpRequest',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
  }

  protected readonly parseHeaders = {
    'origin': 'https://www.jbsou.cn',
    'referer': 'https://www.jbsou.cn/',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
  }

  protected readonly downloadHeaders = {
    'referer': 'https://y.qq.com/',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
  }

  override async search(input: SearchRequest, context: SourceContext): Promise<TrackSummary[]> {
    const signal = context.requestOptions?.signal as AbortSignal | undefined
    const response = await fetch('https://www.jbsou.cn/', {
      method: 'POST',
      headers: {
        ...this.searchHeaders,
        ...(context.requestOptions?.headers as Record<string, string> | undefined),
      },
      body: new URLSearchParams({
        input: input.keyword,
        filter: 'name',
        type: 'qq',
        page: '1',
      }),
      signal,
    })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${response.url}`)
    }

    const payload = (await response.json()) as { data?: JbsouSearchItem[] }
    const items = Array.isArray(payload.data) ? payload.data : []
    const limit = input.limit
    const results: TrackSummary[] = []
    for (const item of limit === undefined ? items : items.slice(0, limit)) {
      if (signal?.aborted) {
        break
      }
      const track = this.buildTrackFromSearchItem(item)
      if (track) {
        results.push(track)
      }
    }
    return results
  }

  protected async resolveTrackDetail(track: TrackLookup, context: SourceContext): Promise<TrackDetail> {
    if (this.isDetailedTrack(track)) {
      return track
    }

    const item = track.rawData?.search as JbsouSearchItem | undefined
    if (item) {
      const detailed = await this.resolveTrackFromSearchItem(item, context)
      if (detailed) {
        return detailed
      }
    }

    const refreshedItem = await this.refreshSearchItem(track, context)
    const detailed = refreshedItem
      ? await this.resolveTrackFromSearchItem(refreshedItem, context)
      : null
    if (!detailed) {
      throw new Error(`Failed to fetch detail for ${track.identifier} from ${this.name}`)
    }
    return detailed
  }

  private async refreshSearchItem(track: TrackLookup, context: SourceContext): Promise<JbsouSearchItem | null> {
    const signal = context.requestOptions?.signal as AbortSignal | undefined
    const detail = await getQQSongDetail(track.identifier)
    const detailSingers = Array.isArray(detail?.singer)
      ? detail.singer.map(item => item.name).filter(Boolean).join(', ')
      : undefined

    return await refreshJbsouSearchItem({
      site: 'qq',
      identifier: track.identifier,
      track: {
        songName: track.songName ?? detail?.name,
        singers: track.singers ?? detailSingers,
      },
      headers: {
        ...this.searchHeaders,
        ...(context.requestOptions?.headers as Record<string, string> | undefined),
      },
      signal,
    })
  }

  private buildTrackFromSearchItem(item: JbsouSearchItem): TrackSummary | null {
    const songId = String(item.songid ?? '')
    if (!songId) {
      return null
    }

    const coverPath = String(item.cover ?? '')
    return {
      source: this.name,
      identifier: songId,
      songName: sanitizeText(String(item.name ?? '')),
      singers: sanitizeText(String(item.artist ?? '').replaceAll('/', ', ')),
      album: sanitizeText(String(item.album ?? '')),
      coverUrl: coverPath ? new URL(coverPath, 'https://www.jbsou.cn/').toString() : undefined,
      rawData: {
        search: item,
      },
    }
  }

  private async resolveTrackFromSearchItem(item: JbsouSearchItem, context: SourceContext): Promise<TrackDetail | null> {
    const signal = context.requestOptions?.signal as AbortSignal | undefined
    if (signal?.aborted) {
      return null
    }
    const songId = String(item.songid ?? '')
    const redirectPath = String(item.url ?? '')
    if (!songId || !redirectPath) {
      return null
    }

    const redirectUrl = new URL(redirectPath, 'https://www.jbsou.cn/').toString()
    const resolvedUrl = await this.parseClient.resolveUrl(redirectUrl, {
      headers: context.requestOptions?.headers as Record<string, string> | undefined,
      cookies: context.requestOptions?.cookies as Record<string, unknown> | string | undefined,
      timeoutMs: context.requestOptions?.timeoutMs as number | undefined,
      signal,
    })
    if (!resolvedUrl.startsWith('http')) {
      return null
    }

    const downloadUrlStatus = await this.audioLinkTester.test(resolvedUrl, {
      headers: context.requestOptions?.headers as Record<string, string> | undefined,
      cookies: context.requestOptions?.cookies as Record<string, unknown> | string | undefined,
      timeoutMs: context.requestOptions?.timeoutMs as number | undefined,
      signal,
    })
    if (!downloadUrlStatus.ok) {
      return null
    }

    const probe = await this.audioLinkTester.probe(resolvedUrl, {
      headers: context.requestOptions?.headers as Record<string, string> | undefined,
      cookies: context.requestOptions?.cookies as Record<string, unknown> | string | undefined,
      timeoutMs: context.requestOptions?.timeoutMs as number | undefined,
      signal,
    })
    if (!(probe.ext && probe.ext !== 'NULL')) {
      return null
    }

    let lyric = 'NULL'
    const lyricPath = String(item.lrc ?? '')
    if (lyricPath) {
      if (signal?.aborted) {
        return null
      }
      try {
        lyric = cleanLyric(
          await this.parseClient.text(new URL(lyricPath, 'https://www.jbsou.cn/').toString(), {
            headers: context.requestOptions?.headers as Record<string, string> | undefined,
            cookies: context.requestOptions?.cookies as Record<string, unknown> | string | undefined,
            timeoutMs: context.requestOptions?.timeoutMs as number | undefined,
            signal,
          }),
        )
      }
      catch {
        lyric = 'NULL'
      }
    }

    const coverPath = String(item.cover ?? '')
    const coverUrl = coverPath ? new URL(coverPath, 'https://www.jbsou.cn/').toString() : undefined
    const detail = await getQQSongDetail(songId)
    const durationS = Number(detail?.interval ?? 0) || probe.durationS || this.extractDurationSeconds(lyric)
    const album = String(item.album ?? '').trim() || String(detail?.album?.name ?? '').trim() || extractAlbumFromLyric(lyric)

    return {
      source: this.name,
      identifier: songId,
      songName: sanitizeText(String(item.name ?? '')),
      singers: sanitizeText(String(item.artist ?? '').replaceAll('/', ', ')),
      album: sanitizeText(album),
      ext: probe.ext,
      fileSize: probe.fileSize,
      durationS: durationS > 0 ? durationS : undefined,
      duration: durationS > 0 ? secondsToHms(durationS) : 'NULL',
      lyric,
      coverUrl,
      downloadUrl: resolvedUrl,
      protocol: 'http',
      rawData: {
        search: item,
        detail,
      },
    }
  }

  private extractDurationSeconds(lyric: string): number {
    const matches = [...lyric.matchAll(/\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\]/g)]
    if (matches.length === 0) {
      return 0
    }
    const last = matches.at(-1)
    if (!last) {
      return 0
    }
    return Number(last[1]) * 60 + Number(last[2])
  }
}
