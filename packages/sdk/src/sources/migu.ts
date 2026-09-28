import type { TrackDetail, TrackLookup, TrackSummary } from '@jannchie/mdl-core'
import type { ParsePlaylistRequest, SearchRequest, SourceContext } from '@jannchie/mdl-core/internal'

import { bytesToMb, cleanLyric, hostMatches, resolveRequestedSearchCount, resolveSearchPageSize, safeGet, sanitizeText, secondsToHms, uniqueByIdentifier } from '../shared/utils.js'
import { BaseMusicSource } from './base.js'

const MIGU_HOSTS = ['music.migu.cn', 'y.migu.cn']
const MIGU_MAGIC = [0xAB, 0xCD, 0x01]
const MIGU_KEY = new TextEncoder().encode('Jk8qzuePiJ1qE3mDYhLQ3T73DtDoAhLP')

/**
 * The h5 listen-url endpoint answers with an obfuscated body: 3 magic bytes, a seed byte, then bytes shifted by a repeating key.
 */
export function decryptMiguPayload(raw: Uint8Array, signature: string | null): unknown {
  const encrypted = signature === '1' || MIGU_MAGIC.every((byte, index) => raw[index] === byte)
  if (!encrypted) {
    return JSON.parse(new TextDecoder().decode(raw))
  }
  const seed = raw[3] ?? 0
  const plain = raw.subarray(4).map((byte, index) => (byte + seed - (MIGU_KEY[index % MIGU_KEY.length] ?? 0)) & 0xFF)
  return JSON.parse(new TextDecoder().decode(plain))
}

export class MiguMusicSource extends BaseMusicSource {
  readonly name = 'MiguMusicClient'
  protected readonly searchHeaders = {
    'accept': 'application/json, text/plain, */*',
    'origin': 'https://h5.nf.migu.cn',
    'referer': 'https://h5.nf.migu.cn/',
    'ua': 'Android_migu',
    'version': '6.8.8',
    'channel': '014021I',
    'subchannel': '014021I',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
  }

  protected readonly parseHeaders = this.searchHeaders
  protected readonly downloadHeaders = {
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
  }

