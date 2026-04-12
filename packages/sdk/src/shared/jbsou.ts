import type { SourceContext, Track } from '@jannchie/mdl-core'

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

export async function buildTrackFromJbsouItem(options: {
  sourceName: string
  rootSource: string
  item: JbsouSearchItem
  context: SourceContext
  parseClient: HttpClient
  audioLinkTester: AudioLinkTester
}): Promise<Track | null> {
  const { sourceName, rootSource, item, context, parseClient, audioLinkTester } = options
  const signal = context.requestOverrides?.signal as AbortSignal | undefined
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
    headers: context.requestOverrides?.headers as Record<string, string> | undefined,
    cookies: context.requestOverrides?.cookies as Record<string, unknown> | string | undefined,
    timeoutMs: context.requestOverrides?.timeoutMs as number | undefined,
    signal: context.requestOverrides?.signal as AbortSignal | undefined,
  })
  if (!resolvedUrl.startsWith('http')) {
    return null
  }

  const downloadUrlStatus = await audioLinkTester.test(resolvedUrl, {
    headers: context.requestOverrides?.headers as Record<string, string> | undefined,
    cookies: context.requestOverrides?.cookies as Record<string, unknown> | string | undefined,
    timeoutMs: context.requestOverrides?.timeoutMs as number | undefined,
    signal: context.requestOverrides?.signal as AbortSignal | undefined,
  })
  if (!downloadUrlStatus.ok) {
    return null
  }

  const probe = await audioLinkTester.probe(resolvedUrl, {
    headers: context.requestOverrides?.headers as Record<string, string> | undefined,
    cookies: context.requestOverrides?.cookies as Record<string, unknown> | string | undefined,
    timeoutMs: context.requestOverrides?.timeoutMs as number | undefined,
    signal: context.requestOverrides?.signal as AbortSignal | undefined,
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

  const durationS = extractDurationSeconds(lyric)
  const coverPath = String(item.cover ?? '')
  return {
    source: sourceName,
    rootSource,
    identifier: songId,
    songName: sanitizeText(String(item.name ?? '')),
    singers: sanitizeText(String(item.artist ?? '').replaceAll('/', ', ')),
    album: sanitizeText(String(item.album ?? '')),
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
