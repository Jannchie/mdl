import type { SearchOptions } from '@jannchie/mdl-core'

import { mkdir } from 'node:fs/promises'
import path from 'node:path'

export function safeGet<T>(value: unknown, pathSegments: Array<string | number>, fallback: T): T {
  let current: unknown = value
  for (const segment of pathSegments) {
    if (Array.isArray(current) && typeof segment === 'number') {
      const index = segment >= 0 ? segment : current.length + segment
      current = current[index]
      continue
    }
    if (current && typeof current === 'object' && segment in current) {
      current = (current as Record<string | number, unknown>)[segment]
      continue
    }
    return fallback
  }
  return (current as T) ?? fallback
}

export function bytesToMb(value: number | null | undefined): string {
  if (!value || Number.isNaN(value)) {
    return 'NULL'
  }
  return `${(value / 1024 / 1024).toFixed(2)} MB`
}

export function secondsToHms(value: number | null | undefined): string {
  if (!value || Number.isNaN(value)) {
    return 'NULL'
  }
  const total = Math.floor(value)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export function sanitizeText(value: string | null | undefined): string {
  const text = (value ?? '').trim()
  if (!text) {
    return 'NULL'
  }
  return text.replaceAll(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
}

export function cleanLyric(value: string | null | undefined): string {
  const text = (value ?? '').replaceAll('\r\n', '\n').trim()
  return text || 'NULL'
}

export function cookieHeader(value: string | Record<string, unknown> | undefined): string | undefined {
  if (!value) {
    return undefined
  }
  if (typeof value === 'string') {
    return value
  }
  const parts = Object.entries(value)
    .filter((entry): entry is [string, string | number | boolean] => entry[1] !== undefined && entry[1] !== null)
    .map(([key, item]) => `${key}=${String(item)}`)
  return parts.length > 0 ? parts.join('; ') : undefined
}

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true })
}

export function buildTrackOutputPath(baseDir: string, sourceName: string, trackName: string, identifier: string, ext: string): string {
  const filename = `${sanitizeText(trackName)} - ${sanitizeText(identifier)}.${ext.replace(/^\./, '') || 'mp3'}`
  return path.join(baseDir, sourceName, filename)
}

export function uniqueByIdentifier<T extends { identifier: string }>(items: T[]): T[] {
  const seen = new Set<string>()
  const result: T[] = []
  for (const item of items) {
    if (seen.has(item.identifier)) {
      continue
    }
    seen.add(item.identifier)
    result.push(item)
  }
  return result
}

export function hostMatches(urlString: string, suffixes: string[]): boolean {
  try {
    const hostname = new URL(urlString).hostname.toLowerCase()
    return suffixes.some(suffix => hostname === suffix || hostname.endsWith(`.${suffix}`))
  }
  catch {
    return false
  }
}

export function resolveSearchPageSize(input: Pick<SearchOptions, 'searchSizePerPage'>, fallback = 10): number {
  return input.searchSizePerPage ?? fallback
}

export function resolveRequestedSearchCount(
  input: Pick<SearchOptions, 'searchSizePerPage' | 'searchSizePerSource'>,
  fallbackPageSize = 10,
): number {
  return input.searchSizePerSource ?? input.searchSizePerPage ?? fallbackPageSize
}