  protected buildSearchRequests(input: SearchRequest, context: SourceContext) {
    const pageSize = resolveSearchPageSize(input)
    const total = resolveRequestedSearchCount(input, pageSize)
    const searchRule = context.sourceSearchOptions ?? {}
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

  protected async buildSearchTrack(item: unknown, _context: SourceContext): Promise<TrackSummary | null> {
    const searchResult = item as Record<string, unknown>
    const contentId = String(searchResult.contentId ?? '')
    if (!contentId) {
      return null
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
      coverUrl: this.resolveCoverUrl(searchResult),
      rawData: {
        search: searchResult,
      },
    }
  }

  protected async resolveTrackDetail(track: TrackLookup, context: SourceContext): Promise<TrackDetail> {
    if (this.isDetailedTrack(track)) {
      return track
    }

    const searchResult = track.rawData?.search as Record<string, unknown> | undefined
    const fallbackSearchResult: Record<string, unknown> = {
      contentId: track.identifier,
      name: track.songName,
      album: track.album,
      singers: (track.singers ?? '')
        .split(',')
        .map((name: string) => ({ name: name.trim() }))
        .filter((item: { name: string }) => item.name),
      img3: track.coverUrl,
    }

    const detailed = await this.resolveTrackFromSearchItem(searchResult ?? fallbackSearchResult, context)
    if (!detailed) {
      throw new Error(`Failed to fetch detail for ${track.identifier} from ${this.name}`)
    }
    return detailed
  }

  private async resolveTrackFromSearchItem(item: unknown, context: SourceContext): Promise<TrackDetail | null> {
    const searchResult = item as Record<string, unknown>
    const contentId = String(searchResult.contentId ?? '')
    const copyrightId = String(searchResult.copyrightId ?? '')
    if (!contentId || !copyrightId) {
      return null
    }

    const allFormats = [
      ...(safeGet(searchResult, ['rateFormats'], []) as Array<Record<string, unknown>>),
      ...(safeGet(searchResult, ['newRateFormats'], []) as Array<Record<string, unknown>>),
      ...(safeGet(searchResult, ['audioFormats'], []) as Array<Record<string, unknown>>),
    ]
    // The three lists overlap; Z3D is an encrypted format.
    const rateFormats = [...new Map(allFormats.map(item => [item.formatType, item])).values()]
      .filter(item => item.formatType !== 'Z3D')
      .sort((left, right) => this.parseRateSize(right) - this.parseRateSize(left))

    for (const rate of rateFormats) {
      const resourceType = String(rate.resourceType ?? '')
      const formatType = String(rate.formatType ?? '')
      if (!resourceType || !formatType) {
        continue
      }

      let payload: unknown = {}
      try {
        payload = await this.fetchListenUrl({
          contentId,
          copyrightId,
          resourceType,
          netType: '01',
          toneFlag: formatType,
          scene: '',
          lowerQualityContentId: contentId,
        }, context)
      }
      catch {
        continue
      }

      let downloadUrl = safeGet(payload, ['data', 'url'], '')
      if (!downloadUrl || typeof downloadUrl !== 'string' || !downloadUrl.startsWith('http')) {
        downloadUrl = `https://app.pd.nf.migu.cn/MIGUM3.0/v1.0/content/sub/listenSong.do?channel=mx&copyrightId=${copyrightId}&contentId=${contentId}&toneFlag=${formatType}&resourceType=${resourceType}&userId=15548614588710179085069&netType=00`
      }

      downloadUrl = downloadUrl.replace('/MP3_128_16_Stero/', '/MP3_320_16_Stero/')
      const durationS = Number(safeGet(payload, ['data', 'song', 'duration'], 0))
      const probe = await this.probeDownloadUrl(downloadUrl, context, durationS)
      if (!probe) {
        continue
      }

      let lyric = 'NULL'
      const lyricUrl = String(searchResult.lyricUrl ?? '')
      if (lyricUrl.startsWith('http')) {
        try {
          lyric = cleanLyric(await this.parseClient.text(lyricUrl, this.resolverOverrides(context)))
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
        ext: probe.ext,
        fileSizeBytes: this.parseRateSize(rate),
        fileSize: probe.fileSize === 'NULL' ? bytesToMb(this.parseRateSize(rate)) : probe.fileSize,
        durationS,
        duration: secondsToHms(durationS),
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

  override async parsePlaylist(input: ParsePlaylistRequest, context: SourceContext): Promise<TrackSummary[]> {
    if (!hostMatches(input.playlistUrl, MIGU_HOSTS)) {
      return []
    }

    const resolvedUrl = await this.parseClient.resolveUrl(input.playlistUrl, {
      headers: context.requestOptions?.headers as Record<string, string> | undefined,
      cookies: context.requestOptions?.cookies as Record<string, unknown> | string | undefined,
      timeoutMs: context.requestOptions?.timeoutMs as number | undefined,
      signal: context.requestOptions?.signal as AbortSignal | undefined,
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
        headers: context.requestOptions?.headers as Record<string, string> | undefined,
        cookies: context.requestOptions?.cookies as Record<string, unknown> | string | undefined,
        timeoutMs: context.requestOptions?.timeoutMs as number | undefined,
        signal: context.requestOptions?.signal as AbortSignal | undefined,
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

    const parsed = await Promise.all(tracks.map(item => this.buildSearchTrack(item, context)))
    return uniqueByIdentifier(parsed.filter((track): track is TrackSummary => track !== null))
  }

  private async fetchListenUrl(query: Record<string, string>, context: SourceContext): Promise<unknown> {
    const overrides = this.resolverOverrides(context)
    const target = `https://c.musicapp.migu.cn/strategy/listen-url/h5/v2.4?${new URLSearchParams(query)}`
    // Read raw bytes: the body is obfuscated and the `signature` header says how.
    const response = await this.parseClient.openStream(target, {
      ...overrides,
      headers: {
        'content-type': 'application/json;charset=UTF-8',
        'birth': 'h5page',
        'signature': '1',
        ...overrides.headers,
      },
    })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${response.url}`)
    }
    return decryptMiguPayload(new Uint8Array(await response.arrayBuffer()), response.headers.get('signature'))
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
}
