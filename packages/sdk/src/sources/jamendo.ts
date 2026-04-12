import type { ParsePlaylistOptions, SearchOptions, SourceContext, Track } from '@jannchie/mdl-core'

import { createHash } from 'node:crypto'

import { cleanLyric, hostMatches, resolveRequestedSearchCount, resolveSearchPageSize, safeGet, sanitizeText, secondsToHms, uniqueByIdentifier } from '../shared/utils.js'
import { BaseMusicSource } from './base.js'

const JAMENDO_HOSTS = ['jamendo.com', 'www.jamendo.com']

export class JamendoMusicSource extends BaseMusicSource {
  readonly name = 'JamendoMusicClient'
  protected readonly searchHeaders = {
    'referer': 'https://www.jamendo.com/search?q=musicdl',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
    'x-jam-version': '4rkl5f',
    'x-requested-with': 'XMLHttpRequest',
  }

  protected readonly parseHeaders = this.searchHeaders
  protected readonly downloadHeaders = {
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
  }

  protected buildSearchRequests(input: SearchOptions, context: SourceContext) {
    const pageSize = resolveSearchPageSize(input)
    const total = resolveRequestedSearchCount(input, pageSize)
    const searchRule = context.searchRule ?? {}
    const requests = []
    for (let count = 0; count < total; count += pageSize) {
      requests.push({
        url: 'https://www.jamendo.com/api/search',
        query: {
          query: input.keyword,
          type: 'track',
          limit: pageSize,
          identities: 'www',
          offset: count,
          ...searchRule,
        },
      })
    }
    return requests
  }

  protected extractSearchItems(payload: unknown): unknown[] {
    return Array.isArray(payload) ? payload : []
  }

