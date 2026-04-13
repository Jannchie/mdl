import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import { cookieHeader } from './utils.js'

export interface RequestOverrides {
  headers?: Record<string, string>
  cookies?: Record<string, unknown> | string
  timeoutMs?: number
  signal?: AbortSignal
}

export interface RequestOptions extends RequestOverrides {
  method?: 'GET' | 'POST' | 'HEAD'
  query?: Record<string, string | number | boolean>
  json?: unknown
}

export interface AudioProbe {
  ok: boolean
  ext?: string
  contentLength?: number
  fileSize?: string
}

export class HttpClient {
  constructor(private readonly defaultHeaders: Record<string, string> = {}) {}

  async json<T>(url: string, options: RequestOptions = {}): Promise<T> {
    const response = await this.request(url, options)
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${response.url}`)
    }
    return (await response.json()) as T
  }

  async text(url: string, options: RequestOptions = {}): Promise<string> {
    const response = await this.request(url, options)
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${response.url}`)
    }
    return await response.text()
  }

  async resolveUrl(url: string, options: RequestOptions = {}): Promise<string> {
    const response = await this.request(url, { ...options, method: 'HEAD' })
    return response.url
  }

  async openStream(url: string, options: RequestOverrides = {}): Promise<Response> {
    return await this.request(url, options)
  }

  async downloadToFile(url: string, savePath: string, options: RequestOverrides = {}): Promise<void> {
    const controller = new AbortController()
    const timeout = options.timeoutMs ? setTimeout(() => controller.abort(), options.timeoutMs) : null
    const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal
    try {
      const response = await this.openStream(url, { ...options, signal })
      if (!response.ok || !response.body) {
        throw new Error(`Failed to download ${response.url}`)
      }
      await mkdir(path.dirname(savePath), { recursive: true })
      await pipeline(
        Readable.fromWeb(response.body as unknown as NodeReadableStream),
        createWriteStream(savePath),
        { signal },
      )
    }
    finally {
      if (timeout) {
        clearTimeout(timeout)
      }
    }
  }

  async probeAudio(url: string, options: RequestOverrides = {}): Promise<AudioProbe> {
    const response = await this.request(url, {
      ...options,
      headers: {
        Range: 'bytes=0-0',
        ...options.headers,
      },
    })
    if (!response.ok && response.status !== 206) {
      return { ok: false }
    }
    const contentType = response.headers.get('content-type') ?? ''
    const contentLength = Number(response.headers.get('content-length') ?? '0') || undefined
    const ext = this.inferExt(url, contentType)
    return {
      ok: true,
      ext,
      contentLength,
      fileSize: contentLength ? `${(contentLength / 1024 / 1024).toFixed(2)} MB` : undefined,
    }
  }

  private async request(url: string, options: RequestOptions = {}): Promise<Response> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000)
    const headers = new Headers(this.defaultHeaders)
    for (const [key, value] of Object.entries(options.headers ?? {})) {
      headers.set(key, value)
    }
    const cookie = cookieHeader(options.cookies)
    if (cookie) {
      headers.set('cookie', cookie)
    }
    if (options.json !== undefined) {
      headers.set('content-type', 'application/json')
    }
    const finalUrl = this.withQuery(url, options.query)
    try {
      const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal
      return await fetch(finalUrl, {
        method: options.method ?? (options.json === undefined ? 'GET' : 'POST'),
        headers,
        body: options.json === undefined ? null : JSON.stringify(options.json),
        redirect: 'follow',
        signal,
      })
    }
    finally {
      clearTimeout(timeout)
    }
  }

  private withQuery(url: string, query?: Record<string, string | number | boolean>): string {
    if (!query) {
      return url
    }
    const target = new URL(url)
    for (const [key, value] of Object.entries(query)) {
      target.searchParams.set(key, String(value))
    }
    return target.toString()
  }

  private inferExt(url: string, contentType: string): string | undefined {
    const pathname = new URL(url).pathname
    const fromPath = pathname.split('.').pop()
    if (fromPath && fromPath.length <= 5) {
      return fromPath
    }
    if (contentType.includes('flac')) {
      return 'flac'
    }
    if (contentType.includes('mpeg')) {
      return 'mp3'
    }
    if (contentType.includes('aac')) {
      return 'aac'
    }
    return undefined
  }
}
