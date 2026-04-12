import type { ParsePlaylistOptions, SearchOptions, SourceContext, Track } from '@jannchie/mdl-core'

import { bytesToMb, cleanLyric, hostMatches, safeGet, sanitizeText, secondsToHms, uniqueByIdentifier } from '../shared/utils.js'
import { BaseMusicSource } from './base.js'

const MIGU_HOSTS = ['music.migu.cn', 'y.migu.cn']

export class MiguMusicSource extends BaseMusicSource {
  readonly name = 'MiguMusicClient'
  protected readonly searchHeaders = {
    'accept': 'application/json, text/plain, */*',
    'accept-language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
    'appid': 'ce',
    'channel': '014X031',
    'referer': 'https://y.migu.cn/app/v4/zt/2022/music/index.html',
    'origin': 'https://y.migu.cn',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
  }

  protected readonly parseHeaders = this.searchHeaders
  protected readonly downloadHeaders = {
    'accept': '*/*',
    'range': 'bytes=0-',
    'referer': 'https://y.migu.cn/app/v4/zt/2022/music/index.html',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
  }

  private static readonly qualityExt = new Map<string, string>([
    ['LQ', 'mp3'],
    ['PQ', 'mp3'],
    ['HQ', 'mp3'],
    ['SQ', 'flac'],
    ['ZQ', 'flac'],
    ['Z3D', 'flac'],
    ['ZQ24', 'flac'],
    ['ZQ32', 'flac'],
  ])

  protected buildSearchRequests(input: SearchOptions, context: SourceContext) {
    const pageSize = input.searchSizePerPage ?? 10
    const total = input.searchSizePerSource ?? 5
    const searchRule = context.searchRule ?? {}
    const requests = []
    for (let count = 0; count < total; count += pageSize) {
      requests.push({
        url: 'https://c.musicapp.migu.cn/v1.0/content/search_all.do',
        query: {
          text: input.keyword,
          pageNo: count / pageSize + 1,
          pageSize,
          isCopyright: 1,
          sort: 1,
          searchSwitch: JSON.stringify({
            song: 1,
            album: 0,
            singer: 0,
            tagSong: 1,
            mvSong: 0,
            bestShow: 1,
          }),
          ...searchRule,
        },
      })
    }
    return requests
  }

  protected extractSearchItems(payload: unknown): unknown[] {
    return safeGet(payload, ['songResultData', 'result'], [])
  }

  override async search(input: SearchOptions, context: SourceContext): Promise<Track[]> {
    const limit = input.searchSizePerSource ?? 5
    const results: Track[] = []
    for (let index = 1; index <= limit; index += 1) {
      const payload = await this.searchClient.json<unknown>('https://api.xcvts.cn/api/music/migu', {
        query: {
          gm: input.keyword,
          n: index,
          num: Math.max(limit, input.searchSizePerPage ?? limit),
          type: 'json',
        },
        headers: context.requestOverrides?.headers as Record<string, string> | undefined,
        cookies: context.requestOverrides?.cookies as Record<string, unknown> | string | undefined,
        timeoutMs: context.requestOverrides?.timeoutMs as number | undefined,
        signal: context.requestOverrides?.signal as AbortSignal | undefined,
      })
      const track = await this.parseXcvtsItem(payload, context)
      if (track?.downloadUrl) {
        results.push(track)
      }
    }
    return uniqueByIdentifier(results)
  }