  override async search(input: SearchOptions, context: SourceContext): Promise<Track[]> {
    const limit = input.searchSizePerSource
    const results: Track[] = []
    for (const request of this.buildSearchRequests(input, context)) {
      const payload = await this.searchClient.json<unknown>(request.url, {
        query: request.query,
        headers: this.makeJamHeaders('/api/search', context),
        cookies: context.requestOverrides?.cookies as Record<string, unknown> | string | undefined,
        timeoutMs: context.requestOverrides?.timeoutMs as number | undefined,
        signal: context.requestOverrides?.signal as AbortSignal | undefined,
      })
      for (const item of this.extractSearchItems(payload)) {
        const track = await this.parseSearchItem(item, context)
        if (!track?.downloadUrl) {
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

  protected async parseSearchItem(item: unknown, context: SourceContext): Promise<Track | null> {
    const signal = context.requestOverrides?.signal as AbortSignal | undefined
    if (signal?.aborted) {
      return null
    }
    const searchResult = item as Record<string, unknown>
    const songId = String(searchResult.id ?? '')
    if (!songId) {
      return null
    }

    const downloadResult = await this.parseClient.json<unknown>('https://www.jamendo.com/api/tracks', {
      query: { 'id[]': songId },
      headers: this.makeJamHeaders('/api/tracks', context),
      cookies: context.requestOverrides?.cookies as Record<string, unknown> | string | undefined,
      timeoutMs: context.requestOverrides?.timeoutMs as number | undefined,
      signal: context.requestOverrides?.signal as AbortSignal | undefined,
    })
    const trackPayload = Array.isArray(downloadResult) ? downloadResult[0] : null
    if (!trackPayload || typeof trackPayload !== 'object') {
      return null
    }

    const artistName
      = String(safeGet(searchResult, ['artist', 'name'], '')) || String(safeGet(trackPayload, ['artist', 'name'], ''))
    const albumName
      = String(safeGet(searchResult, ['album', 'name'], '')) || String(safeGet(trackPayload, ['album', 'name'], ''))
    const albumId
      = String(safeGet(searchResult, ['album', 'id'], ''))
      || String((trackPayload as Record<string, unknown>).albumId ?? '')

    const candidates = [
      safeGet(trackPayload, ['stream', 'flac'], null),
      safeGet(trackPayload, ['download', 'flac'], null),
      safeGet(trackPayload, ['stream', 'mp33'], null),
      safeGet(trackPayload, ['stream', 'mp32'], null),
      safeGet(trackPayload, ['download', 'mp3'], null),
      safeGet(trackPayload, ['stream', 'mp3'], null),
      safeGet(trackPayload, ['stream', 'ogg'], null),
      safeGet(trackPayload, ['download', 'ogg'], null),
      safeGet(searchResult, ['download', 'mp3'], null),
      safeGet(searchResult, ['stream', 'mp3'], null),
      safeGet(searchResult, ['download', 'ogg'], null),
      safeGet(searchResult, ['stream', 'ogg'], null),
    ]
      .map(value => String(value ?? ''))
      .filter(value => value.startsWith('http'))

    const tried = [`https://prod-1.storage.jamendo.com/download/track/${songId}/flac/`, ...candidates]

    for (const downloadUrl of tried) {
      if (signal?.aborted) {
        return null
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
      const ext = this.inferExt(downloadUrl, probe.ext)
      if (!ext) {
        continue
      }
      return {
        source: this.name,
        identifier: songId,
        songName: sanitizeText(String(searchResult.name ?? (trackPayload as Record<string, unknown>).name ?? '')),
        singers: sanitizeText(artistName),
        album: sanitizeText(albumName),
        ext,
        fileSize: probe.fileSize === 'NULL' ? undefined : probe.fileSize,
        durationS: Number(searchResult.duration ?? (trackPayload as Record<string, unknown>).duration ?? 0),
        duration: secondsToHms(Number(searchResult.duration ?? (trackPayload as Record<string, unknown>).duration ?? 0)),
        lyric: cleanLyric(String((trackPayload as Record<string, unknown>).lyrics ?? 'NULL').replaceAll('<br />', '\n')),
        coverUrl: albumId ? `https://usercontent.jamendo.com?type=album&id=${albumId}&width=300&trackid=${songId}` : undefined,
        downloadUrl,
        protocol: 'http',
        rawData: {
          search: searchResult,
          download: trackPayload,
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
    if (!hostMatches(input.playlistUrl, JAMENDO_HOSTS)) {
      return []
    }
    const match = input.playlistUrl.match(/\/playlist\/([^/?#]+)/)
    const playlistId = match?.[1]
    if (!playlistId) {
      return []
    }
    const payload = await this.parseClient.json<unknown>('https://www.jamendo.com/api/playlists', {
      query: { 'id[]': playlistId },
      headers: this.makeJamHeaders('/api/playlists', context),
      cookies: context.requestOverrides?.cookies as Record<string, unknown> | string | undefined,
      timeoutMs: context.requestOverrides?.timeoutMs as number | undefined,
      signal: context.requestOverrides?.signal as AbortSignal | undefined,
    })
    const playlist = Array.isArray(payload) ? payload[0] : null
    const tracks = Array.isArray((playlist as Record<string, unknown> | null)?.tracks)
      ? ((playlist as Record<string, unknown>).tracks as unknown[])
      : []
    const parsed = await Promise.all(tracks.map(track => this.parseSearchItem(track, context)))
    return uniqueByIdentifier(parsed.filter((track): track is Track => track !== null))
  }

  private makeJamHeaders(path: string, context: SourceContext): Record<string, string> {
    const random = String(Math.random())
    return {
      ...this.searchHeaders,
      ...(context.requestOverrides?.headers as Record<string, string> | undefined),
      'x-jam-call': `$${createHash('sha1').update(path + random).digest('hex')}*${random}~`,
    }
  }

  private inferExt(downloadUrl: string, probeExt: string): string | null {
    if (probeExt && probeExt !== 'NULL') {
      return probeExt === 'mp4' ? 'm4a' : probeExt
    }
    const url = new URL(downloadUrl)
    const format = url.searchParams.get('format')
    if (format) {
      return format.startsWith('mp3') ? 'mp3' : format
    }
    const match = url.pathname.match(/\/download\/track\/\d+\/([^/]+)\//)
    if (match?.[1]) {
      return match[1].startsWith('mp3') ? 'mp3' : match[1]
    }
    return null
  }
}
