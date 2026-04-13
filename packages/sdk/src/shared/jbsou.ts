import type { TrackDetail, TrackLookup, TrackSummary } from '@jannchie/mdl-core'
import type { SourceContext } from '@jannchie/mdl-core/internal'

import type { AudioLinkTester } from './audio-link-tester.js'
import type { HttpClient } from './http.js'

import { cleanLyric, sanitizeText, secondsToHms } from './utils.js'

export interface JbsouSearchItem {
  songid?: string
  name?: string
  artist?: string
  album?: string
  lrc?: string
  url?: string
  cover?: string
}

const JBSOU_BASE_URL = 'https://www.jbsou.cn/'

export function extractAlbumFromLyric(lyric: string): string {
  if (!lyric || lyric === 'NULL') {
    return ''
  }
  for (const line of lyric.split('\n').slice(0, 10)) {
    const match = line.match(/^\[al[:：]([^\]]+)\]$/i)
    if (match?.[1]?.trim()) {
      return match[1].trim()
    }
    if (/^\[\d{2}:\d{2}(?:\.\d{2,3})?\]/.test(line)) {
      break
    }
  }
  return ''
}

export async function searchJbsouSite(
  site: string,
  keyword: string,
  headers: Record<string, string>,
  options: { signal?: AbortSignal } = {},
): Promise<JbsouSearchItem[]> {
  const response = await fetch(JBSOU_BASE_URL, {
    method: 'POST',
    headers,
    body: new URLSearchParams({
      input: keyword,
      filter: 'name',
      type: site,
      page: '1',
    }),
    signal: options.signal,
  })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${response.url}`)
  }
  const payload = (await response.json()) as { data?: JbsouSearchItem[] }
  return Array.isArray(payload.data) ? payload.data : []
}

export function buildJbsouSearchKeywords(track: Pick<TrackLookup, 'songName' | 'singers'>): string[] {
  const songName = track.songName?.trim() ?? ''
  const singers = track.singers?.trim() ?? ''
  const firstSinger = singers
    .split(',')
    .map(name => name.trim())
    .find(Boolean) ?? ''

  return [...new Set([
    [songName, singers].filter(Boolean).join(' ').trim(),
    [songName, firstSinger].filter(Boolean).join(' ').trim(),
    songName,
  ].filter(Boolean))]
}

export async function refreshJbsouSearchItem(options: {
  site: string
  identifier: string
  track: Pick<TrackLookup, 'songName' | 'singers'>
  headers: Record<string, string>
  signal?: AbortSignal
}): Promise<JbsouSearchItem | null> {
  for (const keyword of buildJbsouSearchKeywords(options.track)) {
    const items = await searchJbsouSite(options.site, keyword, options.headers, {
      signal: options.signal,
    })
    const matched = items.find(item => String(item.songid ?? '') === options.identifier)
    if (matched) {
      return matched
    }
  }

  return null
}

export function buildSearchTrackFromJbsouItem(options: {
  sourceName: string
  rootSource: string
  item: JbsouSearchItem
}): TrackSummary | null {
  const { sourceName, rootSource, item } = options
  const songId = String(item.songid ?? '')
  if (!songId) {
    return null
  }

  const coverPath = String(item.cover ?? '')
  return {
    source: sourceName,
    rootSource,
    identifier: songId,
    songName: sanitizeText(String(item.name ?? '')),
    singers: sanitizeText(String(item.artist ?? '').replaceAll('/', ', ')),
    album: sanitizeText(String(item.album ?? '')),
    coverUrl: coverPath ? new URL(coverPath, JBSOU_BASE_URL).toString() : undefined,
    rawData: {
      search: item,
    },
  }
}

export async function resolveTrackFromJbsouItem(options: {
  sourceName: string
  rootSource: string
  item: JbsouSearchItem
  context: SourceContext
  parseClient: HttpClient
  audioLinkTester: AudioLinkTester
}): Promise<TrackDetail | null> {
  const { sourceName, rootSource, item, context, parseClient, audioLinkTester } = options
  const signal = context.requestOptions?.signal as AbortSignal | undefined
  if (signal?.aborted) {
    return null
  }
  const songId = String(item.songid ?? '')
  const redirectPath = String(item.url ?? '')
  if (!songId || !redirectPath) {
    return null
  }

  const redirectUrl = new URL(redirectPath, JBSOU_BASE_URL).toString()
  const resolvedUrl = await parseClient.resolveUrl(redirectUrl, {
    headers: context.requestOptions?.headers as Record<string, string> | undefined,
    cookies: context.requestOptions?.cookies as Record<string, unknown> | string | undefined,
    timeoutMs: context.requestOptions?.timeoutMs as number | undefined,
    signal: context.requestOptions?.signal as AbortSignal | undefined,
  })
  if (!resolvedUrl.startsWith('http')) {
    return null
  }

  const downloadUrlStatus = await audioLinkTester.test(resolvedUrl, {
    headers: context.requestOptions?.headers as Record<string, string> | undefined,
    cookies: context.requestOptions?.cookies as Record<string, unknown> | string | undefined,
    timeoutMs: context.requestOptions?.timeoutMs as number | undefined,
    signal: context.requestOptions?.signal as AbortSignal | undefined,
  })
  if (!downloadUrlStatus.ok) {
    return null
  }

  const probe = await audioLinkTester.probe(resolvedUrl, {
    headers: context.requestOptions?.headers as Record<string, string> | undefined,
    cookies: context.requestOptions?.cookies as Record<string, unknown> | string | undefined,
    timeoutMs: context.requestOptions?.timeoutMs as number | undefined,
    signal: context.requestOptions?.signal as AbortSignal | undefined,
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
        await parseClient.text(new URL(lyricPath, JBSOU_BASE_URL).toString(), {
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

  const durationS = probe.durationS ?? extractDurationSeconds(lyric)
  const coverPath = String(item.cover ?? '')
  const album = String(item.album ?? '').trim() || extractAlbumFromLyric(lyric)
  return {
    source: sourceName,
    rootSource,
    identifier: songId,
    songName: sanitizeText(String(item.name ?? '')),
    singers: sanitizeText(String(item.artist ?? '').replaceAll('/', ', ')),
    album: sanitizeText(album),
    ext: probe.ext,
    fileSize: probe.fileSize,
    durationS: durationS > 0 ? durationS : undefined,
    duration: durationS > 0 ? secondsToHms(durationS) : 'NULL',
    lyric,
    coverUrl: coverPath ? new URL(coverPath, JBSOU_BASE_URL).toString() : undefined,
    downloadUrl: resolvedUrl,
    protocol: 'http',
    rawData: {
      search: item,
    },
  }
}

function extractDurationSeconds(lyric: string): number {
  const matches = [...lyric.matchAll(/\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\]/g)]
  const last = matches.at(-1)
  if (!last) {
    return 0
  }
  return Number(last[1]) * 60 + Number(last[2])
}