  protected async parseSearchItem(item: unknown, context: SourceContext): Promise<Track | null> {
    const searchResult = item as Record<string, unknown>
    const contentId = String(searchResult.contentId ?? '')
    if (!contentId) {
      return null
    }

    const rateFormats = [
      ...(safeGet(searchResult, ['rateFormats'], []) as Array<Record<string, unknown>>),
      ...(safeGet(searchResult, ['newRateFormats'], []) as Array<Record<string, unknown>>),
      ...(safeGet(searchResult, ['audioFormats'], []) as Array<Record<string, unknown>>),
    ]
      .filter(item => item.formatType !== 'Z3D')
      .sort((left, right) => this.parseRateSize(right) - this.parseRateSize(left))

    for (const rate of rateFormats) {
      const resourceType = String(rate.resourceType ?? '')
      const formatType = String(rate.formatType ?? '')
      if (!resourceType || !formatType) {
        continue
      }

      const payload = await this.parseClient.json<unknown>('https://c.musicapp.migu.cn/MIGUM3.0/strategy/listen-url/v2.4', {
        query: {
          resourceType,
          netType: '01',
          scene: '',
          toneFlag: formatType,
          contentId,
          copyrightId: contentId,
          lowerQualityContentId: contentId,
        },
        headers: context.requestOverrides?.headers as Record<string, string> | undefined,
        cookies: context.requestOverrides?.cookies as Record<string, unknown> | string | undefined,
      })

      let downloadUrl = safeGet(payload, ['data', 'url'], '')
      if (!downloadUrl || typeof downloadUrl !== 'string' || !downloadUrl.startsWith('http')) {
        downloadUrl = `https://app.pd.nf.migu.cn/MIGUM3.0/v1.0/content/sub/listenSong.do?channel=mx&copyrightId=${contentId}&contentId=${contentId}&toneFlag=${formatType}&resourceType=${resourceType}&userId=15548614588710179085069&netType=00`
      }

      downloadUrl = downloadUrl.replace('/MP3_128_16_Stero/', '/MP3_320_16_Stero/')
      const downloadUrlStatus = await this.audioLinkTester.test(downloadUrl, {
        headers: context.requestOverrides?.headers as Record<string, string> | undefined,
        cookies: context.requestOverrides?.cookies as Record<string, unknown> | string | undefined,
      })
      if (!downloadUrlStatus.ok) {
        continue
      }
      const probe = await this.audioLinkTester.probe(downloadUrl, {
        headers: context.requestOverrides?.headers as Record<string, string> | undefined,
        cookies: context.requestOverrides?.cookies as Record<string, unknown> | string | undefined,
      })
      if (!(probe.ext && probe.ext !== 'NULL')) {
        continue
      }

      let lyric = 'NULL'
      const lyricUrl = String(searchResult.lyricUrl ?? '')
      if (lyricUrl.startsWith('http')) {
        try {
          lyric = cleanLyric(await this.parseClient.text(lyricUrl))
        }
        catch {
          lyric = 'NULL'
        }
      }

      return {
        source: this.name,
        identifier: contentId,
        songName: sanitizeText(String(searchResult.name ?? searchResult.songName ?? '')),
        singers: sanitizeText(
          ((safeGet(searchResult, ['singers'], []) as Array<{ name?: string }>)
            || (safeGet(searchResult, ['singerList'], []) as Array<{ name?: string }>))
            .map(artist => artist.name)
            .filter(Boolean)
            .join(', '),
        ),
        album: sanitizeText(
          String(
            searchResult.album
              ?? (safeGet(searchResult, ['albums'], []) as Array<{ name?: string }>)
                .map(album => album.name)
                .filter(Boolean)
                .join(', '),
          ),
        ),
        ext: probe.ext ?? MiguMusicSource.qualityExt.get(formatType) ?? 'mp3',
        fileSizeBytes: this.parseRateSize(rate),
        fileSize: probe.fileSize === 'NULL' ? bytesToMb(this.parseRateSize(rate)) : probe.fileSize,
        durationS: Number(safeGet(payload, ['data', 'song', 'duration'], 0)),
        duration: secondsToHms(Number(safeGet(payload, ['data', 'song', 'duration'], 0))),
        lyric,
        coverUrl: this.resolveCoverUrl(searchResult),
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
    if (!hostMatches(input.playlistUrl, MIGU_HOSTS)) {
      return []
    }

    const resolvedUrl = await this.parseClient.resolveUrl(input.playlistUrl, {
      headers: context.requestOverrides?.headers as Record<string, string> | undefined,
      cookies: context.requestOverrides?.cookies as Record<string, unknown> | string | undefined,
    })
    const url = new URL(resolvedUrl)
    const playlistId = url.searchParams.get('playlistId') ?? url.pathname.split('/').pop()?.replace(/\.html?$/, '') ?? ''
    if (!playlistId) {
      return []
    }

    const tracks: unknown[] = []
    for (let page = 1; ; page += 1) {
      const payload = await this.parseClient.json<unknown>('https://app.c.nf.migu.cn/MIGUM3.0/resource/playlist/song/v2.0', {
        query: {
          pageNo: page,
          pageSize: 50,
          playlistId,
        },
        headers: context.requestOverrides?.headers as Record<string, string> | undefined,
        cookies: context.requestOverrides?.cookies as Record<string, unknown> | string | undefined,
      })
      const items = safeGet(payload, ['data', 'songList'], [])
      if (!Array.isArray(items) || items.length === 0) {
        break
      }
      tracks.push(...items)
      const total = Number(safeGet(payload, ['data', 'totalCount'], 0))
      if (tracks.length >= total) {
        break
      }
    }

    const parsed = await Promise.all(tracks.map(item => this.parseSearchItem(item, context)))
    return uniqueByIdentifier(parsed.filter((track): track is Track => track !== null))
  }

  private parseRateSize(rate: Record<string, unknown>): number {
    const raw = rate.size ?? rate.iosSize ?? rate.androidSize ?? rate.isize ?? rate.asize ?? 0
    const text = String(raw).replace(/MB$/i, '').trim()
    const numeric = Number(text)
    if (Number.isFinite(numeric) && numeric > 0 && numeric < 10_000) {
      return numeric * 1024 * 1024
    }
    return Number(raw) || 0
  }

  private resolveCoverUrl(searchResult: Record<string, unknown>): string | undefined {
    const imgItems = safeGet(searchResult, ['imgItems'], []) as Array<{ img?: string }>
    const fromItems = imgItems.at(-1)?.img
    const value = fromItems || String(searchResult.img3 ?? searchResult.img2 ?? searchResult.img1 ?? '')
    if (!value) {
      return undefined
    }
    return value.startsWith('http') ? value : new URL(value, 'https://d.musicapp.migu.cn').toString()
  }

  private async parseXcvtsItem(payload: unknown, context: SourceContext): Promise<Track | null> {
    const data = payload as Record<string, unknown>
    const downloadUrl = String(data.music_url ?? '')
    if (!downloadUrl.startsWith('http')) {
      return null
    }

    const downloadUrlStatus = await this.audioLinkTester.test(downloadUrl, {
      headers: context.requestOverrides?.headers as Record<string, string> | undefined,
      cookies: context.requestOverrides?.cookies as Record<string, unknown> | string | undefined,
      timeoutMs: context.requestOverrides?.timeoutMs as number | undefined,
      signal: context.requestOverrides?.signal as AbortSignal | undefined,
    })
    if (!downloadUrlStatus.ok) {
      return null
    }

    const probe = await this.audioLinkTester.probe(downloadUrl, {
      headers: context.requestOverrides?.headers as Record<string, string> | undefined,
      cookies: context.requestOverrides?.cookies as Record<string, unknown> | string | undefined,
      timeoutMs: context.requestOverrides?.timeoutMs as number | undefined,
      signal: context.requestOverrides?.signal as AbortSignal | undefined,
    })
    if (!(probe.ext && probe.ext !== 'NULL')) {
      return null
    }

    let lyric = 'NULL'
    const lyricUrl = String(data.lrc_url ?? '')
    if (lyricUrl.startsWith('http')) {
      try {
        lyric = cleanLyric(
          await this.parseClient.text(lyricUrl, {
            headers: context.requestOverrides?.headers as Record<string, string> | undefined,
            cookies: context.requestOverrides?.cookies as Record<string, unknown> | string | undefined,
            timeoutMs: context.requestOverrides?.timeoutMs as number | undefined,
            signal: context.requestOverrides?.signal as AbortSignal | undefined,
          }),
        )
      }
      catch {
        lyric = 'NULL'
      }
    }

    return {
      source: this.name,
      identifier: this.extractMiguIdentifier(String(data.link ?? '')) || sanitizeText(String(data.title ?? '')),
      songName: sanitizeText(String(data.title ?? '')),
      singers: sanitizeText(String(data.singer ?? '')),
      album: 'NULL',
      ext: probe.ext,
      fileSize: probe.fileSize,
      lyric,
      coverUrl: String(data.cover ?? '') || undefined,
      downloadUrl,
      protocol: 'http',
      rawData: {
        search: payload,
      },
    }
  }

  private extractMiguIdentifier(link: string): string {
    if (!link.startsWith('http')) {
      return ''
    }
    return link.split('/').pop() ?? ''
  }
}
